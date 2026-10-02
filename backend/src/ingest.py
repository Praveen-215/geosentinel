"""
Deterministic Sentinel-2 L2A scene ingestion and validation for GeoSentinel.

Pipeline: scenes.csv + aoi.geojson + scene rasters → validate → Scene → SQLite.

Stops after validate / fingerprint / register / produce Scene records.
Does not resample, tile, embed, retrieve, detect change, or read evaluation labels.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sqlite3
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
import rasterio
from rasterio.crs import CRS
from rasterio.features import geometry_mask
from rasterio.warp import transform_bounds, transform_geom
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

# contracts.py lives in backend/; support `python -m src.ingest` from backend/
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from contracts import BoundingBox, Scene  # noqa: E402

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sentinel-2 L2A Scene Classification Layer (SCL) — ESA / Sen2Cor classes
#
# Official SCL integer codes (0–11):
#   0  NO_DATA               — no data / missing
#   1  SATURATED_DEFECTIVE   — saturated or defective
#   2  DARK_AREA_PIXELS      — dark area / topographic cast shadow
#                              (semantics vary by processing baseline)
#   3  CLOUD_SHADOWS         — cloud shadows
#   4  VEGETATION            — vegetation
#   5  NOT_VEGETATED         — not vegetated (bare soil/rock)
#   6  WATER                 — water
#   7  UNCLASSIFIED          — unclassified
#   8  CLOUD_MEDIUM_PROB     — cloud, medium probability
#   9  CLOUD_HIGH_PROB       — cloud, high probability
#   10 THIN_CIRRUS           — thin cirrus
#   11 SNOW_ICE              — snow or ice
# ---------------------------------------------------------------------------
SCL_CLASS_NAMES: dict[int, str] = {
    0: "NO_DATA",
    1: "SATURATED_DEFECTIVE",
    2: "DARK_AREA_PIXELS",
    3: "CLOUD_SHADOWS",
    4: "VEGETATION",
    5: "NOT_VEGETATED",
    6: "WATER",
    7: "UNCLASSIFIED",
    8: "CLOUD_MEDIUM_PROB",
    9: "CLOUD_HIGH_PROB",
    10: "THIN_CIRRUS",
    11: "SNOW_ICE",
}

# Pilot quality policy (Sentinel-2 L2A). Single source of truth — do not duplicate.
SCL_CLOUD_CLASSES: frozenset[int] = frozenset({8, 9, 10})
SCL_CLOUD_SHADOW_CLASSES: frozenset[int] = frozenset({3})
# valid_percent = usable clear-surface observation percentage for this pilot.
SCL_VALID_CLASSES: frozenset[int] = frozenset({4, 5, 6})
# Explicitly excluded from valid_percent (everything except clear vegetation/bare/water).
SCL_EXCLUDED_FROM_VALID: frozenset[int] = frozenset({0, 1, 2, 3, 7, 8, 9, 10, 11})

SCL_QUALITY_POLICY: dict[str, Any] = {
    "name": "sentinel2_l2a_pilot_clear_surface",
    "valid_definition": (
        "usable clear-surface observation percentage "
        "(vegetation + not-vegetated + water only)"
    ),
    "class_names": dict(SCL_CLASS_NAMES),
    "cloud_classes": sorted(SCL_CLOUD_CLASSES),
    "cloud_shadow_classes": sorted(SCL_CLOUD_SHADOW_CLASSES),
    "valid_classes": sorted(SCL_VALID_CLASSES),
    "excluded_from_valid": sorted(SCL_EXCLUDED_FROM_VALID),
}

REQUIRED_BANDS: tuple[str, ...] = (
    "B02",
    "B03",
    "B04",
    "B05",
    "B06",
    "B07",
    "B08",
    "B11",
    "B12",
    "SCL",
)

EXPECTED_RESOLUTION_M: dict[str, int] = {
    "B02": 10,
    "B03": 10,
    "B04": 10,
    "B08": 10,
    "B05": 20,
    "B06": 20,
    "B07": 20,
    "B11": 20,
    "B12": 20,
    "SCL": 20,
}

# Pilot stage: GeoTIFF / COG only. JP2 / SAFE is a future extension.
GEOTIFF_EXTENSIONS: frozenset[str] = frozenset({".tif", ".tiff"})

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS scenes (
    product_id TEXT PRIMARY KEY,
    satellite TEXT,
    sensor TEXT,
    acquisition_date TEXT,
    processing_level TEXT,
    processing_baseline TEXT,
    mgrs_tile TEXT,
    relative_orbit INTEGER,
    crs TEXT,
    bbox_json TEXT,
    bands_json TEXT,
    band_resolution_m_json TEXT,
    cloud_percent REAL,
    shadow_percent REAL,
    valid_percent REAL,
    status TEXT NOT NULL,
    rejection_reason TEXT,
    warnings_json TEXT,
    ingested_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL
);
"""

QUALITY_MISMATCH_TOLERANCE = 1.0  # percentage points


# ---------------------------------------------------------------------------
# Small result containers
# ---------------------------------------------------------------------------
@dataclass
class RasterInfo:
    path: Path
    band: str
    crs: str
    bounds: tuple[float, float, float, float]  # left, bottom, right, top in CRS
    width: int
    height: int
    transform: tuple[float, ...]
    pixel_size_x: float
    pixel_size_y: float
    dtype: str
    band_count: int
    nodata: Any
    driver: str


@dataclass
class AssetFingerprint:
    path: str
    size_bytes: int
    sha256: str


@dataclass
class SceneValidation:
    product_id: str
    status: str  # accepted | rejected
    rejection_reason: Optional[str] = None
    warnings: list[str] = field(default_factory=list)
    satellite: Optional[str] = None
    sensor: Optional[str] = None
    acquisition_date: Optional[str] = None
    processing_level: Optional[str] = None
    processing_baseline: Optional[str] = None
    mgrs_tile: Optional[str] = None
    relative_orbit: Optional[int] = None
    crs: Optional[str] = None
    bbox_wgs84: Optional[BoundingBox] = None
    native_bounds: Optional[tuple[float, float, float, float]] = None
    bands: list[str] = field(default_factory=list)
    band_resolution_m: dict[str, int] = field(default_factory=dict)
    cloud_percent: Optional[float] = None
    shadow_percent: Optional[float] = None
    valid_percent: Optional[float] = None
    assets: dict[str, RasterInfo] = field(default_factory=dict)
    fingerprints: list[AssetFingerprint] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    scene: Optional[Scene] = None


@dataclass
class IngestSummary:
    accepted: int = 0
    rejected: int = 0
    skipped: int = 0
    scenes: list[Scene] = field(default_factory=list)


# ---------------------------------------------------------------------------
# CSV / AOI IO
# ---------------------------------------------------------------------------
def _optional_str(row: pd.Series, *names: str) -> Optional[str]:
    for name in names:
        if name in row.index and pd.notna(row[name]):
            value = str(row[name]).strip()
            if value:
                return value
    return None


def _optional_float(row: pd.Series, *names: str) -> Optional[float]:
    for name in names:
        if name in row.index and pd.notna(row[name]):
            try:
                return float(row[name])
            except (TypeError, ValueError):
                continue
    return None


def _optional_int(row: pd.Series, *names: str) -> Optional[int]:
    for name in names:
        if name in row.index and pd.notna(row[name]):
            try:
                return int(row[name])
            except (TypeError, ValueError):
                continue
    return None


def normalize_processing_baseline(row: pd.Series) -> str:
    """Accept processing_baseline or baseline; fail if neither is present."""
    value = _optional_str(row, "processing_baseline", "baseline")
    if value is None:
        raise ValueError(
            "Missing required baseline metadata: need 'processing_baseline' or 'baseline'"
        )
    return value


def load_scenes_csv(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"scenes.csv not found: {path}")
    df = pd.read_csv(path)
    if "product_id" not in df.columns:
        raise ValueError("scenes.csv missing required column: product_id")
    if df["product_id"].isna().any() or (df["product_id"].astype(str).str.strip() == "").any():
        raise ValueError("scenes.csv has empty product_id values")
    if "processing_baseline" not in df.columns and "baseline" not in df.columns:
        raise ValueError(
            "scenes.csv missing required baseline column: "
            "need 'processing_baseline' or 'baseline'"
        )
    return df


def load_aoi(path: Path) -> BaseGeometry:
    if not path.is_file():
        raise FileNotFoundError(f"aoi.geojson not found: {path}")
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    geoms: list[BaseGeometry] = []
    if data.get("type") == "FeatureCollection":
        for feat in data.get("features", []):
            geoms.append(shape(feat["geometry"]))
    elif data.get("type") == "Feature":
        geoms.append(shape(data["geometry"]))
    elif "coordinates" in data:
        geoms.append(shape(data))
    else:
        raise ValueError(f"Unsupported GeoJSON structure in {path}")

    if not geoms:
        raise ValueError(f"No geometries found in {path}")
    return unary_union(geoms)


# ---------------------------------------------------------------------------
# Product ID / satellite helpers
# ---------------------------------------------------------------------------
def derive_satellite_sensor(product_id: str) -> tuple[str, str]:
    """Derive satellite and sensor from a Sentinel-2 product ID when possible."""
    pid = product_id.upper()
    if pid.startswith("S2A"):
        return "Sentinel-2A", "MSI"
    if pid.startswith("S2B"):
        return "Sentinel-2B", "MSI"
    if pid.startswith("S2C"):
        return "Sentinel-2C", "MSI"
    return "Sentinel-2", "MSI"


def parse_acquisition_from_product_id(product_id: str) -> Optional[str]:
    """Extract sensing time from S2*_*_YYYYMMDDTHHMMSS_* product IDs."""
    match = re.search(r"_(\d{8}T\d{6})_", product_id)
    if not match:
        return None
    raw = match.group(1)
    try:
        dt = datetime.strptime(raw, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None


def parse_mgrs_from_product_id(product_id: str) -> Optional[str]:
    match = re.search(r"_T([0-9]{2}[A-Z]{3})(?:_|$)", product_id.upper())
    return match.group(1) if match else None


def parse_orbit_from_product_id(product_id: str) -> Optional[int]:
    match = re.search(r"_R(\d{3})_", product_id.upper())
    return int(match.group(1)) if match else None


# ---------------------------------------------------------------------------
# Asset discovery and raster metadata (deterministic GeoTIFF / COG layout)
# ---------------------------------------------------------------------------
def _is_geotiff(path: Path) -> bool:
    return path.suffix.lower() in GEOTIFF_EXTENSIONS


def _band_token_pattern(band: str) -> re.Pattern[str]:
    # Match B02.tif, B02_10m.tif, *_SCL.tif, etc. Avoid matching B08 inside B8A.
    if band == "SCL":
        return re.compile(r"(?:^|[_./-])SCL(?:[_./-]|$)", re.IGNORECASE)
    return re.compile(rf"(?:^|[_./-]){re.escape(band)}(?:[_./-]|$)", re.IGNORECASE)


def _list_geotiffs_in_dir(directory: Path) -> list[Path]:
    """Non-recursive listing of GeoTIFF files in a single directory."""
    if not directory.is_dir():
        return []
    return sorted(
        p.resolve()
        for p in directory.iterdir()
        if p.is_file() and _is_geotiff(p)
    )


def _resolve_csv_asset_path(imagery_root: Path, raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        path = imagery_root / path
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(f"CSV asset path does not exist: {path}")
    if not _is_geotiff(path):
        raise ValueError(
            f"CSV asset must be GeoTIFF (.tif/.tiff); got {path.suffix}: {path}"
        )
    return path


def _discover_band_in_scene_dir(scene_dir: Path, band: str) -> Path:
    """
    Deterministic discovery inside one product directory.

    Preference order:
      1. Exact `{band}.tif` / `{band}.tiff` (case-insensitive stem)
      2. Unique filename token match among GeoTIFFs in that directory only

    Zero or multiple matches → reject (no guessing).
    """
    geotiffs = _list_geotiffs_in_dir(scene_dir)
    if not geotiffs:
        raise FileNotFoundError(
            f"No GeoTIFF (.tif/.tiff) assets found in scene directory: {scene_dir}"
        )

    exact = [p for p in geotiffs if p.stem.upper() == band.upper()]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise FileNotFoundError(
            f"Multiple exact GeoTIFF matches for {band} in {scene_dir}: "
            + ", ".join(str(p) for p in exact)
        )

    pattern = _band_token_pattern(band)
    token_matches = [p for p in geotiffs if pattern.search(p.name)]
    if len(token_matches) == 0:
        raise FileNotFoundError(
            f"No GeoTIFF found for required band {band} in {scene_dir} "
            f"(expected {band}.tif / {band}.tiff or a unique equivalent filename)"
        )
    if len(token_matches) > 1:
        raise FileNotFoundError(
            f"Ambiguous GeoTIFF matches for {band} in {scene_dir}: "
            + ", ".join(str(p) for p in token_matches)
        )
    return token_matches[0]


def resolve_scene_assets(imagery_root: Path, product_id: str, row: pd.Series) -> dict[str, Path]:
    """
    Locate required band GeoTIFFs for a scene.

    Primary layout: imagery_root / product_id / <band>.tif
    Optional overrides: CSV scene_dir, or per-band path_* / *_path columns.
    Does not recursively search the entire imagery root.
    """
    found: dict[str, Path] = {}

    for band in REQUIRED_BANDS:
        col_path = _optional_str(row, f"path_{band}", f"{band}_path", f"{band}_file")
        if col_path:
            found[band] = _resolve_csv_asset_path(imagery_root, col_path)

    remaining = [b for b in REQUIRED_BANDS if b not in found]
    if not remaining:
        return found

    scene_rel = _optional_str(row, "scene_dir", "relative_path", "directory")
    if scene_rel:
        scene_dir = Path(scene_rel)
        if not scene_dir.is_absolute():
            scene_dir = imagery_root / scene_dir
        scene_dir = scene_dir.resolve()
    else:
        scene_dir = (imagery_root / product_id).resolve()

    if not scene_dir.is_dir():
        raise FileNotFoundError(
            f"Scene directory not found for {product_id}: {scene_dir}"
        )

    for band in remaining:
        found[band] = _discover_band_in_scene_dir(scene_dir, band)

    return found


def read_raster_metadata(path: Path, band: str) -> RasterInfo:
    with rasterio.open(path) as ds:
        if ds.crs is None:
            raise ValueError(f"Raster has no CRS: {path}")
        transform = ds.transform
        return RasterInfo(
            path=path,
            band=band,
            crs=ds.crs.to_string(),
            bounds=tuple(ds.bounds),  # type: ignore[arg-type]
            width=ds.width,
            height=ds.height,
            transform=(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f),
            pixel_size_x=abs(transform.a),
            pixel_size_y=abs(transform.e),
            dtype=str(ds.dtypes[0]),
            band_count=ds.count,
            nodata=ds.nodata,
            driver=ds.driver,
        )


def validate_band_resolutions(assets: dict[str, RasterInfo]) -> tuple[dict[str, int], list[str]]:
    """Record native resolutions; warn when they differ from S2 expectations."""
    resolutions: dict[str, int] = {}
    warnings: list[str] = []
    for band, info in assets.items():
        native = int(round(min(info.pixel_size_x, info.pixel_size_y)))
        resolutions[band] = native
        expected = EXPECTED_RESOLUTION_M.get(band)
        if expected is not None and native != expected:
            warnings.append(
                f"Band {band} native resolution {native} m != expected {expected} m "
                f"(preserving native value; no resampling)"
            )
    return resolutions, warnings


# ---------------------------------------------------------------------------
# Geometry / AOI coverage
# ---------------------------------------------------------------------------
def common_coverage_footprint(
    assets: dict[str, RasterInfo],
    target_crs: str,
) -> BaseGeometry:
    """Intersection of all required asset footprints in a common CRS."""
    polys: list[BaseGeometry] = []
    for info in assets.values():
        geom = {
            "type": "Polygon",
            "coordinates": [[
                [info.bounds[0], info.bounds[1]],
                [info.bounds[2], info.bounds[1]],
                [info.bounds[2], info.bounds[3]],
                [info.bounds[0], info.bounds[3]],
                [info.bounds[0], info.bounds[1]],
            ]],
        }
        if CRS.from_user_input(info.crs) != CRS.from_user_input(target_crs):
            geom = transform_geom(info.crs, target_crs, geom)
        polys.append(shape(geom))
    if not polys:
        raise ValueError("No asset footprints available for coverage check")
    intersection = polys[0]
    for poly in polys[1:]:
        intersection = intersection.intersection(poly)
    if intersection.is_empty:
        raise ValueError("Required assets have empty common coverage footprint")
    return intersection


def aoi_in_crs(aoi: BaseGeometry, source_crs: str, target_crs: str) -> BaseGeometry:
    if CRS.from_user_input(source_crs) == CRS.from_user_input(target_crs):
        return aoi
    geom = transform_geom(source_crs, target_crs, mapping(aoi))
    return shape(geom)


def check_aoi_coverage(
    aoi: BaseGeometry,
    aoi_crs: str,
    assets: dict[str, RasterInfo],
) -> tuple[bool, str, BaseGeometry, str]:
    """
    Verify AOI is fully covered by the intersection of all required assets.

    Uses shapely covers() (no silent buffering). Geometries are transformed to
    a common CRS first.

    Returns (ok, reason, footprint_in_target_crs, target_crs).
    """
    ref = assets.get("B02") or next(iter(assets.values()))
    target_crs = ref.crs
    footprint = common_coverage_footprint(assets, target_crs)
    aoi_t = aoi_in_crs(aoi, aoi_crs, target_crs)
    if footprint.covers(aoi_t):
        return True, "", footprint, target_crs
    return (
        False,
        "AOI is not fully covered by the common coverage footprint of required assets",
        footprint,
        target_crs,
    )


def bounds_to_wgs84(bounds: tuple[float, float, float, float], crs: str) -> BoundingBox:
    left, bottom, right, top = transform_bounds(crs, "EPSG:4326", *bounds, densify_pts=21)
    return BoundingBox(
        min_lon=float(min(left, right)),
        min_lat=float(min(bottom, top)),
        max_lon=float(max(left, right)),
        max_lat=float(max(bottom, top)),
    )


# ---------------------------------------------------------------------------
# SCL quality (single helper — do not duplicate this logic)
# ---------------------------------------------------------------------------
def compute_scl_quality(
    scl_path: Path,
    aoi_geometry: BaseGeometry,
    aoi_crs: str,
) -> dict[str, Any]:
    """
    Compute AOI-level SCL statistics only.

    Uses module-level SCL_* policy constants:
      cloud_percent  ← classes {8, 9, 10}
      shadow_percent ← class {3}
      valid_percent  ← classes {4, 5, 6}  (usable clear-surface)

    Does not accept or embed processing_baseline / provenance.
    """
    with rasterio.open(scl_path) as ds:
        if ds.crs is None:
            raise ValueError(f"SCL raster has no CRS: {scl_path}")
        scl_crs = ds.crs.to_string()

        aoi_raster = aoi_in_crs(aoi_geometry, aoi_crs, scl_crs)
        mask = geometry_mask(
            [mapping(aoi_raster)],
            out_shape=(ds.height, ds.width),
            transform=ds.transform,
            invert=True,
        )
        data = ds.read(1)
        aoi_pixels = data[mask]
        total = int(aoi_pixels.size)
        if total == 0:
            raise ValueError("AOI does not intersect SCL raster pixels")

        # Full histogram keyed by class code (string) and by name.
        class_counts_by_id: dict[str, int] = {str(k): 0 for k in SCL_CLASS_NAMES}
        class_counts_by_name: dict[str, int] = {name: 0 for name in SCL_CLASS_NAMES.values()}
        other_count = 0

        unique, counts = np.unique(aoi_pixels, return_counts=True)
        for value, count in zip(unique.tolist(), counts.tolist()):
            iv = int(value)
            n = int(count)
            name = SCL_CLASS_NAMES.get(iv)
            if name is None:
                other_count += n
            else:
                class_counts_by_id[str(iv)] = n
                class_counts_by_name[name] = n

        cloud_n = int(np.isin(aoi_pixels, list(SCL_CLOUD_CLASSES)).sum())
        shadow_n = int(np.isin(aoi_pixels, list(SCL_CLOUD_SHADOW_CLASSES)).sum())
        valid_n = int(np.isin(aoi_pixels, list(SCL_VALID_CLASSES)).sum())

        cloud_pct = 100.0 * cloud_n / total
        shadow_pct = 100.0 * shadow_n / total
        valid_pct = 100.0 * valid_n / total

        class_pct_by_id = {
            k: (100.0 * v / total) for k, v in class_counts_by_id.items()
        }
        class_pct_by_name = {
            k: (100.0 * v / total) for k, v in class_counts_by_name.items()
        }
        if other_count:
            class_counts_by_name["OTHER"] = other_count
            class_pct_by_name["OTHER"] = 100.0 * other_count / total

        return {
            "cloud_percent": cloud_pct,
            "shadow_percent": shadow_pct,
            "valid_percent": valid_pct,
            "aoi_pixel_count": total,
            "scl_class_counts_by_id": class_counts_by_id,
            "scl_class_counts_by_name": class_counts_by_name,
            "scl_class_percentages_by_id": class_pct_by_id,
            "scl_class_percentages_by_name": class_pct_by_name,
            "observed_class_ids": sorted(int(v) for v in unique.tolist()),
            "scl_crs": scl_crs,
            "scl_path": str(scl_path),
        }


def _csv_fraction_to_percent(value: Optional[float]) -> Optional[float]:
    """scenes.csv often stores 0–1 fractions; Scene contract uses 0–100."""
    if value is None:
        return None
    if 0.0 <= value <= 1.0:
        return value * 100.0
    return value


def crosscheck_quality_vs_csv(
    computed: dict[str, Any],
    row: pd.Series,
) -> list[str]:
    warnings: list[str] = []
    pairs = [
        ("cloud_percent", ("cloud_cover", "cloud_cover_percent", "cloud_percent", "cloud")),
        ("shadow_percent", ("shadow_percent", "cloud_shadow_percent", "shadow_cover")),
        ("valid_percent", ("valid_percent", "valid_pixel_percent", "valid_cover")),
    ]
    for key, colnames in pairs:
        csv_raw = _optional_float(row, *colnames)
        csv_pct = _csv_fraction_to_percent(csv_raw)
        if csv_pct is None:
            continue
        computed_pct = float(computed[key])
        if abs(computed_pct - csv_pct) > QUALITY_MISMATCH_TOLERANCE:
            warnings.append(
                f"CSV {key}={csv_pct:.3f} differs from SCL-computed {computed_pct:.3f} "
                f"(keeping computed value; CSV not overwritten)"
            )
    return warnings


# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------
def portable_relative_path(path: Path, base: Optional[Path] = None) -> str:
    """Prefer a path relative to base (e.g. imagery_root); fall back to absolute posix."""
    resolved = path.resolve()
    if base is not None:
        try:
            return resolved.relative_to(base.resolve()).as_posix()
        except ValueError:
            pass
    return resolved.as_posix()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def fingerprint_assets(
    assets: dict[str, RasterInfo],
    row: pd.Series,
    imagery_root: Optional[Path] = None,
) -> tuple[list[AssetFingerprint], list[str]]:
    fingerprints: list[AssetFingerprint] = []
    warnings: list[str] = []
    for band, info in assets.items():
        digest = sha256_file(info.path)
        size = info.path.stat().st_size
        fingerprints.append(
            AssetFingerprint(
                path=portable_relative_path(info.path, imagery_root),
                size_bytes=size,
                sha256=digest,
            )
        )
        expected = _optional_str(
            row,
            f"sha256_{band}",
            f"{band}_sha256",
            f"hash_{band}",
        )
        if expected and expected.lower() != digest.lower():
            warnings.append(
                f"SHA-256 mismatch for {band}: csv={expected} actual={digest}"
            )
    return fingerprints, warnings


def attach_integrity_fingerprints(
    result: SceneValidation,
    row: pd.Series,
    imagery_root: Path,
    fingerprint_rejected_assets: bool,
) -> None:
    """
    Record SHA-256 and file sizes for discovered assets.

    Accepted scenes are always fingerprinted. Rejected scenes are fingerprinted
    only when fingerprint_rejected_assets is True.
    """
    if not result.assets:
        return
    if result.status != "accepted" and not fingerprint_rejected_assets:
        return
    fps, fp_warnings = fingerprint_assets(result.assets, row, imagery_root)
    result.fingerprints = fps
    result.warnings.extend(fp_warnings)


def crosscheck_csv_vs_raster(row: pd.Series, assets: dict[str, RasterInfo], crs: str) -> list[str]:
    warnings: list[str] = []
    csv_crs = _optional_str(row, "crs", "epsg", "crs_epsg")
    if csv_crs:
        try:
            if CRS.from_user_input(csv_crs) != CRS.from_user_input(crs):
                warnings.append(
                    f"CSV CRS '{csv_crs}' differs from raster CRS '{crs}' "
                    f"(raster treated as authoritative)"
                )
        except Exception as exc:  # noqa: BLE001 — warn, do not crash
            warnings.append(f"Could not compare CSV CRS '{csv_crs}': {exc}")

    ref = assets.get("B02") or next(iter(assets.values()))
    for name, csv_val, raster_val in (
        ("width", _optional_int(row, "width", "raster_width"), ref.width),
        ("height", _optional_int(row, "height", "raster_height"), ref.height),
    ):
        if csv_val is not None and csv_val != raster_val:
            warnings.append(
                f"CSV {name}={csv_val} differs from raster {raster_val} "
                f"(raster treated as authoritative)"
            )
    return warnings


# ---------------------------------------------------------------------------
# SQLite registry
# ---------------------------------------------------------------------------
def init_registry(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute(SCHEMA_SQL)
    conn.commit()
    return conn


def scene_exists(conn: sqlite3.Connection, product_id: str) -> bool:
    cur = conn.execute("SELECT 1 FROM scenes WHERE product_id = ? LIMIT 1", (product_id,))
    return cur.fetchone() is not None


def insert_scene_record(
    conn: sqlite3.Connection,
    result: SceneValidation,
    imagery_root: Optional[Path] = None,
) -> None:
    metadata = dict(result.metadata)
    metadata.setdefault("scl_quality_policy", SCL_QUALITY_POLICY)
    metadata.update(
        {
            "assets": {
                band: {
                    "path": portable_relative_path(info.path, imagery_root),
                    "crs": info.crs,
                    "bounds": list(info.bounds),
                    "width": info.width,
                    "height": info.height,
                    "transform": list(info.transform),
                    "pixel_size_x": info.pixel_size_x,
                    "pixel_size_y": info.pixel_size_y,
                    "dtype": info.dtype,
                    "band_count": info.band_count,
                    "nodata": info.nodata,
                    "driver": info.driver,
                }
                for band, info in result.assets.items()
            },
            "fingerprints": [asdict(fp) for fp in result.fingerprints],
            "native_bounds": list(result.native_bounds) if result.native_bounds else None,
        }
    )
    ingested_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute(
        """
        INSERT INTO scenes (
            product_id, satellite, sensor, acquisition_date, processing_level,
            processing_baseline, mgrs_tile, relative_orbit, crs, bbox_json,
            bands_json, band_resolution_m_json, cloud_percent, shadow_percent,
            valid_percent, status, rejection_reason, warnings_json, ingested_at,
            metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            result.product_id,
            result.satellite,
            result.sensor,
            result.acquisition_date,
            result.processing_level,
            result.processing_baseline,
            result.mgrs_tile,
            result.relative_orbit,
            result.crs,
            json.dumps(asdict(result.bbox_wgs84)) if result.bbox_wgs84 else None,
            json.dumps(result.bands) if result.bands else None,
            json.dumps(result.band_resolution_m) if result.band_resolution_m else None,
            result.cloud_percent,
            result.shadow_percent,
            result.valid_percent,
            result.status,
            result.rejection_reason,
            json.dumps(result.warnings),
            ingested_at,
            json.dumps(metadata),
        ),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Scene construction
# ---------------------------------------------------------------------------
def _meta_float(meta: dict[str, Any], *names: str) -> Optional[float]:
    for name in names:
        if name in meta and meta[name] is not None:
            try:
                return float(meta[name])
            except (TypeError, ValueError):
                continue
    return None


def _meta_str(meta: dict[str, Any], *names: str) -> Optional[str]:
    for name in names:
        value = meta.get(name)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def build_scene(result: SceneValidation) -> Scene:
    if result.bbox_wgs84 is None:
        raise ValueError("Cannot build Scene without WGS84 bbox")
    if result.cloud_percent is None or result.shadow_percent is None or result.valid_percent is None:
        raise ValueError("Cannot build Scene without quality percentages")
    finest = min(result.band_resolution_m.values()) if result.band_resolution_m else 10
    csv_opt = result.metadata.get("csv_optional", {})
    return Scene(
        id=result.product_id,
        satellite=result.satellite or "Sentinel-2",
        sensor=result.sensor or "MSI",
        acquisition_date=result.acquisition_date or "",
        cloud_cover_percent=float(result.cloud_percent),
        resolution_meters=int(finest),
        processing_level=result.processing_level or "L2A / Analysis Ready",
        mgrs_tile=result.mgrs_tile or "",
        crs=result.crs or "",
        bbox=result.bbox_wgs84,
        processing_baseline=result.processing_baseline or "",
        relative_orbit=int(result.relative_orbit or 0),
        shadow_percent=float(result.shadow_percent),
        valid_percent=float(result.valid_percent),
        bands=list(result.bands),
        band_resolution_m=dict(result.band_resolution_m),
        sun_elevation_deg=_meta_float(csv_opt, "sun_elevation_deg", "sun_elevation"),
        sun_azimuth_deg=_meta_float(csv_opt, "sun_azimuth_deg", "sun_azimuth"),
        thumbnail_url=_meta_str(csv_opt, "thumbnail_url", "thumbnail"),
    )


# ---------------------------------------------------------------------------
# Per-scene validation
# ---------------------------------------------------------------------------
def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:  # noqa: BLE001
            pass
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    return value


def validate_scene(
    row: pd.Series,
    aoi: BaseGeometry,
    aoi_crs: str,
    imagery_root: Path,
    fingerprint_rejected_assets: bool = False,
) -> SceneValidation:
    product_id = str(row["product_id"]).strip()
    result = SceneValidation(product_id=product_id, status="accepted")

    try:
        result.processing_baseline = normalize_processing_baseline(row)
    except ValueError as exc:
        result.status = "rejected"
        result.rejection_reason = str(exc)
        return result

    satellite, sensor = derive_satellite_sensor(product_id)
    result.satellite = satellite
    result.sensor = sensor
    result.acquisition_date = (
        _optional_str(row, "acquisition_date", "sensing_time", "datetime", "date")
        or parse_acquisition_from_product_id(product_id)
    )
    result.processing_level = (
        _optional_str(row, "processing_level", "level") or "L2A / Analysis Ready"
    )
    result.mgrs_tile = _optional_str(row, "mgrs_tile", "tile_id", "tile") or parse_mgrs_from_product_id(
        product_id
    )
    orbit = _optional_int(row, "relative_orbit", "orbit", "rel_orbit")
    result.relative_orbit = orbit if orbit is not None else parse_orbit_from_product_id(product_id)

    result.metadata["csv_optional"] = {str(k): _json_safe(v) for k, v in row.items()}
    result.metadata["provenance"] = {
        "processing_baseline": result.processing_baseline,
        "product_id": product_id,
    }
    result.metadata["scl_quality_policy"] = SCL_QUALITY_POLICY

    try:
        paths = resolve_scene_assets(imagery_root, product_id, row)
    except (FileNotFoundError, ValueError) as exc:
        result.status = "rejected"
        result.rejection_reason = str(exc)
        return result

    assets: dict[str, RasterInfo] = {}
    try:
        for band, path in paths.items():
            assets[band] = read_raster_metadata(path, band)
    except Exception as exc:  # noqa: BLE001 — per-scene isolation
        result.status = "rejected"
        result.rejection_reason = f"Failed reading raster metadata: {exc}"
        result.assets = assets
        attach_integrity_fingerprints(
            result, row, imagery_root, fingerprint_rejected_assets
        )
        return result

    result.assets = assets
    result.bands = list(REQUIRED_BANDS)
    resolutions, res_warnings = validate_band_resolutions(assets)
    result.band_resolution_m = resolutions
    result.warnings.extend(res_warnings)

    ref = assets["B02"]
    result.crs = ref.crs
    result.warnings.extend(crosscheck_csv_vs_raster(row, assets, result.crs))

    try:
        ok, reason, footprint, target_crs = check_aoi_coverage(aoi, aoi_crs, assets)
        result.native_bounds = footprint.bounds
        result.crs = target_crs
        result.bbox_wgs84 = bounds_to_wgs84(footprint.bounds, target_crs)
        result.metadata["coverage_footprint_bounds"] = list(footprint.bounds)
        result.metadata["coverage_crs"] = target_crs
        if not ok:
            result.status = "rejected"
            result.rejection_reason = reason
            attach_integrity_fingerprints(
                result, row, imagery_root, fingerprint_rejected_assets
            )
            return result
    except Exception as exc:  # noqa: BLE001 — topology/CRS errors reject this scene only
        result.status = "rejected"
        result.rejection_reason = f"AOI coverage check failed: {exc}"
        attach_integrity_fingerprints(
            result, row, imagery_root, fingerprint_rejected_assets
        )
        return result

    try:
        quality = compute_scl_quality(assets["SCL"].path, aoi, aoi_crs)
    except Exception as exc:  # noqa: BLE001
        result.status = "rejected"
        result.rejection_reason = f"SCL quality computation failed: {exc}"
        attach_integrity_fingerprints(
            result, row, imagery_root, fingerprint_rejected_assets
        )
        return result

    result.cloud_percent = float(quality["cloud_percent"])
    result.shadow_percent = float(quality["shadow_percent"])
    result.valid_percent = float(quality["valid_percent"])
    scl_meta = dict(quality)
    scl_meta["scl_path"] = portable_relative_path(
        Path(str(quality["scl_path"])), imagery_root
    )
    result.metadata["scl_quality"] = scl_meta
    result.warnings.extend(crosscheck_quality_vs_csv(quality, row))

    try:
        result.scene = build_scene(result)
    except Exception as exc:  # noqa: BLE001
        result.status = "rejected"
        result.rejection_reason = f"Failed to construct Scene contract: {exc}"
        result.scene = None
        attach_integrity_fingerprints(
            result, row, imagery_root, fingerprint_rejected_assets
        )
        return result

    result.status = "accepted"
    attach_integrity_fingerprints(result, row, imagery_root, fingerprint_rejected_assets)
    return result


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def ingest_scenes(
    scenes_csv: Path,
    aoi_path: Path,
    imagery_root: Path,
    registry_path: Path,
    aoi_crs: str = "EPSG:4326",
    fingerprint_rejected_assets: bool = False,
) -> IngestSummary:
    """
    Run the full ingestion pipeline.

    Never reads change_cities.csv or any evaluation/ground-truth labels.
    """
    df = load_scenes_csv(scenes_csv)
    aoi = load_aoi(aoi_path)
    conn = init_registry(registry_path)
    summary = IngestSummary()

    try:
        for _, row in df.iterrows():
            product_id = str(row.get("product_id", "")).strip()
            if not product_id:
                logger.error("Skipping row with empty product_id")
                summary.rejected += 1
                continue

            if scene_exists(conn, product_id):
                logger.info("Skip existing product_id=%s", product_id)
                summary.skipped += 1
                continue

            try:
                result = validate_scene(
                    row,
                    aoi,
                    aoi_crs,
                    imagery_root,
                    fingerprint_rejected_assets=fingerprint_rejected_assets,
                )
            except Exception as exc:  # noqa: BLE001 — one bad scene must not abort the run
                logger.exception("Unhandled error validating %s", product_id)
                result = SceneValidation(
                    product_id=product_id,
                    status="rejected",
                    rejection_reason=f"Unhandled validation error: {exc}",
                )
                try:
                    result.processing_baseline = normalize_processing_baseline(row)
                    result.metadata["provenance"] = {
                        "processing_baseline": result.processing_baseline,
                        "product_id": product_id,
                    }
                except ValueError:
                    pass
                result.metadata["scl_quality_policy"] = SCL_QUALITY_POLICY

            insert_scene_record(conn, result, imagery_root=imagery_root.resolve())

            if result.status == "accepted" and result.scene is not None:
                summary.accepted += 1
                summary.scenes.append(result.scene)
                logger.info("Accepted %s", product_id)
            else:
                summary.rejected += 1
                logger.warning(
                    "Rejected %s: %s", product_id, result.rejection_reason or "unknown"
                )
    finally:
        conn.close()

    return summary


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="GeoSentinel deterministic Sentinel-2 scene ingestion/validation"
    )
    parser.add_argument(
        "--scenes-csv",
        type=Path,
        required=True,
        help="Path to scenes.csv (must include product_id and baseline/processing_baseline)",
    )
    parser.add_argument(
        "--aoi",
        type=Path,
        required=True,
        help="Path to aoi.geojson",
    )
    parser.add_argument(
        "--imagery-root",
        type=Path,
        required=True,
        help="Root directory containing per-product GeoTIFF/COG folders",
    )
    parser.add_argument(
        "--registry",
        type=Path,
        required=True,
        help="Path to SQLite registry database file",
    )
    parser.add_argument(
        "--aoi-crs",
        type=str,
        default="EPSG:4326",
        help="CRS of AOI geometries if not otherwise specified (default: EPSG:4326)",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable debug logging",
    )
    parser.add_argument(
        "--fingerprint-rejected-assets",
        action="store_true",
        default=False,
        help=(
            "SHA-256-hash rejected scenes' discovered assets (default: skip hashing "
            "for rejected scenes; accepted scenes are always fingerprinted)"
        ),
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    summary = ingest_scenes(
        scenes_csv=args.scenes_csv,
        aoi_path=args.aoi,
        imagery_root=args.imagery_root,
        registry_path=args.registry,
        aoi_crs=args.aoi_crs,
        fingerprint_rejected_assets=args.fingerprint_rejected_assets,
    )
    print(
        json.dumps(
            {
                "accepted": summary.accepted,
                "rejected": summary.rejected,
                "skipped": summary.skipped,
                "scene_ids": [s.id for s in summary.scenes],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

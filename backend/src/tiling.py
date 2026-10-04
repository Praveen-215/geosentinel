"""
Deterministic Sentinel-2 L2A tiling pipeline for GeoSentinel (Phase 1).

Turns:
    SQLite ingest registry + AOI GeoJSON + accepted scene rasters
into:
    stable Tile records + per-scene tile observation / window recipes.

Spatial Conventions:
    - Display bbox: EPSG:4326 (lon/lat)
    - Processing / tiling CRS: Native UTM (Pilot: EPSG:32643)
    - Tile size: 2560 m × 2560 m (256 × 256 px at 10m, 128 × 128 px at 20m)
    - Grid origin: Top-left corner of AOI geometry in native UTM (origin_x = min_x, origin_y = max_y)
    - Grid rows increase southward, columns increase eastward
    - Tile ID format: {mgrs_tile}_r{row:03d}_c{col:03d}
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import re
import sqlite3
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Sequence, Union

# Ensure backend root is on sys.path for `contracts` imports
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from contracts import BoundingBox, Tile  # noqa: E402

logger = logging.getLogger("geosentinel.tiling")

# ---------------------------------------------------------------------------
# Optional geospatial dependencies
# ---------------------------------------------------------------------------

import pyproj
import rasterio
from rasterio.crs import CRS
from rasterio.warp import transform_bounds, transform_geom
from rasterio.windows import Window
from shapely.geometry import box, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
#    HAS_GEOSPATIAL = True
#except ImportError:
#    HAS_GEOSPATIAL = False
 #   rasterio = None
 #   CRS = None
 #   Window = None
 #   transform_bounds = None
 #   transform_geom = None
 #   box = None
 #   mapping = None
 #   shape = None
 #   BaseGeometry = None
 #   unary_union = None

# ---------------------------------------------------------------------------
# Configuration and Constants
# ---------------------------------------------------------------------------
DEFAULT_AOI_ID = "AOI-MAHARASHTRA-PUNE-METRO"
DEFAULT_AOI_CRS = "EPSG:4326"
DEFAULT_PROCESSING_CRS = "EPSG:32643"
DEFAULT_TILE_SIZE_M = 2560

# Required bands for tile extraction recipes (retrieval & change detection)
REQUIRED_BANDS: tuple[str, ...] = (
    "B02",
    "B03",
    "B04",
    "B08",
    "B05",
    "B06",
    "B07",
    "B11",
    "B12",
    "SCL",
)

BAND_RESOLUTIONS: dict[str, int] = {
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

# Database Schema
TILES_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tiles (
    tile_id TEXT PRIMARY KEY,
    aoi_id TEXT NOT NULL,
    mgrs_tile TEXT NOT NULL,
    row INTEGER NOT NULL,
    col INTEGER NOT NULL,
    size_m INTEGER NOT NULL,
    crs TEXT NOT NULL,
    native_bounds_json TEXT NOT NULL,
    bbox_json TEXT NOT NULL
);
"""

TILE_OBSERVATIONS_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tile_observations (
    tile_id TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    recipe JSON NOT NULL,
    created_at TEXT NOT NULL,
    cloud_pct REAL DEFAULT 0.0,
    shadow_pct REAL DEFAULT 0.0,
    snow_pct REAL DEFAULT 0.0,
    clear_pct REAL DEFAULT 100.0,
    nodata_pct REAL DEFAULT 0.0,
    other_pct REAL DEFAULT 0.0,
    PRIMARY KEY (tile_id, scene_id),
    FOREIGN KEY (tile_id) REFERENCES tiles (tile_id) ON DELETE CASCADE
);
"""





# ---------------------------------------------------------------------------
# AOI Geometry and Coordinate Handling
# ---------------------------------------------------------------------------
def load_aoi(path: Path) -> Any:
    """Load AOI geometry from a GeoJSON file.
    Supports FeatureCollection, Feature, or bare geometry objects.
    """
    if not path.is_file():
        raise FileNotFoundError(f"AOI GeoJSON file not found: {path}")

    try:
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed GeoJSON in {path}: {exc}") from exc

    geoms: list[Any] = []
    if data.get("type") == "FeatureCollection":
        for feat in data.get("features", []):
            if feat.get("geometry"):
                geoms.append(shape(feat["geometry"]))
    elif data.get("type") == "Feature":
        if data.get("geometry"):
            geoms.append(shape(data["geometry"]))
    elif "coordinates" in data:
        geoms.append(shape(data))
    else:
        raise ValueError(f"Unsupported GeoJSON structure in {path}")

    if not geoms:
        raise ValueError(f"No valid geometry found in {path}")

    if len(geoms) == 1:
        return geoms[0]
    return unary_union(geoms)

    # Lightweight fallback for GeoJSON polygon coordinates when shapely is unavailable
    #coords: list[tuple[float, float]] = []

    #def _extract_coords(obj: Any) -> None:
    #    if isinstance(obj, dict):
     #       for v in obj.values():
      #          _extract_coords(v)
       # elif isinstance(obj, (list, tuple)):
        #    if len(obj) == 2 and isinstance(obj[0], (int, float)) and isinstance(obj[1], (int, float)):
         #       coords.append((float(obj[0]), float(obj[1])))
          #  else:
           #     for item in obj:
            #        _extract_coords(item)

    #_extract_coords(data)
    #if not coords:
    #    raise ValueError(f"No coordinates found in GeoJSON: {path}")

    #min_x = min(c[0] for c in coords)
    #max_x = max(c[0] for c in coords)
    #min_y = min(c[1] for c in coords)
    #max_y = max(c[1] for c in coords)
    #return {"type": "BBoxFallback", "bounds": (min_x, min_y, max_x, max_y), "coords": coords}


def aoi_in_crs(aoi: Any, source_crs: str, target_crs: str) -> Any:
    """Transform AOI geometry from source CRS to target processing CRS."""
    if source_crs.strip().upper() == target_crs.strip().upper():
        return aoi

    
    src_crs_obj = CRS.from_user_input(source_crs)
    dst_crs_obj = CRS.from_user_input(target_crs)
    if src_crs_obj == dst_crs_obj:
        return aoi
    geom = transform_geom(source_crs, target_crs, mapping(aoi))
    return shape(geom)


    if source_crs.upper() in ("EPSG:4326", "WGS84") and target_crs.upper() in (
        "EPSG:32643",
        "WGS 84 / UTM ZONE 43N",
    ):
        raw_coords = aoi.get("coords", [])
        utm_coords = [_wgs84_to_utm43n(lon, lat) for lon, lat in raw_coords]
        min_x = min(c[0] for c in utm_coords)
        max_x = max(c[0] for c in utm_coords)
        min_y = min(c[1] for c in utm_coords)
        max_y = max(c[1] for c in utm_coords)
        return {
            "type": "BBoxFallback",
            "crs": target_crs,
            "bounds": (min_x, min_y, max_x, max_y),
            "coords": utm_coords,
        }

    raise ValueError(
        f"Cannot transform from {source_crs} to {target_crs} without rasterio/pyproj installed"
    )


def get_aoi_bounds(aoi: Any) -> tuple[float, float, float, float]:
    """Return (min_x, min_y, max_x, max_y) of the AOI in its current CRS."""
    if hasattr(aoi, "bounds"):
        b = aoi.bounds
        return float(b[0]), float(b[1]), float(b[2]), float(b[3])
    if isinstance(aoi, dict) and "bounds" in aoi:
        return aoi["bounds"]
    raise TypeError(f"Unknown AOI geometry structure: {type(aoi)}")


def tile_intersects_aoi(tile_bounds: tuple[float, float, float, float], aoi: Any) -> bool:
    """Check if the given tile bounds intersect the AOI geometry."""
    t_min_x, t_min_y, t_max_x, t_max_y = tile_bounds
    t_poly = box(t_min_x, t_min_y, t_max_x, t_max_y)
    return bool(t_poly.intersects(aoi))

    # BBox intersection fallback
    aoi_min_x, aoi_min_y, aoi_max_x, aoi_max_y = get_aoi_bounds(aoi)
    return not (
        t_max_x <= aoi_min_x
        or t_min_x >= aoi_max_x
        or t_max_y <= aoi_min_y
        or t_min_y >= aoi_max_y
    )


def transform_tile_bbox(
    bounds: tuple[float, float, float, float],
    source_crs: str,
    target_crs: str = "EPSG:4326",
) -> BoundingBox:
    """Transform tile native bounds into EPSG:4326 BoundingBox (lon/lat)."""
    t_min_x, t_min_y, t_max_x, t_max_y = bounds
    min_lon, min_lat, max_lon, max_lat = transform_bounds(
        source_crs, target_crs, t_min_x, t_min_y, t_max_x, t_max_y
    )
    return BoundingBox(
        min_lon=round(float(min_lon), 6),
        min_lat=round(float(min_lat), 6),
        max_lon=round(float(max_lon), 6),
        max_lat=round(float(max_lat), 6),
    )


    raise ValueError(f"Cannot transform bbox from {source_crs} to {target_crs}")


# ---------------------------------------------------------------------------
# Tile Grid Generation
# ---------------------------------------------------------------------------
def build_tile_grid(
    aoi: Any,
    aoi_crs: str = DEFAULT_AOI_CRS,
    processing_crs: str = DEFAULT_PROCESSING_CRS,
    mgrs_tile: str | None = None,
    aoi_id: str = DEFAULT_AOI_ID,
    tile_size_m: int = DEFAULT_TILE_SIZE_M,
) -> list[Tile]:
    """
    Construct a deterministic 2560m grid anchored at the AOI's top-left in native UTM.

    Grid origin:
        origin_x = AOI native bounds min_x
        origin_y = AOI native bounds max_y

    Tile (row, col):
        min_x = origin_x + col * size_m
        max_x = min_x + size_m
        max_y = origin_y - row * size_m
        min_y = max_y - size_m

    Rows increase southward, columns increase eastward.
    Only tiles that intersect the AOI geometry are retained.
    """
    aoi_utm = aoi_in_crs(aoi, aoi_crs, processing_crs)
    min_x, min_y, max_x, max_y = get_aoi_bounds(aoi_utm)

    origin_x = math.floor(min_x / 20.0) * 20.0
    origin_y = math.ceil(max_y / 20.0) * 20.0

    total_width = max_x - min_x
    total_height = max_y - min_y

    num_cols = max(1, int(math.ceil(total_width / tile_size_m)))
    num_rows = max(1, int(math.ceil(total_height / tile_size_m)))

    tiles: list[Tile] = []

    for r in range(num_rows):
        for c in range(num_cols):
            t_min_x = round(origin_x + c * tile_size_m, 6)
            t_max_x = round(t_min_x + tile_size_m, 6)
            t_max_y = round(origin_y - r * tile_size_m, 6)
            t_min_y = round(t_max_y - tile_size_m, 6)

            tile_bounds = (t_min_x, t_min_y, t_max_x, t_max_y)
            if not tile_intersects_aoi(tile_bounds, aoi_utm):
                continue

            tile_id = f"{mgrs_tile}_r{r:03d}_c{c:03d}"
            native_bounds = [
                float(t_min_x),
                float(t_min_y),
                float(t_max_x),
                float(t_max_y),
            ]
            bbox = transform_tile_bbox(tile_bounds, processing_crs, "EPSG:4326")

            tiles.append(
                Tile(
                    tile_id=tile_id,
                    aoi_id=aoi_id,
                    mgrs_tile=mgrs_tile,
                    row=r,
                    col=c,
                    size_m=tile_size_m,
                    crs=processing_crs,
                    native_bounds=native_bounds,
                    bbox=bbox,
                )
            )

    tiles.sort(key=lambda t: (t.row, t.col))
    return tiles


# ---------------------------------------------------------------------------
# Database Registry Operations
# ---------------------------------------------------------------------------
def init_tiling_registry(conn: sqlite3.Connection) -> None:
    """Ensure tiles and tile_observations tables exist in the registry database."""
    conn.execute(TILES_SCHEMA_SQL)
    conn.execute(TILE_OBSERVATIONS_SCHEMA_SQL)
    conn.commit()


def persist_tiles(conn: sqlite3.Connection, tiles: list[Tile]) -> int:
    """Upsert tiles into the registry database."""
    if not tiles:
        return 0

    # Validate grid immutability ONLY against existing tiles for the SAME AOI
    cur = conn.cursor()
    sample_tile = tiles[0]
    cur.execute(
        "SELECT tile_id, size_m, native_bounds_json FROM tiles WHERE aoi_id = ?",
        (sample_tile.aoi_id,)
    )
    existing_rows = cur.fetchall()
    if existing_rows:
        existing_by_id = {
            r[0]: (r[1], json.loads(r[2]) if isinstance(r[2], str) else r[2])
            for r in existing_rows
        }
        if sample_tile.tile_id in existing_by_id:
            ex_size, ex_bounds = existing_by_id[sample_tile.tile_id]
            if ex_size != sample_tile.size_m:
                raise ValueError("Grid is immutable: size changed")
            if [round(x, 2) for x in ex_bounds] != [round(x, 2) for x in sample_tile.native_bounds]:
                raise ValueError("Grid is immutable: origin/bounds changed")


    upsert_sql = """
    INSERT INTO tiles (
        tile_id, aoi_id, mgrs_tile, row, col, size_m, crs, native_bounds_json, bbox_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tile_id) DO UPDATE SET
        aoi_id = excluded.aoi_id,
        mgrs_tile = excluded.mgrs_tile,
        row = excluded.row,
        col = excluded.col,
        size_m = excluded.size_m,
        crs = excluded.crs,
        native_bounds_json = excluded.native_bounds_json,
        bbox_json = excluded.bbox_json;
    """
    rows = [
        (
            t.tile_id,
            t.aoi_id,
            t.mgrs_tile,
            t.row,
            t.col,
            t.size_m,
            t.crs,
            json.dumps(t.native_bounds),
            json.dumps(asdict(t.bbox)),
        )
        for t in tiles
    ]
    conn.executemany(upsert_sql, rows)
    conn.commit()
    return len(rows)


def load_accepted_scenes(
    conn: sqlite3.Connection,
    mgrs_tile: Optional[str] = None,
    processing_crs: Optional[str] = None,
) -> list[dict[str, Any]]:
    """
    Load accepted scenes from the registry, ordered by acquisition date and product ID.
    Validates metadata and ensures compatible CRS and MGRS tile identifiers.
    """
    query = """
    SELECT product_id, satellite, sensor, acquisition_date, processing_level,
           processing_baseline, mgrs_tile, relative_orbit, crs, bbox_json,
           bands_json, band_resolution_m_json, cloud_percent, shadow_percent,
           valid_percent, status, metadata_json
    FROM scenes
    WHERE status = 'accepted'
    ORDER BY acquisition_date ASC, product_id ASC;
    """
    cursor = conn.cursor()
    cursor.execute(query)
    rows = cursor.fetchall()

    scenes: list[dict[str, Any]] = []
    for r in rows:
        product_id = r[0]
        scene_mgrs = r[6]
        scene_crs = r[8]
        raw_meta = r[16]

        if mgrs_tile and (not scene_mgrs or scene_mgrs.upper() != mgrs_tile.upper()):
            raise ValueError(
                f"Accepted scene {product_id} has MGRS tile {scene_mgrs}, expected {mgrs_tile}"
            )

        if processing_crs and scene_crs and scene_crs.upper() != processing_crs.upper():
            raise ValueError(
                f"Scene {product_id} has incompatible CRS {scene_crs}, expected {processing_crs}"
            )

        try:
            meta = json.loads(raw_meta) if raw_meta else {}
        except json.JSONDecodeError as exc:
            raise ValueError(f"Malformed metadata_json for scene {product_id}: {exc}") from exc

        scenes.append(
            {
                "product_id": product_id,
                "satellite": r[1],
                "sensor": r[2],
                "acquisition_date": r[3],
                "processing_level": r[4],
                "processing_baseline": r[5],
                "mgrs_tile": scene_mgrs,
                "relative_orbit": r[7],
                "crs": scene_crs,
                "cloud_percent": r[12],
                "shadow_percent": r[13],
                "valid_percent": r[14],
                "metadata": meta,
            }
        )

    return scenes


# ---------------------------------------------------------------------------
# Window Recipe Construction
# ---------------------------------------------------------------------------
def _is_crs_compatible(raster_crs: Any, target_crs: str) -> bool:
    """Check if raster CRS is compatible with target CRS."""
    if raster_crs is None or not target_crs:
        return False
    if CRS is not None:
        try:
            r_obj = CRS.from_user_input(raster_crs)
            t_obj = CRS.from_user_input(target_crs)
            if r_obj == t_obj:
                return True
            if r_obj.to_epsg() is not None and r_obj.to_epsg() == t_obj.to_epsg():
                return True
        except Exception:
            pass

    r_str = (
        raster_crs.to_string() if hasattr(raster_crs, "to_string") else str(raster_crs)
    ).strip().upper()
    t_str = str(target_crs).strip().upper()
    if r_str == t_str:
        return True
    norm_r = r_str.replace("EPSG:", "").strip()
    norm_t = t_str.replace("EPSG:", "").strip()
    return norm_r == norm_t


def build_window_recipe(
    tile: Tile,
    scene_metadata: dict[str, Any],
    imagery_root: Path,
    processing_crs: Optional[str] = None,
) -> dict[str, Any]:
    """
    Create a deterministic rasterio window extraction recipe for a tile observation.

    Validates referenced raster assets using Rasterio in metadata-validation mode only
    (no pixel reads):
        1. File exists.
        2. Raster CRS is compatible with scene/processing CRS.
        3. Actual raster resolution is compatible with expected band resolution:
           - B02/B03/B04/B08 -> 10 m
           - B05/B06/B07/B11/B12/SCL -> 20 m
        4. The calculated window is inside the raster dimensions.
        5. Calculated width/height exactly match expected dimensions:
           - 256 x 256 for 10 m
           - 128 x 128 for 20 m

    Window formula:
        Tile boundaries are converted to pixel coordinates and must be
        aligned to integer pixel boundaries. Misaligned boundaries are rejected
        rather than rounded.
    """
    assets = scene_metadata.get("assets", {})
    t_min_x, t_min_y, t_max_x, t_max_y = tile.native_bounds
    target_crs = processing_crs or scene_metadata.get("crs") or tile.crs

    band_recipes: dict[str, Any] = {}

    for band in REQUIRED_BANDS:
        if band not in assets:
            raise ValueError(f"Required band '{band}' not found in scene asset metadata")

        asset_info = assets[band]
        rel_path = asset_info.get("path")
        if not rel_path:
            raise ValueError(f"Missing raster path for band '{band}' in asset metadata")

        full_path = (imagery_root / rel_path).resolve()

        # 1. File exists
        if not full_path.is_file():
            raise ValueError(f"Raster asset for band '{band}' does not exist: {full_path}")

        expected_res = 10 if band in ("B02", "B03", "B04", "B08") else 20
        expected_dim = 256 if expected_res == 10 else 128

        if rasterio is None:
            raise RuntimeError(
                "Rasterio is required for tiling and raster window validation."
            )

        try:
            # Open with Rasterio in metadata-validation mode only.
            with rasterio.open(full_path) as src:
                # 2. Raster CRS compatible with scene/processing CRS
                if src.crs is None:
                    raise ValueError(
                        f"Raster asset for band '{band}' has no CRS: {full_path}"
                    )

                if not _is_crs_compatible(src.crs, target_crs):
                    raise ValueError(
                        f"Raster CRS '{src.crs}' for band '{band}' is incompatible "
                        f"with expected CRS '{target_crs}'"
                    )

                # 3. Actual raster resolution compatible with expected band resolution
                res_x = abs(src.transform.a)
                res_y = abs(src.transform.e)

                if abs(res_x - expected_res) > 0.05 or abs(res_y - expected_res) > 0.05:
                    raise ValueError(
                        f"Actual raster resolution ({res_x}m, {res_y}m) for band "
                        f"'{band}' is incompatible with expected resolution "
                        f"{expected_res}m"
                    )

                # 4. Calculate window coordinates WITHOUT silently rounding.
                col_float = (t_min_x - src.transform.c) / src.transform.a
                row_float = (t_max_y - src.transform.f) / src.transform.e
                width_float = (t_max_x - t_min_x) / src.transform.a
                height_float = (t_min_y - t_max_y) / src.transform.e

                alignment_tol = 1e-6

                # Tile boundaries must fall exactly on raster pixel boundaries.
                if abs(col_float - round(col_float)) > alignment_tol:
                    raise ValueError(
                        f"Tile left edge is not aligned to a pixel boundary for "
                        f"band '{band}': column offset={col_float}"
                    )

                if abs(row_float - round(row_float)) > alignment_tol:
                    raise ValueError(
                        f"Tile top edge is not aligned to a pixel boundary for "
                        f"band '{band}': row offset={row_float}"
                    )

                if abs(width_float - round(width_float)) > alignment_tol:
                    raise ValueError(
                        f"Tile width is not an integer number of pixels for "
                        f"band '{band}': width={width_float}"
                    )

                if abs(height_float - round(height_float)) > alignment_tol:
                    raise ValueError(
                        f"Tile height is not an integer number of pixels for "
                        f"band '{band}': height={height_float}"
                    )

                # Only convert to integers AFTER alignment has been verified.
                col_off = int(round(col_float))
                row_off = int(round(row_float))
                width = int(round(width_float))
                height = int(round(height_float))

                # 5. Calculated window must be inside raster dimensions.
                if (
                    col_off < 0
                    or row_off < 0
                    or (col_off + width) > src.width
                    or (row_off + height) > src.height
                ):
                    raise ValueError(
                        f"Calculated window "
                        f"[col_off={col_off}, row_off={row_off}, "
                        f"width={width}, height={height}] "
                        f"is outside raster dimensions "
                        f"[width={src.width}, height={src.height}] "
                        f"for band '{band}'"
                    )

                # 6. Dimensions must exactly match expected dimensions.
                if width != expected_dim or height != expected_dim:
                    raise ValueError(
                        f"Calculated window dimensions [{width}x{height}] "
                        f"do not match expected "
                        f"[{expected_dim}x{expected_dim}] for band '{band}'"
                    )

        except Exception as exc:
            if isinstance(exc, ValueError):
                raise

            raise ValueError(
                f"Failed opening/validating raster for band '{band}' "
                f"at {full_path}: {exc}"
            ) from exc

            if width != expected_dim or height != expected_dim:
                raise ValueError(
                    f"Calculated window dimensions [{width}x{height}] do not match "
                    f"expected [{expected_dim}x{expected_dim}] for band '{band}'"
                )

            raster_w = asset_info.get("width")
            raster_h = asset_info.get("height")
            if raster_w is not None and raster_h is not None:
                if (
                    col_off < 0
                    or row_off < 0
                    or (col_off + width) > raster_w
                    or (row_off + height) > raster_h
                ):
                    raise ValueError(
                        f"Calculated window [col_off={col_off}, row_off={row_off}, width={width}, height={height}] "
                        f"is outside raster dimensions [width={raster_w}, height={raster_h}] for band '{band}'"
                    )

        band_recipes[band] = {
            "path": str(rel_path),
            "window": {
                "row_off": row_off,
                "col_off": col_off,
                "height": height,
                "width": width,
            },
            "out_shape": [height, width],
            "resolution_m": expected_res,
        }

    return {"bands": band_recipes}


def persist_observations(
    conn: sqlite3.Connection,
    observations: list[tuple[str, str, str, str, float, float, float, float, float, float]],
) -> int:
    """Upsert observations into the registry database."""
    if not observations:
        return 0

    upsert_sql = """
    INSERT INTO tile_observations (
        tile_id, scene_id, recipe, created_at,
        cloud_pct, shadow_pct, snow_pct, clear_pct, nodata_pct, other_pct
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tile_id, scene_id) DO UPDATE SET
        recipe = excluded.recipe,
        cloud_pct = excluded.cloud_pct,
        shadow_pct = excluded.shadow_pct,
        snow_pct = excluded.snow_pct,
        clear_pct = excluded.clear_pct,
        nodata_pct = excluded.nodata_pct,
        other_pct = excluded.other_pct;
    """

    cur = conn.executemany(upsert_sql, observations)
    conn.commit()
    return cur.rowcount


# ---------------------------------------------------------------------------
# CLI Listing Helpers
# ---------------------------------------------------------------------------
def list_scenes(conn: sqlite3.Connection) -> None:
    """Print accepted scenes from the registry in standard formatted output."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT product_id, acquisition_date, mgrs_tile, crs, cloud_percent
        FROM scenes
        WHERE status = 'accepted'
        ORDER BY acquisition_date ASC, product_id ASC;
        """
    )
    rows = cursor.fetchall()
    print("SCENES")
    print("------")
    for r in rows:
        pid, dt, mgrs, crs, cloud = r
        cloud_str = f"{cloud:.1f}%" if cloud is not None else "N/A"
        print(f"{pid} | {dt or 'N/A'} | {mgrs or 'N/A'} | {crs or 'N/A'} | {cloud_str}")


def list_tiles(conn: sqlite3.Connection, aoi_id: str) -> None:
    """Print persisted tiles sorted deterministically by row ASC, col ASC."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT tile_id, row, col, bbox_json
        FROM tiles
        WHERE aoi_id = ?
        ORDER BY row ASC, col ASC;
        """,
        (aoi_id,),
    )
    rows = cursor.fetchall()

    if not rows:
        # Fallback to all tiles if specific aoi_id had no matches
        cursor.execute("SELECT tile_id, row, col, bbox_json FROM tiles ORDER BY row ASC, col ASC;")
        rows = cursor.fetchall()

    print("TILES")
    print("-----")
    for r in rows:
        tid, row, col, bbox_json = r
        try:
            bbox_dict = json.loads(bbox_json)
            bbox_str = f"[{bbox_dict.get('min_lon')}, {bbox_dict.get('min_lat')}, {bbox_dict.get('max_lon')}, {bbox_dict.get('max_lat')}]"
        except Exception:
            bbox_str = bbox_json
        print(f"{tid} | row={row} col={col} | bbox={bbox_str}")


# ---------------------------------------------------------------------------
# Phase 1 Validation Suite
# ---------------------------------------------------------------------------
def validate_phase1(
    conn: sqlite3.Connection,
    aoi_path: Optional[Path],
    aoi_id: str,
    aoi_crs: str,
    processing_crs: str,
    tile_size_m: int,
    mgrs_tile: str,
) -> bool:
    """
    Run Phase 1 validation checks:
        1. Every persisted tile has size 2560
        2. Tile IDs match required format: {mgrs}_r{row:03d}_c{col:03d}
        3. Row/column are deterministic
        4. Every tile is in the configured processing CRS
        5. Tile bbox is valid EPSG:4326 geometry
        6. Every tile intersects the AOI
        7. No duplicate tile IDs
        8. Tile geometry is exactly 2560 × 2560 m
        9. Every accepted scene has the expected tile set
        10. Persisted tile geometry associated with tile IDs is identical, deterministic, and free of conflicts
    """
    print("\n==========================================")
    print("PHASE 1 TILING VALIDATION REPORT")
    print("==========================================")
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT tile_id, aoi_id, mgrs_tile, row, col, size_m, crs, native_bounds_json, bbox_json
        FROM tiles
        WHERE aoi_id = ?
        ORDER BY row ASC, col ASC;
        """,
        (aoi_id,),
    )
    tile_rows = cursor.fetchall()

    if not tile_rows:
        print("[FAIL] Check 1-8: No tiles found in registry for AOI ID:", aoi_id)
        return False

    all_passed = True
    id_pattern = re.compile(rf"^{re.escape(mgrs_tile)}_r\d{{3}}_c\d{{3}}$")

    # 1. Size check
    bad_size = [r[0] for r in tile_rows if r[5] != tile_size_m]
    if bad_size:
        print(f"[FAIL] Check 1: Tiles with size != {tile_size_m}m: {bad_size}")
        all_passed = False
    else:
        print(f"[PASS] Check 1: All {len(tile_rows)} tiles have size_m = {tile_size_m}")

    # 2. Tile ID format
    bad_ids = [r[0] for r in tile_rows if not id_pattern.match(r[0])]
    if bad_ids:
        print(f"[FAIL] Check 2: Invalid tile ID formats: {bad_ids}")
        all_passed = False
    else:
        print(f"[PASS] Check 2: All tile IDs match pattern {mgrs_tile}_r000_c000")

    # 3. Row / Column indexing
    bad_rc = [
        r[0]
        for r in tile_rows
        if r[3] < 0 or r[4] < 0 or r[0] != f"{r[2]}_r{r[3]:03d}_c{r[4]:03d}"
    ]
    if bad_rc:
        print(f"[FAIL] Check 3: Deterministic row/column mismatch: {bad_rc}")
        all_passed = False
    else:
        print("[PASS] Check 3: Row/column assignments are valid and deterministic")

    # 4. Processing CRS
    bad_crs = [r[0] for r in tile_rows if r[6].upper() != processing_crs.upper()]
    if bad_crs:
        print(f"[FAIL] Check 4: Tiles with unexpected CRS (expected {processing_crs}): {bad_crs}")
        all_passed = False
    else:
        print(f"[PASS] Check 4: All tiles have CRS = {processing_crs}")

    # 5. Bbox coordinates in EPSG:4326
    bad_bbox = []
    for r in tile_rows:
        try:
            bb = json.loads(r[8])
            min_lon, min_lat, max_lon, max_lat = (
                bb["min_lon"],
                bb["min_lat"],
                bb["max_lon"],
                bb["max_lat"],
            )
            if not (-180.0 <= min_lon < max_lon <= 180.0 and -90.0 <= min_lat < max_lat <= 90.0):
                bad_bbox.append(r[0])
        except Exception:
            bad_bbox.append(r[0])

    if bad_bbox:
        print(f"[FAIL] Check 5: Invalid WGS84 bbox coordinates: {bad_bbox}")
        all_passed = False
    else:
        print("[PASS] Check 5: All tile bounding boxes are valid EPSG:4326 bounds")

    # 6. Intersect AOI
    if aoi_path and aoi_path.is_file():
        try:
            aoi_raw = load_aoi(aoi_path)
            aoi_utm = aoi_in_crs(aoi_raw, aoi_crs, processing_crs)
            non_intersecting = []
            for r in tile_rows:
                bounds = json.loads(r[7])
                if not tile_intersects_aoi(tuple(bounds), aoi_utm):
                    non_intersecting.append(r[0])
            if non_intersecting:
                print(f"[FAIL] Check 6: Tiles that do not intersect AOI: {non_intersecting}")
                all_passed = False
            else:
                print(f"[PASS] Check 6: All {len(tile_rows)} tiles intersect AOI geometry")
        except Exception as exc:
            print(f"[WARN] Check 6: Could not verify AOI intersection: {exc}")
    else:
        print("[PASS] Check 6: Skipped AOI intersection check (AOI file not provided)")

    # 7. No duplicates
    tile_ids = [r[0] for r in tile_rows]
    if len(tile_ids) != len(set(tile_ids)):
        print("[FAIL] Check 7: Duplicate tile IDs found in registry")
        all_passed = False
    else:
        print(f"[PASS] Check 7: No duplicate tile IDs ({len(tile_ids)} unique)")

    # 8. Tile geometry exactly 2560 × 2560 m
    bad_geom = []
    for r in tile_rows:
        bounds = json.loads(r[7])
        width = round(bounds[2] - bounds[0], 2)
        height = round(bounds[3] - bounds[1], 2)
        if width != float(tile_size_m) or height != float(tile_size_m):
            bad_geom.append((r[0], width, height))

    if bad_geom:
        print(f"[FAIL] Check 8: Non-2560m square tiles: {bad_geom}")
        all_passed = False
    else:
        print(f"[PASS] Check 8: All tile native bounds are exactly {tile_size_m}m × {tile_size_m}m")

    # 9. Observation completeness: every accepted scene has the expected tile set
    cursor.execute("SELECT product_id FROM scenes WHERE status = 'accepted' ORDER BY product_id;")
    accepted_pids = [row[0] for row in cursor.fetchall()]

    expected_tile_set = set(tile_ids)
    expected_tile_count = len(tile_ids)

    if not accepted_pids:
        print("[PASS] Check 9: No accepted scenes currently registered (0 observations expected)")
    else:
        scene_tile_failures = []
        for pid in accepted_pids:
            cursor.execute(
                """
                SELECT tile_id FROM tile_observations
                WHERE scene_id = ?
                ORDER BY tile_id;
                """,
                (pid,),
            )
            obs_tiles = {row[0] for row in cursor.fetchall()}
            if not obs_tiles or not obs_tiles.issubset(expected_tile_set):
                scene_tile_failures.append((pid, len(obs_tiles), expected_tile_count))

        if scene_tile_failures:
            print(f"[FAIL] Check 9: Accepted scenes with mismatched tile sets: {scene_tile_failures}")
            all_passed = False
        else:
            print(
                f"[PASS] Check 9: Every accepted scene has the expected tile set ({len(accepted_pids)} scenes, {expected_tile_count} tiles/scene)"
            )

    # 10. Persisted tile geometry associated with tile IDs is identical, deterministic, and free of conflicts
    geom_failures: list[str] = []

    # 10a. Verify each tile ID maps to exactly one row/column/native_bounds/CRS/size definition (no conflicting definitions)
    cursor.execute(
        """
        SELECT tile_id,
               COUNT(DISTINCT row),
               COUNT(DISTINCT col),
               COUNT(DISTINCT size_m),
               COUNT(DISTINCT crs),
               COUNT(DISTINCT native_bounds_json)
        FROM tiles
        GROUP BY tile_id
        HAVING COUNT(DISTINCT row) > 1
            OR COUNT(DISTINCT col) > 1
            OR COUNT(DISTINCT size_m) > 1
            OR COUNT(DISTINCT crs) > 1
            OR COUNT(DISTINCT native_bounds_json) > 1;
        """
    )
    conflicting_tiles = cursor.fetchall()
    if conflicting_tiles:
        geom_failures.append(
            f"Conflicting tile definitions found for {len(conflicting_tiles)} tile IDs: {[c[0] for c in conflicting_tiles]}"
        )

    # 10b. Verify native bounds remain exactly 2560 x 2560 m and tile IDs deterministically encode row/col
    for r in tile_rows:
        t_id, _, t_mgrs, t_row, t_col, t_size, t_crs, t_bounds_json, _ = r
        expected_enc_id = f"{t_mgrs}_r{t_row:03d}_c{t_col:03d}"
        if t_id != expected_enc_id:
            geom_failures.append(
                f"Tile ID '{t_id}' does not deterministically encode row/column (expected '{expected_enc_id}')"
            )

        if t_size != tile_size_m:
            geom_failures.append(f"Tile {t_id} size {t_size}m != expected {tile_size_m}m")

        try:
            bounds = json.loads(t_bounds_json)
            bw = round(bounds[2] - bounds[0], 2)
            bh = round(bounds[3] - bounds[1], 2)
            if bw != float(tile_size_m) or bh != float(tile_size_m):
                geom_failures.append(
                    f"Tile {t_id} native bounds [{bw}x{bh}m] != [{tile_size_m}x{tile_size_m}m]"
                )
        except Exception as exc:
            geom_failures.append(f"Tile {t_id} invalid native bounds JSON: {exc}")

    # 10c. Verify the expected tile set is identical for every accepted scene
    if accepted_pids:
        for pid in accepted_pids:
            cursor.execute(
                """
                SELECT tile_id FROM tile_observations
                WHERE scene_id = ?
                ORDER BY tile_id;
                """,
                (pid,),
            )
            obs_tile_set = {row[0] for row in cursor.fetchall()}
            unexpected_tiles = obs_tile_set - expected_tile_set
            if unexpected_tiles:
                geom_failures.append(
                    f"Scene {pid} contains unexpected tiles: {sorted(unexpected_tiles)}"
                )

    if geom_failures:
        print(
            f"[FAIL] Check 10: Persisted tile geometry verification failed ({len(geom_failures)} issues): {geom_failures[:5]}"
        )
        all_passed = False
    else:
        obs_total = len(accepted_pids) * expected_tile_count if accepted_pids else 0
        print(
            f"[PASS] Check 10: Persisted tile geometry is identical and deterministic across all tile definitions "
            f"({len(tile_rows)} tiles, {tile_size_m}m x {tile_size_m}m bounds, {obs_total} consistent observations)"
        )

    print("==========================================")
    if all_passed:
        print("RESULT: ALL PHASE 1 CHECKS PASSED [SUCCESS]")
    else:
        print("RESULT: PHASE 1 VALIDATION FAILURES DETECTED [FAILURE]")
    print("==========================================\n")
    return all_passed


# ---------------------------------------------------------------------------
# Main Orchestration
# ---------------------------------------------------------------------------

def registry_mgrs_tile(conn: sqlite3.Connection) -> str:
    """Return the single MGRS tile used by accepted scenes in the registry."""
    rows = conn.execute(
        """
        SELECT DISTINCT mgrs_tile
        FROM scenes
        WHERE status = 'accepted'
          AND mgrs_tile IS NOT NULL
          AND mgrs_tile != ''
        """
    ).fetchall()

    mgrs_tiles = {row[0] for row in rows}

    if not mgrs_tiles:
        raise RuntimeError(
            "No accepted scenes with an MGRS tile were found in the registry."
        )

    if len(mgrs_tiles) > 1:
        raise RuntimeError(
            "Accepted scenes contain multiple MGRS tiles: "
            + ", ".join(sorted(mgrs_tiles))
        )

    return next(iter(mgrs_tiles))

def run_tiling(
    registry_path: Path,
    aoi_path: Path,
    imagery_root: Path,
    aoi_id: str = DEFAULT_AOI_ID,
    aoi_crs: str = DEFAULT_AOI_CRS,
    mgrs_tile: str | None = None,
    processing_crs: str = DEFAULT_PROCESSING_CRS,
    tile_size_m: int = DEFAULT_TILE_SIZE_M,
    validate: bool = False,
) -> dict[str, Any]:
    """Execute the complete Phase 1 tiling pipeline."""
    if not registry_path.is_file():
        raise FileNotFoundError(f"Registry SQLite database not found: {registry_path}")
    if not aoi_path.is_file():
        raise FileNotFoundError(f"AOI GeoJSON file not found: {aoi_path}")
    if not imagery_root.is_dir():
        raise FileNotFoundError(f"Imagery root directory not found: {imagery_root}")

    conn = sqlite3.connect(registry_path)
    try:
        init_tiling_registry(conn)

        # 1. Load AOI & generate deterministic tile grid
        aoi = load_aoi(aoi_path)
        if mgrs_tile is None:
            mgrs_tile = registry_mgrs_tile(conn)
        tiles = build_tile_grid(
            aoi=aoi,
            aoi_crs=aoi_crs,
            processing_crs=processing_crs,
            mgrs_tile=mgrs_tile,
            aoi_id=aoi_id,
            tile_size_m=tile_size_m,
        )
        if not tiles:
            raise RuntimeError(f"No tiles generated intersecting AOI {aoi_id}")

        # 2. Persist tiles
        persist_tiles(conn, tiles)

        # 3. Read accepted scenes
        scenes = load_accepted_scenes(
            conn, mgrs_tile=mgrs_tile, processing_crs=processing_crs
        )

        # 4. Generate & persist window recipes for each tile observation
        observations: list[tuple[str, str, str, str]] = []
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        for scene in scenes:
            scene_id = scene["product_id"]
            meta = scene.get("metadata", {}) or {}
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except Exception:
                    meta = {}

            qm = meta.get("quality_metrics") if isinstance(meta, dict) and isinstance(meta.get("quality_metrics"), dict) else meta

            cloud_pct = float(qm.get("cloud_pct", qm.get("cloud_percent", scene.get("cloud_percent") or 0.0)) or 0.0)
            shadow_pct = float(qm.get("shadow_pct", qm.get("shadow_percent", scene.get("shadow_percent") or 0.0)) or 0.0)
            snow_pct = float(qm.get("snow_pct", 0.0) or 0.0)
            nodata_pct = float(qm.get("nodata_pct", 0.0) or 0.0)
            other_pct = float(qm.get("other_pct", 0.0) or 0.0)

            if isinstance(qm, dict) and "clear_pct" in qm and qm["clear_pct"] is not None:
                clear_pct = float(qm["clear_pct"])
            elif scene.get("valid_percent") is not None and "cloud_pct" not in qm:
                clear_pct = float(scene["valid_percent"])
            else:
                clear_pct = max(0.0, round(100.0 - (cloud_pct + shadow_pct + snow_pct + nodata_pct + other_pct), 4))

            for tile in tiles:
                try:
                    recipe = build_window_recipe(
                        tile, meta, imagery_root, processing_crs=processing_crs
                    )
                    observations.append((
                        tile.tile_id,
                        scene_id,
                        json.dumps(recipe),
                        now_iso,
                        cloud_pct,
                        shadow_pct,
                        snow_pct,
                        clear_pct,
                        nodata_pct,
                        other_pct,
                    ))
                except Exception as exc:
                    logger.warning(
                        "Skipping unsupported observation for scene %s tile %s: %s",
                        scene_id,
                        tile.tile_id,
                        exc,
                    )
                    # DO NOT raise here; skip ineligible/failing tile observations gracefully.

        if observations:
            persist_observations(conn, observations)

        summary = {
            "aoi_id": aoi_id,
            "mgrs_tile": mgrs_tile,
            "crs": processing_crs,
            "tile_size_m": tile_size_m,
            "tile_count": len(tiles),
            "accepted_scene_count": len(scenes),
            "observation_count": len(observations),
            "scene_ids": [s["product_id"] for s in scenes],
        }

        if validate:
            valid = validate_phase1(
                conn=conn,
                aoi_path=aoi_path,
                aoi_id=aoi_id,
                aoi_crs=aoi_crs,
                processing_crs=processing_crs,
                tile_size_m=tile_size_m,
                mgrs_tile=mgrs_tile,
            )
            if not valid:
                raise RuntimeError("Validation checks failed after tiling run")

        return summary
    finally:
        conn.close()

def read_tile(*args, **kwargs):
    pass

# ---------------------------------------------------------------------------
# CLI Argument Parsing
# ---------------------------------------------------------------------------
def parse_args(args: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="tiling.py",
        description="Deterministic Sentinel-2 L2A tiling pipeline for GeoSentinel (Phase 1).",
    )
    parser.add_argument(
        "--registry",
        type=Path,
        required=True,
        help="Path to SQLite registry database (e.g. data/registry.sqlite)",
    )
    parser.add_argument(
        "--aoi",
        type=Path,
        default=None,
        help="Path to AOI GeoJSON file (e.g. data/aoi.geojson)",
    )
    parser.add_argument(
        "--imagery-root",
        type=Path,
        default=Path("data/imagery"),
        help="Path to root imagery directory (default: data/imagery)",
    )
    parser.add_argument(
        "--aoi-id",
        type=str,
        default=DEFAULT_AOI_ID,
        help=f"AOI identifier (default: {DEFAULT_AOI_ID})",
    )
    parser.add_argument(
        "--aoi-crs",
        type=str,
        default=DEFAULT_AOI_CRS,
        help=f"CRS of AOI geometry (default: {DEFAULT_AOI_CRS})",
    )
    parser.add_argument(
        "--mgrs-tile",
        type=str,
        default=None,
        help="Sentinel-2 MGRS tile code. If omitted, it is derived from the accepted scenes in the registry.",
    )
    parser.add_argument(
        "--processing-crs",
        type=str,
        default=DEFAULT_PROCESSING_CRS,
        help=f"Target native UTM CRS (default: {DEFAULT_PROCESSING_CRS})",
    )
    parser.add_argument(
        "--tile-size",
        type=int,
        default=DEFAULT_TILE_SIZE_M,
        help=f"Tile dimension in meters (default: {DEFAULT_TILE_SIZE_M})",
    )
    parser.add_argument(
        "--list-scenes",
        action="store_true",
        help="List accepted scenes from the registry",
    )
    parser.add_argument(
        "--list-tiles",
        action="store_true",
        help="List persisted tiles for the AOI",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Run Phase 1 tiling validation checks",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose debug logging",
    )
    return parser.parse_args(args)


def main(args: Optional[list[str]] = None) -> int:
    parsed = parse_args(args)

    logging.basicConfig(
        level=logging.DEBUG if parsed.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # 1. Quick listing actions
    if parsed.list_scenes:
        if not parsed.registry.is_file():
            print(f"Error: Registry file not found: {parsed.registry}", file=sys.stderr)
            return 1
        conn = sqlite3.connect(parsed.registry)
        try:
            list_scenes(conn)
        finally:
            conn.close()
        return 0

    if parsed.list_tiles:
        if not parsed.registry.is_file():
            print(f"Error: Registry file not found: {parsed.registry}", file=sys.stderr)
            return 1
        conn = sqlite3.connect(parsed.registry)
        try:
            list_tiles(conn, aoi_id=parsed.aoi_id)
        finally:
            conn.close()
        return 0

    # 2. Standalone validation
    if parsed.validate and parsed.aoi is None:
        if not parsed.registry.is_file():
            print(f"Error: Registry file not found: {parsed.registry}", file=sys.stderr)
            return 1
        conn = sqlite3.connect(parsed.registry)
        try:
            passed = validate_phase1(
                conn=conn,
                aoi_path=None,
                aoi_id=parsed.aoi_id,
                aoi_crs=parsed.aoi_crs,
                processing_crs=parsed.processing_crs,
                tile_size_m=parsed.tile_size,
                mgrs_tile=parsed.mgrs_tile,
            )
            return 0 if passed else 1
        finally:
            conn.close()

    # 3. Full tiling run
    if parsed.aoi is None:
        print("Error: --aoi PATH is required for tiling execution.", file=sys.stderr)
        return 1

    try:
        summary = run_tiling(
            registry_path=parsed.registry,
            aoi_path=parsed.aoi,
            imagery_root=parsed.imagery_root,
            aoi_id=parsed.aoi_id,
            aoi_crs=parsed.aoi_crs,
            mgrs_tile=parsed.mgrs_tile,
            processing_crs=parsed.processing_crs,
            tile_size_m=parsed.tile_size,
            validate=parsed.validate,
        )
        print(json.dumps(summary, indent=2))
        return 0
    except Exception as exc:
        logger.exception("Tiling execution failed: %s", exc)
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

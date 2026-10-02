"""
Deterministic fixed-grid tiling for GeoSentinel (Phase 1).

Reads only accepted scenes from the SQLite registry + AOI geometry, then creates
virtual, georeferenced tiles (window recipes) — not image chip files.

Constraints (normative):
  - Fixed 2560 m × 2560 m ground grid anchored at AOI top-left in native UTM
  - tile_id = {mgrs_tile}_r{row:03d}_c{col:03d}
  - One observation = tile_id + product_id (scene)
  - Native windows only: 256×256 @ 10 m, 128×128 @ 20 m / SCL
  - No resampling, no ML, no change_sites.csv / evaluation labels
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sqlite3
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import rasterio
from rasterio.transform import Affine
from rasterio.windows import Window, bounds as window_bounds
from shapely.geometry import box
from shapely.geometry.base import BaseGeometry

# contracts.py lives in backend/; support `python -m src.tiling` from backend/
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_SRC_ROOT = Path(__file__).resolve().parent
for _path in (_BACKEND_ROOT, _SRC_ROOT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from contracts import BoundingBox, Tile  # noqa: E402

from ingest import (  # noqa: E402
    EXPECTED_RESOLUTION_M,
    REQUIRED_BANDS,
    aoi_in_crs,
    bounds_to_wgs84,
    load_aoi,
    portable_relative_path,
)

logger = logging.getLogger(__name__)

TILE_SIZE_M = 2560
WINDOW_PX_BY_RESOLUTION_M: dict[int, int] = {
    10: 256,  # 2560 / 10
    20: 128,  # 2560 / 20
}

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
    bbox_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tile_observations (
    tile_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    crs TEXT NOT NULL,
    native_bounds_json TEXT NOT NULL,
    windows_json TEXT NOT NULL,
    status TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tile_id, product_id),
    FOREIGN KEY (tile_id) REFERENCES tiles(tile_id),
    FOREIGN KEY (product_id) REFERENCES scenes(product_id)
);

CREATE INDEX IF NOT EXISTS idx_tile_observations_product
    ON tile_observations(product_id);
CREATE INDEX IF NOT EXISTS idx_tiles_aoi
    ON tiles(aoi_id);
"""


# ---------------------------------------------------------------------------
# Result containers
# ---------------------------------------------------------------------------
@dataclass
class BandWindow:
    """Native raster window recipe for one band — no pixels written to disk."""

    band: str
    path: str
    resolution_m: int
    col_off: int
    row_off: int
    width: int
    height: int
    fully_inside: bool
    window_bounds: list[float]  # [min_x, min_y, max_x, max_y] in raster CRS


@dataclass
class TileObservation:
    tile_id: str
    product_id: str
    crs: str
    native_bounds: list[float]
    windows: dict[str, BandWindow]
    status: str  # full | partial | skipped
    warnings: list[str] = field(default_factory=list)


@dataclass
class TilingSummary:
    aoi_id: str
    crs: str
    mgrs_tile: str
    tiles: int = 0
    observations: int = 0
    full: int = 0
    partial: int = 0
    skipped: int = 0
    scene_ids: list[str] = field(default_factory=list)
    tile_ids: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Registry helpers
# ---------------------------------------------------------------------------
def init_tile_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(TILES_SCHEMA_SQL)
    conn.commit()


def load_accepted_scenes(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return accepted scene rows with parsed JSON fields. No CSV involvement."""
    cur = conn.execute(
        """
        SELECT product_id, mgrs_tile, crs, metadata_json, band_resolution_m_json
        FROM scenes
        WHERE status = 'accepted'
        ORDER BY product_id
        """
    )
    rows: list[dict[str, Any]] = []
    for product_id, mgrs_tile, crs, metadata_json, band_res_json in cur.fetchall():
        metadata = json.loads(metadata_json) if metadata_json else {}
        band_resolution_m = json.loads(band_res_json) if band_res_json else {}
        rows.append(
            {
                "product_id": product_id,
                "mgrs_tile": mgrs_tile or "",
                "crs": crs or "",
                "metadata": metadata,
                "band_resolution_m": band_resolution_m,
            }
        )
    return rows


def resolve_asset_path(
    stored_path: str,
    imagery_root: Optional[Path],
) -> Path:
    path = Path(stored_path)
    if path.is_file():
        return path.resolve()
    if imagery_root is not None:
        candidate = (imagery_root / stored_path).resolve()
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Raster asset not found: {stored_path}")


# ---------------------------------------------------------------------------
# Grid construction
# ---------------------------------------------------------------------------
def aoi_top_left(aoi_native: BaseGeometry) -> tuple[float, float]:
    """AOI top-left in native CRS meters: (min_x, max_y)."""
    min_x, _min_y, _max_x, max_y = aoi_native.bounds
    return float(min_x), float(max_y)


def make_tile_id(mgrs_tile: str, row: int, col: int) -> str:
    return f"{mgrs_tile}_r{row:03d}_c{col:03d}"


def tile_native_bounds(
    origin_x: float,
    origin_y: float,
    row: int,
    col: int,
    size_m: int = TILE_SIZE_M,
) -> tuple[float, float, float, float]:
    """
    Ground bounds [min_x, min_y, max_x, max_y] for grid cell (row, col).

    Row increases southward; col increases eastward from AOI top-left.
    """
    min_x = origin_x + col * size_m
    max_y = origin_y - row * size_m
    max_x = min_x + size_m
    min_y = max_y - size_m
    return min_x, min_y, max_x, max_y


def build_tile_grid(
    aoi_native: BaseGeometry,
    crs: str,
    mgrs_tile: str,
    aoi_id: str,
    size_m: int = TILE_SIZE_M,
) -> list[Tile]:
    """
    Cover the AOI with a fixed size_m grid anchored at AOI top-left.

    Only cells that intersect the AOI polygon are kept. Geometry is identical
    for every scene that shares the same AOI + CRS + mgrs_tile.
    """
    origin_x, origin_y = aoi_top_left(aoi_native)
    min_x, min_y, max_x, max_y = aoi_native.bounds

    n_cols = max(1, math.ceil((max_x - origin_x) / size_m))
    n_rows = max(1, math.ceil((origin_y - min_y) / size_m))

    tiles: list[Tile] = []
    for row in range(n_rows):
        for col in range(n_cols):
            bounds = tile_native_bounds(origin_x, origin_y, row, col, size_m)
            cell = box(*bounds)
            if not cell.intersects(aoi_native):
                continue
            tile_id = make_tile_id(mgrs_tile, row, col)
            tiles.append(
                Tile(
                    tile_id=tile_id,
                    aoi_id=aoi_id,
                    mgrs_tile=mgrs_tile,
                    row=row,
                    col=col,
                    size_m=size_m,
                    crs=crs,
                    native_bounds=list(bounds),
                    bbox=bounds_to_wgs84(bounds, crs),
                )
            )
    return tiles


# ---------------------------------------------------------------------------
# Native windows (no resampling)
# ---------------------------------------------------------------------------
def expected_window_px(resolution_m: int) -> int:
    px = WINDOW_PX_BY_RESOLUTION_M.get(int(resolution_m))
    if px is None:
        raise ValueError(
            f"Unsupported resolution {resolution_m} m; "
            f"expected one of {sorted(WINDOW_PX_BY_RESOLUTION_M)}"
        )
    return px


def affine_from_stored(transform_vals: list[float] | tuple[float, ...]) -> Affine:
    if len(transform_vals) != 6:
        raise ValueError(f"Expected 6-parameter affine, got {transform_vals!r}")
    return Affine(*transform_vals)


def compute_native_window(
    tile_bounds: tuple[float, float, float, float],
    transform: Affine,
    raster_width: int,
    raster_height: int,
    resolution_m: int,
) -> tuple[Window, bool, list[str]]:
    """
    Map a 2560 m tile to an integer native pixel window of fixed size.

    Uses the raster geotransform only — never resamples. Origin is rounded to
    the nearest integer pixel; width/height are forced to the resolution-native
    chip size (256 @ 10 m, 128 @ 20 m).
    """
    warnings: list[str] = []
    expected_px = expected_window_px(resolution_m)
    min_x, min_y, max_x, max_y = tile_bounds

    # Pixel coords of tile corners via inverse affine (col, row).
    # Upper-left of tile in ground space → (min_x, max_y).
    col_f, row_f = ~transform * (min_x, max_y)
    col_off = int(round(col_f))
    row_off = int(round(row_f))

    if abs(col_f - col_off) > 1e-3 or abs(row_f - row_off) > 1e-3:
        warnings.append(
            f"Tile bounds not pixel-aligned at {resolution_m} m "
            f"(col={col_f:.4f}, row={row_f:.4f}); rounded without resampling"
        )

    window = Window(col_off, row_off, expected_px, expected_px)

    fully_inside = (
        col_off >= 0
        and row_off >= 0
        and (col_off + expected_px) <= raster_width
        and (row_off + expected_px) <= raster_height
    )
    return window, fully_inside, warnings


def build_band_window(
    band: str,
    asset: dict[str, Any],
    tile_bounds: tuple[float, float, float, float],
    imagery_root: Optional[Path],
    resolution_m: int,
) -> tuple[BandWindow, list[str]]:
    path = resolve_asset_path(str(asset["path"]), imagery_root)
    transform = affine_from_stored(asset["transform"])
    width = int(asset["width"])
    height = int(asset["height"])

    window, fully_inside, warnings = compute_native_window(
        tile_bounds, transform, width, height, resolution_m
    )
    w_bounds = window_bounds(window, transform)
    return (
        BandWindow(
            band=band,
            path=portable_relative_path(path, imagery_root),
            resolution_m=resolution_m,
            col_off=int(window.col_off),
            row_off=int(window.row_off),
            width=int(window.width),
            height=int(window.height),
            fully_inside=fully_inside,
            window_bounds=[float(w_bounds[0]), float(w_bounds[1]), float(w_bounds[2]), float(w_bounds[3])],
        ),
        warnings,
    )


def build_observation(
    tile: Tile,
    scene: dict[str, Any],
    imagery_root: Optional[Path],
) -> TileObservation:
    product_id = scene["product_id"]
    assets: dict[str, Any] = scene["metadata"].get("assets") or {}
    band_res: dict[str, int] = {
        str(k): int(v) for k, v in (scene.get("band_resolution_m") or {}).items()
    }
    warnings: list[str] = []
    windows: dict[str, BandWindow] = {}
    tile_bounds = (
        float(tile.native_bounds[0]),
        float(tile.native_bounds[1]),
        float(tile.native_bounds[2]),
        float(tile.native_bounds[3]),
    )

    missing = [b for b in REQUIRED_BANDS if b not in assets]
    if missing:
        return TileObservation(
            tile_id=tile.tile_id,
            product_id=product_id,
            crs=tile.crs,
            native_bounds=list(tile.native_bounds),
            windows={},
            status="skipped",
            warnings=[f"Missing asset metadata for bands: {', '.join(missing)}"],
        )

    all_inside = True
    for band in REQUIRED_BANDS:
        expected = EXPECTED_RESOLUTION_M[band]
        resolution_m = band_res.get(band, expected)
        if resolution_m not in WINDOW_PX_BY_RESOLUTION_M:
            # Fall back to expected S2 resolution so window size stays deterministic.
            warnings.append(
                f"{band}: native {resolution_m} m not in {{10,20}}; "
                f"using expected {expected} m window size (still no resampling)"
            )
            resolution_m = expected
        try:
            bw, band_warnings = build_band_window(
                band, assets[band], tile_bounds, imagery_root, resolution_m
            )
        except (FileNotFoundError, KeyError, ValueError, TypeError) as exc:
            warnings.append(f"{band}: {exc}")
            return TileObservation(
                tile_id=tile.tile_id,
                product_id=product_id,
                crs=tile.crs,
                native_bounds=list(tile.native_bounds),
                windows=windows,
                status="skipped",
                warnings=warnings,
            )
        windows[band] = bw
        warnings.extend(f"{band}: {w}" for w in band_warnings)
        if not bw.fully_inside:
            all_inside = False

    status = "full" if all_inside else "partial"
    return TileObservation(
        tile_id=tile.tile_id,
        product_id=product_id,
        crs=tile.crs,
        native_bounds=list(tile.native_bounds),
        windows=windows,
        status=status,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------
def upsert_tile(conn: sqlite3.Connection, tile: Tile, created_at: str) -> None:
    conn.execute(
        """
        INSERT INTO tiles (
            tile_id, aoi_id, mgrs_tile, row, col, size_m, crs,
            native_bounds_json, bbox_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tile_id) DO UPDATE SET
            aoi_id=excluded.aoi_id,
            mgrs_tile=excluded.mgrs_tile,
            row=excluded.row,
            col=excluded.col,
            size_m=excluded.size_m,
            crs=excluded.crs,
            native_bounds_json=excluded.native_bounds_json,
            bbox_json=excluded.bbox_json
        """,
        (
            tile.tile_id,
            tile.aoi_id,
            tile.mgrs_tile,
            tile.row,
            tile.col,
            tile.size_m,
            tile.crs,
            json.dumps(tile.native_bounds),
            json.dumps(asdict(tile.bbox)),
            created_at,
        ),
    )


def upsert_observation(
    conn: sqlite3.Connection,
    obs: TileObservation,
    created_at: str,
) -> None:
    windows_payload = {
        band: asdict(bw) for band, bw in obs.windows.items()
    }
    conn.execute(
        """
        INSERT INTO tile_observations (
            tile_id, product_id, crs, native_bounds_json, windows_json,
            status, warnings_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tile_id, product_id) DO UPDATE SET
            crs=excluded.crs,
            native_bounds_json=excluded.native_bounds_json,
            windows_json=excluded.windows_json,
            status=excluded.status,
            warnings_json=excluded.warnings_json
        """,
        (
            obs.tile_id,
            obs.product_id,
            obs.crs,
            json.dumps(obs.native_bounds),
            json.dumps(windows_payload),
            obs.status,
            json.dumps(obs.warnings),
            created_at,
        ),
    )


def band_window_to_rasterio(bw: BandWindow) -> Window:
    return Window(bw.col_off, bw.row_off, bw.width, bw.height)


def read_observation_band(
    obs: TileObservation,
    band: str,
    imagery_root: Optional[Path] = None,
):
    """
    Lazily read one band for an observation using the stored native window.

    Provided for downstream Phase 2/3 callers — tiling itself does not call this
    and never writes chip files.
    """
    if band not in obs.windows:
        raise KeyError(f"Band {band} not in observation {obs.tile_id}/{obs.product_id}")
    bw = obs.windows[band]
    path = resolve_asset_path(bw.path, imagery_root)
    with rasterio.open(path) as ds:
        return ds.read(1, window=band_window_to_rasterio(bw))


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def _resolve_grid_crs_and_mgrs(scenes: list[dict[str, Any]]) -> tuple[str, str]:
    if not scenes:
        raise ValueError("No accepted scenes in registry — run ingest first")

    crs_set = {s["crs"] for s in scenes if s.get("crs")}
    mgrs_set = {s["mgrs_tile"] for s in scenes if s.get("mgrs_tile")}
    if len(crs_set) != 1:
        raise ValueError(f"Accepted scenes must share one CRS; found {sorted(crs_set)}")
    if len(mgrs_set) != 1:
        raise ValueError(
            f"Accepted scenes must share one MGRS tile; found {sorted(mgrs_set)}"
        )
    return next(iter(crs_set)), next(iter(mgrs_set))


def tile_accepted_scenes(
    registry_path: Path,
    aoi_path: Path,
    aoi_id: str = "pilot",
    aoi_crs: str = "EPSG:4326",
    imagery_root: Optional[Path] = None,
    product_ids: Optional[list[str]] = None,
) -> tuple[TilingSummary, list[Tile], list[TileObservation]]:
    """
    Build the AOI tile grid and virtual observations for accepted scenes.

    Never reads change_sites.csv / changes.csv or any evaluation labels.
    Never writes GeoTIFF chips — only SQLite window recipes + Tile contracts.
    """
    if not registry_path.is_file():
        raise FileNotFoundError(f"Registry not found: {registry_path}")

    aoi = load_aoi(aoi_path)
    conn = sqlite3.connect(str(registry_path))
    init_tile_tables(conn)

    try:
        scenes = load_accepted_scenes(conn)
        if product_ids:
            wanted = set(product_ids)
            scenes = [s for s in scenes if s["product_id"] in wanted]
        if not scenes:
            raise ValueError("No matching accepted scenes to tile")

        crs, mgrs_tile = _resolve_grid_crs_and_mgrs(scenes)
        aoi_native = aoi_in_crs(aoi, aoi_crs, crs)
        tiles = build_tile_grid(aoi_native, crs, mgrs_tile, aoi_id)

        created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for tile in tiles:
            upsert_tile(conn, tile, created_at)

        observations: list[TileObservation] = []
        summary = TilingSummary(
            aoi_id=aoi_id,
            crs=crs,
            mgrs_tile=mgrs_tile,
            tiles=len(tiles),
            scene_ids=[s["product_id"] for s in scenes],
            tile_ids=[t.tile_id for t in tiles],
        )

        for scene in scenes:
            for tile in tiles:
                obs = build_observation(tile, scene, imagery_root)
                upsert_observation(conn, obs, created_at)
                observations.append(obs)
                summary.observations += 1
                if obs.status == "full":
                    summary.full += 1
                elif obs.status == "partial":
                    summary.partial += 1
                else:
                    summary.skipped += 1
                if obs.warnings:
                    for w in obs.warnings:
                        logger.debug(
                            "%s / %s: %s", obs.product_id, obs.tile_id, w
                        )

        conn.commit()
        return summary, tiles, observations
    finally:
        conn.close()


def list_tiles(conn: sqlite3.Connection, aoi_id: Optional[str] = None) -> list[Tile]:
    if aoi_id:
        cur = conn.execute(
            """
            SELECT tile_id, aoi_id, mgrs_tile, row, col, size_m, crs,
                   native_bounds_json, bbox_json
            FROM tiles WHERE aoi_id = ? ORDER BY row, col
            """,
            (aoi_id,),
        )
    else:
        cur = conn.execute(
            """
            SELECT tile_id, aoi_id, mgrs_tile, row, col, size_m, crs,
                   native_bounds_json, bbox_json
            FROM tiles ORDER BY row, col
            """
        )
    tiles: list[Tile] = []
    for row in cur.fetchall():
        bbox = json.loads(row[8])
        tiles.append(
            Tile(
                tile_id=row[0],
                aoi_id=row[1],
                mgrs_tile=row[2],
                row=int(row[3]),
                col=int(row[4]),
                size_m=int(row[5]),
                crs=row[6],
                native_bounds=json.loads(row[7]),
                bbox=BoundingBox(**bbox),
            )
        )
    return tiles


def list_observations_for_product(
    conn: sqlite3.Connection,
    product_id: str,
) -> list[TileObservation]:
    cur = conn.execute(
        """
        SELECT tile_id, product_id, crs, native_bounds_json, windows_json,
               status, warnings_json
        FROM tile_observations
        WHERE product_id = ?
        ORDER BY tile_id
        """,
        (product_id,),
    )
    out: list[TileObservation] = []
    for row in cur.fetchall():
        windows_raw = json.loads(row[4]) if row[4] else {}
        windows = {
            band: BandWindow(**payload) for band, payload in windows_raw.items()
        }
        out.append(
            TileObservation(
                tile_id=row[0],
                product_id=row[1],
                crs=row[2],
                native_bounds=json.loads(row[3]),
                windows=windows,
                status=row[5],
                warnings=json.loads(row[6]) if row[6] else [],
            )
        )
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "GeoSentinel virtual tiling: accepted SQLite scenes → fixed 2560 m "
            "grid + native raster window recipes (no chip export, no ML)"
        )
    )
    parser.add_argument(
        "--registry",
        type=Path,
        required=True,
        help="Path to geosentinel.sqlite registry",
    )
    parser.add_argument(
        "--aoi",
        type=Path,
        required=True,
        help="Path to aoi.geojson",
    )
    parser.add_argument(
        "--aoi-id",
        type=str,
        default="pilot",
        help="AOI identifier stored on Tile rows (default: pilot)",
    )
    parser.add_argument(
        "--aoi-crs",
        type=str,
        default="EPSG:4326",
        help="CRS of AOI geometries (default: EPSG:4326)",
    )
    parser.add_argument(
        "--imagery-root",
        type=Path,
        default=None,
        help="Root for resolving relative asset paths from ingest metadata",
    )
    parser.add_argument(
        "--product-id",
        action="append",
        default=None,
        help="Limit to one or more product_id values (repeatable)",
    )
    parser.add_argument(
        "--list-tiles",
        action="store_true",
        help="After tiling (or alone if already tiled), print tile_ids as JSON",
    )
    parser.add_argument(
        "--list-product",
        type=str,
        default=None,
        help="Print observation window summary JSON for one product_id",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable debug logging",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    summary, tiles, _observations = tile_accepted_scenes(
        registry_path=args.registry,
        aoi_path=args.aoi,
        aoi_id=args.aoi_id,
        aoi_crs=args.aoi_crs,
        imagery_root=args.imagery_root,
        product_ids=args.product_id,
    )

    payload: dict[str, Any] = {
        "aoi_id": summary.aoi_id,
        "crs": summary.crs,
        "mgrs_tile": summary.mgrs_tile,
        "tiles": summary.tiles,
        "observations": summary.observations,
        "full": summary.full,
        "partial": summary.partial,
        "skipped": summary.skipped,
        "scene_ids": summary.scene_ids,
        "tile_ids": summary.tile_ids,
    }

    if args.list_tiles:
        payload["tiles_detail"] = [
            {
                "tile_id": t.tile_id,
                "row": t.row,
                "col": t.col,
                "native_bounds": t.native_bounds,
                "bbox": asdict(t.bbox),
            }
            for t in tiles
        ]

    if args.list_product:
        conn = sqlite3.connect(str(args.registry))
        try:
            obs_list = list_observations_for_product(conn, args.list_product)
            payload["product_observations"] = [
                {
                    "tile_id": o.tile_id,
                    "product_id": o.product_id,
                    "status": o.status,
                    "windows": {
                        band: {
                            "col_off": bw.col_off,
                            "row_off": bw.row_off,
                            "width": bw.width,
                            "height": bw.height,
                            "resolution_m": bw.resolution_m,
                            "fully_inside": bw.fully_inside,
                        }
                        for band, bw in o.windows.items()
                    },
                    "warnings": o.warnings,
                }
                for o in obs_list
            ]
        finally:
            conn.close()

    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

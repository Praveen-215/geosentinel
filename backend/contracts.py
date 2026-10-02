"""
contracts.py - data shapes shared by the backend pipelines and the frontend.

Field names mirror frontend/src/types/index.ts. Backend code builds these
objects and exports them with to_json(), which turns snake_case keys into the
camelCase keys the frontend expects.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Optional

# Change types the backend produces (PS 2.2.2). Frontend enum must include them.
CHANGE_TYPES = ("CONSTRUCTION", "CLEARANCE", "WATER", "ROAD")
CHECK_STATUS = ("PASS", "WARN", "FAIL")
CONFIDENCE_BUCKETS = ("HIGH", "MEDIUM", "LOW")
DISPOSITIONS = ("confirmed", "rejected", "flagged")


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(w.capitalize() for w in rest)


def _convert(obj):
    if isinstance(obj, dict):
        return {_camel(k): _convert(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert(v) for v in obj]
    return obj


def to_json(obj, **kwargs) -> str:
    """Serialise a contract object (or a list of them) for the frontend."""
    data = [asdict(o) for o in obj] if isinstance(obj, list) else asdict(obj)
    return json.dumps(_convert(data), **kwargs)


@dataclass
class BoundingBox:
    """Always EPSG:4326 (lon/lat) so the map can draw it."""
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float


@dataclass
class Scene:
    id: str                     # product_id from scenes.csv
    satellite: str              # 'Sentinel-2A' | 'Sentinel-2B' (from product_id)
    sensor: str                 # 'MSI'
    acquisition_date: str       # ISO 8601 UTC
    cloud_cover_percent: float  # 0-100 (scenes.csv holds 0-1: multiply by 100)
    resolution_meters: int      # finest band (10); B05-B07, B11, B12, SCL are 20
    processing_level: str       # 'L2A / Analysis Ready'
    mgrs_tile: str
    crs: str                    # native UTM, e.g. 'EPSG:32643'
    bbox: BoundingBox           # lon/lat, display only
    processing_baseline: str    # e.g. '05.10'
    relative_orbit: int
    shadow_percent: float       # 0-100, from SCL inside AOI
    valid_percent: float        # 0-100
    bands: list[str]            # e.g. ['B02','B03','B04','B08','B05',...,'SCL']
    band_resolution_m: dict[str, int] # e.g. {'B02': 10, 'B03': 10, 'B04': 10, 'B08': 10, 'B05': 20, ...}
    sun_elevation_deg: Optional[float] = None  # not in scenes.csv
    sun_azimuth_deg: Optional[float] = None    # not in scenes.csv
    thumbnail_url: Optional[str] = None


@dataclass
class Tile:
    """A fixed 2560 m × 2560 m square of ground, identical across every date.

    At 10 m resolution: 256 × 256 px.
    At 20 m resolution: 128 × 128 px.

    tile_id = f"{mgrs_tile}_r{row:03d}_c{col:03d}"
    on a grid anchored at the AOI's top-left corner in native UTM.
    One observation = tile_id + scene_id.
    """
    tile_id: str
    aoi_id: str
    mgrs_tile: str
    row: int
    col: int
    size_m: int #2560
    crs: str                    # native UTM, e.g. 'EPSG:32643'
    native_bounds: list[float]  # [min_x, min_y, max_x, max_y] in crs meters
    bbox: BoundingBox           # lon/lat, display only


@dataclass
class SearchQuery:
    top_k: int = 20
    text: Optional[str] = None            # free-text query
    reference_tile_id: Optional[str] = None  # image-to-image: an indexed tile
    image_path: Optional[str] = None      # image-to-image: an uploaded image
    aoi_id: Optional[str] = None
    start_date: Optional[str] = None      # ISO date
    end_date: Optional[str] = None
    sensor: Optional[str] = None
    max_cloud_percent: Optional[float] = None


@dataclass
class SearchResult:
    """One ranked hit. Retrieval returns TILES, so tile_id/tile_bbox are new."""
    id: str
    scene_id: str
    tile_id: str
    tile_bbox: BoundingBox
    similarity_score: float     # 0-1
    semantic_rank: int          # 1 = best
    scene: Scene
    retrieval_timestamp: str
    aoi_id: Optional[str] = None


@dataclass
class QualityChecks:
    cloud_cover_t1: float       # 0-100
    cloud_cover_t2: float       # 0-100
    temporal_separation_days: int
    co_registration: str        # PASS | WARN | FAIL
    scene_quality: str          # PASS | WARN | FAIL
    cloud_shadow_screening: str  # PASS | WARN | FAIL
    shadow_cover_t1: float      # 0-100, from SCL
    shadow_cover_t2: float      # 0-100
    valid_pixels_t1: float      # 0-100, excludes nodata/swath edge
    valid_pixels_t2: float      # 0-100
    snow_haze_screening: str    # PASS | WARN | FAIL (SCL snow/ice, thin cirrus)
    seasonal_variation: str     # PASS | WARN | FAIL (t1/t2 in different seasons)
    illumination_geometry: str  # PASS | WARN | FAIL (sun/view angle difference)
    radiometric_consistency: str  # PASS | WARN | FAIL (baseline/BOA offset match)
    overall_confidence: str     # HIGH | MEDIUM | LOW
    flags: list[str] = field(default_factory=list)  # e.g. 'baseline_mismatch'


@dataclass
class ChangeQuery:
    aoi_id: str
    start_date: str                       # ISO date
    end_date: str
    tile_id: Optional[str] = None         # None = whole AOI
    change_types: Optional[list[str]] = None  # subset of CHANGE_TYPES


@dataclass
class ChangeResult:
    id: str                     # candidate id, used by ReviewDecision
    aoi: str
    tile_id: str
    t1_baseline_scene: str      # product_id
    t2_comparison_scene: str    # product_id
    change_type: str            # one of CHANGE_TYPES
    confidence: float           # 0-1 (frontend currently types this as string)
    earliest_supported_observation: str  # ISO date of earliest supporting scene
    earliest_scene_id: str
    quality_checks: QualityChecks
    change_mask: Optional[str] = None    # path/URL to mask image, if produced


@dataclass
class ReviewDecision:
    """Audit-trail record. Stored by the backend, never only in the browser."""
    review_id: str
    candidate_id: str           # ChangeResult.id or SearchResult.id
    disposition: str            # one of DISPOSITIONS
    reviewed_by: str
    reviewed_at: str            # ISO 8601 UTC
    analyst_notes: str = ""
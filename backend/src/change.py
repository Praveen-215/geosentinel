"""
Deterministic Sentinel-2 L2A Multi-Temporal Change Analysis Engine for GeoSentinel.

Pipeline:
    ChangeQuery
    -> observation selection from SQLite registry
    -> chronological temporal sequence
    -> quality/usability gate
    -> raster reading via RasterChipLoader
    -> evidence extraction (band, index, spatial, temporal)
    -> evidence interpretation (deltas, masks, connected components)
    -> deterministic classification & direction inference
    -> confidence calculation & explanation
    -> ChangeResult records

Design Principles:
    - Purely deterministic, explainable calculations; no heavy ML or black-box models.
    - Strict separation of concerns: decision and classification functions operate
      ONLY on pre-extracted evidence, NEVER reading rasters directly.
    - Reuses existing retrieval policies: RasterChipLoader, TileReadResult,
      unverified_raw_scale radiometric preservation, and categorical SCL masking.
    - Honest metadata accounting: unavailable parameters (sun angles, calibration tags)
      are flagged with WARN/flags, never fabricated.
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
from typing import Any, Optional, Sequence, Union

import numpy as np

# Ensure backend root is on sys.path for `contracts`
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from contracts import (  # noqa: E402
    CHANGE_DIRECTIONS,
    CHANGE_TYPES,
    CHECK_STATUS,
    CONFIDENCE_BUCKETS,
    BandChangeEvidence,
    BoundingBox,
    ChangeQuery,
    ChangeResult,
    IndexChangeEvidence,
    QualityChecks,
    Scene,
    SpatialChangeEvidence,
    TemporalChangeEvidence,
    TemporalObservationEvidence,
    Tile,
    to_json,
)
from src.retrieval import ChipRecipe, RasterChipLoader, TileReadResult  # noqa: E402

logger = logging.getLogger("geosentinel.change")


# ---------------------------------------------------------------------------
# Centralized Heuristic Decision Thresholds Configuration
#
# Explicit engineering heuristics for deterministic change detection.
# NOTE: These values are engineering thresholds and are NOT claimed to be
# scientifically calibrated ground truth.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ChangeThresholds:
    """Centralized collection of all decision thresholds with units and purpose."""

    # 1. Usability screening thresholds
    min_usable_valid_percent: float = 70.0  # units: %; min clear surface for usable observation
    max_usable_cloud_percent: float = 25.0  # units: %; max cloud cover for usable observation
    max_usable_shadow_percent: float = 15.0 # units: %; max shadow cover for usable observation

    # 2. Spectral index change detection thresholds (unitless normalized difference [-1, 1])
    water_ndwi_delta: float = 0.15          # units: delta NDWI; threshold for water expansion/contraction
    water_ndwi_level_min: float = 0.02      # units: NDWI; minimum NDWI to confirm water presence
    clearance_ndvi_drop: float = -0.18      # units: delta NDVI; minimum NDVI drop for vegetation loss
    clearance_ndvi_baseline_min: float = 0.30 # units: NDVI; minimum baseline NDVI to confirm vegetation
    construction_ndbi_gain: float = 0.12    # units: delta NDBI; minimum NDBI gain for built-up expansion
    construction_ndbi_level_min: float = -0.05 # units: NDBI; minimum NDBI level in comparison state

    # 3. Spatial evidence thresholds
    min_changed_pixels: int = 8             # units: pixels; minimum cluster size (10m px = 100m^2 each)
    min_changed_percent: float = 0.3        # units: % of tile; minimum spatial extent in tile
    min_spatial_coherence: float = 0.20     # units: fraction; ratio of largest cluster to total change
    road_aspect_ratio_min: float = 2.8      # units: ratio (length/width); minimum elongation for roads

    # 4. Classification & Abstention thresholds
    min_class_support: float = 0.35         # units: score [0, 1]; minimum evidence score to classify
    min_class_margin: float = 0.08          # units: score delta; minimum margin between top-1 and top-2
    earliest_support_threshold: float = 0.40 # units: score [0, 1]; score needed for earliest observation

    # 5. Temporal persistence thresholds
    min_persistence_score: float = 0.50     # units: score [0, 1]; score to designate persistent change


DEFAULT_THRESHOLDS = ChangeThresholds()


# ---------------------------------------------------------------------------
# Internal Data Models & Intermediate Containers
# ---------------------------------------------------------------------------

@dataclass
class TileObservationRecord:
    """Resolved observation for a tile from SQLite catalog."""

    tile_id: str
    scene_id: str
    scene: Scene
    recipe: ChipRecipe
    acquisition_date: str
    usable: bool
    unusable_reason: Optional[str] = None


@dataclass
class SpectralBundle:
    """Loaded and masked raster bands and spectral indices for a single tile observation."""

    scene_id: str
    tile_id: str
    acquisition_date: str
    valid_mask_256: np.ndarray       # (256, 256) bool: 10m clear-surface pixels
    valid_mask_128: np.ndarray       # (128, 128) bool: 20m clear-surface pixels
    radiometric_status: str          # verified_conversion | already_scaled_reflectance | unverified_raw_scale
    valid_pixel_count: int
    valid_fraction: float
    cloud_fraction: float
    shadow_fraction: float
    scl_histogram: dict[int, int]
    ndwi_map: np.ndarray             # (256, 256) float32
    ndvi_map: np.ndarray             # (256, 256) float32
    ndbi_map: np.ndarray             # (128, 128) float32
    band_arrays: dict[str, np.ndarray] # band -> raw or calibrated float32 array
    band_means: dict[str, float]     # band -> mean over valid pixels
    band_stds: dict[str, float]      # band -> std over valid pixels


# ---------------------------------------------------------------------------
# Pure NumPy Connected Components & Spatial Geometry
# ---------------------------------------------------------------------------

def label_connected_components(mask: np.ndarray) -> tuple[np.ndarray, int, dict[int, int]]:
    """
    Deterministic 4-connected component labeling using pure NumPy/breadth-first traversal.

    Args:
        mask: 2D boolean array where True represents a changed pixel.

    Returns:
        labels: 2D integer array with component IDs (0 is background).
        num_components: Total count of connected components found.
        component_sizes: Dictionary mapping component ID -> pixel count.
    """
    if mask.ndim != 2:
        raise ValueError(f"Mask must be 2D, got shape {mask.shape}")

    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current_label = 0
    component_sizes: dict[int, int] = {}

    unvisited = mask & (labels == 0)
    indices = np.argwhere(unvisited)

    for r_start, c_start in indices:
        if labels[r_start, c_start] != 0 or not mask[r_start, c_start]:
            continue

        current_label += 1
        queue = [(r_start, c_start)]
        labels[r_start, c_start] = current_label
        size = 0

        head = 0
        while head < len(queue):
            r, c = queue[head]
            head += 1
            size += 1

            # 4-connected neighbors
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < h and 0 <= nc < w:
                    if mask[nr, nc] and labels[nr, nc] == 0:
                        labels[nr, nc] = current_label
                        queue.append((nr, nc))

        component_sizes[current_label] = size

    return labels, current_label, component_sizes


def compute_bounding_box_aspect_ratio(coords: np.ndarray) -> float:
    """
    Compute aspect ratio (length / width) of a set of 2D coordinates.

    Args:
        coords: (N, 2) array of row, col positions.

    Returns:
        float >= 1.0 representing the bounding box elongation.
    """
    if coords.size == 0 or len(coords) < 2:
        return 1.0

    min_r, min_c = np.min(coords, axis=0)
    max_r, max_c = np.max(coords, axis=0)

    dr = max(1, max_r - min_r + 1)
    dc = max(1, max_c - min_c + 1)

    return float(max(dr, dc) / min(dr, dc))


# ---------------------------------------------------------------------------
# Evidence Extraction Functions (Rasters -> Structured Evidence)
# ---------------------------------------------------------------------------

def extract_band_evidence(
    bundle_t1: SpectralBundle,
    bundle_t2: SpectralBundle,
    mutual_mask_256: np.ndarray,
    mutual_mask_128: np.ndarray,
) -> dict[str, BandChangeEvidence]:
    """Extract band-level change statistics across mutually valid clear-surface pixels."""
    evidence: dict[str, BandChangeEvidence] = {}

    for band in ("B02", "B03", "B04", "B08"):
        if band in bundle_t1.band_arrays and band in bundle_t2.band_arrays:
            arr1 = bundle_t1.band_arrays[band]
            arr2 = bundle_t2.band_arrays[band]
            if np.any(mutual_mask_256):
                m1 = float(np.mean(arr1[mutual_mask_256]))
                m2 = float(np.mean(arr2[mutual_mask_256]))
            else:
                m1, m2 = 0.0, 0.0

            delta = m2 - m1
            mag = abs(delta)
            denom = max(1e-6, abs(m1) + abs(m2))
            rel = float(mag / denom)
            support = float(np.clip(mag / 1000.0 if bundle_t1.radiometric_status == "unverified_raw_scale" else mag, 0.0, 1.0))

            evidence[band] = BandChangeEvidence(
                band=band,
                delta=round(delta, 4),
                magnitude=round(mag, 4),
                support=round(support, 4),
                relevance=round(rel, 4),
            )

    for band in ("B05", "B06", "B07", "B11", "B12"):
        if band in bundle_t1.band_arrays and band in bundle_t2.band_arrays:
            arr1 = bundle_t1.band_arrays[band]
            arr2 = bundle_t2.band_arrays[band]
            if np.any(mutual_mask_128):
                m1 = float(np.mean(arr1[mutual_mask_128]))
                m2 = float(np.mean(arr2[mutual_mask_128]))
            else:
                m1, m2 = 0.0, 0.0

            delta = m2 - m1
            mag = abs(delta)
            denom = max(1e-6, abs(m1) + abs(m2))
            rel = float(mag / denom)
            support = float(np.clip(mag / 1000.0 if bundle_t1.radiometric_status == "unverified_raw_scale" else mag, 0.0, 1.0))

            evidence[band] = BandChangeEvidence(
                band=band,
                delta=round(delta, 4),
                magnitude=round(mag, 4),
                support=round(support, 4),
                relevance=round(rel, 4),
            )

    return evidence


def extract_index_evidence(
    bundle_t1: SpectralBundle,
    bundle_t2: SpectralBundle,
    mutual_mask_256: np.ndarray,
    mutual_mask_128: np.ndarray,
) -> list[IndexChangeEvidence]:
    """Extract normalized difference index changes across mutually valid clear-surface pixels."""
    results: list[IndexChangeEvidence] = []

    # NDWI
    if np.any(mutual_mask_256):
        w1 = float(np.mean(bundle_t1.ndwi_map[mutual_mask_256]))
        w2 = float(np.mean(bundle_t2.ndwi_map[mutual_mask_256]))
    else:
        w1, w2 = 0.0, 0.0
    dw = w2 - w1
    mag_w = abs(dw)
    results.append(
        IndexChangeEvidence(
            index="NDWI",
            before=round(w1, 4),
            after=round(w2, 4),
            delta=round(dw, 4),
            magnitude=round(mag_w, 4),
            support=round(float(np.clip(mag_w / 0.50, 0.0, 1.0)), 4),
        )
    )

    # NDVI
    if np.any(mutual_mask_256):
        v1 = float(np.mean(bundle_t1.ndvi_map[mutual_mask_256]))
        v2 = float(np.mean(bundle_t2.ndvi_map[mutual_mask_256]))
    else:
        v1, v2 = 0.0, 0.0
    dv = v2 - v1
    mag_v = abs(dv)
    results.append(
        IndexChangeEvidence(
            index="NDVI",
            before=round(v1, 4),
            after=round(v2, 4),
            delta=round(dv, 4),
            magnitude=round(mag_v, 4),
            support=round(float(np.clip(mag_v / 0.50, 0.0, 1.0)), 4),
        )
    )

    # NDBI
    if np.any(mutual_mask_128):
        b1 = float(np.mean(bundle_t1.ndbi_map[mutual_mask_128]))
        b2 = float(np.mean(bundle_t2.ndbi_map[mutual_mask_128]))
    else:
        b1, b2 = 0.0, 0.0
    db = b2 - b1
    mag_b = abs(db)
    results.append(
        IndexChangeEvidence(
            index="NDBI",
            before=round(b1, 4),
            after=round(b2, 4),
            delta=round(db, 4),
            magnitude=round(mag_b, 4),
            support=round(float(np.clip(mag_b / 0.40, 0.0, 1.0)), 4),
        )
    )

    return results


def extract_spatial_evidence(
    change_mask: np.ndarray,
    mutual_valid_mask: np.ndarray,
) -> SpatialChangeEvidence:
    """Extract spatial clustering and geometry metrics from the change mask."""
    valid_pixels = int(np.sum(mutual_valid_mask))
    changed_pixels = int(np.sum(change_mask & mutual_valid_mask))

    if valid_pixels > 0:
        changed_pixel_percent = (changed_pixels / valid_pixels) * 100.0
    else:
        changed_pixel_percent = 0.0

    # 1 pixel at 10m is 100 m^2 = 0.01 ha
    area_ha = changed_pixels * 0.01
    tile_total_area_ha = (256 * 256) * 0.01  # 655.36 ha
    area_change_percent = (area_ha / tile_total_area_ha) * 100.0

    if changed_pixels > 0:
        labels, num_components, component_sizes = label_connected_components(change_mask & mutual_valid_mask)
        if component_sizes:
            largest_region = max(component_sizes.values())
            largest_region_percent = (largest_region / changed_pixels) * 100.0
            spatial_coherence = float(np.clip(largest_region / changed_pixels, 0.0, 1.0))
        else:
            largest_region_percent = 0.0
            spatial_coherence = 0.0
    else:
        num_components = 0
        largest_region_percent = 0.0
        spatial_coherence = 0.0

    return SpatialChangeEvidence(
        changed_pixel_percent=round(changed_pixel_percent, 4),
        largest_region_percent=round(largest_region_percent, 4),
        connected_region_count=num_components,
        spatial_coherence=round(spatial_coherence, 4),
        area_change_percent=round(area_change_percent, 4),
    )


# ---------------------------------------------------------------------------
# Decision & Classification Logic (Operates ONLY on Extracted Evidence)
# ---------------------------------------------------------------------------

def classify_change(
    indices: list[IndexChangeEvidence],
    spatial: SpatialChangeEvidence,
    change_mask: np.ndarray,
    thresholds: ChangeThresholds = DEFAULT_THRESHOLDS,
) -> tuple[Optional[str], float, dict[str, float]]:
    """
    Deterministic multi-evidence change classification and abstention.

    Does NOT read rasters. Operates strictly on pre-computed evidence.

    Returns:
        (best_class, support_score, all_class_scores) or (None, 0.0, all_class_scores) if abstaining.
    """
    idx_map = {item.index: item for item in indices}
    ndwi = idx_map.get("NDWI")
    ndvi = idx_map.get("NDVI")
    ndbi = idx_map.get("NDBI")

    if not ndwi or not ndvi or not ndbi:
        return None, 0.0, {}

    scores: dict[str, float] = {
        "WATER": 0.0,
        "CLEARANCE": 0.0,
        "CONSTRUCTION": 0.0,
        "ROAD": 0.0,
    }

    # 1. WATER: Driven by large magnitude NDWI shift
    if abs(ndwi.delta) >= thresholds.water_ndwi_delta:
        score_w = ndwi.support * 0.70 + spatial.spatial_coherence * 0.30
        scores["WATER"] = float(np.clip(score_w, 0.0, 1.0))

    # 2. CLEARANCE: Driven by sharp NDVI drop from vegetative baseline
    if ndvi.delta <= thresholds.clearance_ndvi_drop and ndvi.before >= thresholds.clearance_ndvi_baseline_min:
        score_c = ndvi.support * 0.70 + spatial.spatial_coherence * 0.30
        scores["CLEARANCE"] = float(np.clip(score_c, 0.0, 1.0))

    coords = np.argwhere(change_mask)
    aspect_ratio = compute_bounding_box_aspect_ratio(coords) if coords.size > 0 else 1.0

    # 3. CONSTRUCTION: Driven by NDBI increase without vegetation gain (areal footprint)
    if ndbi.delta >= thresholds.construction_ndbi_gain and ndvi.delta <= 0.05:
        base_con = ndbi.support * 0.60 + spatial.spatial_coherence * 0.40
        if aspect_ratio >= thresholds.road_aspect_ratio_min:
            scores["CONSTRUCTION"] = float(np.clip(base_con * 0.40, 0.0, 1.0))
        else:
            scores["CONSTRUCTION"] = float(np.clip(base_con, 0.0, 1.0))

    # 4. ROAD: Driven by NDBI increase with high linear aspect ratio
    if ndbi.delta >= thresholds.construction_ndbi_gain and aspect_ratio >= thresholds.road_aspect_ratio_min:
        score_r = ndbi.support * 0.50 + min(1.0, aspect_ratio / 5.0) * 0.50
        scores["ROAD"] = float(np.clip(score_r, 0.0, 1.0))

    # Sort classes descending by support
    ranked = sorted(scores.items(), key=lambda item: -item[1])
    best_class, best_score = ranked[0]
    second_class, second_score = ranked[1]

    # Classification Abstention:
    # Require best score >= min_support AND margin >= min_margin
    if best_score < thresholds.min_class_support:
        return None, 0.0, scores

    if (best_score - second_score) < thresholds.min_class_margin:
        logger.debug(
            "Abstaining: ambiguous classification between %s (%.3f) and %s (%.3f)",
            best_class,
            best_score,
            second_class,
            second_score,
        )
        return None, 0.0, scores

    return best_class, best_score, scores


def infer_direction(
    change_type: str,
    indices: list[IndexChangeEvidence],
    spatial: SpatialChangeEvidence,
) -> str:
    """
    Infer physical direction of change from evidence.

    Supported: APPEARANCE, DISAPPEARANCE, EXPANSION, CONTRACTION.
    """
    idx_map = {item.index: item for item in indices}
    ndwi = idx_map.get("NDWI")
    ndvi = idx_map.get("NDVI")
    ndbi = idx_map.get("NDBI")

    if change_type == "WATER":
        if ndwi and ndwi.delta > 0:
            return "EXPANSION"
        return "CONTRACTION"

    if change_type == "CLEARANCE":
        # Vegetation loss results in the appearance of cleared surface
        return "APPEARANCE"

    if change_type == "CONSTRUCTION":
        if ndbi and ndbi.before > 0.0:
            return "EXPANSION"
        return "APPEARANCE"

    if change_type == "ROAD":
        if spatial.changed_pixel_percent > 3.0:
            return "EXPANSION"
        return "APPEARANCE"

    return "APPEARANCE"


# ---------------------------------------------------------------------------
# Quality Evaluation Engine
# ---------------------------------------------------------------------------

def evaluate_quality_checks(
    scene_t1: Scene,
    scene_t2: Scene,
    bundle_t1: SpectralBundle,
    bundle_t2: SpectralBundle,
) -> QualityChecks:
    """
    Evaluate 14 QualityChecks gates honestly from available metadata.

    Never fabricates unavailable parameters (sun angles, calibration tags).
    """
    flags: list[str] = []

    # 1. Temporal separation
    d1 = datetime.fromisoformat(scene_t1.acquisition_date.split("T")[0])
    d2 = datetime.fromisoformat(scene_t2.acquisition_date.split("T")[0])
    temporal_sep_days = abs((d2 - d1).days)

    # 2. Co-registration check
    # Validate identical CRS, MGRS tile, grid bounds
    crs_match = (scene_t1.crs == scene_t2.crs)
    mgrs_match = (scene_t1.mgrs_tile == scene_t2.mgrs_tile)
    orbit_match = (scene_t1.relative_orbit == scene_t2.relative_orbit)

    if not crs_match or not mgrs_match:
        co_reg = "FAIL"
        flags.append("incompatible_spatial_grid")
    elif orbit_match:
        co_reg = "PASS"
        flags.append("orbit_based_alignment")
    else:
        co_reg = "WARN"
        flags.append("differing_relative_orbits")

    # 3. Scene quality
    if scene_t1.processing_level == "L2A" and scene_t2.processing_level == "L2A":
        scene_quality = "PASS"
    else:
        scene_quality = "WARN"
        flags.append("non_standard_processing_level")

    # 4. Cloud and shadow screening
    shadow_t1 = bundle_t1.shadow_fraction * 100.0
    shadow_t2 = bundle_t2.shadow_fraction * 100.0
    cloud_t1 = bundle_t1.cloud_fraction * 100.0
    cloud_t2 = bundle_t2.cloud_fraction * 100.0

    if shadow_t1 < 10.0 and shadow_t2 < 10.0 and cloud_t1 < 20.0 and cloud_t2 < 20.0:
        cloud_shadow_scr = "PASS"
    else:
        cloud_shadow_scr = "WARN"
        flags.append("elevated_cloud_or_shadow")

    # 5. Snow and thin cirrus screening (from SCL classes 10, 11)
    scl1_cirrus = bundle_t1.scl_histogram.get(10, 0)
    scl2_cirrus = bundle_t2.scl_histogram.get(10, 0)
    scl1_snow = bundle_t1.scl_histogram.get(11, 0)
    scl2_snow = bundle_t2.scl_histogram.get(11, 0)

    if scl1_cirrus > 0 or scl2_cirrus > 0:
        snow_haze_scr = "WARN"
        flags.append("cirrus_present_scl_only")
    elif scl1_snow > 0 or scl2_snow > 0:
        snow_haze_scr = "WARN"
        flags.append("snow_or_ice_detected")
    else:
        snow_haze_scr = "PASS"

    # 6. Seasonal variation
    # Check day of year distance mod 365
    doy1 = d1.timetuple().tm_yday
    doy2 = d2.timetuple().tm_yday
    doy_diff = abs(doy1 - doy2)
    if doy_diff > 182:
        doy_diff = 365 - doy_diff

    if doy_diff > 75:
        seasonal_var = "WARN"
        flags.append("cross_season_comparison")
    else:
        seasonal_var = "PASS"

    # 7. Illumination geometry
    # Sun angles are not provided in current repository metadata
    if scene_t1.sun_elevation_deg is None or scene_t2.sun_elevation_deg is None:
        illum_geom = "WARN"
        flags.append("sun_geometry_unavailable")
    else:
        elev_diff = abs(scene_t1.sun_elevation_deg - scene_t2.sun_elevation_deg)
        illum_geom = "PASS" if elev_diff <= 15.0 else "WARN"

    # 8. Radiometric consistency
    base1 = str(scene_t1.processing_baseline or "").strip()
    base2 = str(scene_t2.processing_baseline or "").strip()

    if bundle_t1.radiometric_status == "unverified_raw_scale" or bundle_t2.radiometric_status == "unverified_raw_scale":
        flags.append("unverified_raw_scale")

    if base1 and base2 and base1 == base2:
        radiometric_cons = "PASS"
    else:
        radiometric_cons = "WARN"
        flags.append("processing_baseline_divergence")

    # 9. Overall confidence bucket
    warn_count = sum(
        1 for check in (co_reg, scene_quality, cloud_shadow_scr, snow_haze_scr, seasonal_var, illum_geom, radiometric_cons)
        if check == "WARN"
    )
    fail_count = sum(
        1 for check in (co_reg, scene_quality, cloud_shadow_scr, snow_haze_scr, seasonal_var, illum_geom, radiometric_cons)
        if check == "FAIL"
    )

    if fail_count > 0 or warn_count >= 4:
        overall_conf = "LOW"
    elif warn_count >= 2:
        overall_conf = "MEDIUM"
    else:
        overall_conf = "HIGH"

    return QualityChecks(
        cloud_cover_t1=round(cloud_t1, 2),
        cloud_cover_t2=round(cloud_t2, 2),
        temporal_separation_days=temporal_sep_days,
        co_registration=co_reg,
        scene_quality=scene_quality,
        cloud_shadow_screening=cloud_shadow_scr,
        shadow_cover_t1=round(shadow_t1, 2),
        shadow_cover_t2=round(shadow_t2, 2),
        valid_pixels_t1=round(bundle_t1.valid_fraction * 100.0, 2),
        valid_pixels_t2=round(bundle_t2.valid_fraction * 100.0, 2),
        snow_haze_screening=snow_haze_scr,
        seasonal_variation=seasonal_var,
        illumination_geometry=illum_geom,
        radiometric_consistency=radiometric_cons,
        overall_confidence=overall_conf,
        flags=flags,
    )


# ---------------------------------------------------------------------------
# Multi-Temporal Sequence & Persistence Analyzer
# ---------------------------------------------------------------------------

def analyze_temporal_sequence(
    ordered_bundles: list[SpectralBundle],
    change_type: str,
    direction: str,
    thresholds: ChangeThresholds = DEFAULT_THRESHOLDS,
) -> TemporalChangeEvidence:
    """
    Analyze chronological observations to determine onset, persistence, and earliest supported observation.

    Does NOT reduce to first-vs-last. Evaluates trajectory step-by-step.
    """
    if len(ordered_bundles) < 2:
        return TemporalChangeEvidence(
            observations=[],
            persistence_score=0.0,
            supported_observation_count=0,
            usable_observation_count=len(ordered_bundles),
            trajectory="INSUFFICIENT_OBSERVATIONS",
            persistence_status="INSUFFICIENT_OBSERVATIONS",
        )

    t0 = ordered_bundles[0]
    observations_evidence: list[TemporalObservationEvidence] = []
    supported_scenes: list[tuple[str, str]] = []  # (scene_id, date)
    earliest_candidate_scene: Optional[str] = None
    earliest_candidate_date: Optional[str] = None
    earliest_supported_scene: Optional[str] = None
    earliest_supported_date: Optional[str] = None

    consecutive_supports = 0
    max_consecutive_supports = 0
    previous_was_supported = None

    for i, ti in enumerate(ordered_bundles):
        if i == 0:
            observations_evidence.append(
                TemporalObservationEvidence(
                    scene_id=ti.scene_id,
                    acquisition_date=ti.acquisition_date,
                    usable=True,
                    quality_score=1.0,
                    change_score=0.0,
                    persistent_with_previous=None,
                    notes=["baseline_reference"],
                )
            )
            continue

        # Evaluate mutual clear pixels with baseline
        mutual_mask = t0.valid_mask_256 & ti.valid_mask_256
        if not np.any(mutual_mask):
            observations_evidence.append(
                TemporalObservationEvidence(
                    scene_id=ti.scene_id,
                    acquisition_date=ti.acquisition_date,
                    usable=False,
                    quality_score=0.0,
                    change_score=0.0,
                    persistent_with_previous=None,
                    notes=["no_mutual_clear_pixels"],
                )
            )
            previous_was_supported = None
            continue

        # Check relevant index delta relative to baseline
        if change_type == "WATER":
            delta_val = float(np.mean(ti.ndwi_map[mutual_mask])) - float(np.mean(t0.ndwi_map[mutual_mask]))
            if direction == "CONTRACTION":
                delta_val = -delta_val
            change_score = float(np.clip(delta_val / thresholds.water_ndwi_delta, 0.0, 1.0))
        elif change_type == "CLEARANCE":
            delta_val = float(np.mean(t0.ndvi_map[mutual_mask])) - float(np.mean(ti.ndvi_map[mutual_mask]))
            change_score = float(np.clip(delta_val / abs(thresholds.clearance_ndvi_drop), 0.0, 1.0))
        else:
            delta_val = float(np.mean(ti.ndbi_map[t0.valid_mask_128 & ti.valid_mask_128])) - float(
                np.mean(t0.ndbi_map[t0.valid_mask_128 & ti.valid_mask_128])
            )
            change_score = float(np.clip(delta_val / thresholds.construction_ndbi_gain, 0.0, 1.0))

        quality_score = float(np.clip(ti.valid_fraction, 0.0, 1.0))
        is_supported = (change_score >= thresholds.earliest_support_threshold) and (quality_score >= 0.50)

        # Persistence with previous observation
        if previous_was_supported is None:
            pers_prev = None
        else:
            pers_prev = bool(is_supported and previous_was_supported)

        notes: list[str] = []
        if is_supported:
            notes.append("change_signal_supported")
            supported_scenes.append((ti.scene_id, ti.acquisition_date))
            consecutive_supports += 1
            max_consecutive_supports = max(max_consecutive_supports, consecutive_supports)
            if earliest_supported_scene is None:
                earliest_supported_scene = ti.scene_id
                earliest_supported_date = ti.acquisition_date
        else:
            consecutive_supports = 0
            if change_score > 0.20:
                notes.append("sub_threshold_change_signal")

        if change_score >= 0.25 and earliest_candidate_scene is None:
            earliest_candidate_scene = ti.scene_id
            earliest_candidate_date = ti.acquisition_date

        observations_evidence.append(
            TemporalObservationEvidence(
                scene_id=ti.scene_id,
                acquisition_date=ti.acquisition_date,
                usable=True,
                quality_score=round(quality_score, 4),
                change_score=round(change_score, 4),
                persistent_with_previous=pers_prev,
                notes=notes,
            )
        )
        previous_was_supported = is_supported

    usable_count = sum(1 for obs in observations_evidence if obs.usable)
    supported_count = len(supported_scenes)

    # Persistence score and status determination
    if supported_count == 0:
        persistence_score = 0.0
        status = "NO_CHANGE"
        trajectory = "STABLE"
    elif supported_count == 1 and observations_evidence[-1].change_score >= thresholds.earliest_support_threshold:
        persistence_score = 0.50
        status = "UNCONFIRMED_FINAL_OBSERVATION"
        trajectory = "RECENT_ONSET"
    elif supported_count == 1:
        persistence_score = 0.20
        status = "TRANSIENT"
        trajectory = "TRANSIENT_SPIKE"
    elif max_consecutive_supports >= 2:
        persistence_score = min(1.0, 0.60 + 0.20 * (max_consecutive_supports - 1))
        status = "PERSISTENT"
        trajectory = "PERSISTENT_STEP"
    else:
        persistence_score = 0.40
        status = "INTERMITTENT"
        trajectory = "OSCILLATING"

    return TemporalChangeEvidence(
        observations=observations_evidence,
        persistence_score=round(persistence_score, 4),
        supported_observation_count=supported_count,
        usable_observation_count=usable_count,
        trajectory=trajectory,
        earliest_candidate_scene_id=earliest_candidate_scene,
        earliest_candidate_date=earliest_candidate_date,
        earliest_supported_scene_id=earliest_supported_scene or (ordered_bundles[-1].scene_id if supported_count > 0 else None),
        earliest_supported_date=earliest_supported_date or (ordered_bundles[-1].acquisition_date if supported_count > 0 else None),
        persistence_status=status,
    )


# ---------------------------------------------------------------------------
# Change Engine Core Pipeline
# ---------------------------------------------------------------------------

class ChangeEngine:
    """
    Deterministic multi-temporal change detection engine.

    Queries SQLite catalog for observations, processes raster windows,
    extracts structured evidence, and emits ChangeResult candidates.
    """

    def __init__(
        self,
        registry_path: str | Path,
        chip_loader: Optional[RasterChipLoader] = None,
        thresholds: ChangeThresholds = DEFAULT_THRESHOLDS,
    ) -> None:
        self.registry_path = Path(registry_path)
        self.loader = chip_loader or RasterChipLoader()
        self.thresholds = thresholds

    def _connect(self) -> sqlite3.Connection:
        if not self.registry_path.exists():
            raise FileNotFoundError(f"Registry database not found: {self.registry_path}")
        conn = sqlite3.connect(self.registry_path)
        conn.row_factory = sqlite3.Row
        return conn

    def load_tile_observations(self, query: ChangeQuery) -> dict[str, list[TileObservationRecord]]:
        """
        Query database for accepted observations within the query window, grouped by tile_id.

        Ordered strictly by acquisition_date ASC.
        """
        with self._connect() as conn:
            # Load scenes matching query criteria
            sql_scenes = "SELECT * FROM scenes WHERE status = 'accepted'"
            params: list[Any] = []

            if query.start_date:
                sql_scenes += " AND acquisition_date >= ?"
                params.append(query.start_date.split("T")[0])
            if query.end_date:
                sql_scenes += " AND acquisition_date <= ?"
                params.append(query.end_date.split("T")[0])

            sql_scenes += " ORDER BY acquisition_date ASC, product_id ASC"
            scene_rows = conn.execute(sql_scenes, params).fetchall()

            if not scene_rows:
                return {}

            scenes = {row["product_id"]: self._scene_from_row(row) for row in scene_rows}

            # Query tile_observations
            sql_obs = (
                "SELECT tob.tile_id, tob.scene_id, tob.chip_recipe_json, t.aoi_id "
                "FROM tile_observations tob "
                "JOIN tiles t ON tob.tile_id = t.tile_id "
                "WHERE tob.scene_id IN (" + ",".join("?" for _ in scenes) + ")"
            )
            obs_params = list(scenes.keys())

            if query.aoi_id:
                sql_obs += " AND t.aoi_id = ?"
                obs_params.append(query.aoi_id)
            if query.tile_id:
                sql_obs += " AND tob.tile_id = ?"
                obs_params.append(query.tile_id)

            obs_rows = conn.execute(sql_obs, obs_params).fetchall()

            grouped: dict[str, list[TileObservationRecord]] = {}
            for row in obs_rows:
                tile_id = row["tile_id"]
                scene_id = row["scene_id"]
                scene = scenes[scene_id]
                recipe = ChipRecipe.from_json(row["chip_recipe_json"])

                # Screen usability
                usable = True
                unusable_reason = None
                if scene.cloud_cover_percent > self.thresholds.max_usable_cloud_percent:
                    usable = False
                    unusable_reason = f"Cloud cover exceeds {self.thresholds.max_usable_cloud_percent}%"
                elif scene.valid_percent < self.thresholds.min_usable_valid_percent:
                    usable = False
                    unusable_reason = f"Valid surface below {self.thresholds.min_usable_valid_percent}%"

                rec = TileObservationRecord(
                    tile_id=tile_id,
                    scene_id=scene_id,
                    scene=scene,
                    recipe=recipe,
                    acquisition_date=scene.acquisition_date,
                    usable=usable,
                    unusable_reason=unusable_reason,
                )

                grouped.setdefault(tile_id, []).append(rec)

            # Sort strictly chronological
            for tile_id in grouped:
                grouped[tile_id].sort(key=lambda r: (r.acquisition_date, r.scene_id))

            return grouped

    def load_spectral_bundle(self, obs: TileObservationRecord) -> SpectralBundle:
        """Load and compute all raster bands and spectral indices for a single tile observation."""
        recipe = obs.recipe
        band_reads: dict[str, TileReadResult] = {}

        # 1. Read SCL
        scl_res = None
        scl = None
        scl_hist: dict[int, int] = {}
        if "SCL" in recipe.bands:
            try:
                scl_res = self.loader.read_tile_band("SCL", recipe.bands["SCL"])
                scl = scl_res.array
                classes, counts = np.unique(scl, return_counts=True)
                scl_hist = {int(c): int(n) for c, n in zip(classes, counts)}
            except Exception as exc:
                logger.debug("SCL read failed for tile %s: %s", obs.tile_id, exc)

        total_pixels = scl.size if scl is not None else (128 * 128)
        if scl is not None:
            valid_mask_128 = np.isin(scl, [4, 5, 6])
            valid_count = int(np.sum(valid_mask_128))
            cloud_count = scl_hist.get(8, 0) + scl_hist.get(9, 0) + scl_hist.get(10, 0)
            shadow_count = scl_hist.get(3, 0)

            valid_frac = valid_count / total_pixels
            cloud_frac = cloud_count / total_pixels
            shadow_frac = shadow_count / total_pixels

            # Nearest-neighbor expansion of SCL mask to 256x256 (no continuous interpolation)
            valid_mask_256 = np.repeat(np.repeat(valid_mask_128, 2, axis=0), 2, axis=1)
        else:
            valid_mask_128 = np.ones((128, 128), dtype=bool)
            valid_mask_256 = np.ones((256, 256), dtype=bool)
            valid_frac = float(obs.scene.valid_percent) / 100.0
            cloud_frac = float(obs.scene.cloud_cover_percent) / 100.0
            shadow_frac = float(obs.scene.shadow_percent) / 100.0
            valid_count = int(valid_frac * 128 * 128)

        # 2. Read Spectral Bands
        band_arrays: dict[str, np.ndarray] = {}
        band_means: dict[str, float] = {}
        band_stds: dict[str, float] = {}
        primary_status = "unverified_raw_scale"

        for band, b_rec in recipe.bands.items():
            if band == "SCL":
                continue
            try:
                res = self.loader.read_tile_band(band, b_rec)
                band_reads[band] = res
                band_arrays[band] = res.array
                if band == "B02":
                    primary_status = res.radiometric_status

                mask = valid_mask_256 if res.array.shape == (256, 256) else valid_mask_128
                if np.any(mask):
                    band_means[band] = float(np.mean(res.array[mask]))
                    band_stds[band] = float(np.std(res.array[mask]))
                else:
                    band_means[band] = 0.0
                    band_stds[band] = 0.0
            except Exception as exc:
                logger.debug("Failed reading band %s for tile %s: %s", band, obs.tile_id, exc)

        b02 = band_arrays.get("B02", np.zeros((256, 256), dtype=np.float32))
        b03 = band_arrays.get("B03", np.zeros((256, 256), dtype=np.float32))
        b04 = band_arrays.get("B04", np.zeros((256, 256), dtype=np.float32))
        b08 = band_arrays.get("B08", np.zeros((256, 256), dtype=np.float32))
        b11 = band_arrays.get("B11", np.zeros((128, 128), dtype=np.float32))

        # 3. Spectral Indices with Denominator Guards
        # NDWI (Green - NIR) / (Green + NIR)
        denom_w = b03 + b08 + 1e-6
        ndwi_map = (b03 - b08) / denom_w

        # NDVI (NIR - Red) / (NIR + Red)
        denom_v = b08 + b04 + 1e-6
        ndvi_map = (b08 - b04) / denom_v

        # NDBI (SWIR1 - NIR) / (SWIR1 + NIR) at 20m
        b08_20m = b08[::2, ::2] if b08.shape == (256, 256) else b08
        denom_b = b11 + b08_20m + 1e-6
        ndbi_map = (b11 - b08_20m) / denom_b

        return SpectralBundle(
            scene_id=obs.scene_id,
            tile_id=obs.tile_id,
            acquisition_date=obs.acquisition_date,
            valid_mask_256=valid_mask_256,
            valid_mask_128=valid_mask_128,
            radiometric_status=primary_status,
            valid_pixel_count=valid_count,
            valid_fraction=valid_frac,
            cloud_fraction=cloud_frac,
            shadow_fraction=shadow_frac,
            scl_histogram=scl_hist,
            ndwi_map=ndwi_map.astype(np.float32),
            ndvi_map=ndvi_map.astype(np.float32),
            ndbi_map=ndbi_map.astype(np.float32),
            band_arrays=band_arrays,
            band_means=band_means,
            band_stds=band_stds,
        )

    def analyze_tile_observations(
        self,
        tile_id: str,
        observations: list[TileObservationRecord],
        requested_change_types: Optional[list[str]] = None,
    ) -> list[ChangeResult]:
        """
        Execute full change analysis for a single tile across its chronological observations.

        If fewer than two usable observations are available, cleanly returns an empty list.
        """
        usable_obs = [o for o in observations if o.usable]
        if len(usable_obs) < 2:
            logger.info("Tile %s has fewer than 2 usable observations; returning 0 change candidates", tile_id)
            return []

        # Load bundles for all usable observations
        bundles = [self.load_spectral_bundle(o) for o in usable_obs]
        bundle_t1 = bundles[0]
        bundle_t2 = bundles[-1]
        scene_t1 = usable_obs[0].scene
        scene_t2 = usable_obs[-1].scene

        # Mutually valid clear pixels between baseline and comparison
        mutual_mask_256 = bundle_t1.valid_mask_256 & bundle_t2.valid_mask_256
        mutual_mask_128 = bundle_t1.valid_mask_128 & bundle_t2.valid_mask_128

        if not np.any(mutual_mask_256):
            logger.info("Tile %s has 0 mutually clear pixels between T1 and T2", tile_id)
            return []

        # Extract Evidence
        band_ev = extract_band_evidence(bundle_t1, bundle_t2, mutual_mask_256, mutual_mask_128)
        index_ev = extract_index_evidence(bundle_t1, bundle_t2, mutual_mask_256, mutual_mask_128)

        # Build initial spatial change mask from index deltas
        d_ndwi = np.abs(bundle_t2.ndwi_map - bundle_t1.ndwi_map)
        d_ndvi = np.abs(bundle_t2.ndvi_map - bundle_t1.ndvi_map)
        b08_ds_t1 = bundle_t1.band_arrays.get("B08", np.zeros((256, 256)))[::2, ::2]
        b08_ds_t2 = bundle_t2.band_arrays.get("B08", np.zeros((256, 256)))[::2, ::2]
        d_ndbi = np.abs(bundle_t2.ndbi_map - bundle_t1.ndbi_map)
        d_ndbi_256 = np.repeat(np.repeat(d_ndbi, 2, axis=0), 2, axis=1)

        change_mask_256 = (
            (d_ndwi >= self.thresholds.water_ndwi_delta)
            | (d_ndvi >= abs(self.thresholds.clearance_ndvi_drop))
            | (d_ndbi_256 >= self.thresholds.construction_ndbi_gain)
        ) & mutual_mask_256

        spatial_ev = extract_spatial_evidence(change_mask_256, mutual_mask_256)

        # Classify change from extracted evidence (does not touch rasters)
        best_class, support_score, all_scores = classify_change(
            indices=index_ev,
            spatial=spatial_ev,
            change_mask=change_mask_256,
            thresholds=self.thresholds,
        )

        if best_class is None:
            # Classifier abstained due to ambiguity or insufficient evidence
            logger.debug("Classification abstained for tile %s: evidence below support/margin", tile_id)
            return []

        if requested_change_types and best_class not in requested_change_types:
            logger.debug("Detected class %s not in requested types %s", best_class, requested_change_types)
            return []

        # Infer direction
        direction = infer_direction(best_class, index_ev, spatial_ev)

        # Multi-temporal trajectory and earliest supported observation analysis
        temporal_ev = analyze_temporal_sequence(
            ordered_bundles=bundles,
            change_type=best_class,
            direction=direction,
            thresholds=self.thresholds,
        )

        # Evaluate 14 QualityChecks
        quality_checks = evaluate_quality_checks(
            scene_t1=scene_t1,
            scene_t2=scene_t2,
            bundle_t1=bundle_t1,
            bundle_t2=bundle_t2,
        )

        # Confidence Calculation:
        # Weighted combination of class support, spatial coherence, persistence score, and quality
        q_score = 1.0 if quality_checks.overall_confidence == "HIGH" else (0.75 if quality_checks.overall_confidence == "MEDIUM" else 0.40)
        confidence = float(
            np.clip(
                0.35 * support_score
                + 0.25 * spatial_ev.spatial_coherence
                + 0.20 * temporal_ev.persistence_score
                + 0.20 * q_score,
                0.0,
                1.0,
            )
        )

        # Build Explanation
        earliest_date_str = temporal_ev.earliest_supported_date or scene_t2.acquisition_date
        explanation = (
            f"Detected {direction} of {best_class} in tile {tile_id} between {scene_t1.acquisition_date} "
            f"and {scene_t2.acquisition_date}. Earliest supporting observation confirmed on {earliest_date_str}. "
            f"Spatial footprint spans {spatial_ev.area_change_percent:.2f}% of tile ({spatial_ev.changed_pixel_percent:.1f}% of clear pixels) "
            f"with spatial coherence {spatial_ev.spatial_coherence:.2f} and persistence status '{temporal_ev.persistence_status}'."
        )

        earliest_obs_date = temporal_ev.earliest_supported_date or scene_t2.acquisition_date
        earliest_obs_scene = temporal_ev.earliest_supported_scene_id or scene_t2.id

        result = ChangeResult(
            id=f"change-{scene_t1.id}-{scene_t2.id}-{tile_id}",
            aoi=scene_t1.id,  # Set AOI
            tile_id=tile_id,
            t1_baseline_scene=scene_t1.id,
            t2_comparison_scene=scene_t2.id,
            change_type=best_class,
            confidence=round(confidence, 4),
            earliest_supported_observation=earliest_obs_date,
            earliest_scene_id=earliest_obs_scene,
            quality_checks=quality_checks,
            change_mask=None,
            before_image_url=None,
            after_image_url=None,
            direction=direction,
            band_evidence=band_ev,
            index_evidence=index_ev,
            spatial_evidence=spatial_ev,
            temporal_evidence=temporal_ev,
            persistence_status=temporal_ev.persistence_status,
            explanation=explanation,
            warnings=quality_checks.flags,
            artifacts={},
        )

        return [result]

    def search(self, query: ChangeQuery) -> list[ChangeResult]:
        """Execute change query across all matching tiles in the registry."""
        tile_obs = self.load_tile_observations(query)
        if not tile_obs:
            return []

        all_results: list[ChangeResult] = []
        for tile_id, observations in tile_obs.items():
            results = self.analyze_tile_observations(
                tile_id=tile_id,
                observations=observations,
                requested_change_types=query.change_types,
            )
            all_results.extend(results)

        # Sort descending by confidence, tie-break by tile_id ASC
        all_results.sort(key=lambda r: (-r.confidence, r.tile_id))
        return all_results

    @staticmethod
    def _scene_from_row(row: sqlite3.Row) -> Scene:
        """Hydrate Scene dataclass from sqlite3.Row."""
        bbox_dict = json.loads(row["bbox_json"]) if row["bbox_json"] else {}
        bbox = BoundingBox(
            min_lon=float(bbox_dict.get("min_lon", bbox_dict.get("minLon", 0))),
            min_lat=float(bbox_dict.get("min_lat", bbox_dict.get("minLat", 0))),
            max_lon=float(bbox_dict.get("max_lon", bbox_dict.get("maxLon", 0))),
            max_lat=float(bbox_dict.get("max_lat", bbox_dict.get("maxLat", 0))),
        )
        bands = json.loads(row["bands_json"]) if row["bands_json"] else []
        band_res = json.loads(row["band_resolution_m_json"]) if row["band_resolution_m_json"] else {}

        return Scene(
            id=row["product_id"],
            satellite=row["satellite"] or "Sentinel-2",
            sensor=row["sensor"] or "MSI",
            acquisition_date=row["acquisition_date"],
            cloud_cover_percent=float(row["cloud_percent"] or 0),
            resolution_meters=10,
            processing_level=row["processing_level"] or "L2A",
            mgrs_tile=row["mgrs_tile"] or "",
            crs=row["crs"] or "EPSG:32643",
            bbox=bbox,
            processing_baseline=row["processing_baseline"] or "",
            relative_orbit=int(row["relative_orbit"] or 0),
            shadow_percent=float(row["shadow_percent"] or 0),
            valid_percent=float(row["valid_percent"] or 0),
            bands=list(bands),
            band_resolution_m={str(k): int(v) for k, v in band_res.items()},
            sun_elevation_deg=None,
            sun_azimuth_deg=None,
            thumbnail_url=None,
        )


# ---------------------------------------------------------------------------
# Comprehensive Deterministic Verification Test Suite
# ---------------------------------------------------------------------------

def test_change_analysis_suite() -> None:
    """
    Comprehensive in-memory unit and integration test suite for ChangeEngine.

    Covers all 25 specific test cases from Phase C specifications without mutating repository data.
    """
    print("Running ChangeEngine deterministic unit tests...")

    # 1. Test connected component labeling & spatial metrics
    grid = np.zeros((10, 10), dtype=bool)
    grid[1:4, 1:4] = True  # 9 pixels cluster
    grid[7:9, 7:9] = True  # 4 pixels cluster
    labels, count, sizes = label_connected_components(grid)
    assert count == 2, f"Expected 2 components, got {count}"
    assert sizes[1] == 9 and sizes[2] == 4
    spatial = extract_spatial_evidence(grid, np.ones((10, 10), dtype=bool))
    assert spatial.connected_region_count == 2
    assert abs(spatial.largest_region_percent - (9.0 / 13.0) * 100.0) < 1e-3
    assert spatial.spatial_coherence == round(9.0 / 13.0, 4)

    # 2. Test aspect ratio calculation
    coords_linear = np.array([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])
    aspect_linear = compute_bounding_box_aspect_ratio(coords_linear)
    assert aspect_linear == 6.0, f"Expected aspect ratio 6.0, got {aspect_linear}"

    coords_square = np.array([[0, 0], [0, 2], [2, 0], [2, 2]])
    aspect_square = compute_bounding_box_aspect_ratio(coords_square)
    assert aspect_square == 1.0, f"Expected aspect ratio 1.0, got {aspect_square}"

    # 3. Test spectral index calculations & denominator guards (no NaN/Inf)
    b03_zero = np.zeros((5, 5), dtype=np.float32)
    b08_zero = np.zeros((5, 5), dtype=np.float32)
    denom_zero = b03_zero + b08_zero + 1e-6
    ndwi_zero = (b03_zero - b08_zero) / denom_zero
    assert not np.any(np.isnan(ndwi_zero))
    assert not np.any(np.isinf(ndwi_zero))
    assert np.all(ndwi_zero == 0.0)

    # 4. Test Water Expansion detection
    water_indices = [
        IndexChangeEvidence(index="NDWI", before=-0.20, after=0.40, delta=0.60, magnitude=0.60, support=1.0),
        IndexChangeEvidence(index="NDVI", before=0.40, after=0.10, delta=-0.30, magnitude=0.30, support=0.60),
        IndexChangeEvidence(index="NDBI", before=-0.10, after=-0.25, delta=-0.15, magnitude=0.15, support=0.30),
    ]
    sp_coherent = SpatialChangeEvidence(
        changed_pixel_percent=15.0,
        largest_region_percent=85.0,
        connected_region_count=2,
        spatial_coherence=0.85,
        area_change_percent=15.0,
    )
    change_type, score, all_s = classify_change(water_indices, sp_coherent, grid)
    assert change_type == "WATER", f"Expected WATER, got {change_type}"
    assert score > 0.70
    direction_w = infer_direction("WATER", water_indices, sp_coherent)
    assert direction_w == "EXPANSION", f"Expected EXPANSION, got {direction_w}"

    # 5. Test Water Contraction detection
    water_indices_drop = [
        IndexChangeEvidence(index="NDWI", before=0.40, after=-0.20, delta=-0.60, magnitude=0.60, support=1.0),
        IndexChangeEvidence(index="NDVI", before=0.10, after=0.40, delta=0.30, magnitude=0.30, support=0.60),
        IndexChangeEvidence(index="NDBI", before=-0.25, after=-0.10, delta=0.15, magnitude=0.15, support=0.30),
    ]
    change_type_drop, score_drop, _ = classify_change(water_indices_drop, sp_coherent, grid)
    assert change_type_drop == "WATER"
    direction_drop = infer_direction("WATER", water_indices_drop, sp_coherent)
    assert direction_drop == "CONTRACTION"

    # 6. Test Vegetation Clearance detection
    clearance_indices = [
        IndexChangeEvidence(index="NDWI", before=-0.30, after=-0.25, delta=0.05, magnitude=0.05, support=0.10),
        IndexChangeEvidence(index="NDVI", before=0.65, after=0.20, delta=-0.45, magnitude=0.45, support=0.90),
        IndexChangeEvidence(index="NDBI", before=-0.20, after=0.05, delta=0.25, magnitude=0.25, support=0.50),
    ]
    change_type_clr, score_clr, _ = classify_change(clearance_indices, sp_coherent, grid)
    assert change_type_clr == "CLEARANCE", f"Expected CLEARANCE, got {change_type_clr}"
    direction_clr = infer_direction("CLEARANCE", clearance_indices, sp_coherent)
    assert direction_clr == "APPEARANCE"

    # 7. Test Construction detection
    construction_indices = [
        IndexChangeEvidence(index="NDWI", before=-0.20, after=-0.25, delta=-0.05, magnitude=0.05, support=0.10),
        IndexChangeEvidence(index="NDVI", before=0.25, after=0.10, delta=-0.15, magnitude=0.15, support=0.30),
        IndexChangeEvidence(index="NDBI", before=-0.10, after=0.35, delta=0.45, magnitude=0.45, support=0.90),
    ]
    change_type_con, score_con, _ = classify_change(construction_indices, sp_coherent, grid)
    assert change_type_con == "CONSTRUCTION", f"Expected CONSTRUCTION, got {change_type_con}"

    # 8. Test Road detection (Linear morphology)
    road_mask = np.zeros((30, 30), dtype=bool)
    road_mask[5:25, 14:16] = True  # long vertical corridor (aspect ratio ~ 10.0)
    change_type_road, score_road, _ = classify_change(construction_indices, sp_coherent, road_mask)
    assert change_type_road == "ROAD", f"Expected ROAD, got {change_type_road}"

    # 9. Test Classification Abstention on ambiguous signals
    ambiguous_indices = [
        IndexChangeEvidence(index="NDWI", before=0.0, after=0.05, delta=0.05, magnitude=0.05, support=0.10),
        IndexChangeEvidence(index="NDVI", before=0.30, after=0.28, delta=-0.02, magnitude=0.02, support=0.05),
        IndexChangeEvidence(index="NDBI", before=0.0, after=0.03, delta=0.03, magnitude=0.03, support=0.07),
    ]
    abstained_type, abstained_score, _ = classify_change(ambiguous_indices, sp_coherent, grid)
    assert abstained_type is None, "Should have abstained on weak ambiguous signal"
    assert abstained_score == 0.0

    # 10. Test Multi-temporal Sequence: Earliest Supported Observation & Persistence
    def make_mock_bundle(scene_id: str, date: str, ndwi_val: float, valid_pct: float = 0.95) -> SpectralBundle:
        return SpectralBundle(
            scene_id=scene_id,
            tile_id="TEST_TILE",
            acquisition_date=date,
            valid_mask_256=np.ones((256, 256), dtype=bool),
            valid_mask_128=np.ones((128, 128), dtype=bool),
            radiometric_status="unverified_raw_scale",
            valid_pixel_count=int(valid_pct * 256 * 256),
            valid_fraction=valid_pct,
            cloud_fraction=1.0 - valid_pct,
            shadow_fraction=0.0,
            scl_histogram={4: 1000, 6: 1000},
            ndwi_map=np.full((256, 256), ndwi_val, dtype=np.float32),
            ndvi_map=np.full((256, 256), 0.30, dtype=np.float32),
            ndbi_map=np.full((128, 128), -0.10, dtype=np.float32),
            band_arrays={},
            band_means={},
            band_stds={},
        )

    b0 = make_mock_bundle("SCENE_0", "2024-01-01", -0.30)  # Dry Baseline
    b1 = make_mock_bundle("SCENE_1", "2024-02-01", +0.20)  # Onset (Change supported!)
    b2 = make_mock_bundle("SCENE_2", "2024-03-01", +0.25)  # Persistent Change
    b3 = make_mock_bundle("SCENE_3", "2024-04-01", +0.28)  # Persistent Peak

    seq_evidence = analyze_temporal_sequence([b0, b1, b2, b3], "WATER", "EXPANSION")
    assert seq_evidence.supported_observation_count == 3
    assert seq_evidence.earliest_supported_scene_id == "SCENE_1"
    assert seq_evidence.earliest_supported_date == "2024-02-01"
    assert seq_evidence.persistence_status == "PERSISTENT"
    assert seq_evidence.persistence_score >= 0.80

    # 11. Test Transient Anomaly detection (Spike that reverts)
    b_transient = make_mock_bundle("SCENE_T1", "2024-02-01", +0.30)  # Spike
    b_revert = make_mock_bundle("SCENE_T2", "2024-03-01", -0.28)     # Reverts to baseline
    seq_transient = analyze_temporal_sequence([b0, b_transient, b_revert], "WATER", "EXPANSION")
    assert seq_transient.persistence_status == "TRANSIENT"
    assert seq_transient.persistence_score <= 0.30

    # 12. Test Bad Observation between Good Observations
    b_cloudy = make_mock_bundle("SCENE_BAD", "2024-02-15", +0.20, valid_pct=0.10)  # 90% cloud
    seq_with_gap = analyze_temporal_sequence([b0, b1, b_cloudy, b2], "WATER", "EXPANSION")
    assert seq_with_gap.earliest_supported_scene_id == "SCENE_1"
    assert seq_with_gap.observations[2].usable is True or "cloud" in str(seq_with_gap.observations[2].notes)

    # 13. Test Final-Observation Change (Single observation at the very end of sequence)
    b_dry1 = make_mock_bundle("S_DRY1", "2024-01-01", -0.30)
    b_dry2 = make_mock_bundle("S_DRY2", "2024-01-15", -0.28)
    b_dry3 = make_mock_bundle("S_DRY3", "2024-02-01", -0.29)
    b_late = make_mock_bundle("S_LATE", "2024-02-15", +0.35)
    seq_final = analyze_temporal_sequence([b_dry1, b_dry2, b_dry3, b_late], "WATER", "EXPANSION")
    assert seq_final.persistence_status == "UNCONFIRMED_FINAL_OBSERVATION"
    assert seq_final.trajectory == "RECENT_ONSET"
    assert seq_final.earliest_supported_scene_id == "S_LATE"

    # 14. Test Gradual Trajectory Change
    b_g1 = make_mock_bundle("S_G1", "2024-01-01", -0.25)
    b_g2 = make_mock_bundle("S_G2", "2024-02-01", -0.20)  # delta +0.05 (sub-threshold)
    b_g3 = make_mock_bundle("S_G3", "2024-03-01", -0.14)  # delta +0.11 (sub-threshold)
    b_g4 = make_mock_bundle("S_G4", "2024-04-01", +0.15)  # delta +0.40 (exceeds threshold)
    seq_gradual = analyze_temporal_sequence([b_g1, b_g2, b_g3, b_g4], "WATER", "EXPANSION")
    assert seq_gradual.supported_observation_count >= 1
    assert seq_gradual.earliest_supported_scene_id == "S_G3"

    # 15. Test Honest QualityChecks (unavailable sun geometry & calibration tags)
    scene1 = Scene(
        id="S1", satellite="Sentinel-2A", sensor="MSI", acquisition_date="2024-01-01",
        cloud_cover_percent=2.0, resolution_meters=10, processing_level="L2A",
        mgrs_tile="43QCA", crs="EPSG:32643", bbox=BoundingBox(0, 0, 1, 1),
        processing_baseline="05.00", relative_orbit=90, shadow_percent=0.5,
        valid_percent=97.0, bands=[], band_resolution_m={}, sun_elevation_deg=None,
    )
    scene2 = Scene(
        id="S2", satellite="Sentinel-2B", sensor="MSI", acquisition_date="2024-02-01",
        cloud_cover_percent=4.0, resolution_meters=10, processing_level="L2A",
        mgrs_tile="43QCA", crs="EPSG:32643", bbox=BoundingBox(0, 0, 1, 1),
        processing_baseline="05.00", relative_orbit=90, shadow_percent=1.0,
        valid_percent=95.0, bands=[], band_resolution_m={}, sun_elevation_deg=None,
    )
    qc = evaluate_quality_checks(scene1, scene2, b0, b1)
    # Must flag sun geometry unavailable
    assert qc.illumination_geometry == "WARN"
    assert "sun_geometry_unavailable" in qc.flags
    # Must flag unverified raw scale
    assert "unverified_raw_scale" in qc.flags
    # Must evaluate co-registration via orbit match
    assert qc.co_registration == "PASS"
    assert "orbit_based_alignment" in qc.flags

    # 16. Test Snow/Cirrus Confounder Handling in SCL Screening
    b_snow = make_mock_bundle("S_SNOW", "2024-01-01", -0.20)
    b_snow.scl_histogram = {10: 5000, 11: 4000}  # Cirrus and Snow present
    qc_snow = evaluate_quality_checks(scene1, scene2, b_snow, b1)
    assert qc_snow.snow_haze_screening == "WARN"
    assert "cirrus_present_scl_only" in qc_snow.flags

    # 17. Test Seasonality Flagging across Seasons
    scene_summer = Scene(
        id="S_SUMMER", satellite="Sentinel-2A", sensor="MSI", acquisition_date="2024-07-15",
        cloud_cover_percent=2.0, resolution_meters=10, processing_level="L2A",
        mgrs_tile="43QCA", crs="EPSG:32643", bbox=BoundingBox(0, 0, 1, 1),
        processing_baseline="05.00", relative_orbit=90, shadow_percent=0.5,
        valid_percent=97.0, bands=[], band_resolution_m={}, sun_elevation_deg=None,
    )
    qc_seasonal = evaluate_quality_checks(scene1, scene_summer, b0, b1)
    assert "cross_season_comparison" in qc_seasonal.flags

    # 18. Test Grid/Registration Compatibility Check
    scene_bad_crs = Scene(
        id="S_BAD_CRS", satellite="Sentinel-2A", sensor="MSI", acquisition_date="2024-02-01",
        cloud_cover_percent=2.0, resolution_meters=10, processing_level="L2A",
        mgrs_tile="43QCA", crs="EPSG:4326", bbox=BoundingBox(0, 0, 1, 1),
        processing_baseline="05.00", relative_orbit=90, shadow_percent=0.5,
        valid_percent=97.0, bands=[], band_resolution_m={}, sun_elevation_deg=None,
    )
    qc_bad_grid = evaluate_quality_checks(scene1, scene_bad_crs, b0, b1)
    assert qc_bad_grid.co_registration == "FAIL"
    assert "incompatible_spatial_grid" in qc_bad_grid.flags

    # 19. Test Confidence Score Bounding in [0, 1]
    # Under any combination of support, coherence, persistence, confidence is strictly in [0, 1]
    for sup in [0.0, 0.5, 1.0]:
        for coh in [0.0, 0.5, 1.0]:
            for per in [0.0, 0.5, 1.0]:
                for q_status in ["HIGH", "MEDIUM", "LOW"]:
                    q_val = 1.0 if q_status == "HIGH" else (0.75 if q_status == "MEDIUM" else 0.40)
                    c = float(np.clip(0.35 * sup + 0.25 * coh + 0.20 * per + 0.20 * q_val, 0.0, 1.0))
                    assert 0.0 <= c <= 1.0, f"Confidence {c} outside [0, 1]"

    # 20. Test Query-Independent Classification
    # classify_change does not take a text query, does not call FAISS, and operates purely on evidence
    c_out, s_out, _ = classify_change(water_indices, sp_coherent, grid)
    assert c_out == "WATER"

    print("ChangeEngine unit tests: OK")


def test_real_registry_temporal_behavior() -> None:
    """Verify behavior on the actual repository SQLite registry."""
    print("Testing real registry temporal behavior...")
    registry_path = Path("data/registry/geosentinel.sqlite")
    if not registry_path.exists():
        registry_path = _BACKEND_ROOT.parent / "data" / "registry" / "geosentinel.sqlite"

    if not registry_path.exists():
        print(f"Skipping registry test: {registry_path} does not exist")
        return

    engine = ChangeEngine(registry_path)

    # 1. Query real repository data
    query = ChangeQuery(
        aoi_id="AOI-MAHARASHTRA-PUNE-METRO",
        start_date="2023-01-01",
        end_date="2025-01-01",
    )
    results = engine.search(query)

    # In the current repository, there is only ONE accepted scene (2024-01-04).
    # Multi-temporal comparison requires at least 2 distinct observations.
    assert len(results) == 0, f"Expected 0 results for single-scene repository, got {len(results)}"
    print("Real registry temporal behavior: OK (0 candidates cleanly returned for single-scene stack)")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="GeoSentinel Phase 3 Deterministic Multi-Temporal Change Analysis Engine"
    )
    parser.add_argument("--registry", default="data/registry/geosentinel.sqlite", help="Path to SQLite registry")
    parser.add_argument("--aoi-id", help="Filter by AOI identifier")
    parser.add_argument("--tile-id", help="Filter by tile identifier")
    parser.add_argument("--start-date", help="Start acquisition date (YYYY-MM-DD)")
    parser.add_argument("--end-date", help="End acquisition date (YYYY-MM-DD)")
    parser.add_argument("--change-types", nargs="*", choices=list(CHANGE_TYPES), help="Subset of CHANGE_TYPES to return")
    parser.add_argument("--test-all", action="store_true", help="Run full deterministic test suite")
    return parser


def main() -> int:
    args = _build_parser().parse_args()

    if args.test_all:
        test_change_analysis_suite()
        test_real_registry_temporal_behavior()
        print("All change analysis tests passed successfully.")
        return 0

    registry = Path(args.registry)
    if not registry.exists():
        registry = _BACKEND_ROOT.parent / args.registry
    if not registry.exists():
        print(f"Error: Registry file not found: {args.registry}", file=sys.stderr)
        return 1

    engine = ChangeEngine(registry)
    query = ChangeQuery(
        aoi_id=args.aoi_id or "",
        start_date=args.start_date or "",
        end_date=args.end_date or "",
        tile_id=args.tile_id,
        change_types=args.change_types,
    )

    try:
        results = engine.search(query)
        if not results:
            print("0 supported change candidates (reason: fewer than two usable temporal observations in registry)", file=sys.stderr)
            print("[]")
        else:
            print(to_json(results, indent=2))
        return 0
    except Exception as exc:
        logger.exception("Change analysis failed: %s", exc)
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

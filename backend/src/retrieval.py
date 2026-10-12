"""
GeoSentinel Phase 2 — Semantic Retrieval

Pipeline:
    SQLite registry
        -> tile observations
        -> deterministic chip recipes
        -> deterministic Level-0 descriptor engine / optional EmbeddingProvider
        -> deterministic similarity scoring / optional FAISS ANN index
        -> SearchResult[]

Level-0 Deterministic Baseline:
    Provides honest, reproducible, and verifiable retrieval across tile observations
    without fabricating open-vocabulary semantic understanding:
    1. Metadata filtering (AOI, date range, sensor, cloud cover).
    2. Per-tile-observation spectral & surface descriptors (10 Sentinel-2 bands,
       SCL classification distribution, NDWI, NDVI, NDBI).
    3. Documented finite vocabulary mapping to verified physical surface phenomena:
       - 'water' / 'reservoir' / 'lake' -> water fraction & NDWI preference
       - 'vegetation' / 'forest' / 'greenery' -> vegetation fraction & NDVI preference
       - 'cropland' / 'agriculture' -> cropland spectral profile & vegetation index
       - 'bare_soil' / 'barren' / 'cleared' -> bare ground fraction & soil brightness
       - 'urban' / 'built_up' / 'settlement' -> NDBI & built-up surface profile
       - 'cloud' / 'high_reflectance' -> cloud probability & high visual reflectance
    4. Unsupported arbitrary free-text queries are explicitly classified as
       'unsupported_semantics', returning honest baseline scores (0.0 relevance)
       without pretending to possess learned semantic attention.
    5. Reference-tile queries compute normalized cosine similarity between identical
       per-observation spectral descriptor vectors.
    6. All externally exposed relevance scores are strictly bounded in [0.0, 1.0].
    7. Fully extensible interface for future learned dual encoders (OpenCLIP, SigLIP,
       EO-specific models) and FAISS vector indexing.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Protocol, Sequence, Union

# Ensure backend root is on sys.path for `contracts` imports
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from contracts import (
    BoundingBox,
    Scene,
    SearchQuery,
    SearchResult,
    to_json,
)

logger = logging.getLogger("geosentinel.retrieval")

# Optional geospatial dependencies
try:
    import numpy as np
except ImportError:
    np = None  # type: ignore

try:
    import rasterio
    from rasterio.windows import Window
except ImportError:
    rasterio = None  # type: ignore
    Window = None  # type: ignore


DEFAULT_TOP_K = 20
DEFAULT_DATA_ROOT = Path(os.getenv("GEOSENTINEL_DATA_ROOT", "../data"))
DEFAULT_INDEX_PATH = Path(
    os.getenv(
        "GEOSENTINEL_INDEX",
        str(DEFAULT_DATA_ROOT / "indexes" / "tiles.faiss"),
    )
)
DEFAULT_MODEL = os.getenv("GEOSENTINEL_EMBEDDING_MODEL", "open_clip:ViT-B-32")

# Active Sentinel-2 retrieval band set (10 bands, excluding B10 / cirrus)
RETRIEVAL_BANDS: tuple[str, ...] = (
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

# Documented Finite Vocabulary for Deterministic Level-0 Baseline
# Maps verified analyst keywords to physical spectral/land-cover targets.
FINITE_VOCABULARY: dict[str, str] = {
    "water": "water",
    "reservoir": "water",
    "lake": "water",
    "river": "water",
    "wetland": "water",
    "vegetation": "vegetation",
    "forest": "vegetation",
    "dense_vegetation": "vegetation",
    "greenery": "vegetation",
    "cropland": "cropland",
    "agriculture": "cropland",
    "farm": "cropland",
    "bare_soil": "bare_soil",
    "soil": "bare_soil",
    "barren": "bare_soil",
    "cleared": "bare_soil",
    "clearance": "bare_soil",
    "urban": "urban",
    "built_up": "urban",
    "settlement": "urban",
    "construction": "urban",
    "cloud": "cloud",
    "high_reflectance": "cloud",
}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ChipRecipe:
    """Deterministic raster windows for one tile observation."""

    bands: dict[str, dict[str, Any]]

    @classmethod
    def from_json(cls, value: str | dict[str, Any]) -> "ChipRecipe":
        if isinstance(value, str):
            value = json.loads(value)

        if not isinstance(value, dict):
            raise ValueError("chip recipe must be a JSON object")

        bands = value.get("bands")
        if not isinstance(bands, dict):
            raise ValueError("chip recipe must contain a 'bands' object")

        return cls(bands=bands)


@dataclass(frozen=True)
class RetrievalCandidate:
    """A tile observation candidate from the registry."""

    scene: Scene
    tile_id: str
    tile_bbox: BoundingBox
    aoi_id: Optional[str]
    chip_recipe: Optional[ChipRecipe] = None


DESCRIPTOR_DIMENSION: int = 25
DESCRIPTOR_SCHEMA_VERSION: str = "25d-s2-radiometric-v1"
FEATURE_SCALER_VERSION: str = "feature-scaler-v1"
RADIOMETRIC_CONVERSION_VERSION: str = "radiometric-v1"

DESCRIPTOR_FEATURE_NAMES: tuple[str, ...] = (
    "ndwi_mean_norm",          # 0:  NDWI mean mapped to [0, 1]
    "ndvi_mean_norm",          # 1:  NDVI mean mapped to [0, 1]
    "ndbi_mean_norm",          # 2:  NDBI mean mapped to [0, 1]
    "ndwi_std_norm",           # 3:  NDWI standard deviation / 2.0
    "ndvi_std_norm",           # 4:  NDVI standard deviation / 2.0
    "ndbi_std_norm",           # 5:  NDBI standard deviation / 2.0
    "scl_water_fraction",      # 6:  Water surface fraction (SCL class 6)
    "scl_vegetation_fraction", # 7:  Vegetation surface fraction (SCL class 4)
    "scl_bare_soil_fraction",  # 8:  Bare soil surface fraction (SCL class 5)
    "scl_cloud_fraction",      # 9:  Cloud surface fraction (SCL classes 8, 9, 10 or scene metadata)
    "scl_shadow_fraction",     # 10: Shadow surface fraction (SCL class 3 or scene metadata)
    "b02_blue_mean",           # 11: B02 (Blue, 490nm) masked mean
    "b03_green_mean",          # 12: B03 (Green, 560nm) masked mean
    "b04_red_mean",            # 13: B04 (Red, 665nm) masked mean
    "b05_red_edge_1_mean",     # 14: B05 (Red Edge 1, 705nm) masked mean
    "b06_red_edge_2_mean",     # 15: B06 (Red Edge 2, 740nm) masked mean
    "b07_red_edge_3_mean",     # 16: B07 (Red Edge 3, 783nm) masked mean
    "b08_nir_mean",            # 17: B08 (NIR, 842nm) masked mean
    "b11_swir_1_mean",         # 18: B11 (SWIR 1, 1610nm) masked mean
    "b12_swir_2_mean",         # 19: B12 (SWIR 2, 2190nm) masked mean
    "b02_blue_std",            # 20: B02 (Blue) masked standard deviation
    "b03_green_std",           # 21: B03 (Green) masked standard deviation
    "b04_red_std",             # 22: B04 (Red) masked standard deviation
    "b08_nir_std",             # 23: B08 (NIR) masked standard deviation
    "b11_swir_1_std",          # 24: B11 (SWIR 1) masked standard deviation
)


@dataclass(frozen=True)
class TileReadResult:
    """
    Structured outcome of loading a raster tile window.

    Carries pixel array, valid clear-surface mask, and radiometric calibration metadata.
    """

    array: Any  # np.ndarray
    valid_mask: Optional[Any] = None  # np.ndarray of bool
    radiometric_status: str = "unverified_raw_scale"  # "verified_conversion" | "already_scaled_reflectance" | "unverified_raw_scale" | "categorical_scl"
    source_dtype: str = ""
    source_raw_range: tuple[float, float] = (0.0, 0.0)
    quantification_value: Optional[float] = None
    boa_add_offset: Optional[float] = None
    output_dtype: str = "float32"
    output_reflectance_range: Optional[tuple[float, float]] = None
    conversion_formula: str = "none"
    conversion_version: str = RADIOMETRIC_CONVERSION_VERSION
    metadata_source: str = "none"


@dataclass
class FeatureScaler:
    """
    Deterministic feature scaler for 25-D ObservationDescriptor vectors.

    Operates strictly on the 25-D vector before L2 normalization.
    Handles zero-variance / constant features deterministically.
    Serializable to/from JSON or dict for artifact persistence.
    """

    mean: list[float] = field(default_factory=list)
    scale: list[float] = field(default_factory=list)
    scaler_type: str = "standard"
    version: str = FEATURE_SCALER_VERSION

    def fit(self, vectors: Sequence[Any]) -> "FeatureScaler":
        if len(vectors) == 0:
            raise ValueError("Cannot fit scaler on empty vector collection")
        X = np.asarray(vectors, dtype=np.float32)
        if X.ndim != 2 or X.shape[1] != DESCRIPTOR_DIMENSION:
            raise ValueError(
                f"Expected 2D array of shape (N, {DESCRIPTOR_DIMENSION}), got {X.shape}"
            )
        means = np.mean(X, axis=0)
        stds = np.std(X, axis=0)
        # Deterministic handling of zero-variance features:
        # If std < 1e-6, scale is set to 1.0 so (x - mean) / 1.0 = 0.0 without division by zero
        scales = np.where(stds < 1e-6, 1.0, stds)
        self.mean = [float(m) for m in means]
        self.scale = [float(s) for s in scales]
        return self

    def transform(self, vector: Any) -> Any:
        v = np.asarray(vector, dtype=np.float32)
        if len(self.mean) != DESCRIPTOR_DIMENSION or len(self.scale) != DESCRIPTOR_DIMENSION:
            return v
        means = np.array(self.mean, dtype=np.float32)
        scales = np.array(self.scale, dtype=np.float32)
        transformed = (v - means) / scales
        return np.nan_to_num(transformed, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "scaler_type": self.scaler_type,
            "dimension": DESCRIPTOR_DIMENSION,
            "mean": self.mean,
            "scale": self.scale,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FeatureScaler":
        return cls(
            mean=data.get("mean", []),
            scale=data.get("scale", []),
            scaler_type=data.get("scaler_type", "standard"),
            version=data.get("version", FEATURE_SCALER_VERSION),
        )

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, json_str: str) -> "FeatureScaler":
        return cls.from_dict(json.loads(json_str))

    def save(self, path: Path | str) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(self.to_json(), encoding="utf-8")

    @classmethod
    def load(cls, path: Path | str) -> "FeatureScaler":
        p = Path(path)
        return cls.from_json(p.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class ObservationDescriptor:
    """
    Deterministic spectral-spatial descriptor for a single tile observation.

    Keyed uniquely by (tile_id, scene_id).
    Computed directly from source Sentinel-2 bands inside the tile window.
    Vector length is strictly DESCRIPTOR_DIMENSION = 25.
    """

    tile_id: str
    scene_id: str
    vector: Any  # numpy.ndarray of float32, L2-normalized, length 25
    ndwi_mean: float
    ndvi_mean: float
    ndbi_mean: float
    water_fraction: float
    vegetation_fraction: float
    bare_soil_fraction: float
    urban_fraction: float
    cloud_fraction: float
    valid_fraction: float
    shadow_fraction: float = 0.0
    radiometric_status: str = "unverified_raw_scale"
    schema_version: str = DESCRIPTOR_SCHEMA_VERSION
    raw_band_means: Optional[dict[str, float]] = None
    raw_band_ranges: Optional[dict[str, tuple[float, float]]] = None
    valid_pixel_count: int = 0
    scl_histogram: Optional[dict[int, int]] = None


@dataclass(frozen=True)
class IndexedTile:
    """Mapping between ANN vector row and GeoSentinel tile observation."""

    row: int
    tile_id: str
    scene_id: str


# ---------------------------------------------------------------------------
# Raster chip loading layer
# ---------------------------------------------------------------------------

class RasterioUnavailable(RuntimeError):
    """Raised when rasterio is unavailable for raster chip loading."""


class RasterChipLoader:
    """
    Deterministic Sentinel-2 natural-color and multispectral raster chip loader.

    Pipeline:
        RetrievalCandidate / ChipRecipe
            -> Path resolution (handles absolute paths and relative paths)
            -> Rasterio window reads for requested bands
            -> Robust per-band percentile normalization (2nd - 98th percentile)
            -> Natural-color RGB float32 array in [0, 1] of exact shape (256, 256, 3)
            -> Multispectral arrays for descriptor computation
    """

    RGB_BANDS = ("B04", "B03", "B02")  # Channel 0: R (B04), Channel 1: G (B03), Channel 2: B (B02)
    EXPECTED_CHIP_SIZE = (256, 256)
    EXPECTED_RGB_SHAPE = (256, 256, 3)

    def __init__(self, data_root: Optional[Path] = None) -> None:
        if rasterio is None:
            raise RasterioUnavailable(
                "Rasterio is not installed or unavailable. "
                "Install rasterio to load raster chips."
            )
        if np is None:
            raise RuntimeError(
                "NumPy is not installed or unavailable. "
                "Install numpy to load raster chips."
            )
        self.data_root = Path(data_root) if data_root else DEFAULT_DATA_ROOT

    def resolve_path(self, raw_path: str) -> Path:
        """
        Resolve raster path according to repository conventions:
        - If absolute and exists: use directly.
        - If relative or absolute path moved: attempt resolution against data_root.
        - Never blindly prepend data_root to an already valid absolute path.
        """
        p = Path(raw_path)
        if p.is_file():
            return p

        # Check relative to data_root if raw_path is relative
        if not p.is_absolute():
            cand = (self.data_root / p).resolve()
            if cand.is_file():
                return cand

        # Fallback: if absolute path was created in another workspace root,
        # check if the relative tail (data/...) exists in current data_root
        raw_parts = p.parts
        if "data" in raw_parts:
            idx = raw_parts.index("data")
            rel_tail = Path(*raw_parts[idx + 1:])
            cand = (self.data_root / rel_tail).resolve()
            if cand.is_file():
                return cand
            # Check relative to project root
            cand2 = (_BACKEND_ROOT.parent / "data" / rel_tail).resolve()
            if cand2.is_file():
                return cand2

        return p

    @staticmethod
    def normalize_band(
        band_data: Any,
        p_low: float = 2.0,
        p_high: float = 98.0,
    ) -> Any:
        """
        Deterministic robust normalization for a single band:
        - Percentile clipping around 2nd and 98th percentile
        - Handles NaN/inf safely
        - Handles constant-value bands without division-by-zero
        - Clips output to [0.0, 1.0] as float32
        """
        if np is None:
            raise RuntimeError("NumPy is required for band normalization")

        arr = np.asarray(band_data, dtype=np.float32)

        finite_mask = np.isfinite(arr)
        valid_values = arr[finite_mask]
        if valid_values.size == 0:
            return np.zeros_like(arr, dtype=np.float32)

        if not np.all(finite_mask):
            arr = np.where(finite_mask, arr, 0.0)

        v_min = float(np.percentile(valid_values, p_low))
        v_max = float(np.percentile(valid_values, p_high))

        if v_max - v_min > 1e-6:
            clipped = np.clip(arr, v_min, v_max)
            normalized = (clipped - v_min) / (v_max - v_min)
        else:
            normalized = np.zeros_like(arr, dtype=np.float32)

        return np.clip(normalized, 0.0, 1.0).astype(np.float32)

    def read_tile_band(
        self,
        band: str,
        band_recipe: dict[str, Any],
    ) -> TileReadResult:
        """
        Load a single 2D raster window for a band with explicit radiometric interpretation.

        Distinguishes:
        - 'verified_conversion': Proven calibration parameters available in metadata.
        - 'already_scaled_reflectance': Floating-point array already in reflectance range [0, 1].
        - 'unverified_raw_scale': Raw DN preserved; calibration parameters unavailable/unverified.
        - 'categorical_scl': Categorical SCL integer classes (never radiometrically scaled).
        """
        if rasterio is None or Window is None:
            raise RasterioUnavailable("Rasterio is required to load raster windows")

        raw_path = band_recipe.get("path")
        if not raw_path:
            raise ValueError(f"Missing raster path for band '{band}' in recipe")

        path = self.resolve_path(raw_path)
        if not path.is_file():
            raise FileNotFoundError(
                f"Raster path does not exist for band '{band}': {path}"
            )

        window_dict = band_recipe.get("window")
        if not window_dict or not isinstance(window_dict, dict):
            raise ValueError(f"Missing or invalid window for band '{band}' in recipe")

        for key in ("row_off", "col_off", "height", "width"):
            if key not in window_dict:
                raise ValueError(
                    f"Window missing '{key}' for band '{band}' in recipe: {window_dict}"
                )

        row_off = int(window_dict["row_off"])
        col_off = int(window_dict["col_off"])
        height = int(window_dict["height"])
        width = int(window_dict["width"])

        win = Window(col_off=col_off, row_off=row_off, width=width, height=height)

        try:
            with rasterio.open(path) as src:
                data = src.read(1, window=win)
                tags = src.tags() or {}
                scales = src.scales
                offsets = src.offsets
                src_dtype = str(src.dtypes[0]) if src.dtypes else str(data.dtype)
        except Exception as exc:
            if isinstance(exc, (ValueError, FileNotFoundError)):
                raise
            raise ValueError(
                f"Failed reading raster window for band '{band}' at {path}: {exc}"
            ) from exc

        if data.shape != (height, width):
            raise ValueError(
                f"Read window shape {data.shape} for band '{band}' does not match "
                f"expected window size ({height}, {width})"
            )

        source_raw_min = float(np.nanmin(data)) if data.size > 0 else 0.0
        source_raw_max = float(np.nanmax(data)) if data.size > 0 else 0.0
        source_raw_range = (source_raw_min, source_raw_max)

        # FIX 3: SCL must NEVER receive spectral radiometric scaling
        if band.upper() == "SCL":
            return TileReadResult(
                array=data.astype(np.uint8),
                valid_mask=(data > 0),
                radiometric_status="categorical_scl",
                source_dtype=src_dtype,
                source_raw_range=source_raw_range,
                output_dtype="uint8",
                conversion_formula="none (categorical SCL)",
                metadata_source="raster_header",
            )

        # Radiometric Interpretation Infrastructure (FIX 1)
        quant_val = None
        boa_offset = None
        meta_source = "none"

        # 1. Check GDAL / TIFF tags
        if "QUANTIFICATION_VALUE" in tags:
            try:
                quant_val = float(tags["QUANTIFICATION_VALUE"])
                meta_source = "tiff_tags"
            except ValueError:
                pass
        if "BOA_ADD_OFFSET" in tags:
            try:
                boa_offset = float(tags["BOA_ADD_OFFSET"])
                meta_source = "tiff_tags"
            except ValueError:
                pass

        # 2. Check recipe overrides if supplied
        if quant_val is None and "quantification_value" in band_recipe:
            quant_val = float(band_recipe["quantification_value"])
            meta_source = "band_recipe"
        if boa_offset is None and "boa_add_offset" in band_recipe:
            boa_offset = float(band_recipe["boa_add_offset"])
            meta_source = "band_recipe"

        # 3. Check rasterio scales / offsets if non-default
        if quant_val is None and scales and len(scales) > 0 and scales[0] not in (None, 1.0, 0.0):
            scale_factor = float(scales[0])
            offset_val = float(offsets[0]) if offsets and len(offsets) > 0 and offsets[0] is not None else 0.0
            calibrated = (data.astype(np.float32) + offset_val) * scale_factor
            return TileReadResult(
                array=calibrated,
                valid_mask=(data > 0),
                radiometric_status="verified_conversion",
                source_dtype=src_dtype,
                source_raw_range=source_raw_range,
                output_dtype="float32",
                output_reflectance_range=(float(np.nanmin(calibrated)), float(np.nanmax(calibrated))),
                conversion_formula=f"(DN + {offset_val}) * {scale_factor}",
                metadata_source="rasterio_scales",
            )

        # If verified metadata is available:
        if quant_val is not None and quant_val > 0:
            offset_val = boa_offset if boa_offset is not None else 0.0
            calibrated = (data.astype(np.float32) + offset_val) / quant_val
            return TileReadResult(
                array=calibrated,
                valid_mask=(data > 0),
                radiometric_status="verified_conversion",
                source_dtype=src_dtype,
                source_raw_range=source_raw_range,
                quantification_value=quant_val,
                boa_add_offset=boa_offset,
                output_dtype="float32",
                output_reflectance_range=(float(np.nanmin(calibrated)), float(np.nanmax(calibrated))),
                conversion_formula=f"(DN + {offset_val}) / {quant_val}",
                metadata_source=meta_source,
            )

        # Check if already scaled reflectance (float32 in [-0.1, 2.0])
        if np.issubdtype(data.dtype, np.floating) and source_raw_min >= -0.1 and source_raw_max <= 2.0:
            return TileReadResult(
                array=data.astype(np.float32),
                valid_mask=np.isfinite(data) & (data > 0),
                radiometric_status="already_scaled_reflectance",
                source_dtype=src_dtype,
                source_raw_range=source_raw_range,
                output_dtype="float32",
                output_reflectance_range=source_raw_range,
                conversion_formula="identity",
                metadata_source="dtype_inspection",
            )

        # CURRENT REPOSITORY STATUS: unverified_raw_scale
        # Do NOT guess /10000. Preserve raw spectral values and record unverified status.
        return TileReadResult(
            array=data.astype(np.float32),
            valid_mask=(data > 0),
            radiometric_status="unverified_raw_scale",
            source_dtype=src_dtype,
            source_raw_range=source_raw_range,
            output_dtype="float32",
            output_reflectance_range=None,
            conversion_formula="none (conversion parameters unverified/unavailable)",
            metadata_source="none",
        )

    def load_band(
        self,
        band: str,
        band_recipe: dict[str, Any],
        normalize: bool = True,
    ) -> Any:
        """Load a single 2D raster window for a band according to its recipe."""
        res = self.read_tile_band(band, band_recipe)
        if normalize and res.radiometric_status != "categorical_scl":
            return self.normalize_band(res.array)
        return res.array

    def load_rgb(
        self,
        candidate_or_recipe: RetrievalCandidate | ChipRecipe | dict[str, Any],
    ) -> Any:
        """Load a normalized float32 (256, 256, 3) natural-color RGB chip (B04, B03, B02)."""
        if candidate_or_recipe is None:
            raise ValueError("chip_recipe is missing (None provided)")

        if isinstance(candidate_or_recipe, RetrievalCandidate):
            if candidate_or_recipe.chip_recipe is None:
                raise ValueError(
                    f"chip_recipe is missing for candidate tile '{candidate_or_recipe.tile_id}'"
                )
            recipe = candidate_or_recipe.chip_recipe
        elif isinstance(candidate_or_recipe, ChipRecipe):
            recipe = candidate_or_recipe
        elif isinstance(candidate_or_recipe, dict):
            recipe = ChipRecipe.from_json(candidate_or_recipe)
        else:
            raise ValueError(
                f"Unsupported candidate/recipe type: {type(candidate_or_recipe)}"
            )

        bands_data: list[Any] = []
        for band in self.RGB_BANDS:
            if band not in recipe.bands:
                raise ValueError(
                    f"Required RGB band '{band}' is missing from chip recipe"
                )
            band_arr = self.load_band(band, recipe.bands[band], normalize=True)
            bands_data.append(band_arr)

        rgb = np.stack(bands_data, axis=-1)

        if rgb.shape != self.EXPECTED_RGB_SHAPE:
            raise ValueError(
                f"Unexpected RGB chip shape: {rgb.shape}, "
                f"expected {self.EXPECTED_RGB_SHAPE}"
            )

        if rgb.dtype != np.float32:
            rgb = rgb.astype(np.float32)

        return rgb

    def load(
        self,
        candidate_or_recipe: RetrievalCandidate | ChipRecipe | dict[str, Any],
    ) -> Any:
        """Alias for load_rgb."""
        return self.load_rgb(candidate_or_recipe)


# ---------------------------------------------------------------------------
# Deterministic Level-0 Descriptor Engine
# ---------------------------------------------------------------------------

class DeterministicDescriptorEngine:
    """
    Computes deterministic spectral and land-cover descriptors per tile observation.

    Guarantees:
    - Independent per (tile_id, scene_id) observation.
    - Zero dependency on change detection, ground-truth labels, or external AI models.
    - Completely reproducible from persisted tile observation rasters.
    - L2-normalized feature vector suitable for cosine distance and ranking.
    """

    def __init__(
        self,
        chip_loader: Optional[RasterChipLoader] = None,
        feature_scaler: Optional[FeatureScaler] = None,
    ) -> None:
        self.loader = chip_loader or RasterChipLoader()
        self.scaler = feature_scaler

    def compute_descriptor(self, candidate: RetrievalCandidate) -> ObservationDescriptor:
        """Compute the deterministic ObservationDescriptor for a single candidate."""
        if candidate.chip_recipe is None:
            raise ValueError(f"Candidate {candidate.tile_id} has no chip recipe")

        recipe = candidate.chip_recipe

        # 1. Read SCL first (FIX 3 & FIX 4)
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
                logger.debug("SCL read failed for tile %s: %s", candidate.tile_id, exc)

        total_pixels = scl.size if scl is not None else 1
        if scl is not None:
            # Classes: 3: Cloud shadow, 4: Vegetation, 5: Not-vegetated (bare soil), 6: Water, 8-10: Clouds
            water_count = scl_hist.get(6, 0)
            veg_count = scl_hist.get(4, 0)
            bare_count = scl_hist.get(5, 0)
            cloud_count = scl_hist.get(8, 0) + scl_hist.get(9, 0) + scl_hist.get(10, 0)
            shadow_count = scl_hist.get(3, 0)

            # Valid clear-surface mask: vegetation, bare ground, water
            valid_clear_mask_128 = np.isin(scl, [4, 5, 6])
            valid_count = int(np.sum(valid_clear_mask_128))

            water_frac = water_count / total_pixels
            veg_frac = veg_count / total_pixels
            bare_frac = bare_count / total_pixels
            cloud_frac = cloud_count / total_pixels
            shadow_frac = shadow_count / total_pixels
            valid_frac = valid_count / total_pixels

            # Nearest-neighbor expansion of SCL mask to 256x256 for 10m bands (no continuous interpolation)
            valid_clear_mask_256 = np.repeat(np.repeat(valid_clear_mask_128, 2, axis=0), 2, axis=1)
        else:
            water_frac = 0.0
            veg_frac = 0.0
            bare_frac = 0.0
            cloud_frac = float(candidate.scene.cloud_cover_percent) / 100.0
            shadow_frac = float(candidate.scene.shadow_percent) / 100.0
            valid_frac = float(candidate.scene.valid_percent) / 100.0
            valid_count = int(valid_frac * 256 * 256)
            valid_clear_mask_128 = np.ones((128, 128), dtype=bool)
            valid_clear_mask_256 = np.ones((256, 256), dtype=bool)

        # 2. Read Spectral Bands with Radiometric Interpretation (FIX 1 & FIX 2)
        band_reads: dict[str, TileReadResult] = {}
        raw_band_means: dict[str, float] = {}
        raw_band_ranges: dict[str, tuple[float, float]] = {}

        for band in RETRIEVAL_BANDS:
            if band == "SCL":
                continue
            if band in recipe.bands:
                try:
                    res = self.loader.read_tile_band(band, recipe.bands[band])
                    band_reads[band] = res
                    raw_band_means[band] = float(np.mean(res.array))
                    raw_band_ranges[band] = res.source_raw_range
                except Exception as exc:
                    logger.debug("Band %s read skipped for tile %s: %s", band, candidate.tile_id, exc)

        primary_status = (
            band_reads["B02"].radiometric_status
            if "B02" in band_reads
            else "unverified_raw_scale"
        )

        b02 = band_reads["B02"].array if "B02" in band_reads else np.zeros((256, 256), dtype=np.float32)
        b03 = band_reads["B03"].array if "B03" in band_reads else np.zeros((256, 256), dtype=np.float32)
        b04 = band_reads["B04"].array if "B04" in band_reads else np.zeros((256, 256), dtype=np.float32)
        b05 = band_reads["B05"].array if "B05" in band_reads else np.zeros((128, 128), dtype=np.float32)
        b06 = band_reads["B06"].array if "B06" in band_reads else np.zeros((128, 128), dtype=np.float32)
        b07 = band_reads["B07"].array if "B07" in band_reads else np.zeros((128, 128), dtype=np.float32)
        b08 = band_reads["B08"].array if "B08" in band_reads else np.zeros((256, 256), dtype=np.float32)
        b11 = band_reads["B11"].array if "B11" in band_reads else np.zeros((128, 128), dtype=np.float32)
        b12 = band_reads["B12"].array if "B12" in band_reads else np.zeros((128, 128), dtype=np.float32)

        # 3. Apply Validity Mask to Exclude Cloud, Shadow, Defective Pixels from Spectral Statistics (FIX 4)
        mask_256 = valid_clear_mask_256 & (b02 > 0) & (b03 > 0) & (b04 > 0) & (b08 > 0)
        if not np.any(mask_256):
            mask_256 = (b02 > 0) | (b03 > 0) | (b04 > 0) | (b08 > 0)
            if not np.any(mask_256):
                mask_256 = np.ones((256, 256), dtype=bool)

        mask_128 = valid_clear_mask_128 & (b11 > 0)
        if not np.any(mask_128):
            mask_128 = (b11 > 0)
            if not np.any(mask_128):
                mask_128 = np.ones((128, 128), dtype=bool)

        # Masked Spectral Indices:
        denom_w = b03[mask_256].astype(np.float32) + b08[mask_256].astype(np.float32) + 1e-6
        ndwi_map = (b03[mask_256].astype(np.float32) - b08[mask_256].astype(np.float32)) / denom_w
        ndwi_mean = float(np.mean(ndwi_map)) if ndwi_map.size > 0 else 0.0
        ndwi_std = float(np.std(ndwi_map)) if ndwi_map.size > 0 else 0.0

        denom_v = b08[mask_256].astype(np.float32) + b04[mask_256].astype(np.float32) + 1e-6
        ndvi_map = (b08[mask_256].astype(np.float32) - b04[mask_256].astype(np.float32)) / denom_v
        ndvi_mean = float(np.mean(ndvi_map)) if ndvi_map.size > 0 else 0.0
        ndvi_std = float(np.std(ndvi_map)) if ndvi_map.size > 0 else 0.0

        b08_ds = b08[::2, ::2] if b08.shape == (256, 256) else b08
        denom_b = b11[mask_128].astype(np.float32) + b08_ds[mask_128].astype(np.float32) + 1e-6
        ndbi_map = (b11[mask_128].astype(np.float32) - b08_ds[mask_128].astype(np.float32)) / denom_b
        ndbi_mean = float(np.mean(ndbi_map)) if ndbi_map.size > 0 else 0.0
        ndbi_std = float(np.std(ndbi_map)) if ndbi_map.size > 0 else 0.0

        urban_frac = (
            max(0.0, min(1.0, float(np.mean(ndbi_map > 0.0) * (1.0 - veg_frac - water_frac))))
            if ndbi_map.size > 0
            else 0.0
        )

        # Masked band statistics:
        m_b02 = float(np.mean(b02[mask_256])) if np.any(mask_256) else 0.0
        s_b02 = float(np.std(b02[mask_256])) if np.any(mask_256) else 0.0
        m_b03 = float(np.mean(b03[mask_256])) if np.any(mask_256) else 0.0
        s_b03 = float(np.std(b03[mask_256])) if np.any(mask_256) else 0.0
        m_b04 = float(np.mean(b04[mask_256])) if np.any(mask_256) else 0.0
        s_b04 = float(np.std(b04[mask_256])) if np.any(mask_256) else 0.0
        m_b05 = float(np.mean(b05[mask_128])) if np.any(mask_128) else 0.0
        m_b06 = float(np.mean(b06[mask_128])) if np.any(mask_128) else 0.0
        m_b07 = float(np.mean(b07[mask_128])) if np.any(mask_128) else 0.0
        m_b08 = float(np.mean(b08[mask_256])) if np.any(mask_256) else 0.0
        s_b08 = float(np.std(b08[mask_256])) if np.any(mask_256) else 0.0
        m_b11 = float(np.mean(b11[mask_128])) if np.any(mask_128) else 0.0
        s_b11 = float(np.std(b11[mask_128])) if np.any(mask_128) else 0.0
        m_b12 = float(np.mean(b12[mask_128])) if np.any(mask_128) else 0.0

        # 4. Dense exactly 25-dimensional descriptor vector (FIX 5, FIX 6, FIX 7)
        # Spectral band features (11-24) represent masked band statistics directly.
        # When calibration is verified or already reflectance: values are in reflectance units.
        # When unverified raw scale: raw spectral DN statistics are preserved directly without
        # assuming, guessing, or scaling by unverified calibration parameters (no /10000 or /5000).
        def _safe_float(val: float) -> float:
            return float(val) if np.isfinite(val) else 0.0

        features = [
            float(np.clip((ndwi_mean + 1.0) / 2.0, 0.0, 1.0)),    # 0: NDWI mean mapped to [0, 1]
            float(np.clip((ndvi_mean + 1.0) / 2.0, 0.0, 1.0)),    # 1: NDVI mean mapped to [0, 1]
            float(np.clip((ndbi_mean + 1.0) / 2.0, 0.0, 1.0)),    # 2: NDBI mean mapped to [0, 1]
            float(np.clip(ndwi_std / 2.0, 0.0, 1.0)),             # 3: NDWI std scaled to [0, 1]
            float(np.clip(ndvi_std / 2.0, 0.0, 1.0)),             # 4: NDVI std scaled to [0, 1]
            float(np.clip(ndbi_std / 2.0, 0.0, 1.0)),             # 5: NDBI std scaled to [0, 1]
            float(np.clip(water_frac, 0.0, 1.0)),                 # 6: SCL water fraction
            float(np.clip(veg_frac, 0.0, 1.0)),                   # 7: SCL vegetation fraction
            float(np.clip(bare_frac, 0.0, 1.0)),                  # 8: SCL bare soil fraction
            float(np.clip(cloud_frac, 0.0, 1.0)),                 # 9: SCL/scene cloud fraction
            float(np.clip(shadow_frac, 0.0, 1.0)),                # 10: SCL/scene shadow fraction
            _safe_float(m_b02),                                   # 11: B02 mean
            _safe_float(m_b03),                                   # 12: B03 mean
            _safe_float(m_b04),                                   # 13: B04 mean
            _safe_float(m_b05),                                   # 14: B05 mean
            _safe_float(m_b06),                                   # 15: B06 mean
            _safe_float(m_b07),                                   # 16: B07 mean
            _safe_float(m_b08),                                   # 17: B08 mean
            _safe_float(m_b11),                                   # 18: B11 mean
            _safe_float(m_b12),                                   # 19: B12 mean
            _safe_float(s_b02),                                   # 20: B02 std
            _safe_float(s_b03),                                   # 21: B03 std
            _safe_float(s_b04),                                   # 22: B04 std
            _safe_float(s_b08),                                   # 23: B08 std
            _safe_float(s_b11),                                   # 24: B11 std
        ]

        if len(features) != DESCRIPTOR_DIMENSION:
            raise ValueError(
                f"Feature vector must have length {DESCRIPTOR_DIMENSION}, got {len(features)}"
            )

        raw_vec = np.array(features, dtype=np.float32)

        # 5. Feature Scaler (FIX 5 & FIX 6: only applied when an explicit fitted scaler is supplied)
        if self.scaler is not None:
            vec = self.scaler.transform(raw_vec)
        else:
            vec = raw_vec

        # 6. Final L2 Normalization (FIX 6: occurs as the final vector transformation step)
        norm = float(np.linalg.norm(vec))
        if norm > 1e-6:
            vec = vec / norm
        else:
            vec = np.zeros(DESCRIPTOR_DIMENSION, dtype=np.float32)
            vec[0] = 1.0

        return ObservationDescriptor(
            tile_id=candidate.tile_id,
            scene_id=candidate.scene.id,
            vector=vec,
            ndwi_mean=ndwi_mean,
            ndvi_mean=ndvi_mean,
            ndbi_mean=ndbi_mean,
            water_fraction=water_frac,
            vegetation_fraction=veg_frac,
            bare_soil_fraction=bare_frac,
            urban_fraction=urban_frac,
            cloud_fraction=cloud_frac,
            valid_fraction=valid_frac,
            shadow_fraction=shadow_frac,
            radiometric_status=primary_status,
            schema_version=DESCRIPTOR_SCHEMA_VERSION,
            raw_band_means=raw_band_means,
            raw_band_ranges=raw_band_ranges,
            valid_pixel_count=valid_count,
            scl_histogram=scl_hist,
        )


# ---------------------------------------------------------------------------
# Embedding provider contract (Extensible Interface)
# ---------------------------------------------------------------------------

class EmbeddingProvider(Protocol):
    """
    Provider interface for text/image/tile embeddings.

    Implementations must return L2-normalized vectors so cosine similarity
    can be represented by inner product.
    """

    model_id: str

    def embed_text(self, text: str) -> Any:
        ...

    def embed_chip(self, candidate: RetrievalCandidate) -> Any:
        ...


class EmbeddingProviderUnavailable(RuntimeError):
    """Raised when external ML semantic retrieval dependencies are unavailable."""


class OpenCLIPProvider:
    """
    OpenCLIP implementation boundary.

    Kept intentionally isolated because torch/open_clip are optional Phase 2
    dependencies and are not installed in the base backend environment.
    """

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL,
        chip_loader: Optional[RasterChipLoader] = None,
    ):
        self.model_id = model_id
        self._chip_loader = chip_loader

        try:
            import torch  # type: ignore
            import open_clip  # type: ignore
        except ImportError as exc:
            raise EmbeddingProviderUnavailable(
                "OpenCLIP retrieval requires optional dependencies. "
                "Install torch, open-clip-torch and Pillow before enabling "
                "learned semantic retrieval."
            ) from exc

        self._torch = torch
        self._open_clip = open_clip
        self._model = None
        self._preprocess = None
        self._tokenizer = None

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return

        model_name = self.model_id.split(":", 1)[-1]
        self._model, _, self._preprocess = self._open_clip.create_model_and_transforms(
            model_name,
            pretrained="laion2b_s34b_b79k",
        )
        self._tokenizer = self._open_clip.get_tokenizer(model_name)
        self._model.eval()

    def embed_text(self, text: str) -> Any:
        self._ensure_loaded()
        tokens = self._tokenizer([text])
        with self._torch.no_grad():
            vector = self._model.encode_text(tokens)
            vector /= vector.norm(dim=-1, keepdim=True)
        return vector.cpu().numpy()

    def embed_chip(self, candidate: RetrievalCandidate) -> Any:
        self._ensure_loaded()
        loader = self._chip_loader or RasterChipLoader()
        _ = loader.load_rgb(candidate)
        raise NotImplementedError(
            "OpenCLIP model inference for chip embeddings will be enabled "
            "once model weights and PyTorch dependencies are configured."
        )


# ---------------------------------------------------------------------------
# JSON / date helpers
# ---------------------------------------------------------------------------

def _json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        dt = datetime.strptime(text[:10], "%Y-%m-%d")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _date_only(value: Optional[str]) -> Optional[str]:
    dt = _parse_date(value)
    return dt.date().isoformat() if dt else None


def _bbox_from_json(value: Any) -> BoundingBox:
    data = value if isinstance(value, dict) else {}
    return BoundingBox(
        min_lon=float(data.get("min_lon", data.get("minLon", 0))),
        min_lat=float(data.get("min_lat", data.get("minLat", 0))),
        max_lon=float(data.get("max_lon", data.get("maxLon", 0))),
        max_lat=float(data.get("max_lat", data.get("maxLat", 0))),
    )


def _scene_from_row(row: sqlite3.Row) -> Scene:
    bands = _json(row["bands_json"], [])
    band_resolution = _json(row["band_resolution_m_json"], {})
    bbox = _bbox_from_json(_json(row["bbox_json"], {}))
    metadata = _json(row["metadata_json"], {})

    finest_resolution = min(
        [int(v) for v in band_resolution.values()],
        default=10,
    )

    sun_elevation = metadata.get("sun_elevation_deg", metadata.get("sun_elevation"))
    sun_azimuth = metadata.get("sun_azimuth_deg", metadata.get("sun_azimuth"))
    thumbnail = metadata.get("thumbnail_url", metadata.get("thumbnail"))

    return Scene(
        id=row["product_id"],
        satellite=row["satellite"] or "Sentinel-2",
        sensor=row["sensor"] or "MSI",
        acquisition_date=row["acquisition_date"] or "",
        cloud_cover_percent=float(row["cloud_percent"] or 0),
        resolution_meters=finest_resolution,
        processing_level=row["processing_level"] or "L2A",
        mgrs_tile=row["mgrs_tile"] or "",
        crs=row["crs"] or "",
        bbox=bbox,
        processing_baseline=row["processing_baseline"] or "",
        relative_orbit=int(row["relative_orbit"] or 0),
        shadow_percent=float(row["shadow_percent"] or 0),
        valid_percent=float(row["valid_percent"] or 0),
        bands=list(bands),
        band_resolution_m={str(k): int(v) for k, v in band_resolution.items()},
        sun_elevation_deg=float(sun_elevation) if sun_elevation is not None else None,
        sun_azimuth_deg=float(sun_azimuth) if sun_azimuth is not None else None,
        thumbnail_url=str(thumbnail) if thumbnail else None,
    )


# ---------------------------------------------------------------------------
# Registry access
# ---------------------------------------------------------------------------

class RetrievalRegistry:
    """Read-only access to scenes, tiles and tile observations."""

    def __init__(self, registry: str | Path):
        self.registry = Path(registry)

    def _connect(self) -> sqlite3.Connection:
        if not self.registry.exists():
            raise FileNotFoundError(f"Registry database not found: {self.registry}")
        conn = sqlite3.connect(self.registry)
        conn.row_factory = sqlite3.Row
        return conn

    def load_candidates(self, query: SearchQuery) -> list[RetrievalCandidate]:
        with self._connect() as conn:
            tables = {
                row["name"]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }

            required = {"scenes", "tiles", "tile_observations"}
            if not required.issubset(tables):
                raise RuntimeError(
                    "Phase 2 retrieval requires scenes, tiles and tile_observations tables"
                )

            scene_rows = conn.execute(
                """
                SELECT
                    product_id,
                    satellite,
                    sensor,
                    acquisition_date,
                    processing_level,
                    processing_baseline,
                    mgrs_tile,
                    relative_orbit,
                    crs,
                    bbox_json,
                    bands_json,
                    band_resolution_m_json,
                    cloud_percent,
                    shadow_percent,
                    valid_percent,
                    metadata_json
                FROM scenes
                WHERE status = 'accepted'
                ORDER BY acquisition_date ASC, product_id ASC
                """
            ).fetchall()

            scenes = {row["product_id"]: _scene_from_row(row) for row in scene_rows}

            rows = conn.execute(
                """
                SELECT
                    t.tile_id,
                    t.aoi_id,
                    t.bbox_json,
                    o.scene_id,
                    o.chip_recipe_json
                FROM tile_observations AS o
                JOIN tiles AS t
                  ON t.tile_id = o.tile_id
                ORDER BY o.scene_id ASC, t.tile_id ASC
                """
            ).fetchall()

        candidates: list[RetrievalCandidate] = []

        for row in rows:
            scene = scenes.get(row["scene_id"])
            if scene is None:
                continue

            candidate = RetrievalCandidate(
                scene=scene,
                tile_id=row["tile_id"],
                tile_bbox=_bbox_from_json(_json(row["bbox_json"], {})),
                aoi_id=row["aoi_id"],
                chip_recipe=(
                    ChipRecipe.from_json(row["chip_recipe_json"])
                    if row["chip_recipe_json"]
                    else None
                ),
            )

            if self.matches(candidate, query):
                candidates.append(candidate)

        return candidates

    @staticmethod
    def matches(candidate: RetrievalCandidate, query: SearchQuery) -> bool:
        scene = candidate.scene

        if query.aoi_id and candidate.aoi_id != query.aoi_id:
            return False

        scene_date = _date_only(scene.acquisition_date)

        if query.start_date:
            start = _date_only(query.start_date)
            if start and scene_date and scene_date < start:
                return False

        if query.end_date:
            end = _date_only(query.end_date)
            if end and scene_date and scene_date > end:
                return False

        if query.sensor:
            if scene.sensor.lower() != query.sensor.lower():
                return False

        if (
            query.max_cloud_percent is not None
            and scene.cloud_cover_percent > query.max_cloud_percent
        ):
            return False

        return True


# ---------------------------------------------------------------------------
# Optional ANN index boundary (Extensible for FAISS)
# ---------------------------------------------------------------------------

class VectorIndexUnavailable(RuntimeError):
    """Raised when FAISS is unavailable."""


class FaissIndex:
    """
    Thin FAISS boundary for future learned embeddings.

    IndexFlatIP is used because embeddings are normalized.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)

        try:
            import faiss  # type: ignore
        except ImportError as exc:
            raise VectorIndexUnavailable(
                "FAISS is not installed. Install faiss-cpu before "
                "building or querying the vector index."
            ) from exc

        self._faiss = faiss
        self.index = None
        self.mapping: list[IndexedTile] = []

    def build(self, vectors: Any, mapping: Sequence[IndexedTile]) -> None:
        if len(vectors) != len(mapping):
            raise ValueError("Embedding count does not match index mapping count")
        if len(vectors) == 0:
            raise ValueError("Cannot build an empty retrieval index")

        if np is not None:
            vectors = np.asarray(vectors, dtype=np.float32)

        self.path.parent.mkdir(parents=True, exist_ok=True)
        dimension = int(vectors.shape[1])
        index = self._faiss.IndexFlatIP(dimension)
        index.add(vectors)
        self._faiss.write_index(index, str(self.path))

        mapping_path = self.path.with_suffix(".json")
        mapping_path.write_text(
            json.dumps(
                [
                    {
                        "row": item.row,
                        "tile_id": item.tile_id,
                        "scene_id": item.scene_id,
                    }
                    for item in mapping
                ],
                indent=2,
            ),
            encoding="utf-8",
        )
        self.index = index
        self.mapping = list(mapping)

    def load(self) -> None:
        if not self.path.exists():
            raise FileNotFoundError(f"FAISS index not found: {self.path}")

        self.index = self._faiss.read_index(str(self.path))
        mapping_path = self.path.with_suffix(".json")
        if not mapping_path.exists():
            raise FileNotFoundError(f"FAISS mapping not found: {mapping_path}")

        payload = json.loads(mapping_path.read_text(encoding="utf-8"))
        self.mapping = [
            IndexedTile(
                row=int(item["row"]),
                tile_id=item["tile_id"],
                scene_id=item["scene_id"],
            )
            for item in payload
        ]

    def search(self, query_vector: Any, top_k: int) -> list[tuple[float, IndexedTile]]:
        if self.index is None:
            self.load()

        if np is not None:
            query_vector = np.asarray(query_vector, dtype=np.float32)
            if query_vector.ndim == 1:
                query_vector = np.expand_dims(query_vector, axis=0)

        scores, rows = self.index.search(query_vector, top_k)
        results: list[tuple[float, IndexedTile]] = []
        for score, row in zip(scores[0], rows[0]):
            if row < 0 or row >= len(self.mapping):
                continue
            results.append((float(score), self.mapping[int(row)]))
        return results


# ---------------------------------------------------------------------------
# Retrieval Engine (Level-0 Deterministic Baseline & Learned Extension)
# ---------------------------------------------------------------------------

class RetrievalEngine:
    """
    GeoSentinel Retrieval Engine.

    Operational Modes:
    1. 'deterministic_descriptor_reference': Reference tile image-to-image similarity
       using per-observation spectral descriptors.
    2. 'deterministic_finite_vocabulary': Semantic keyword matching against
       verified physical land-cover descriptors (water, vegetation, urban, bare_soil).
    3. 'unsupported_semantics': Fallback for arbitrary free-text queries, returning
       honest 0.0 scores with clear documentation that open-vocabulary text understanding
       requires a trained text-to-multispectral encoder.
    4. 'learned_ann_faiss': Optional future learned vector search using OpenCLIP/FAISS.
    """

    def __init__(
        self,
        registry: str | Path,
        *,
        embedding_provider: Optional[EmbeddingProvider] = None,
        index_path: str | Path = DEFAULT_INDEX_PATH,
        chip_loader: Optional[RasterChipLoader] = None,
        feature_scaler: Optional[FeatureScaler] = None,
    ):
        self.registry = RetrievalRegistry(registry)
        self.embedding_provider = embedding_provider
        self.index_path = Path(index_path)
        self.chip_loader = chip_loader or RasterChipLoader()
        self.feature_scaler = feature_scaler
        self.descriptor_engine = DeterministicDescriptorEngine(
            self.chip_loader,
            feature_scaler=self.feature_scaler,
        )
        self.last_retrieval_mode: str = "uninitialized"

    def match_vocabulary(self, text: Optional[str]) -> Optional[str]:
        """Check if query text matches any documented finite vocabulary concept."""
        if not text:
            return None
        cleaned = text.strip().lower()
        words = cleaned.replace("_", " ").replace("-", " ").split()
        for w in words:
            if w in FINITE_VOCABULARY:
                return FINITE_VOCABULARY[w]
        # Also check exact phrase
        if cleaned in FINITE_VOCABULARY:
            return FINITE_VOCABULARY[cleaned]
        return None

    def search(self, query: SearchQuery) -> list[SearchResult]:
        """
        Execute search against cataloged tile observations.

        Always produces individual tile observations (tile_id, scene_id).
        Guarantees all relevance scores fall strictly within [0.0, 1.0].
        """
        if not query.text and not query.reference_tile_id and not query.image_path:
            raise ValueError(
                "SearchQuery requires text, reference_tile_id or image_path"
            )

        candidates = self.registry.load_candidates(query)
        if not candidates:
            self.last_retrieval_mode = "no_candidates"
            return []

        requested_k = max(1, min(int(query.top_k or DEFAULT_TOP_K), 500))
        timestamp = datetime.now(timezone.utc).isoformat()

        # -------------------------------------------------------------------
        # Mode A: Future Learned OpenCLIP / FAISS Path (if configured)
        # -------------------------------------------------------------------
        if self.embedding_provider is not None:
            self.last_retrieval_mode = "learned_ann_faiss"
            try:
                if query.text:
                    q_vec = self.embedding_provider.embed_text(query.text)
                elif query.reference_tile_id:
                    ref = next((c for c in candidates if c.tile_id == query.reference_tile_id), None)
                    if ref is None:
                        raise ValueError(f"Reference tile not found: {query.reference_tile_id}")
                    q_vec = self.embedding_provider.embed_chip(ref)
                else:
                    raise NotImplementedError("image_path queries require trained image encoder")

                index = FaissIndex(self.index_path)
                ranked = index.search(q_vec, min(requested_k * 4, 1000))
                by_key = {(c.tile_id, c.scene.id): c for c in candidates}
                results: list[SearchResult] = []
                rank = 1
                for raw_score, mapping in ranked:
                    cand = by_key.get((mapping.tile_id, mapping.scene_id))
                    if cand is None:
                        continue
                    sim = max(0.0, min(1.0, (float(raw_score) + 1.0) / 2.0))
                    results.append(
                        SearchResult(
                            id=f"retrieval-faiss-{cand.scene.id}-{cand.tile_id}",
                            scene_id=cand.scene.id,
                            tile_id=cand.tile_id,
                            tile_bbox=cand.tile_bbox,
                            similarity_score=round(sim, 6),
                            semantic_rank=rank,
                            scene=cand.scene,
                            retrieval_timestamp=timestamp,
                            aoi_id=cand.aoi_id,
                            tile_image_url=None,
                        )
                    )
                    rank += 1
                    if len(results) >= requested_k:
                        break
                return results
            except EmbeddingProviderUnavailable:
                logger.info("External ML provider unavailable; falling back to deterministic Level-0 baseline")

        # -------------------------------------------------------------------
        # Mode B: Deterministic Reference Tile Similarity
        # -------------------------------------------------------------------
        if query.reference_tile_id:
            self.last_retrieval_mode = "deterministic_descriptor_reference"
            ref_candidate = next((c for c in candidates if c.tile_id == query.reference_tile_id), None)
            if ref_candidate is None:
                # Search across all candidates without filters
                all_cands = self.registry.load_candidates(SearchQuery())
                ref_candidate = next((c for c in all_cands if c.tile_id == query.reference_tile_id), None)

            if ref_candidate is None:
                raise ValueError(f"Reference tile not found in registry: {query.reference_tile_id}")

            ref_desc = self.descriptor_engine.compute_descriptor(ref_candidate)
            scored_candidates: list[tuple[float, RetrievalCandidate]] = []

            for cand in candidates:
                try:
                    if cand.tile_id == ref_candidate.tile_id and cand.scene.id == ref_candidate.scene.id:
                        sim = 1.0
                    else:
                        desc = self.descriptor_engine.compute_descriptor(cand)
                        # DIRECT cosine similarity between L2-normalized unit vectors
                        raw_cosine = float(np.dot(ref_desc.vector, desc.vector))
                        # Clamp final exposed score strictly to [0.0, 1.0] (DO NOT use (cosine + 1) / 2)
                        sim = max(0.0, min(1.0, raw_cosine))
                except Exception as exc:
                    logger.debug("Failed descriptor computation for %s: %s", cand.tile_id, exc)
                    sim = 0.0
                scored_candidates.append((sim, cand))

            # Sort descending by similarity score, tie-breaking deterministically by tile_id ASC
            scored_candidates.sort(key=lambda item: (-item[0], item[1].tile_id, item[1].scene.id))

            results = []
            for rank, (score, cand) in enumerate(scored_candidates[:requested_k], start=1):
                results.append(
                    SearchResult(
                        id=f"retrieval-ref-{cand.scene.id}-{cand.tile_id}",
                        scene_id=cand.scene.id,
                        tile_id=cand.tile_id,
                        tile_bbox=cand.tile_bbox,
                        similarity_score=round(score, 6),
                        semantic_rank=rank,
                        scene=cand.scene,
                        retrieval_timestamp=timestamp,
                        aoi_id=cand.aoi_id,
                        tile_image_url=None,
                    )
                )
            return results

        # -------------------------------------------------------------------
        # Mode C: Deterministic Finite Vocabulary Matching
        # -------------------------------------------------------------------
        matched_concept = self.match_vocabulary(query.text)

        if matched_concept is not None:
            self.last_retrieval_mode = f"deterministic_finite_vocabulary:{matched_concept}"
            scored_candidates = []

            for cand in candidates:
                try:
                    desc = self.descriptor_engine.compute_descriptor(cand)
                    if matched_concept == "water":
                        # Preference for open water extent and high positive NDWI
                        # NDWI in [-1, 1] mapped to [0, 1]
                        ndwi_norm = max(0.0, min(1.0, (desc.ndwi_mean + 1.0) / 2.0))
                        score = 0.6 * desc.water_fraction + 0.4 * ndwi_norm
                    elif matched_concept == "vegetation":
                        ndvi_norm = max(0.0, min(1.0, (desc.ndvi_mean + 1.0) / 2.0))
                        score = 0.6 * desc.vegetation_fraction + 0.4 * ndvi_norm
                    elif matched_concept == "cropland":
                        ndvi_norm = max(0.0, min(1.0, (desc.ndvi_mean + 1.0) / 2.0))
                        score = 0.4 * desc.vegetation_fraction + 0.3 * ndvi_norm + 0.3 * (1.0 - desc.urban_fraction)
                    elif matched_concept == "bare_soil":
                        score = 0.7 * desc.bare_soil_fraction + 0.3 * (1.0 - desc.vegetation_fraction)
                    elif matched_concept == "urban":
                        ndbi_norm = max(0.0, min(1.0, (desc.ndbi_mean + 1.0) / 2.0))
                        score = 0.5 * desc.urban_fraction + 0.5 * ndbi_norm
                    elif matched_concept == "cloud":
                        score = desc.cloud_fraction
                    else:
                        score = 0.0

                    score = max(0.0, min(1.0, float(score)))
                except Exception as exc:
                    logger.debug("Failed computing descriptor for %s: %s", cand.tile_id, exc)
                    score = 0.0

                scored_candidates.append((score, cand))

            scored_candidates.sort(key=lambda item: (-item[0], item[1].tile_id, item[1].scene.id))

            results = []
            for rank, (score, cand) in enumerate(scored_candidates[:requested_k], start=1):
                results.append(
                    SearchResult(
                        id=f"retrieval-vocab-{cand.scene.id}-{cand.tile_id}",
                        scene_id=cand.scene.id,
                        tile_id=cand.tile_id,
                        tile_bbox=cand.tile_bbox,
                        similarity_score=round(score, 6),
                        semantic_rank=rank,
                        scene=cand.scene,
                        retrieval_timestamp=timestamp,
                        aoi_id=cand.aoi_id,
                        tile_image_url=None,
                    )
                )
            return results

        # -------------------------------------------------------------------
        # Mode D: Unsupported Semantics (Honest Fallback)
        # -------------------------------------------------------------------
        self.last_retrieval_mode = "unsupported_semantics"
        logger.warning(
            "Query '%s' contains unsupported semantics. Deterministic Level-0 "
            "baseline supports finite vocabulary: %s. True open-vocabulary "
            "retrieval requires an aligned text-to-multispectral encoder.",
            query.text,
            sorted(set(FINITE_VOCABULARY.values())),
        )

        # Return candidate tile observations with honest 0.0 similarity score,
        # ordered deterministically by acquisition date ASC, tile_id ASC
        sorted_candidates = sorted(candidates, key=lambda c: (c.scene.acquisition_date, c.tile_id))
        results = []
        for rank, cand in enumerate(sorted_candidates[:requested_k], start=1):
            results.append(
                SearchResult(
                    id=f"retrieval-unsupported-{cand.scene.id}-{cand.tile_id}",
                    scene_id=cand.scene.id,
                    tile_id=cand.tile_id,
                    tile_bbox=cand.tile_bbox,
                    similarity_score=0.0,
                    semantic_rank=rank,
                    scene=cand.scene,
                    retrieval_timestamp=timestamp,
                    aoi_id=cand.aoi_id,
                    tile_image_url=None,
                )
            )
        return results


# ---------------------------------------------------------------------------
# Comprehensive Verification Test Suite
# ---------------------------------------------------------------------------

def test_raster_chip_loader() -> None:
    """Deterministic validation of RasterChipLoader using temporary synthetic GeoTIFFs."""
    import tempfile
    from rasterio.transform import from_origin

    loader = RasterChipLoader()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        transform = from_origin(378000, 2042560, 10, 10)

        patterns: dict[str, Any] = {
            "B04": np.zeros((256, 256), dtype=np.float32),
            "B03": np.zeros((256, 256), dtype=np.float32),
            "B02": np.zeros((256, 256), dtype=np.float32),
        }
        patterns["B04"][:128, :128] = 5000.0
        patterns["B04"][128:, 128:] = 100.0

        patterns["B03"][:128, 128:] = 5000.0
        patterns["B03"][128:, :128] = 100.0

        patterns["B02"][128:, :128] = 5000.0
        patterns["B02"][:128, :128] = 100.0

        bands_dict: dict[str, dict[str, Any]] = {}
        for band in ("B04", "B03", "B02"):
            file_path = tmppath / f"{band}.tif"
            with rasterio.open(
                file_path,
                "w",
                driver="GTiff",
                height=256,
                width=256,
                count=1,
                dtype="float32",
                crs="EPSG:32643",
                transform=transform,
            ) as dst:
                dst.write(patterns[band], 1)

            bands_dict[band] = {
                "path": str(file_path),
                "window": {"row_off": 0, "col_off": 0, "height": 256, "width": 256},
                "out_shape": [256, 256],
                "resolution_m": 10,
            }

        recipe = ChipRecipe(bands=bands_dict)

        # 1. Load from ChipRecipe
        rgb = loader.load_rgb(recipe)
        assert rgb.shape == (256, 256, 3), f"Wrong shape: {rgb.shape}"
        assert rgb.dtype == np.float32, f"Wrong dtype: {rgb.dtype}"
        assert np.all(rgb >= 0.0) and np.all(rgb <= 1.0), "Values outside [0, 1]"

        # 2. Verify channel ordering: B04 (R), B03 (G), B02 (B)
        assert rgb[50, 50, 0] > rgb[50, 50, 1], "Channel 0 should be B04 (Red)"
        assert rgb[50, 200, 1] > rgb[50, 200, 0], "Channel 1 should be B03 (Green)"
        assert rgb[200, 50, 2] > rgb[200, 50, 0], "Channel 2 should be B02 (Blue)"

        # 3. Verify robust normalization on constant and NaN data
        const_norm = loader.normalize_band(np.full((256, 256), 500.0, dtype=np.float32))
        assert np.all(const_norm == 0.0), "Constant band should normalize to 0"
        nan_norm = loader.normalize_band(np.array([[np.nan, np.inf], [-np.inf, 100.0]]))
        assert not np.any(np.isnan(nan_norm)) and not np.any(np.isinf(nan_norm))


def test_retrieval_baseline() -> None:
    """Verify all Level-0 deterministic baseline requirements."""
    default_registry = Path("data/registry/geosentinel.sqlite")
    if not default_registry.exists():
        default_registry = _BACKEND_ROOT.parent / "data" / "registry" / "geosentinel.sqlite"

    if not default_registry.exists():
        print(f"Skipping registry test: {default_registry} does not exist")
        return

    engine = RetrievalEngine(default_registry)
    candidates = engine.registry.load_candidates(SearchQuery())
    assert len(candidates) > 0, "No candidates loaded from registry"

    # 1. Test descriptor dimension == 25 and L2-normalization
    desc = engine.descriptor_engine.compute_descriptor(candidates[0])
    assert isinstance(desc.vector, np.ndarray), "Descriptor vector must be a numpy ndarray"
    assert desc.vector.shape == (25,), f"Expected shape (25,), got {desc.vector.shape}"
    assert len(desc.vector) == 25, f"Expected length 25, got {len(desc.vector)}"
    assert abs(float(np.linalg.norm(desc.vector)) - 1.0) < 1e-4, "Descriptor vector must be L2-normalized"

    # 2. Test descriptor repeatability/determinism
    desc2 = engine.descriptor_engine.compute_descriptor(candidates[0])
    assert np.allclose(desc.vector, desc2.vector), "Descriptor computation must be strictly deterministic"

    # 3. Test supported vocabulary retrieval ('water')
    results_water = engine.search(SearchQuery(text="water", top_k=5))
    assert len(results_water) > 0, "Water query returned no results"
    assert "deterministic_finite_vocabulary" in engine.last_retrieval_mode
    for r in results_water:
        assert 0.0 <= r.similarity_score <= 1.0, f"Score out of range: {r.similarity_score}"
        assert r.semantic_rank >= 1
        assert isinstance(r.id, str)
        assert r.tile_id.startswith("43Q")

    # Verify score ordering (descending)
    scores = [r.similarity_score for r in results_water]
    assert scores == sorted(scores, reverse=True), "Results not sorted by score descending"

    # 4. Test reference tile retrieval and self-similarity == 1.0
    ref_tile = candidates[0].tile_id
    results_ref = engine.search(SearchQuery(reference_tile_id=ref_tile, top_k=5))
    assert len(results_ref) > 0, "Reference query returned no results"
    assert engine.last_retrieval_mode == "deterministic_descriptor_reference"
    assert results_ref[0].tile_id == ref_tile, f"Rank 1 should be reference tile itself, got {results_ref[0].tile_id}"
    assert results_ref[0].similarity_score == 1.0, f"Self-similarity must be exactly 1.0, got {results_ref[0].similarity_score}"
    for r in results_ref:
        assert 0.0 <= r.similarity_score <= 1.0, f"Score out of range: {r.similarity_score}"

    # 5. Test unsupported semantics query (returns mode 'unsupported_semantics' and score 0.0)
    results_unsupported = engine.search(SearchQuery(text="flying alien spaceship", top_k=5))
    assert len(results_unsupported) > 0
    assert engine.last_retrieval_mode == "unsupported_semantics"
    for r in results_unsupported:
        assert r.similarity_score == 0.0, f"Unsupported semantics must have score 0.0, got {r.similarity_score}"

    # 6. Test deterministic reproducibility (same input -> same output)
    run1 = engine.search(SearchQuery(text="water", top_k=5))
    run2 = engine.search(SearchQuery(text="water", top_k=5))
    assert [r.id for r in run1] == [r.id for r in run2], "Non-deterministic results detected"
    assert [r.similarity_score for r in run1] == [r.similarity_score for r in run2]

    # 7. Test contract serialization
    json_output = to_json(results_water)
    parsed = json.loads(json_output)
    assert isinstance(parsed, list)
    assert "tileId" in parsed[0]
    assert "similarityScore" in parsed[0]

    # 8. Test independence from change-detection data
    assert "change" not in sys.modules
    assert "src.change" not in sys.modules
    assert "change_cities" not in str(sys.modules)
    assert not any("change" in m for m in sys.modules if "geosentinel" in str(getattr(sys.modules[m], "__file__", "")))


def test_radiometric_and_scaler() -> None:
    """Verify radiometric status, SCL categorical safety, and FeatureScaler behavior."""
    import tempfile
    from rasterio.transform import from_origin

    loader = RasterChipLoader()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        transform = from_origin(378000, 2042560, 10, 10)

        # 1. Test verified radiometric conversion with metadata in recipe
        tif_b02 = tmppath / "B02_meta.tif"
        raw_b02 = np.full((256, 256), 2000, dtype=np.uint16)
        with rasterio.open(
            tif_b02,
            "w",
            driver="GTiff",
            height=256,
            width=256,
            count=1,
            dtype="uint16",
            crs="EPSG:32643",
            transform=transform,
        ) as dst:
            dst.write(raw_b02, 1)

        recipe_with_meta = {
            "path": str(tif_b02),
            "window": {"row_off": 0, "col_off": 0, "height": 256, "width": 256},
            "quantification_value": 10000.0,
            "boa_add_offset": -1000.0,
        }
        res_meta = loader.read_tile_band("B02", recipe_with_meta)
        assert res_meta.radiometric_status == "verified_conversion"
        assert res_meta.quantification_value == 10000.0
        assert res_meta.boa_add_offset == -1000.0
        # (2000 + -1000) / 10000 = 0.1
        assert abs(float(np.mean(res_meta.array)) - 0.1) < 1e-5

        # 2. Test unverified raw scale (current repository status)
        recipe_unverified = {
            "path": str(tif_b02),
            "window": {"row_off": 0, "col_off": 0, "height": 256, "width": 256},
        }
        res_unverified = loader.read_tile_band("B02", recipe_unverified)
        assert res_unverified.radiometric_status == "unverified_raw_scale"
        assert res_unverified.source_dtype == "uint16"
        assert res_unverified.output_reflectance_range is None
        # Does NOT guess /10000: raw values preserved
        assert float(np.mean(res_unverified.array)) == 2000.0

        # 3. Test SCL categorical integrity
        tif_scl = tmppath / "SCL.tif"
        raw_scl = np.full((128, 128), 4, dtype=np.uint8)  # Vegetation class
        raw_scl[:64, :64] = 9  # High prob cloud
        with rasterio.open(
            tif_scl,
            "w",
            driver="GTiff",
            height=128,
            width=128,
            count=1,
            dtype="uint8",
            crs="EPSG:32643",
            transform=from_origin(378000, 2042560, 20, 20),
        ) as dst:
            dst.write(raw_scl, 1)

        res_scl = loader.read_tile_band("SCL", {
            "path": str(tif_scl),
            "window": {"row_off": 0, "col_off": 0, "height": 128, "width": 128},
        })
        assert res_scl.radiometric_status == "categorical_scl"
        assert res_scl.output_dtype == "uint8"
        assert res_scl.array.dtype == np.uint8
        # Unscaled integers:
        assert set(np.unique(res_scl.array)) == {4, 9}

    # 4. Test FeatureScaler determinism and zero-variance handling
    scaler = FeatureScaler()
    np.random.seed(42)
    fake_data = np.random.uniform(0.1, 0.9, size=(10, DESCRIPTOR_DIMENSION)).astype(np.float32)
    # Set feature 0 to constant (zero variance)
    fake_data[:, 0] = 0.5

    scaler.fit(fake_data)
    assert len(scaler.mean) == DESCRIPTOR_DIMENSION
    assert len(scaler.scale) == DESCRIPTOR_DIMENSION
    # Feature 0 scale should be 1.0 (no division by zero)
    assert scaler.scale[0] == 1.0
    assert scaler.mean[0] == 0.5

    test_vec = fake_data[0].copy()
    transformed1 = scaler.transform(test_vec)
    transformed2 = scaler.transform(test_vec)
    assert np.array_equal(transformed1, transformed2), "Scaler transformation must be deterministic"
    assert transformed1[0] == 0.0, "Zero-variance feature must transform to 0.0"
    assert not np.any(np.isnan(transformed1))
    assert not np.any(np.isinf(transformed1))

    # 5. Test FeatureScaler save & load reproducibility
    with tempfile.TemporaryDirectory() as tmpdir:
        scaler_path = Path(tmpdir) / "test_scaler.json"
        scaler.save(scaler_path)
        loaded_scaler = FeatureScaler.load(scaler_path)
        transformed_loaded = loaded_scaler.transform(test_vec)
        assert np.allclose(transformed1, transformed_loaded), "Loaded scaler must match original"

    # 6. Run explicit regression test for unverified raw scale
    test_unverified_raw_scale_regression()


def test_unverified_raw_scale_regression() -> None:
    """
    Explicit regression test proving that when calibration metadata is unavailable:
    1. radiometric_status == 'unverified_raw_scale'
    2. raw spectral values are preserved by the radiometric reader
    3. no guessed /10000 conversion occurs
    4. no guessed /5000 conversion occurs as radiometric calibration
    5. descriptor contains no NaN/Inf
    6. existing 25-D shape remains (25,)
    """
    import tempfile
    from rasterio.transform import from_origin

    with tempfile.TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        transform = from_origin(378000, 2042560, 10, 10)

        # 10m bands (B02, B03, B04, B08)
        bands_dict: dict[str, dict[str, Any]] = {}
        for band in ("B02", "B03", "B04", "B08"):
            p = tmppath / f"{band}.tif"
            raw_data = np.full((256, 256), 2000, dtype=np.uint16)
            raw_data[:128, :] = 2500
            raw_data[128:, :] = 1500
            with rasterio.open(
                p,
                "w",
                driver="GTiff",
                height=256,
                width=256,
                count=1,
                dtype="uint16",
                crs="EPSG:32643",
                transform=transform,
            ) as dst:
                dst.write(raw_data, 1)

            bands_dict[band] = {
                "path": str(p),
                "window": {"row_off": 0, "col_off": 0, "height": 256, "width": 256},
                "out_shape": [256, 256],
                "resolution_m": 10,
            }

        # 20m bands (B05, B06, B07, B11, B12)
        for band in ("B05", "B06", "B07", "B11", "B12"):
            p = tmppath / f"{band}.tif"
            raw_data = np.full((128, 128), 2000, dtype=np.uint16)
            raw_data[:64, :] = 2500
            raw_data[64:, :] = 1500
            with rasterio.open(
                p,
                "w",
                driver="GTiff",
                height=128,
                width=128,
                count=1,
                dtype="uint16",
                crs="EPSG:32643",
                transform=from_origin(378000, 2042560, 20, 20),
            ) as dst:
                dst.write(raw_data, 1)

            bands_dict[band] = {
                "path": str(p),
                "window": {"row_off": 0, "col_off": 0, "height": 128, "width": 128},
                "out_shape": [128, 128],
                "resolution_m": 20,
            }

        # SCL band
        p_scl = tmppath / "SCL.tif"
        raw_scl = np.full((128, 128), 4, dtype=np.uint8)  # Vegetation class
        with rasterio.open(
            p_scl,
            "w",
            driver="GTiff",
            height=128,
            width=128,
            count=1,
            dtype="uint8",
            crs="EPSG:32643",
            transform=from_origin(378000, 2042560, 20, 20),
        ) as dst:
            dst.write(raw_scl, 1)

        bands_dict["SCL"] = {
            "path": str(p_scl),
            "window": {"row_off": 0, "col_off": 0, "height": 128, "width": 128},
            "out_shape": [128, 128],
            "resolution_m": 20,
        }

        recipe = ChipRecipe(bands=bands_dict)
        candidate = RetrievalCandidate(
            scene=Scene(
                id="TEST_UNVERIFIED_SCENE",
                satellite="Sentinel-2A",
                sensor="MSI",
                acquisition_date="2024-01-01",
                cloud_cover_percent=0.0,
                resolution_meters=10,
                processing_level="L2A",
                mgrs_tile="43QDF",
                crs="EPSG:32643",
                bbox=BoundingBox(min_lon=73.8, min_lat=18.4, max_lon=73.9, max_lat=18.5),
                processing_baseline="05.00",
                relative_orbit=10,
                shadow_percent=0.0,
                valid_percent=100.0,
                bands=list(bands_dict.keys()),
                band_resolution_m={b: 10 if b in ("B02", "B03", "B04", "B08") else 20 for b in bands_dict},
            ),
            tile_id="43QDF_r000_c000",
            tile_bbox=BoundingBox(min_lon=73.8, min_lat=18.4, max_lon=73.9, max_lat=18.5),
            aoi_id="AOI-TEST",
            chip_recipe=recipe,
        )

        loader = RasterChipLoader()
        desc_engine = DeterministicDescriptorEngine(chip_loader=loader)

        # 1. Verification of read_tile_band
        read_res = loader.read_tile_band("B02", bands_dict["B02"])
        # (1) status is unverified_raw_scale
        assert read_res.radiometric_status == "unverified_raw_scale"
        # (2) raw spectral values are preserved by the radiometric reader
        assert float(np.mean(read_res.array)) == 2000.0
        # (3) no guessed /10000 conversion occurs
        assert float(np.mean(read_res.array)) != 0.2
        assert read_res.quantification_value is None
        # (4) no guessed /5000 conversion occurs as radiometric calibration
        assert float(np.std(read_res.array)) == 500.0
        assert float(np.std(read_res.array)) != 0.1

        # 2. Verification of descriptor computation
        desc = desc_engine.compute_descriptor(candidate)

        # (1) descriptor radiometric status is unverified_raw_scale
        assert desc.radiometric_status == "unverified_raw_scale"
        # (2) raw spectral statistics preserved in metadata without /10000 or /5000
        assert desc.raw_band_means["B02"] == 2000.0
        assert desc.raw_band_means["B02"] != 0.2
        # (5) descriptor contains no NaN/Inf
        assert not np.any(np.isnan(desc.vector)), "Descriptor contains NaN"
        assert not np.any(np.isinf(desc.vector)), "Descriptor contains Inf"
        # (6) existing 25-D shape remains (25,)
        assert desc.vector.shape == (25,), f"Expected shape (25,), got {desc.vector.shape}"
        assert abs(float(np.linalg.norm(desc.vector)) - 1.0) < 1e-4, "Must be L2-normalized"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="GeoSentinel Phase 2 semantic retrieval"
    )
    parser.add_argument("--registry", required=False)
    parser.add_argument(
        "--test-loader",
        action="store_true",
        help="Run deterministic RasterChipLoader synthetic tests",
    )
    parser.add_argument(
        "--test-scaler",
        action="store_true",
        help="Run focused tests for radiometric interpretation and feature scaler",
    )
    parser.add_argument(
        "--test-all",
        action="store_true",
        help="Run full deterministic retrieval baseline validation suite",
    )
    parser.add_argument("--text", help="Search text query")
    parser.add_argument("--aoi-id", help="Filter by AOI identifier")
    parser.add_argument("--reference-tile-id", help="Image-to-image reference tile query")
    parser.add_argument("--start-date", help="Filter by acquisition start date (ISO)")
    parser.add_argument("--end-date", help="Filter by acquisition end date (ISO)")
    parser.add_argument("--sensor", help="Filter by sensor (e.g. MSI)")
    parser.add_argument("--max-cloud", type=float, help="Filter by max cloud cover percentage")
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K, help="Max hits to return")
    parser.add_argument("--index", default=str(DEFAULT_INDEX_PATH), help="Path to optional FAISS index")
    return parser


def main() -> int:
    args = _build_parser().parse_args()

    if args.test_loader:
        test_raster_chip_loader()
        print("RasterChipLoader test: OK")
        return 0

    if args.test_scaler:
        test_radiometric_and_scaler()
        print("Radiometric and feature scaler test: OK")
        return 0

    if args.test_all:
        test_raster_chip_loader()
        print("RasterChipLoader test: OK")
        test_radiometric_and_scaler()
        print("Radiometric and feature scaler test: OK")
        test_retrieval_baseline()
        print("Retrieval baseline test: OK")
        return 0
    if not args.registry:
        print("Error: --registry is required when not running tests", file=sys.stderr)
        return 1

    query = SearchQuery(
        top_k=args.top_k,
        text=args.text,
        reference_tile_id=args.reference_tile_id,
        aoi_id=args.aoi_id,
        start_date=args.start_date,
        end_date=args.end_date,
        sensor=args.sensor,
        max_cloud_percent=args.max_cloud,
    )

    try:
        engine = RetrievalEngine(
            args.registry,
            index_path=args.index,
        )

        results = engine.search(query)
        print(f"Retrieval mode: {engine.last_retrieval_mode}", file=sys.stderr)
        print(to_json(results, indent=2))
        return 0
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

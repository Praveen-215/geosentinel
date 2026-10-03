"""
GeoSentinel Phase 2 — Semantic Retrieval

Pipeline:
    SQLite registry
        -> tile observations
        -> deterministic chip recipes
        -> embedding provider
        -> ANN index
        -> SearchResult[]

The embedding and ANN implementations are optional dependencies. This module
must never silently substitute metadata heuristics for semantic similarity.

Planned production stack:
    OpenCLIP / SigLIP -> FAISS IndexFlatIP/HNSW

Artifacts:
    data/embeddings/vectors.npy
    data/indexes/tiles.faiss

Environment:
    GEOSENTINEL_REGISTRY
    GEOSENTINEL_INDEX
    GEOSENTINEL_EMBEDDING_MODEL
    GEOSENTINEL_DATA_ROOT
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Protocol, Sequence

# Ensure project root is on sys.path for `backend.contracts`
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from backend.contracts import (
    BoundingBox,
    Scene,
    SearchQuery,
    SearchResult,
    to_json,
)

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
DEFAULT_DATA_ROOT = Path(
    os.getenv("GEOSENTINEL_DATA_ROOT", "../data")
)
DEFAULT_INDEX_PATH = Path(
    os.getenv(
        "GEOSENTINEL_INDEX",
        str(DEFAULT_DATA_ROOT / "indexes" / "tiles.faiss"),
    )
)
DEFAULT_MODEL = os.getenv(
    "GEOSENTINEL_EMBEDDING_MODEL",
    "open_clip:ViT-B-32",
)


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
    scene: Scene
    tile_id: str
    tile_bbox: BoundingBox
    aoi_id: Optional[str]
    chip_recipe: Optional[ChipRecipe] = None


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
    Deterministic Sentinel-2 natural-color raster chip loader for tile observations.

    Pipeline:
        RetrievalCandidate / ChipRecipe
            -> Rasterio window reads for B04, B03, B02 (10m bands)
            -> Robust per-band percentile normalization (2nd - 98th percentile)
            -> Natural-color RGB float32 array in [0, 1] of exact shape (256, 256, 3)
    """

    RGB_BANDS = ("B04", "B03", "B02")  # Channel 0: R (B04), Channel 1: G (B03), Channel 2: B (B02)
    EXPECTED_CHIP_SIZE = (256, 256)
    EXPECTED_RGB_SHAPE = (256, 256, 3)

    def __init__(self) -> None:
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

    def load_band(
        self,
        band: str,
        band_recipe: dict[str, Any],
    ) -> Any:
        """
        Load a single 2D raster window for a band according to its recipe.
        """
        if rasterio is None or Window is None:
            raise RasterioUnavailable("Rasterio is required to load raster windows")

        raw_path = band_recipe.get("path")
        if not raw_path:
            raise ValueError(f"Missing raster path for band '{band}' in recipe")

        path = Path(raw_path)
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

        out_shape = band_recipe.get("out_shape")
        if out_shape is not None:
            if (
                not isinstance(out_shape, (list, tuple))
                or len(out_shape) != 2
                or int(out_shape[0]) != self.EXPECTED_CHIP_SIZE[0]
                or int(out_shape[1]) != self.EXPECTED_CHIP_SIZE[1]
            ):
                raise ValueError(
                    f"Invalid output shape for band '{band}': {out_shape}, "
                    f"expected {list(self.EXPECTED_CHIP_SIZE)}"
                )

        win = Window(col_off=col_off, row_off=row_off, width=width, height=height)

        try:
            with rasterio.open(path) as src:
                # Read band 1 window only — do not load entire raster
                data = src.read(1, window=win)
        except Exception as exc:
            if isinstance(exc, (ValueError, FileNotFoundError)):
                raise
            raise ValueError(
                f"Failed reading raster window for band '{band}' at {path}: {exc}"
            ) from exc

        if data.shape != self.EXPECTED_CHIP_SIZE:
            raise ValueError(
                f"Read window shape {data.shape} for band '{band}' does not match "
                f"expected {self.EXPECTED_CHIP_SIZE}"
            )

        return self.normalize_band(data)

    def load_rgb(
        self,
        candidate_or_recipe: RetrievalCandidate | ChipRecipe | dict[str, Any],
    ) -> Any:
        """
        Load a normalized float32 (256, 256, 3) natural-color RGB chip (B04, B03, B02).
        """
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
            band_arr = self.load_band(band, recipe.bands[band])
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

    @staticmethod
    def to_pil_image(rgb: Any) -> Any:
        """Convert a normalized [0, 1] float32 RGB array to a PIL Image (uint8 [0, 255])."""
        try:
            from PIL import Image  # type: ignore
        except ImportError as exc:
            raise RuntimeError("Pillow is required to convert chip to PIL Image") from exc
        uint8_arr = (np.clip(rgb, 0.0, 1.0) * 255.0).astype(np.uint8)
        return Image.fromarray(uint8_arr)

    def load(
        self,
        candidate_or_recipe: RetrievalCandidate | ChipRecipe | dict[str, Any],
    ) -> Any:
        """Alias for load_rgb."""
        return self.load_rgb(candidate_or_recipe)


# ---------------------------------------------------------------------------
# Embedding provider contract
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
    """Raised when semantic retrieval dependencies are unavailable."""


class OpenCLIPProvider:
    """
    OpenCLIP implementation boundary.

    Kept intentionally isolated because torch/open_clip are optional Phase 2
    dependencies and are not installed in the base backend environment yet.
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
                "semantic retrieval."
            ) from exc

        self._torch = torch
        self._open_clip = open_clip

        # Model construction intentionally happens here rather than at import
        # time so the base backend remains lightweight.
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

    sun_elevation = metadata.get(
        "sun_elevation_deg",
        metadata.get("sun_elevation"),
    )
    sun_azimuth = metadata.get(
        "sun_azimuth_deg",
        metadata.get("sun_azimuth"),
    )
    thumbnail = metadata.get(
        "thumbnail_url",
        metadata.get("thumbnail"),
    )

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
        band_resolution_m={
            str(k): int(v)
            for k, v in band_resolution.items()
        },
        sun_elevation_deg=(
            float(sun_elevation)
            if sun_elevation is not None
            else None
        ),
        sun_azimuth_deg=(
            float(sun_azimuth)
            if sun_azimuth is not None
            else None
        ),
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
            raise FileNotFoundError(
                f"Registry database not found: {self.registry}"
            )

        conn = sqlite3.connect(self.registry)
        conn.row_factory = sqlite3.Row
        return conn

    def load_candidates(
        self,
        query: SearchQuery,
    ) -> list[RetrievalCandidate]:
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
                    "Phase 2 retrieval requires scenes, tiles and "
                    "tile_observations tables"
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

            scenes = {
                row["product_id"]: _scene_from_row(row)
                for row in scene_rows
            }

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
                tile_bbox=_bbox_from_json(
                    _json(row["bbox_json"], {})
                ),
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
    def matches(
        candidate: RetrievalCandidate,
        query: SearchQuery,
    ) -> bool:
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
# ANN index boundary
# ---------------------------------------------------------------------------

class VectorIndexUnavailable(RuntimeError):
    """Raised when FAISS is unavailable."""


class FaissIndex:
    """
    Thin FAISS boundary.

    IndexFlatIP is used for the pilot because embeddings are normalized.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)

        try:
            import faiss  # type: ignore
        except ImportError as exc:
            raise VectorIndexUnavailable(
                "FAISS is not installed. Install faiss-cpu before "
                "building or querying the semantic index."
            ) from exc

        self._faiss = faiss
        self.index = None
        self.mapping: list[IndexedTile] = []

    def build(
        self,
        vectors: Any,
        mapping: Sequence[IndexedTile],
    ) -> None:
        if len(vectors) != len(mapping):
            raise ValueError(
                "Embedding count does not match index mapping count"
            )

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
            raise FileNotFoundError(
                f"FAISS index not found: {self.path}"
            )

        self.index = self._faiss.read_index(str(self.path))

        mapping_path = self.path.with_suffix(".json")

        if not mapping_path.exists():
            raise FileNotFoundError(
                f"FAISS mapping not found: {mapping_path}"
            )

        payload = json.loads(
            mapping_path.read_text(encoding="utf-8")
        )

        self.mapping = [
            IndexedTile(
                row=int(item["row"]),
                tile_id=item["tile_id"],
                scene_id=item["scene_id"],
            )
            for item in payload
        ]

    def search(
        self,
        query_vector: Any,
        top_k: int,
    ) -> list[tuple[float, IndexedTile]]:
        if self.index is None:
            self.load()

        if np is not None:
            query_vector = np.asarray(query_vector, dtype=np.float32)
            if query_vector.ndim == 1:
                query_vector = np.expand_dims(query_vector, axis=0)

        scores, rows = self.index.search(
            query_vector,
            top_k,
        )

        results: list[tuple[float, IndexedTile]] = []

        for score, row in zip(scores[0], rows[0]):
            if row < 0 or row >= len(self.mapping):
                continue

            results.append(
                (float(score), self.mapping[int(row)])
            )

        return results


# ---------------------------------------------------------------------------
# Retrieval engine
# ---------------------------------------------------------------------------

class RetrievalEngine:
    """
    Semantic retrieval engine.

    Metadata filtering happens before ANN search. Semantic ranking comes only
    from the configured embedding provider and vector index.
    """

    def __init__(
        self,
        registry: str | Path,
        *,
        embedding_provider: Optional[EmbeddingProvider] = None,
        index_path: str | Path = DEFAULT_INDEX_PATH,
    ):
        self.registry = RetrievalRegistry(registry)
        self.embedding_provider = embedding_provider
        self.index_path = Path(index_path)

    def search(self, query: SearchQuery) -> list[SearchResult]:
        if not query.text and not query.reference_tile_id and not query.image_path:
            raise ValueError(
                "SearchQuery requires text, reference_tile_id or image_path"
            )

        if self.embedding_provider is None:
            raise EmbeddingProviderUnavailable(
                "No semantic embedding provider configured. "
                "Set up OpenCLIP/SigLIP before running semantic search."
            )

        candidates = self.registry.load_candidates(query)

        if not candidates:
            return []

        # Reference-tile and image queries will use the same normalized
        # embedding space once the provider implements them.
        if query.text:
            query_vector = self.embedding_provider.embed_text(
                query.text
            )
        elif query.reference_tile_id:
            reference = next(
                (
                    candidate
                    for candidate in candidates
                    if candidate.tile_id == query.reference_tile_id
                ),
                None,
            )

            if reference is None:
                # Fallback: check across all accepted tile observations in registry
                all_candidates = self.registry.load_candidates(SearchQuery())
                reference = next(
                    (
                        c
                        for c in all_candidates
                        if c.tile_id == query.reference_tile_id
                    ),
                    None,
                )

            if reference is None:
                raise ValueError(
                    f"Reference tile not found: {query.reference_tile_id}"
                )

            query_vector = self.embedding_provider.embed_chip(reference)
        else:
            raise NotImplementedError(
                "image_path queries require the image embedding path "
                "in the embedding provider."
            )

        requested_k = max(1, min(int(query.top_k or DEFAULT_TOP_K), 500))
        fetch_k = min(max(requested_k * 4, 100), 10000)

        index = FaissIndex(self.index_path)
        ranked = index.search(
            query_vector,
            fetch_k,
        )

        by_key = {
            (candidate.tile_id, candidate.scene.id): candidate
            for candidate in candidates
        }

        timestamp = datetime.now(timezone.utc).isoformat()
        results: list[SearchResult] = []
        rank = 1

        for raw_score, mapping in ranked:
            candidate = by_key.get(
                (mapping.tile_id, mapping.scene_id)
            )

            if candidate is None:
                continue

            # Cosine similarity for normalized vectors is [-1, 1].
            # SearchResult contract requires [0, 1].
            similarity = max(
                0.0,
                min(1.0, (raw_score + 1.0) / 2.0),
            )

            results.append(
                SearchResult(
                    id=(
                        f"retrieval-{candidate.scene.id}-"
                        f"{candidate.tile_id}"
                    ),
                    scene_id=candidate.scene.id,
                    tile_id=candidate.tile_id,
                    tile_bbox=candidate.tile_bbox,
                    similarity_score=round(similarity, 6),
                    semantic_rank=rank,
                    scene=candidate.scene,
                    retrieval_timestamp=timestamp,
                    aoi_id=candidate.aoi_id,
                    tile_image_url=None,
                )
            )
            rank += 1
            if len(results) >= requested_k:
                break

        return results


# ---------------------------------------------------------------------------
# Validation test
# ---------------------------------------------------------------------------

def test_raster_chip_loader() -> None:
    """
    Deterministic validation of RasterChipLoader using temporary synthetic GeoTIFFs.

    Verifies:
        - Synthetic GeoTIFF creation for B04, B03, B02 (256x256)
        - ChipRecipe and RetrievalCandidate loading
        - Output shape == (256, 256, 3)
        - Output dtype == float32
        - Output values are within [0.0, 1.0]
        - Channel ordering is B04 (R), B03 (G), B02 (B)
        - Error handling for missing bands, missing files, missing recipes
    """
    import tempfile
    from rasterio.transform import from_origin

    loader = RasterChipLoader()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        transform = from_origin(378000, 2042560, 10, 10)

        # Create synthetic data with distinct spatial patterns to verify channel ordering:
        # B04 (R): top-left quadrant high (5000)
        # B03 (G): top-right quadrant high (5000)
        # B02 (B): bottom-left quadrant high (5000)
        patterns: dict[str, np.ndarray] = {
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
                "window": {
                    "row_off": 0,
                    "col_off": 0,
                    "height": 256,
                    "width": 256,
                },
                "out_shape": [256, 256],
                "resolution_m": 10,
            }

        recipe = ChipRecipe(bands=bands_dict)

        # 1. Test loading from ChipRecipe
        rgb_from_recipe = loader.load_rgb(recipe)
        assert rgb_from_recipe.shape == (256, 256, 3), f"Wrong shape: {rgb_from_recipe.shape}"
        assert rgb_from_recipe.dtype == np.float32, f"Wrong dtype: {rgb_from_recipe.dtype}"
        assert np.all(rgb_from_recipe >= 0.0) and np.all(rgb_from_recipe <= 1.0), "Values outside [0, 1]"

        # 2. Test loading from RetrievalCandidate
        candidate = RetrievalCandidate(
            scene=Scene(
                id="TEST_SCENE",
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
                bands=["B02", "B03", "B04"],
                band_resolution_m={"B02": 10, "B03": 10, "B04": 10},
            ),
            tile_id="43QDF_r000_c000",
            tile_bbox=BoundingBox(min_lon=73.8, min_lat=18.4, max_lon=73.9, max_lat=18.5),
            aoi_id="AOI-TEST",
            chip_recipe=recipe,
        )

        rgb = loader.load_rgb(candidate)
        assert rgb.shape == (256, 256, 3), f"Expected shape (256, 256, 3), got {rgb.shape}"
        assert rgb.dtype == np.float32, f"Expected float32, got {rgb.dtype}"
        assert float(np.min(rgb)) >= 0.0 and float(np.max(rgb)) <= 1.0, "Values outside [0, 1]"

        # 3. Verify channel ordering is B04 (ch 0), B03 (ch 1), B02 (ch 2):
        # Top-left (rows 50, cols 50) has B04 high, B03 low, B02 low
        assert rgb[50, 50, 0] > rgb[50, 50, 1], "Channel 0 should be B04 (Red)"
        assert rgb[50, 50, 0] > rgb[50, 50, 2], "Channel 0 should be B04 (Red)"

        # Top-right (rows 50, cols 200) has B03 high, B04 low, B02 low
        assert rgb[50, 200, 1] > rgb[50, 200, 0], "Channel 1 should be B03 (Green)"
        assert rgb[50, 200, 1] > rgb[50, 200, 2], "Channel 1 should be B03 (Green)"

        # Bottom-left (rows 200, cols 50) has B02 high, B04 low, B03 low
        assert rgb[200, 50, 2] > rgb[200, 50, 0], "Channel 2 should be B02 (Blue)"
        assert rgb[200, 50, 2] > rgb[200, 50, 1], "Channel 2 should be B02 (Blue)"

        # 4. Verify failure when required band is missing
        missing_band_recipe = ChipRecipe(bands={"B04": bands_dict["B04"], "B03": bands_dict["B03"]})
        try:
            loader.load_rgb(missing_band_recipe)
            assert False, "Should have failed on missing B02 band"
        except ValueError as err:
            assert "B02" in str(err)

        # 5. Verify failure when raster file is missing
        broken_path_recipe = ChipRecipe(bands={
            **bands_dict,
            "B02": {**bands_dict["B02"], "path": str(tmppath / "nonexistent.tif")},
        })
        try:
            loader.load_rgb(broken_path_recipe)
            assert False, "Should have failed on missing raster file"
        except (FileNotFoundError, ValueError):
            pass

        # 6. Verify failure when candidate has no chip recipe
        candidate_no_recipe = RetrievalCandidate(
            scene=candidate.scene,
            tile_id=candidate.tile_id,
            tile_bbox=candidate.tile_bbox,
            aoi_id=candidate.aoi_id,
            chip_recipe=None,
        )
        try:
            loader.load_rgb(candidate_no_recipe)
            assert False, "Should have failed on None chip_recipe"
        except ValueError as err:
            assert "chip_recipe" in str(err)

        # 7. Verify robust normalization on constant and NaN/Inf data
        const_norm = loader.normalize_band(np.full((256, 256), 500.0, dtype=np.float32))
        assert np.all(const_norm == 0.0), "Constant band should normalize to 0"

        nan_norm = loader.normalize_band(np.array([[np.nan, np.inf], [-np.inf, 100.0]]))
        assert not np.any(np.isnan(nan_norm)) and not np.any(np.isinf(nan_norm))


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
    parser.add_argument("--text")
    parser.add_argument("--aoi-id")
    parser.add_argument("--reference-tile-id")
    parser.add_argument("--start-date")
    parser.add_argument("--end-date")
    parser.add_argument("--sensor")
    parser.add_argument("--max-cloud", type=float)
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    parser.add_argument(
        "--index",
        default=str(DEFAULT_INDEX_PATH),
    )

    return parser


def main() -> int:
    args = _build_parser().parse_args()

    if args.test_loader:
        test_raster_chip_loader()
        print("RasterChipLoader test: OK")
        return 0

    if not args.registry:
        print("Error: --registry is required when not running --test-loader", file=sys.stderr)
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
        provider = OpenCLIPProvider()

        engine = RetrievalEngine(
            args.registry,
            embedding_provider=provider,
            index_path=args.index,
        )

        results = engine.search(query)
        print(to_json(results, indent=2))
        return 0
    except (EmbeddingProviderUnavailable, VectorIndexUnavailable, FileNotFoundError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

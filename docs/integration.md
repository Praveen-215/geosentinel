# GeoSentinel — Integration Guide

How frontend, backend, models, data, and tools connect — plus setup runbooks.

Related: [prd.md](./prd.md) · [architecture.md](./architecture.md) · [phases.md](./phases.md) · [rules.md](./rules.md)

---

## 1. Integration map

```text
┌──────────────────────┐     camelCase JSON      ┌──────────────────────────┐
│  frontend services   │ ◄──────────────────────► │  HTTP API (Phase 4)      │
│  (interface + mock   │   same shapes as         │  /scenes /search /change │
│   or Http* impl)     │   contracts.to_json()    │  /reviews /evidence      │
└──────────────────────┘                          └────────────┬─────────────┘
                                                               │
              ┌────────────────────────────────────────────────┼─────────────┐
              ▼                        ▼                       ▼             ▼
        ingest.py                 tiling.py              retrieval.py    change.py
        SQLite scenes             tile chips             embed+FAISS     candidates
              ▲                        ▲                       ▲
              │                        │                       │
        scenes.csv               data/tiles/              models/ + data/index/
        aoi.geojson              GeoTIFF/COG              *.npy *.faiss
        data/imagery/
```

**Today:** Frontend ↔ mocks. Backend ingest is runnable. Tiling/retrieval/change modules are placeholders. API not yet present.

**Contract bridge:** `backend/contracts.py` ↔ `frontend/src/types/index.ts`

---

## 2. Local data layout (recommended)

Create locally (gitignored via `/data/`, rasters, indexes):

```text
data/
├── aoi/
│   └── aoi.geojson                 # Pilot AOI polygon(s)
├── catalogs/
│   └── scenes.csv                  # product_id, baseline, optional quality cols, asset hints
├── imagery/
│   └── <product_id>/
│       ├── B02.tif
│       ├── B03.tif
│       ├── … 
│       ├── B12.tif
│       └── SCL.tif
├── registry/
│   └── geosentinel.sqlite          # Ingest registry
├── tiles/                          # Phase 1+
│   └── <tile_id>/<scene_id>/...
├── embeddings/                     # Phase 2+
│   └── vectors.npy
├── indexes/                        # Phase 2+
│   └── tiles.faiss
└── exports/                        # masks, dossiers, eval dumps
```

### 2.1 `scenes.csv` expectations

Minimum:

- `product_id` (Sentinel-2 style ID)
- `baseline` or `processing_baseline`

Ingest also accepts optional quality / path columns (see `ingest.py` helpers). Cloud fractions in CSV are treated as **0–1** and multiplied by 100 when building `Scene`.

### 2.2 AOI

- GeoJSON polygon/multipolygon
- Default CRS assumption: **EPSG:4326** (`--aoi-crs` override available)

---

## 3. Backend setup

### 3.1 Environment

```bash
cd backend
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Populate `requirements.txt` with at least (ingest already imports these):

| Package | Used for |
|---|---|
| `numpy` | Arrays / SCL math |
| `pandas` | `scenes.csv` |
| `rasterio` | GeoTIFF/COG IO |
| `shapely` | AOI geometry |
| `pyproj` / rasterio.warp | CRS transforms |

Phase 2+ additions (document when added):

| Package | Used for |
|---|---|
| `faiss-cpu` or `faiss-gpu` | ANN index |
| `torch` / `open_clip_torch` (or chosen stack) | Embeddings |
| `fastapi`, `uvicorn`, `pydantic` | API |
| `pillow` | Chip previews |

### 3.2 Run ingest

From `backend/`:

```bash
python -m src.ingest `
  --scenes-csv ..\data\catalogs\scenes.csv `
  --aoi ..\data\aoi\aoi.geojson `
  --imagery-root ..\data\imagery `
  --registry ..\data\registry\geosentinel.sqlite `
  --verbose
```

Optional: `--fingerprint-rejected-assets` to hash assets even when rejected.

**Success output:** JSON summary with `accepted`, `rejected`, `skipped`, `scene_ids`.

### 3.3 Module responsibilities

| Module | Status | Consumes | Produces |
|---|---|---|---|
| `src/ingest.py` | Implemented | CSV, AOI, GeoTIFFs | SQLite scenes + `Scene` |
| `src/tiling.py` | Planned | Registry + rasters + AOI | `Tile` + chips |
| `src/retrieval.py` | Planned | Index + `SearchQuery` | `SearchResult[]` |
| `src/change.py` | Planned | Tiles/scenes + `ChangeQuery` | `ChangeResult[]` |
| `contracts.py` | Implemented | — | Shared DTOs + `to_json` |

---

## 4. Frontend setup

### 4.1 Run workstation

```bash
cd frontend
npm install
npm run dev
```

- App: `http://localhost:3000`
- Typecheck: `npm run typecheck`
- Build: `npm run build`

### 4.2 Service interfaces (integration seam)

| Service file | Interface purpose | Mock source |
|---|---|---|
| `retrievalService.ts` | Semantic / filtered scene search | `mockScenes.ts` |
| `changeAnalysisService.ts` | T1/T2 analysis + verify metric | `mockScenes.ts` |
| `reviewService.ts` | Analyst dispositions / packages | inline + mocks |
| `similarSitesService.ts` | Analog site ranking | `mockSimilarSites.ts` |
| `evidenceService.ts` | Dossier + export + hash check | `mockEvidence.ts` |
| `temporalAnalysisService.ts` | Multi-date series / intervals | `mockTemporal.ts` |

**Rule:** Pages import the exported service singleton, not mock files.

### 4.3 Planned live wiring

```text
VITE_USE_MOCKS=true|false
VITE_API_BASE_URL=http://localhost:8000
```

When mocks are false, each `Http*Service` calls:

| UI action | API (proposed) | Contract |
|---|---|---|
| List / get scenes | `GET /scenes`, `GET /scenes/{id}` | `Scene` |
| Semantic search | `POST /search` body=`SearchQuery` | `SearchResult[]` |
| Run change | `POST /change` body=`ChangeQuery` | `ChangeResult[]` |
| Submit review | `POST /reviews` body=`ReviewDecision` | ack + id |
| Evidence dossier | `GET /evidence/{id}` | dossier DTO |
| Health | `GET /health` | `{ status }` |

Vite proxy example (add when API exists):

```ts
// vite.config.ts (illustrative)
server: {
  port: 3000,
  proxy: {
    '/api': {
      target: 'http://localhost:8000',
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api/, ''),
    },
  },
}
```

### 4.4 Cross-module staging (already in `App.tsx`)

| From | Staged object | To |
|---|---|---|
| Retrieval / Similar / Temporal | `comparisonScene` | Change Analysis |
| Change Analysis | `stagedReviewPackage` | Analyst Review |

API integration must preserve these handoffs (IDs may replace full scene objects later, but UX flow stays).

---

## 5. API design notes (Phase 4)

### 5.1 Serialization

- Backend internal: snake_case dataclasses
- Over the wire: camelCase via `contracts.to_json()`
- Timestamps: ISO 8601 UTC
- Scores: similarity/confidence floats in `[0,1]` unless UI maps to percent

### 5.2 Error model (recommended)

```json
{
  "error": {
    "code": "QUALITY_GATE_FAIL",
    "message": "Co-registration FAIL for tile …",
    "details": {}
  }
}
```

Map HTTP 4xx for bad queries, 422 for validation, 503 for missing index/model.

### 5.3 Idempotency

- Ingest: skip existing `product_id` in registry
- Reviews: unique `review_id` or server-generated IDs with unique constraint on `(candidate_id, reviewed_at, reviewed_by)` as team prefers — document choice when implementing

---

## 6. Models & ML tooling

### 6.1 Role of models

| Stage | Model role |
|---|---|
| Retrieval | Embed tile chips + text into one space; ANN search |
| Similar sites | Reuse embeddings + spatial / land-cover weights |
| Change | Spectral indices and/or learned change scorer |
| Evidence | No ML required; hashing + lineage |

### 6.2 Suggested embedding stack (decision pending)

Pick one and record in [rules.md](./rules.md) Decision log:

1. **OpenCLIP / SigLIP** on RGB or false-color chips (fast to prototype)
2. **EO-specific** checkpoint if license + size allow
3. Dual encoders with metadata filtering outside the vector score

### 6.3 Index tooling

- **FAISS** IndexFlatIP or HNSW for pilot scale
- Persist: `data/indexes/tiles.faiss` + side table mapping vector row → `(tile_id, scene_id)`
- Rebuild index whenever tiling or embedding version changes (version the index name)

### 6.4 Change detection tooling

Minimum viable (no deep model):

- NDVI / NDWI / NDBI deltas inside valid SCL mask
- Threshold + morphology → change type heuristic
- Always attach `QualityChecks`

Optional upgrade: siamese / change-transformer head exporting mask GeoTIFF under `data/exports/`.

### 6.5 Experiment tracking (optional)

- Local: folders under `data/exports/eval/<run_id>/`
- Or MLflow/W&B only if team agrees — do not require cloud accounts for pilot

---

## 7. Tooling matrix

| Tool | Where | Purpose |
|---|---|---|
| Node 18+ / npm | frontend | UI toolchain |
| Vite | frontend | Dev server + build |
| TypeScript | frontend | Strict types |
| Python 3.10+ | backend | Pipelines / API |
| rasterio | backend | Raster IO |
| SQLite | backend | Scene registry (pilot) |
| FAISS | backend/models | Vector search (Phase 2+) |
| FastAPI + Uvicorn | backend (planned) | HTTP API |
| Lucide React | frontend | Icons |
| Git | repo | Source only — not bulky data |

---

## 8. Environment variables

### Frontend (planned)

| Variable | Example | Meaning |
|---|---|---|
| `VITE_USE_MOCKS` | `true` | Force mock services |
| `VITE_API_BASE_URL` | `http://localhost:8000` | API origin |

### Backend (planned)

| Variable | Example | Meaning |
|---|---|---|
| `GEOSENTINEL_REGISTRY` | `../data/registry/geosentinel.sqlite` | DB path |
| `GEOSENTINEL_INDEX` | `../data/indexes/tiles.faiss` | ANN path |
| `GEOSENTINEL_EMBEDDING_MODEL` | `open_clip:ViT-B-32` | Model id |
| `GEOSENTINEL_DATA_ROOT` | `../data` | Data root |
| `GEOSENTINEL_HOST` / `PORT` | `0.0.0.0` / `8000` | API bind |

Never commit real `.env` files.

---

## 9. End-to-end connection checklist

Use this when wiring Phase 4:

1. Ingest pilot stack → SQLite has accepted scenes  
2. Tile AOI → stable `tile_id`s across dates  
3. Embed + index → search returns non-empty ranked tiles  
4. Change on known T1/T2 → candidates + quality  
5. API serves contracts in camelCase  
6. Frontend `VITE_USE_MOCKS=false` → F2 search hits API  
7. Stage scene into F3 → run change via API  
8. F4 posts `ReviewDecision` → reloadable  
9. F6 loads evidence dossier with matching audit hash  
10. Toggle mocks back on → demo still works offline  

---

## 10. Verification commands

```bash
# Frontend
cd frontend && npm run typecheck && npm run build

# Backend ingest smoke
cd backend && python -m src.ingest --help

# After API exists (illustrative)
curl http://localhost:8000/health
curl -X POST http://localhost:8000/search -H "Content-Type: application/json" -d "{\"topK\":5,\"text\":\"reservoir with cropland\",\"aoiId\":\"aoi-43qdf-pune-catchment\"}"
```

Note: request bodies should match camelCase once exposed publicly, or accept snake_case server-side and convert — pick one in implementation and document it here.

---

## 11. Known limitations (current)

- No HTTP API in repo yet  
- `tiling.py`, `retrieval.py`, `change.py` are empty stubs  
- `backend/requirements.txt` may still need pinning — add versions when environments stabilize  
- Frontend imagery is synthetic SVG, not streamed COG tiles  
- Review/evidence paths are mock-backed  
- `docs/architecture` target API is aspirational until Phase 4 lands  

---

## 12. Integration ownership

| Connection | Owner pair |
|---|---|
| contracts ↔ TS types | Backend + Frontend |
| ingest → registry | Backend / data |
| tiles → embeddings | Backend + Models |
| search API → `retrievalService` | Backend + Frontend |
| change API → `changeAnalysisService` | Backend + Frontend |
| reviews persistence | Backend + Frontend |
| model checkpoint ↔ embed worker | Models |

Breaking contract changes require a short note in the PR and a bump note in this file’s limitations / checklist.

# GeoSentinel — System Architecture

**Status:** Current-state + target architecture  
**Contract source of truth:** `backend/contracts.py` ↔ `frontend/src/types/index.ts`

---

## 1. Overview

GeoSentinel is a three-layer system:

1. **Analyst Workstation (frontend)** — React mission-control UI.
2. **EO Pipelines & API (backend)** — ingest, tile, retrieve, change, review persistence.
3. **Models & indexes** — embeddings, similarity index, change detectors (artifacts often local/gitignored).

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Analyst Workstation (React)                  │
│  F1 Overview │ F2 Retrieval │ F3 Change │ F4 Review │ F5–F7 …   │
│                         service interfaces                       │
└─────────────────────────────┬───────────────────────────────────┘
                              │ JSON (camelCase contracts)
┌─────────────────────────────▼───────────────────────────────────┐
│                         API layer (planned)                      │
│              REST / local FastAPI (or equivalent)                │
└───────┬─────────────────┬─────────────────┬─────────────────────┘
        │                 │                 │
┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────────────┐
│ Ingest +     │  │ Retrieval    │  │ Change + Review      │
│ Registry     │  │ + embeddings │  │ + evidence export    │
│ (SQLite)     │  │ (FAISS/etc.) │  │                      │
└───────┬──────┘  └───────┬──────┘  └──────────────────────┘
        │                 │
        ▼                 ▼
   scenes / tiles    tile embeddings
   GeoTIFF/COG       *.npy / *.faiss
```

---

## 2. Repository layout

```text
sentinental/
├── frontend/          # GeoSentinel analyst interface (Vite + React + TS)
├── backend/           # Pipelines + shared contracts
│   ├── contracts.py   # Shared data shapes + to_json() camelCase bridge
│   ├── requirements.txt
│   └── src/
│       ├── ingest.py      # Implemented: L2A GeoTIFF ingest/validate/register
│       ├── tiling.py      # Planned: fixed-grid tiling
│       ├── retrieval.py   # Planned: semantic / visual search
│       └── change.py      # Planned: bi-temporal change candidates
├── docs/              # PRD, architecture, integration, phases, rules
├── models/            # Planned: model cards / export scripts (optional)
└── data/              # Local only (gitignored): imagery, AOI, registry, indexes
```

---

## 3. Frontend architecture

### 3.1 Stack

- React 18 + TypeScript (strict)
- Vite (dev server port **3000**)
- Lucide icons
- Custom GIS chrome design system in `src/styles/globals.css`

### 3.2 Composition

| Layer | Responsibility |
|---|---|
| `App.tsx` | Global state: AOI, scenes, comparison scene, review package, active section, F1–F7 shortcuts |
| `AnalystLayout` | Frame: Header + Sidebar + workspace |
| Pages | One page per mission module |
| Components | Viewport, metadata, thumbnails, standby |
| `services/*` | Async interfaces; currently mock implementations |
| `data/mock*` | Demo catalog & results for offline work |
| `types/index.ts` | Domain models consumed by UI |

### 3.3 State flow (high level)

```text
User selects module (F-key / sidebar)
  → App sets activeSection
  → Page calls service (mock or API)
  → Results update local page state and/or App-level staged objects
  → Cross-module navigation carries staged comparison scene / review package
```

Cross-module handoffs:

- Retrieval / Similar Sites / Temporal → stage comparison scene → Change Analysis
- Change Analysis → queue review package → Analyst Review
- Review / Change → Evidence dossier views

### 3.4 Viewport

`ImageryViewport` is a **local synthetic SVG EO canvas** for pilot demos (true color, false color, NDVI, change heatmap). It is not a Mapbox/Leaflet dependency in the current phase.

---

## 4. Backend architecture

### 4.1 Contracts (`backend/contracts.py`)

Shared dataclasses. Backend uses snake_case; `to_json()` emits camelCase for the frontend.

| Contract | Role |
|---|---|
| `BoundingBox` | Always EPSG:4326 for display |
| `Scene` | Registered L2A product metadata + quality % |
| `Tile` | Fixed 2560 m grid cell |
| `SearchQuery` / `SearchResult` | Retrieval I/O (results are **tiles**) |
| `ChangeQuery` / `ChangeResult` | Change detection I/O |
| `QualityChecks` | Confidence & screening gates |
| `ReviewDecision` | Durable analyst disposition |

Enums / controlled vocabularies:

- Change types: `CONSTRUCTION`, `CLEARANCE`, `WATER`, `ROAD`
- Check status: `PASS`, `WARN`, `FAIL`
- Confidence: `HIGH`, `MEDIUM`, `LOW`
- Dispositions: `confirmed`, `rejected`, `flagged`

### 4.2 Ingest pipeline (implemented)

**Module:** `backend/src/ingest.py`

```text
scenes.csv + aoi.geojson + per-product GeoTIFF/COG
        → resolve bands (B02–B08, B11, B12, SCL)
        → validate CRS / resolution / AOI coverage
        → SCL quality (cloud / shadow / valid %)
        → cross-check CSV vs raster
        → SHA-256 fingerprint accepted assets
        → register in SQLite → emit Scene contracts
```

**Stops after** validate / fingerprint / register. Does **not** resample, tile, embed, retrieve, or detect change.

**SCL pilot policy (single source of truth):**

- Cloud classes: 8, 9, 10
- Cloud shadow: 3
- Valid clear-surface: 4 (vegetation), 5 (not vegetated), 6 (water)

### 4.3 Planned pipeline stages

| Stage | Module | Output |
|---|---|---|
| Tiling | `tiling.py` | `Tile` rows + per-observation chip paths |
| Embedding | models + retrieval helpers | Vectors per tile observation |
| Index | FAISS (or equiv.) | Approximate nearest neighbor store |
| Retrieval | `retrieval.py` | Ranked `SearchResult` |
| Change | `change.py` | `ChangeResult` + quality + optional masks |
| Review store | API + DB | `ReviewDecision` records |
| Evidence | API exporter | Dossier JSON / markdown |

### 4.4 Registry

SQLite table `scenes` (see ingest `SCHEMA_SQL`): product metadata, quality fields, status, rejection reason, warnings, fingerprints embedded in `metadata_json`.

---

## 5. Data architecture

### 5.1 Spatial conventions

| Concern | Convention |
|---|---|
| Display bbox | EPSG:4326 lon/lat |
| Processing / tiling | Native UTM (pilot: EPSG:32643) |
| Tile size | 2560 m × 2560 m |
| Band resolutions | 10 m (B02,B03,B04,B08); 20 m (B05–B07,B11,B12,SCL) |

### 5.2 Identity model

```text
AOI ──< Scene (product_id)
         │
         └── Tile (tile_id) ── observation = (tile_id, scene_id)
                                  │
                                  ├── embedding / search hit
                                  └── change candidate (t1, t2)
                                         └── review decision
```

---

## 6. API architecture (target)

Thin HTTP API in front of pipelines (FastAPI recommended; not required if team chooses another ASGI stack).

Suggested resource groups:

| Group | Examples |
|---|---|
| Catalog | `GET /scenes`, `GET /scenes/{id}`, `GET /aois/{id}` |
| Retrieval | `POST /search` → `SearchResult[]` |
| Change | `POST /change` → `ChangeResult[]` |
| Review | `POST /reviews`, `GET /reviews/{id}` |
| Evidence | `GET /evidence/{investigationId}` |
| Health | `GET /health` |

All response bodies must serialize through contract rules (camelCase keys matching frontend types).

Frontend wiring pattern:

```text
MockXService  →  HttpXService implements same interface
retrievalService export swaps implementation via env flag
```

---

## 7. Models architecture (target)

| Capability | Typical approach | Artifact |
|---|---|---|
| Semantic text↔tile | CLIP / SigLIP / EO-finetuned dual encoder | checkpoint + embedder script |
| Visual similarity | Same encoder on tile RGB/false-color chips | vectors in FAISS |
| Change detection | Spectral indices + optional learned change head | masks + scores |
| Ranking | Cosine similarity + metadata filters | top-k list |

Large binaries stay under `data/` or `models/artifacts/` and remain gitignored (`*.npy`, `*.faiss`, rasters).

---

## 8. Security & ops (pilot)

- No credentials committed; use `.env` (gitignored).
- Imagery and indexes are local artifacts.
- Review decisions are authoritative only when stored server-side.
- Audit hash on evidence packages should cover canonical JSON of the dossier payload.

---

## 9. Current maturity

| Component | Maturity |
|---|---|
| Frontend modules F1–F7 | UI present; mock-backed |
| Frontend service interfaces | Defined |
| `contracts.py` | Defined |
| Ingest + SQLite registry | Implemented |
| Tiling / retrieval / change code | Stub / empty modules |
| HTTP API | Not yet in repo |
| Live frontend↔backend | Not wired |
| Docs architecture/integration | This document |

---

## 10. Design principles

1. **Contracts first** — UI and pipelines agree on shapes before algorithms.
2. **Tiles as retrieval atoms** — search and change attach to stable ground squares.
3. **Quality is first-class** — never ship a change score without checks.
4. **Mocks are first-class** — demo and parallel development must not block on GPU/API.
5. **Determinism in ingest** — reproducible accept/reject for evaluation fairness.

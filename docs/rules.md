# GeoSentinel — Permanent Rules, Context & Constraints

This document is normative. If implementation conflicts with it, **change the code or update this file in the same PR** — do not silently diverge.

Related: [prd.md](./prd.md) · [architecture.md](./architecture.md) · [integration.md](./integration.md) · [phases.md](./phases.md)

---

## 1. Project context

- **Name:** GeoSentinel (repo: `sentinental`)
- **Mission:** Semantic retrieval + multi-temporal change analysis of satellite imagery for EO/GIS analysts.
- **Pilot geography:** Pune Metropolitan Basin / Khadakwasla watershed, MGRS tile **43QDF**, UTM **EPSG:32643**.
- **Primary sensor (pilot):** Sentinel-2 MSI **L2A** Analysis Ready GeoTIFF/COG.
- **Workstation modules:** F1–F7 (Overview, Retrieval, Change, Review, Similar Sites, Evidence, Temporal).

---

## 2. Hard constraints

### 2.1 Data & CRS

1. Display bounding boxes are always **EPSG:4326** (lon/lat).
2. Tiling and raster math use the scene’s **native UTM CRS**.
3. Tile geometry is fixed: **2560 m × 2560 m**, grid anchored at the AOI top-left in native CRS.
4. `tile_id` format: `{mgrs_tile}_r{row:03d}_c{col:03d}`.
5. One observation = **`tile_id` + `scene_id`**.

### 2.2 Ingest (pilot)

6. Accepted raster formats: **GeoTIFF / COG only** (`.tif` / `.tiff`). JP2/SAFE is out of scope until explicitly phased in.
7. Required bands: `B02,B03,B04,B05,B06,B07,B08,B11,B12,SCL`.
8. Expected resolutions must match ingest policy (10 m vs 20 m map in `ingest.py`).
9. SCL quality policy is **single-sourced** in `backend/src/ingest.py` — do not duplicate alternate class sets elsewhere.
10. Pilot valid pixels = SCL classes **4, 5, 6** only (vegetation, not-vegetated, water).
11. Ingest stops at validate / fingerprint / register. It must not silently start tiling, embedding, or change detection.

### 2.3 Contracts & API

12. Shared shapes live in `backend/contracts.py` and must stay aligned with `frontend/src/types/index.ts`.
13. Wire format to the frontend is **camelCase JSON** via `to_json()` (or equivalent).
14. Controlled vocabularies must not be freestyle strings:
    - Change types: `CONSTRUCTION | CLEARANCE | WATER | ROAD`
    - Check status: `PASS | WARN | FAIL`
    - Confidence: `HIGH | MEDIUM | LOW`
    - Dispositions: `confirmed | rejected | flagged`
15. Retrieval results are **tiles** (`SearchResult` includes `tile_id` / `tile_bbox`), not scene-only hits.
16. `ReviewDecision` records are **server-persisted**. Browser-only review state is demo-only and not production truth.

### 2.4 Frontend

17. Pages talk to **service interfaces**, never to mock data modules directly (except inside mock service implementations).
18. Mock services remain until an HTTP implementation is swapped behind the same interface.
19. Do not add heavy GIS cloud SDKs in the pilot unless the phase plan explicitly calls for them.
20. Preserve F1–F7 navigation semantics and dense GIS chrome language unless a product decision changes the PRD.
21. TypeScript must pass `npm run typecheck` / build; do not weaken `strict` to land features.

### 2.5 Repo hygiene

22. Never commit secrets, `.env`, credentials, or API keys.
23. Never commit large rasters, FAISS indexes, or embedding matrices (`/data/`, `*.tif`, `*.npy`, `*.faiss` are gitignored).
24. Do not invent parallel “temporary” contract files; extend `contracts.py` + TS types together.
25. Prefer updating docs in `docs/` when behavior or interfaces change.

---

## 3. Engineering rules

1. **Contracts first:** add/change fields in contracts + types before wiring UI or models.
2. **One quality policy:** SCL meanings and valid/cloud/shadow sets change only in ingest policy (and docs).
3. **Determinism:** ingest accept/reject for the same inputs must be stable for evaluation.
4. **Quality is mandatory on change:** a `ChangeResult` without `QualityChecks` is invalid.
5. **No silent mock leakage:** production API path must not fall back to mock data without an explicit flag.
6. **Small, reviewable PRs:** one concern per PR when possible (ingest vs UI chrome vs model training).
7. **Comments only for non-obvious intent** — do not narrate obvious code.
8. **Match existing style** in the folder you edit (React patterns, Python logging, naming).

---

## 4. Product rules

1. Analyst trust > flashy visuals. Prefer explicit PASS/WARN/FAIL over unexplained scores.
2. Every promoted finding should be traceable to scenes, dates, tile, checks, and disposition.
3. Earliest supported observation must be representable on change + evidence views.
4. Demo mode is allowed; claiming live inference in the UI when mocks are active is not.
5. Pilot AOI assumptions (43QDF / Pune) can be generalized later — do not hardcode city-specific logic deep in pipelines; keep AOI data-driven.

---

## 5. Team / module ownership (logical)

| Area | Owns |
|---|---|
| Frontend | Workstation UX, service interfaces, mock fidelity |
| Backend / data | Ingest, tiling, registry, API, persistence |
| Retrieval / models | Embeddings, index, ranking, evaluation |
| Change analysis | Bi-temporal detectors, masks, quality aggregation |
| Docs | PRD, architecture, integration, phases, rules |

Cross-cutting: **contracts** are owned jointly; any breaking change needs frontend + backend ack.

---

## 6. Decision log (seed)

| Decision | Choice | Rationale |
|---|---|---|
| Retrieval atom | Tile (2560 m) | Stable ground unit across dates |
| Ingest format (pilot) | GeoTIFF/COG | Deterministic, simpler than SAFE/JP2 |
| Display CRS | EPSG:4326 | Map/UI simplicity |
| Process CRS | Native UTM | Metric tiling without distortion hacks |
| Frontend bootstrap | Mocks + interfaces | Parallel team delivery |
| Review storage | Backend | Auditability |

When reversing a decision, add a row here and update PRD/architecture/phases.

---

## 7. Language & naming

- Product name in UI/docs: **GeoSentinel**
- Repo folder may remain `sentinental` historically — do not rename casually.
- Scene IDs follow Sentinel product_id conventions when sourced from Sentinel-2.
- Use ISO 8601 UTC timestamps in contracts.

---

## 8. What “done” means for a feature

A feature is done only when:

1. Contracts/types updated if needed  
2. Happy path + failure/quality path considered  
3. Mock path still works **or** is explicitly replaced  
4. Docs touched if interfaces or phases shifted  
5. No secrets or bulky binaries added to git  

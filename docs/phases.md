# GeoSentinel — Delivery Phases

Phased plan from current repo state → integrated pilot. Each phase has **entry**, **exit**, and **non-goals**.

See also: [prd.md](./prd.md) · [architecture.md](./architecture.md) · [integration.md](./integration.md) · [rules.md](./rules.md)

---

## Phase 0 — Foundation (current baseline)

**Status:** Largely complete

### Scope

- Repo structure: `frontend/`, `backend/`, `docs/`
- Frontend workstation shell + F1–F7 pages on mock services
- Shared contracts in `backend/contracts.py` aligned to TS types
- Deterministic Sentinel-2 L2A GeoTIFF ingest + SQLite registry

### Exit criteria

- [x] Analyst UI navigable with mocks
- [x] Service interfaces defined for retrieval, change, review, similar sites, evidence, temporal
- [x] Ingest CLI accepts `scenes.csv` + AOI + imagery root + registry
- [x] Docs: PRD, architecture, rules, phases, integration exist

### Non-goals

- Live API, real embeddings, real change masks in UI

---

## Phase 1 — Data readiness & tiling

**Goal:** Turn accepted scenes into a stable tile observation store.

### Scope

1. Implement `backend/src/tiling.py`
2. Persist tiles + per-scene chip paths (or COG window recipes)
3. Validate tile grid stability across dates for the pilot AOI
4. Document `data/` directory layout (see integration.md)
5. Smoke scripts: list scenes, list tiles for one product

### Exit criteria

- [ ] Given ingest registry + AOI, tiling produces deterministic `tile_id`s
- [ ] Every accepted scene intersecting AOI yields the same tile set geometry
- [ ] Tile metadata exportable as contract `Tile` JSON
- [ ] At least one multi-date stack tiled for 43QDF pilot

### Non-goals

- Embeddings, HTTP API, UI wiring

---

## Phase 2 — Semantic retrieval (models + search)

**Goal:** Rank tiles from text and/or reference image.

### Scope

1. Choose / document embedding model (see integration.md)
2. Build tile chip preprocessing (RGB and/or false-color recipe)
3. Embed all tile observations → vectors on disk
4. Build ANN index (FAISS or equivalent)
5. Implement `backend/src/retrieval.py` for `SearchQuery` → `SearchResult[]`
6. Offline evaluation: known queries / recall@k notes in docs or `models/`

### Exit criteria

- [ ] `SearchQuery` with text returns ranked tiles with scores in `[0,1]`
- [ ] Reference-tile and/or image-path query path works
- [ ] Metadata filters (date, cloud, sensor, AOI) applied post/pre search
- [ ] Results serialize via contracts (`to_json`)

### Non-goals

- Frontend live wiring (can stay mock); production auth

---

## Phase 3 — Change analysis & quality aggregation

**Goal:** Produce auditable bi-temporal candidates.

### Scope

1. Implement `backend/src/change.py` for `ChangeQuery` → `ChangeResult[]`
2. Support change types: `CONSTRUCTION`, `CLEARANCE`, `WATER`, `ROAD`
3. Compute / attach full `QualityChecks`
4. Optional change mask + before/after preview paths
5. Define earliest-supported-observation rule and test it on the pilot stack

### Exit criteria

- [ ] T1/T2 (+ optional tile) yields typed candidates with confidence
- [ ] Quality checks always present; overall confidence bucket set
- [ ] Mask or metric evidence path documented even if simplified

### Non-goals

- Full interactive polygon editing; multi-sensor fusion beyond pilot

---

## Phase 4 — API layer & frontend integration

**Goal:** Replace mocks with real HTTP services behind existing interfaces.

### Scope

1. Stand up API (FastAPI recommended) exposing catalog, search, change, review, evidence
2. Implement `Http*Service` classes mirroring mock interfaces
3. Env-based switch: `VITE_API_BASE_URL` / `VITE_USE_MOCKS`
4. Vite proxy or CORS configuration
5. Wire retrieval → change staging → review persistence → evidence fetch
6. Keep mocks available for demos without backend

### Exit criteria

- [ ] Frontend F2/F3/F4 work against API on pilot data
- [ ] ReviewDecision stored server-side and reloadable
- [ ] Evidence dossier endpoint returns contract-compatible payload
- [ ] README / integration.md runbook works on a clean machine

### Non-goals

- Multi-tenant auth; cloud deploy hardening

---

## Phase 5 — Similar sites, temporal, evidence hardening

**Goal:** Complete F5–F7 with real or hybrid data paths.

### Scope

1. Similar-sites ranking (reuse embeddings + geospatial filters)
2. Temporal series from multi-date tile metrics (NDWI/NDVI/built-up proxies)
3. Evidence export (JSON + markdown) with stable audit hash
4. Analyst UX polish: empty states, quality WARN/FAIL visibility, loading/error

### Exit criteria

- [ ] F5–F7 no longer depend solely on static mocks **or** clearly labeled hybrid mode
- [ ] Evidence package verifies hash and includes lineage steps
- [ ] Temporal trajectories align with change candidates for the same AOI

### Non-goals

- Active learning loops; mobile clients

---

## Phase 6 — Evaluation, demo freeze & handoff

**Goal:** SIH/demo-ready, reproducible pilot.

### Scope

1. Fixed demo script (queries, T1/T2 pair, expected narrative)
2. Evaluation notes: retrieval recall, change precision on labeled subset (if available)
3. Performance pass: search latency targets, tile preview caching
4. Docs freeze: PRD/architecture/integration/phases/rules consistent
5. Optional: containerize API + document GPU/CPU modes

### Exit criteria

- [ ] End-to-end demo path documented and rehearsed
- [ ] Known limitations listed (integration.md)
- [ ] No secrets in repo; data bootstrap steps clear
- [ ] Team handoff checklist complete

---

## Phase dependency graph

```text
Phase 0 Foundation
    ↓
Phase 1 Tiling ───────────────┐
    ↓                         │
Phase 2 Retrieval             │
    ↓                         │
Phase 3 Change ←──────────────┘
    ↓
Phase 4 API + Frontend wire-up
    ↓
Phase 5 F5–F7 hardening
    ↓
Phase 6 Demo freeze / handoff
```

Phases 2 and 3 can partially overlap after Phase 1 if staffing allows, but both must consume the same tile IDs.

---

## Suggested team split per phase

| Phase | Frontend | Backend | Models |
|---|---|---|---|
| 0 | UI/mocks | ingest/contracts | — |
| 1 | preview placeholders | tiling/registry | chip export specs |
| 2 | search UX polish | retrieval API prep | embed + index |
| 3 | change UX + QC display | change pipeline | optional learned head |
| 4 | Http services swap | FastAPI + persistence | serve embedder |
| 5 | F5–F7 integration | temporal metrics jobs | similar-site ranking |
| 6 | demo polish | runbooks | eval report |

---

## Tracking

Update checkboxes in this file as exit criteria land. If scope slips, adjust **Non-goals** and the Decision log in [rules.md](./rules.md) rather than silently expanding a phase.

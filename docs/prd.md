# GeoSentinel — Product Requirements Document (PRD)

**Product:** GeoSentinel  
**Tagline:** Semantic Retrieval and Multi-Temporal Change Analysis of Satellite Imagery  
**Document status:** Living baseline (aligned to current repo)  
**Pilot AOI:** Pune Metropolitan Basin & Khadakwasla Watershed (MGRS `43QDF`, Maharashtra, IND)

---

## 1. Problem

Earth-observation (EO) analysts must find relevant satellite scenes and prove land-surface change across dates. Today that work is fragmented:

- Catalog search is keyword/metadata-driven, not semantic (“find me a reservoir with surrounding sugarcane”).
- Change detection tools often hide quality caveats (cloud, shadow, seasonal mismatch, co-registration).
- Evidence packages and analyst decisions are hard to audit across tools.

GeoSentinel unifies **semantic retrieval**, **multi-temporal change analysis**, **human review**, and **evidence provenance** in one analyst workstation.

---

## 2. Goals

### Primary goals

1. Let an analyst retrieve satellite tiles/scenes with natural language or reference imagery.
2. Detect and quantify bi-temporal change for defined change types over a fixed AOI.
3. Surface quality checks so confidence is explicit, not implied.
4. Capture analyst disposition (confirm / reject / flag) with a durable audit trail.
5. Export an evidence dossier suitable for review handoff.

### Non-goals (pilot)

- Full planet-scale catalog hosting or commercial imagery marketplace.
- Real-time streaming / near-real-time tasking of satellites.
- Replacing enterprise GIS platforms (ArcGIS / QGIS plugin ecosystem).
- Ingest of JP2 / SAFE packages in phase 1 (GeoTIFF / COG only).
- Browser-side ML inference for full scenes.

---

## 3. Users & personas

| Persona | Need |
|---|---|
| EO / GIS analyst | Search, compare T1/T2, verify change, export evidence |
| Mission lead / reviewer | Audit dispositions, quality flags, provenance hashes |
| ML / retrieval engineer | Stable contracts for embeddings, ranking, evaluation |
| Backend / data engineer | Deterministic ingest, tiling, registry, APIs |
| Frontend engineer | Workstation UX with mockable service interfaces |

---

## 4. Product modules (F1–F7)

| Key | Module | Job |
|---|---|---|
| F1 | Overview | AOI context, scene inspection, spectral viewport |
| F2 | Semantic Retrieval | NL / reference-image / tile similarity search |
| F3 | Change Analysis | Bi-temporal delta, masks, metrics, quality gates |
| F4 | Analyst Review | Human-in-the-loop disposition on candidates |
| F5 | Similar Sites | Cross-site analog search for lookalike geography |
| F6 | Evidence & Provenance | Audit trail, lineage, exportable dossier |
| F7 | Temporal Analysis | Multi-date trajectories beyond a single T1/T2 pair |

---

## 5. Functional requirements

### 5.1 Scene catalog & AOI

- FR-AOI-1: System supports a defined AOI with bbox (EPSG:4326 display), native UTM CRS, MGRS grid, and area metadata.
- FR-SCN-1: Scenes expose product ID, satellite, sensor, acquisition UTC, cloud/shadow/valid %, bands, processing baseline, relative orbit, CRS.
- FR-SCN-2: Pilot sensors: Sentinel-2A/2B MSI L2A (Landsat types allowed in UI contracts for forward compatibility).

### 5.2 Semantic retrieval

- FR-RET-1: Query by free-text prompt.
- FR-RET-2: Query by reference tile ID or uploaded reference image (backend contract).
- FR-RET-3: Filter by date window, max cloud %, sensor, AOI scope.
- FR-RET-4: Return ranked results with similarity score (0–1), semantic rank, scene + tile identity and bbox.
- FR-RET-5: Retrieval unit of search is the **tile** (not only whole scenes).

### 5.3 Tiling

- FR-TIL-1: Fixed 2560 m × 2560 m tiles anchored to AOI top-left in native UTM.
- FR-TIL-2: At 10 m → 256×256 px; at 20 m → 128×128 px.
- FR-TIL-3: `tile_id = {mgrs_tile}_r{row:03d}_c{col:03d}`; observation = `tile_id + scene_id`.

### 5.4 Change analysis

- FR-CHG-1: Compare baseline (T1) vs comparison (T2) for AOI or single tile.
- FR-CHG-2: Change types (backend): `CONSTRUCTION`, `CLEARANCE`, `WATER`, `ROAD`.
- FR-CHG-3: Return confidence, earliest supporting observation, optional change mask / before-after URLs.
- FR-CHG-4: Attach quality checks: cloud T1/T2, temporal separation, co-registration, scene quality, cloud/shadow screening, snow/haze, seasonal variation, illumination geometry, radiometric consistency, overall confidence (`HIGH` | `MEDIUM` | `LOW`).

### 5.5 Analyst review

- FR-REV-1: Dispositions: `confirmed` | `rejected` | `flagged`.
- FR-REV-2: Reviews are **server-persisted** (not browser-only) with reviewer, UTC timestamp, notes.
- FR-REV-3: Review links to `ChangeResult.id` or `SearchResult.id`.

### 5.6 Similar sites, evidence, temporal

- FR-SIM-1: Rank geographic analogs with semantic / visual / land-cover / hybrid modes.
- FR-EVD-1: Evidence dossier includes finding summary, review record, source scenes, pipeline steps, quality checks, timeline, event log, audit hash.
- FR-TMP-1: Multi-observation metric series (water, vegetation, bare ground, built-up) with interval deltas and quality per date.

### 5.7 Workstation UX

- FR-UX-1: Dense GIS / mission-control chrome (header telemetry + left mission rail + workspace).
- FR-UX-2: Function-key navigation F1–F7.
- FR-UX-3: Spectral display modes: true color, false color NIR, NDVI, change heatmap, spectral split.
- FR-UX-4: Frontend must run on mocks until API is wired (independent team velocity).

---

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Deterministic ingest: same inputs → same accept/reject + fingerprints |
| NFR-2 | Contracts are the integration boundary; field names mirror `frontend/src/types` via camelCase JSON |
| NFR-3 | No secrets in repo; local imagery under `/data/` (gitignored) |
| NFR-4 | TypeScript strict build for frontend; typed Python contracts for backend |
| NFR-5 | Pilot quality policy for SCL is single-sourced in ingest (do not fork definitions) |
| NFR-6 | Analyst decisions must be auditable and exportable |
| NFR-7 | Offline-capable demo via mocks for SIH / demo environments |

---

## 7. Success metrics (pilot)

1. Analyst can complete search → change → review → evidence export without leaving the workstation.
2. ≥1 AOI with multi-date Sentinel-2 L2A stack ingested and registered.
3. Retrieval returns ranked tiles with stable IDs usable by change analysis.
4. Change candidates include quality checks and confidence bucket.
5. Mock→API switch requires service implementation swap only (no page rewrites).

---

## 8. Constraints & assumptions

- Pilot imagery format: GeoTIFF / COG only.
- Display CRS for map overlays: EPSG:4326; processing CRS: native UTM (e.g. EPSG:32643).
- SCL clear-surface policy: valid = vegetation + not-vegetated + water only.
- Models folder / embedding index may live outside git (large artifacts gitignored: `*.npy`, `*.faiss`).
- Team can develop frontend and backend in parallel against `contracts.py` + TypeScript types.

---

## 9. Out-of-scope backlog (post-pilot)

- SAFE/JP2 ingest, STAC-native catalog sync, multi-AOI federation.
- Active learning from analyst dispositions into retrieval ranking.
- Full vector change polygons with topology editing.
- Multi-user auth / RBAC / org tenancy.

---

## 10. Related docs

- [architecture.md](./architecture.md) — system design
- [integration.md](./integration.md) — APIs, models, tooling, setup
- [phases.md](./phases.md) — delivery phases
- [rules.md](./rules.md) — permanent project rules & constraints

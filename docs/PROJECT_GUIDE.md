> **GeoSentinel Project Guide**
>
> A developer onboarding and technical walkthrough for the GeoSentinel satellite imagery retrieval and multi-temporal change analysis platform.

- **Last verified date:** 2026-10-03
- **Repository:** https://github.com/Praveen-215/geosentinel
- **Current branch:** `main`
- **Current baseline commit:** `6c3c7d0`

---

## Table of Contents

1. [GeoSentinel at a Glance](#1-geosentinel-at-a-glance)
2. [The Core Idea](#2-the-core-idea)
3. [Current Project Status](#3-current-project-status)
4. [Repository Structure](#4-repository-structure)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Backend Architecture](#6-backend-architecture)
7. [Contracts / Data Flow](#7-contracts--data-flow)
8. [Satellite Data Pipeline](#8-satellite-data-pipeline)
9. [Ingestion](#9-ingestion)
10. [Tiling](#10-tiling)
11. [Semantic Retrieval](#11-semantic-retrieval)
12. [Raster Chip Loading](#12-raster-chip-loading)
13. [Multi-Temporal Change Analysis](#13-multi-temporal-change-analysis)
14. [Pune Demo Scenario](#14-pune-demo-scenario)
15. [How to Set Up the Project](#15-how-to-set-up-the-project)
16. [How to Run the Project](#16-how-to-run-the-project)
17. [Environment Variables](#17-environment-variables)
18. [Data Directory](#18-data-directory)
19. [How a New Developer Should Explore the Code](#19-how-a-new-developer-should-explore-the-code)
20. [How the Pieces Connect](#20-how-the-pieces-connect)
21. [Git / Team Workflow](#21-git--team-workflow)
22. [Current Work Split](#22-current-work-split)
23. [What Is Finished vs What Is Left](#23-what-is-finished-vs-what-is-left)
24. [Common Mistakes / Things to Know](#24-common-mistakes--things-to-know)
25. [Troubleshooting](#25-troubleshooting)
26. [Glossary](#26-glossary)
27. [Quick Start for a New Teammate](#27-quick-start-for-a-new-teammate)

---

# 1. GeoSentinel at a Glance

### Project Name
**GeoSentinel** (repository historically identified as `sentinental` or `geosentinel`).

### Problem Statement
> **"Semantic Retrieval and Multi-Temporal Change Analysis of Satellite Imagery"**

### What GeoSentinel Is
GeoSentinel is an Earth Observation (EO) intelligence workstation and processing pipeline designed to make satellite imagery searchable via natural language and to detect, quantify, and audit physical land-cover changes across time.

### What Problem It Solves
Traditional remote sensing workflows require GIS specialists to manually search scenes by acquisition date, sensor ID, and cloud percentage, then download gigabytes of imagery, open desktop software (such as QGIS or ArcGIS), construct spectral band ratios (like NDVI or NDWI), and visually scan thousands of square kilometers. 

GeoSentinel transforms this process:
1. **Natural-language semantic retrieval:** An analyst can type plain text queries (e.g., *"reservoir with receding water line"* or *"cleared vegetation near river bend"*) or supply reference image chips to instantly surface relevant geographic tiles across years of imagery.
2. **Automated change detection with quality screening:** The system automatically pairs multi-temporal observations, calculates spectral deltas, filters out atmospheric artifacts (clouds, cloud shadows, cirrus), and reports candidate changes with confidence scores.
3. **Auditability and provenance:** Rather than black-box AI predictions, every detected change is anchored to immutable scene metadata, verifiable raster processing steps, and human-in-the-loop analyst decisions.

### Who the Intended User Is
- **EO & GIS Intelligence Analysts:** Conducting environmental change investigations, infrastructure auditing, and natural resource tracking.
- **Disaster Response & Watershed Authorities:** Monitoring reservoir depletion, flood inundation, or storm damage across regional catchments.
- **Urban & Forestry Monitors:** Detecting illegal land clearing, quarrying, or unauthorized construction.

### What the Analyst Can Do
1. **Search:** Query cataloged satellite imagery using semantic prompts, date windows, and cloud-cover thresholds.
2. **Discover Analog Sites:** Find geographically distant locations sharing similar spectral and land-cover signatures.
3. **Compare Multi-Temporal Scenes:** Conduct bi-temporal ($T_1$ vs. $T_2$) spectral analysis with automated cloud-shadow and valid-pixel masking.
4. **Audit Change Trajectories:** Examine longitudinal time-series (multi-date sequences) to determine the exact **Earliest Supported Observation** of a physical change.
5. **Adjudicate Findings:** Review candidate detections in a dedicated review console and record binding dispositions (`confirmed`, `rejected`, `flagged`).
6. **Export Evidence:** Generate machine-readable JSON dossiers and Markdown summaries with traceable processing lineage.

### High-Level Workflow
```text
Raw Sentinel-2 L2A Rasters + Scene Catalog + AOI GeoJSON
                     │
                     ▼
       Deterministic Ingestion & Validation
           (ingest.py -> SQLite Registry)
                     │
                     ▼
           Deterministic 2560m Tiling
          (tiling.py -> Tile Observations)
                     │
                     ▼
         Semantic Embedding & Indexing
          (OpenCLIP + FAISS Vector Store)
                     │
                     ▼
   Analyst Workstation (React / TS Frontend F1–F7)
  [F1 Overview] ──> [F2 Semantic Search] ──> [F5 Similar Sites]
                            │
                            ▼
                  [F3 Change Analysis]
                            │
                            ▼
                  [F7 Temporal Series]
                            │
                            ▼
                  [F4 Analyst Review]
                            │
                            ▼
              [F6 Evidence & Provenance]
```

### Current Implementation Status
- **Frontend (F1–F7):** Fully implemented, interactive, and styled with a professional dark GIS theme. Currently backed by mock services and an interactive local synthetic SVG imagery canvas (`ImageryViewport.tsx`).
- **Backend Data Contracts:** Complete dataclass models defined in `backend/contracts.py` with automatic `to_json()` conversion matching frontend camelCase types.
- **Ingestion Pipeline:** Fully implemented in `backend/src/ingest.py`, validating Sentinel-2 L2A GeoTIFFs, enforcing SCL cloud/shadow/valid pixel policies, calculating SHA-256 fingerprints, and populating the SQLite registry.
- **Tiling Pipeline:** Fully implemented in `backend/src/tiling.py`, generating deterministic 2560 m × 2560 m grids in native UTM projection, storing `Tile` records and per-scene `ChipRecipe` window configurations.
- **Retrieval Architecture:** Foundation implemented in `backend/src/retrieval.py`, including `RasterChipLoader` for natural color RGB extraction and normalization, metadata candidate filtering, and interface boundaries for OpenCLIP and FAISS.
- **Actual ML Execution & Change Detection Engine:** Planned. Deep learning model inference (`torch`, `open-clip-torch`), real FAISS index building, bi-temporal pixel differencing (`backend/src/change.py`), and the FastAPI HTTP service are scheduled for upcoming development phases.

---

# 2. The Core Idea

GeoSentinel's core architectural principle is that **scenes are delivery envelopes, but spatial tiles are the atoms of retrieval and analysis**.

```text
Satellite Imagery (Sentinel-2 L2A)
  └── Scene (100 km × 100 km acquisition envelope)
        └── Spatial Tiles (Fixed 2560 m × 2560 m ground squares)
              └── Tile Observation (Tile + Scene at time t)
                    └── Chip / Recipe (256 × 256 px window of B04, B03, B02, etc.)
                          └── Embedding (Dense vector in multimodal semantic space)
                                └── Retrieval (Ranked nearest-neighbor matches)
                                      └── Temporal Comparison (Pairwise T1/T2 analysis)
                                            └── Change Detection (Indices + SCL masking)
                                                  └── Analyst Review (Human adjudication)
                                                        └── Evidence Dossier (Audit trail)
```

### Why Use Tiles as Retrieval Atoms Instead of Only Scenes?

1. **Scale Mismatch:** A single Sentinel-2 MGRS scene covers $100\text{ km} \times 100\text{ km}$ ($10,000\text{ km}^2$), consisting of over 100 megapixels per 10-meter band. An analyst searching for *"cleared forest patch"* or *"receding water reservoir"* is looking for a local feature spanning a few hundred meters to a few square kilometers. If you compress a $10,000\text{ km}^2$ image into a single embedding vector, localized features vanish into background averages.
2. **Fixed Ground Alignment:** Scenes shift slightly between orbits and across sensors (Sentinel-2A vs. Sentinel-2B). By defining a static spatial tile grid anchored to the Area of Interest (AOI) in native UTM coordinates, the same physical $2560\text{ m} \times 2560\text{ m}$ patch of ground retains the exact same ID (`{mgrs}_r{row}_c{col}`) across every acquisition date.
3. **Native Vision Model Resolution:** At 10-meter ground sample distance (GSD), a 2560 m tile is exactly $256 \times 256$ pixels. This matches standard vision-transformer and dual-encoder input dimensions (e.g., CLIP / SigLIP) without requiring downsampling or lossy interpolation.
4. **Focused Anomaly Isolation:** When change occurs, the analyst can pinpoint, flag, and review individual 2.5 km tiles rather than disqualifying or approving an entire $10,000\text{ km}^2$ scene.

### Key Domain Concepts and Relationships

| Concept | Definition | Concrete Example from Repository |
|---|---|---|
| **AOI** | Area of Interest. The polygon boundary enclosing the geographic mission. | `AOI-MAHARASHTRA-PUNE-METRO` (Pune Basin & Khadakwasla Watershed) |
| **Scene** | A single satellite acquisition product covering an MGRS tile at a specific timestamp. | `S2B_MSIL2A_20250515T051859_N0510_R019_T43QDF` (15 May 2025) |
| **Tile** | A static 2560m × 2560m square of ground, invariant across time. | `43QDF_r000_c000` (Row 0, Col 0 in native UTM EPSG:32643) |
| **Tile Observation** | The observation of a specific `Tile` within a specific `Scene` at time $t$. | Pair: `(43QDF_r000_c000, S2B_..._20250515...)` |
| **Chip / Chip Recipe** | The pixel array or pixel-extraction recipe specifying band paths, offsets, and window size. | `B04`: `row_off=0, col_off=0, height=256, width=256` |
| **Embedding** | Normalized float vector capturing visual/semantic features in shared text-image space. | 512-dim vector produced from normalized RGB chip via OpenCLIP |
| **Search Result** | Ranked tile candidate returned for a text prompt or reference image. | `SearchResult` with `similarity_score=0.912`, `tile_id="43QDF_r001_c002"` |
| **Change Result** | Evaluated spectral delta between two tile observations ($T_1$ vs. $T_2$) with quality checks. | `ChangeResult` with `change_type="WATER"`, `confidence=0.94` |
| **Investigation** | An analyst mission case tracking a geographic phenomenon across time. | `INV-2025-PUNE-001` (Khadakwasla Reservoir Monsoonal Expansion) |
| **Review** | Human adjudication of a detected change candidate. | `ReviewDecision` with `disposition="confirmed"`, notes, and timestamp |
| **Evidence** | An auditable, exportable record containing lineage, quality gates, and event logs. | `EVPKG-2025-0921-01` (Dossier JSON / Markdown) |

---

# 3. Current Project Status

The following table details the implementation status across all subsystems.

| Component | Status | Location | Notes |
|---|---|---|---|
| **Frontend Workstation** | ✅ IMPLEMENTED | `frontend/` | React 18, Vite (port 3000), TypeScript, strict types pass cleanly |
| **F1 — Workspace / Overview** | ✅ IMPLEMENTED | `frontend/src/pages/WorkspacePage.tsx` | Mission stats, scene inspection, active AOI banner, metric cards |
| **F2 — Semantic Retrieval UI** | ✅ IMPLEMENTED | `frontend/src/pages/SemanticRetrievalPage.tsx` | Prompt input, reference chips, cloud/date/sensor filters, rank sorting |
| **F3 — Change Analysis UI** | ✅ IMPLEMENTED | `frontend/src/pages/ChangeAnalysisPage.tsx` | Baseline (T1) vs Comparison (T2), spectral metrics, quality gates |
| **F4 — Analyst Review UI** | ✅ IMPLEMENTED | `frontend/src/pages/AnalystReviewPage.tsx` | Disposition controls (`confirmed`/`rejected`/`flagged`), notes, checklist |
| **F5 — Similar Site Discovery UI**| ✅ IMPLEMENTED | `frontend/src/pages/SimilarSitesPage.tsx` | Cross-catalog analog ranking, land-cover signature matching |
| **F6 — Evidence & Provenance UI**| ✅ IMPLEMENTED | `frontend/src/pages/EvidenceProvenancePage.tsx` | Lineage visualization, 12-event audit log, JSON/MD export |
| **F7 — Multi-Temporal UI** | ✅ IMPLEMENTED | `frontend/src/pages/TemporalAnalysisPage.tsx` | 5-date series, NDWI curve, interval rate analysis, earliest observation |
| **Frontend Mock Services** | ✅ IMPLEMENTED | `frontend/src/services/` | Realistic async delay, complete contract compliance, offline-ready |
| **Frontend Synthetic Viewport** | ✅ IMPLEMENTED | `frontend/src/components/ImageryViewport.tsx` | Synthetic SVG EO canvas: TCI, FCIR, NDVI, Change Heatmap |
| **Backend Contracts** | ✅ IMPLEMENTED | `backend/contracts.py` | Authoritative dataclasses, `to_json()` snake_case to camelCase bridge |
| **Scene Ingestion** | ✅ IMPLEMENTED | `backend/src/ingest.py` | L2A GeoTIFF validation, CRS check, SHA-256 asset fingerprinting |
| **SQLite Registry** | ✅ IMPLEMENTED | `backend/src/ingest.py` | Tables: `scenes`, `tiles`, `tile_observations` schema definitions |
| **Deterministic Tiling** | ✅ IMPLEMENTED | `backend/src/tiling.py` | 2560m UTM grid, window recipes per band, 10 Phase 1 validation checks |
| **Chip Recipes** | ✅ IMPLEMENTED | `backend/src/tiling.py` | Generates per-band JSON recipes with absolute paths & window offsets |
| **Raster Chip Loading** | ✅ IMPLEMENTED | `backend/src/retrieval.py` | `RasterChipLoader` reading B04/B03/B02, 2nd-98th percentile normalization |
| **Retrieval Architecture** | ✅ IMPLEMENTED | `backend/src/retrieval.py` | Candidate query, metadata filtering, `RetrievalEngine` workflow |
| **OpenCLIP Integration** | 🟡 PARTIAL (Foundation) | `backend/src/retrieval.py` | Interface & lazy loader implemented; inference requires installed weights |
| **FAISS Integration** | 🟡 PARTIAL (Foundation) | `backend/src/retrieval.py` | `FaissIndex` class and mapping implemented; index file building pending |
| **Actual Embedding Generation** | ⬜ PLANNED | `backend/src/retrieval.py` | Batch embedding generation of tile observations to `data/embeddings/` |
| **Actual Semantic Retrieval** | 🟡 PARTIAL (Foundation) | `backend/src/retrieval.py` | Code structure complete; waiting on vector index and ML weights |
| **Retrieval Evaluation** | ⬜ PLANNED | `models/` | Recall@K, precision metrics on labeled validation queries |
| **Change Detection Backend** | ⬜ PLANNED | `backend/src/change.py` | File currently empty (0 bytes); spectral differencing & masking planned |
| **Temporal Analysis Backend** | ⬜ PLANNED | `backend/src/` | Automated multi-date trajectory fitting and earliest-observation audit |
| **FastAPI / Backend REST API** | ⬜ PLANNED | `backend/` | Target endpoints: `/scenes`, `/search`, `/change`, `/reviews`, `/evidence` |
| **Review Persistence** | 🟡 PARTIAL | `frontend/src/services/reviewService.ts` | Local mock session storage working; backend DB persistence planned |
| **Evidence Generation** | 🟡 PARTIAL | `frontend/src/services/evidenceService.ts` | JSON/Markdown generation active; backend cryptographic hashing planned |
| **Similar-Site Backend** | ⬜ PLANNED | `backend/src/` | Cross-tile vector similarity search across catalogs |
| **Frontend Live API Integration**| 🟡 PARTIAL | `frontend/.env.example` | Integration seam defined (`VITE_USE_MOCKS`), HTTP client classes pending |
| **End-to-End Integration** | ⬜ PLANNED | Full Stack | Scheduled for Phase 4 |

---

# 4. Repository Structure

Below is the repository tree highlighting the files that developers need to know:

```text
geosentinel/
├── README.md                      # Project overview and quickstart pointers
├── .gitignore                     # Ignores large rasters, .venv, node_modules, data/
├── backend/                       # Python data processing and ML pipelines
│   ├── contracts.py               # Shared data contracts (source of truth)
│   ├── requirements.txt           # Python dependencies (Phase 0/1 active, Phase 2+ commented)
│   └── src/
│       ├── ingest.py              # Sentinel-2 L2A ingest, SCL quality check, SQLite registry
│       ├── tiling.py              # Deterministic 2560m UTM tiling and chip window recipes
│       ├── retrieval.py           # Phase 2 retrieval foundation, RasterChipLoader, FAISS boundary
│       └── change.py              # Phase 3 change detection (placeholder, currently empty)
├── frontend/                      # React 18 + TypeScript analyst workstation
│   ├── .env.example               # Environment template (VITE_USE_MOCKS, VITE_API_BASE_URL)
│   ├── package.json               # Frontend dependencies (React, Lucide, Vite)
│   ├── tsconfig.json              # Strict TypeScript compiler configuration
│   ├── vite.config.ts             # Vite dev server configuration (port 3000)
│   └── src/
│       ├── main.tsx               # DOM mount entry point
│       ├── App.tsx                # Central state, F1–F7 keyboard shortcuts, cross-module handoffs
│       ├── pages/                 # Mission modules (F1–F7)
│       │   ├── WorkspacePage.tsx          # F1: Mission overview and scene browser
│       │   ├── SemanticRetrievalPage.tsx  # F2: Semantic search and candidate ranking
│       │   ├── ChangeAnalysisPage.tsx     # F3: Bi-temporal change detection and QC
│       │   ├── AnalystReviewPage.tsx      # F4: Human-in-the-loop review and disposition
│       │   ├── SimilarSitesPage.tsx       # F5: Cross-catalog analog site discovery
│       │   ├── EvidenceProvenancePage.tsx # F6: Evidence dossier and audit trail
│       │   └── TemporalAnalysisPage.tsx   # F7: Multi-temporal trajectory analysis
│       ├── components/            # Reusable UI components
│       │   ├── ImageryViewport.tsx        # High-fidelity synthetic SVG EO canvas
│       │   ├── MetadataPanel.tsx          # Technical scene and sensor metadata drawer
│       │   ├── Header.tsx                 # Workstation top bar and AOI alert level
│       │   ├── Sidebar.tsx                # Mission navigation bar
│       │   ├── SceneThumbnail.tsx         # Interactive scene card thumbnail
│       │   └── ModuleStandby.tsx          # Standby state placeholder
│       ├── services/              # Service abstraction layer (interfaces + mocks)
│       │   ├── retrievalService.ts        # Semantic search service interface
│       │   ├── changeAnalysisService.ts   # Bi-temporal change service interface
│       │   ├── reviewService.ts           # Analyst review and export service interface
│       │   ├── similarSitesService.ts     # Analog site discovery service interface
│       │   ├── evidenceService.ts         # Evidence dossier service interface
│       │   └── temporalAnalysisService.ts # Multi-temporal series service interface
│       ├── types/
│       │   └── index.ts                   # Authoritative TypeScript types aligned with contracts.py
│       ├── data/                  # Static mock catalogs for offline workstation development
│       │   ├── mockScenes.ts              # Pune pilot scenes and spectral metadata
│       │   ├── mockSimilarSites.ts        # Analog sites across Indian catchments
│       │   ├── mockEvidence.ts            # Audit log events and dossier structures
│       │   └── mockTemporal.ts            # 5-date monsoonal observation series
│       └── styles/
│           └── globals.css                # Custom GIS dark theme and tactical styling
├── docs/                          # Comprehensive product and technical specifications
│   ├── PROJECT_GUIDE.md           # This master onboarding guide
│   ├── prd.md                     # Product requirements document
│   ├── architecture.md            # System design and architecture specification
│   ├── integration.md             # Integration runbooks, APIs, and directory setup
│   ├── phases.md                  # Detailed phased delivery milestones
│   └── rules.md                   # Normative engineering rules, constraints, and decision log
├── models/                        # Model artifacts, checkpoints, and export scripts (gitignored)
└── data/                          # Local data directory (gitignored, see Section 18)
```

---

# 5. Frontend Architecture

### Technology Stack
- **Framework:** React 18 (Functional components, Hooks)
- **Language:** TypeScript (`strict: true`)
- **Build Tool / Dev Server:** Vite running on `http://localhost:3000`
- **Iconography:** Lucide React
- **Styling:** Vanilla CSS (`frontend/src/styles/globals.css`) structured with custom CSS variables for a high-density, low-light GIS command console.

### Entry Point and Routing
The application entry point is `frontend/src/main.tsx`, mounting `frontend/src/App.tsx`. 
Routing is managed internally within `App.tsx` via the `activeSection` state (`overview`, `retrieval`, `change-analysis`, `review`, `similar-sites`, `evidence`, `temporal`).

Developers and analysts can switch between modules either by clicking the left `Sidebar` or pressing function keys **F1 through F7** anywhere in the application.

```ts
// Global Function Key Mapping in App.tsx
F1 -> Workspace / Overview ('overview')
F2 -> Semantic Retrieval ('retrieval')
F3 -> Change Analysis ('change-analysis')
F4 -> Analyst Review ('review')
F5 -> Similar Sites ('similar-sites')
F6 -> Evidence & Provenance ('evidence')
F7 -> Multi-Temporal Analysis ('temporal')
```

### Module Breakdown (F1–F7)

#### F1 — Workspace / Overview (`WorkspacePage.tsx`)
- **Purpose:** Central mission hub providing satellite health, active AOI boundaries, registered scene catalog, and key observation metrics.
- **Inputs:** `currentAoi`, `currentScene`, `allScenes`, `changeMetrics`.
- **Outputs:** Switches active scene; opens F2 Semantic Retrieval.
- **Handoffs:** Clicking "Launch Retrieval" transitions to F2.
- **Data Source:** `mockScenes.ts` via component props.

#### F2 — Semantic Retrieval (`SemanticRetrievalPage.tsx`)
- **Purpose:** Natural language and image-to-image satellite search engine.
- **Inputs:** Query text, date ranges, max cloud cover, sensor selection, similarity threshold.
- **Outputs:** Ranked `SearchResult[]` items with similarity scores, semantic ranks, and scene metadata.
- **Handoffs:** Clicking "Stage for Comparison" assigns the target scene as `comparisonScene` in `App.tsx` and navigates directly to F3 Change Analysis. Clicking "Find Similar Sites" navigates to F5.
- **Data Source:** `retrievalService.ts` (currently `MockRetrievalService`).

#### F3 — Change Analysis (`ChangeAnalysisPage.tsx`)
- **Purpose:** Bi-temporal spectral change detection and quality assessment console.
- **Inputs:** `currentAoi`, baseline scene ($T_1$), comparison scene ($T_2$).
- **Outputs:** Spectral delta calculations (NDWI, NDVI, built-up, bare soil), anomaly scores, 14 automated `QualityChecks`.
- **Handoffs:** Clicking "Queue for Review" bundles the current findings into an `AnalystReviewPackage` and transitions to F4 Analyst Review.
- **Data Source:** `changeAnalysisService.ts` (currently `MockChangeAnalysisService`).

#### F4 — Analyst Review (`AnalystReviewPage.tsx`)
- **Purpose:** Human-in-the-loop review console for adjudicating candidate detections before operational dissemination.
- **Inputs:** `stagedReviewPackage` (passed from F3) or default canonical review package.
- **Outputs:** `ReviewDecision` record (`confirmed`, `rejected`, `flagged`), analyst justification notes, and JSON package export.
- **Handoffs:** Direct navigation to F6 Evidence & Provenance to inspect audit trails.
- **Data Source:** `reviewService.ts` (currently `MockReviewService`).

#### F5 — Similar Site Discovery (`SimilarSitesPage.tsx`)
- **Purpose:** Geographic analog discovery finding locations with matching spectral and land-cover signatures.
- **Inputs:** Reference site signature, distance radius filter, similarity threshold.
- **Outputs:** Ranked analog sites (e.g., Ujjani Reservoir, Koyna Reservoir, Pavana Lake).
- **Handoffs:** Clicking "Stage for Comparison" converts the analog site into a `SatelliteScene` and jumps to F3 Change Analysis.
- **Data Source:** `similarSitesService.ts` (currently `MockSimilarSitesService`).

#### F6 — Evidence & Provenance (`EvidenceProvenancePage.tsx`)
- **Purpose:** Auditable intelligence evidence workstation showing data lineage, sensor metadata, and processing history.
- **Inputs:** Active investigation context (`INV-2025-PUNE-001`).
- **Outputs:** Verifiable event timeline (12 sequential stages), pipeline verification checklist, formatted Markdown intelligence report, and JSON dossier.
- **Status Communicated:** Clearly displays `DEMO / LOCAL MOCK VERIFIED` and `REAL PROVENANCE PIPELINE PENDING` badges to prevent false claims of cryptographic security in mock mode.
- **Data Source:** `evidenceService.ts` (currently `MockEvidenceService`).

#### F7 — Multi-Temporal Analysis (`TemporalAnalysisPage.tsx`)
- **Purpose:** Multi-date trajectory workstation for longitudinal change evolution analysis.
- **Inputs:** 5-date monsoonal observation sequence (May to September 2025).
- **Outputs:** NDWI water extent progression curve, inter-observation rate-of-change metrics ($+0.187\text{ km}^2/\text{day}$ surge), evolution phase tracking, and formal audit of the **Earliest Supported Observation** (18 JUN 2025).
- **Handoffs:** Clicking "Stage for Comparison" on any observation sends that scene to F3 for detailed bi-temporal differencing.
- **Data Source:** `temporalAnalysisService.ts` (currently `MockTemporalAnalysisService`).

### The Synthetic Viewport (`ImageryViewport.tsx`)
Because GeoSentinel is designed for air-gapped or offline demonstration without requiring external map tile servers or Mapbox/Google API keys, the workstation includes a **custom SVG Earth Observation canvas**:
- **Bands & Render Modes:** True Color (TCI / RGB), False Color Infrared (FCIR / NIR-Red-Green), NDVI vegetation health, and Change Heatmap.
- **Interactive Controls:** Smooth pan, zoom, scale bar, crosshair coordinate readouts (Latitude, Longitude, and MGRS grid), and animated delta sweeps.

### How Frontend Obtains Data (Now vs. Future)
- **Current Mode:** All pages import service singletons (`retrievalService`, `changeAnalysisService`, `reviewService`, etc.). These singletons instantiate mock classes that simulate network latency (80–450 ms) and return realistic, contract-compliant mock data.
- **Future Live Mode:** Under Phase 4, developer implementations of `HttpRetrievalService`, `HttpChangeService`, etc., will implement the identical TypeScript interfaces, querying the FastAPI backend at `VITE_API_BASE_URL` when `VITE_USE_MOCKS=false`.

---

# 6. Backend Architecture

The backend consists of Python 3 pipelines structured around deterministic spatial processing, immutable contracts, and SQLite metadata indexing.

```text
backend/
├── contracts.py       # Shared DTO dataclasses & serialization
└── src/
    ├── ingest.py      # Scene ingestion, SCL verification, SQLite catalog
    ├── tiling.py      # Fixed 2560m UTM grid generation & window recipes
    ├── retrieval.py   # Retrieval engine, chip loading, FAISS/OpenCLIP boundaries
    └── change.py      # Bi-temporal change detection (Phase 3 placeholder)
```

### Module Responsibilities

#### 1. `backend/contracts.py`
The architectural bridge between backend and frontend. Contains standard Python dataclasses:
- Defines controlled vocabularies: `CHANGE_TYPES`, `CHECK_STATUS`, `CONFIDENCE_BUCKETS`, `DISPOSITIONS`.
- Dataclasses: `BoundingBox`, `Scene`, `Tile`, `SearchQuery`, `SearchResult`, `QualityChecks`, `ChangeQuery`, `ChangeResult`, `ReviewDecision`.
- Serialization helper `to_json()`: Recursively converts Python `snake_case` attributes into `camelCase` keys matching frontend TypeScript interfaces.

#### 2. `backend/src/ingest.py`
The ingest and validation pipeline for raw Sentinel-2 L2A data:
- Consumes: `scenes.csv`, `aoi.geojson`, and a directory of GeoTIFF band rasters.
- Enforces band requirements: Requires 10 bands (`B02`, `B03`, `B04`, `B05`, `B06`, `B07`, `B08`, `B11`, `B12`, `SCL`).
- Validates raster metadata: CRS compatibility, native resolution (10m vs. 20m), and spatial intersection with AOI.
- Evaluates SCL quality policy: Computes clear surface percentage (classes 4, 5, 6), cloud percentage (classes 8, 9, 10), and cloud shadow percentage (class 3).
- Generates SHA-256 cryptographic fingerprints for accepted GeoTIFF band files.
- Persists accepted metadata into the `scenes` table of the SQLite registry database.

#### 3. `backend/src/tiling.py`
Deterministic tiling engine for Phase 1:
- Consumes: The SQLite registry populated by `ingest.py`, `aoi.geojson`, and scene rasters.
- Generates a spatial grid: Fixed $2560\text{ m} \times 2560\text{ m}$ square tiles anchored to the top-left corner of the AOI bounding envelope in native UTM projection (EPSG:32643).
- Formats tile IDs: `{mgrs_tile}_r{row:03d}_c{col:03d}` (e.g., `43QDF_r000_c000`).
- Generates `ChipRecipe` configurations: Calculates pixel window offsets (`row_off`, `col_off`, `height`, `width`) for 10m ($256 \times 256$) and 20m ($128 \times 128$) bands.
- Validates raster existence and CRS bounds without reading full pixel arrays.
- Persists records into SQLite `tiles` and `tile_observations` tables.

#### 4. `backend/src/retrieval.py`
Phase 2 semantic retrieval foundation:
- `RetrievalRegistry`: Reads candidates from SQLite matching metadata filters (`aoi_id`, `start_date`, `end_date`, `sensor`, `max_cloud_percent`).
- `RasterChipLoader`: Reads exact window slices from B04 (Red), B03 (Green), and B02 (Blue) GeoTIFFs, applying 2nd/98th percentile robust normalization to yield $(256, 256, 3)$ float32 RGB arrays in $[0.0, 1.0]$.
- `OpenCLIPProvider`: Interface boundary for vision-language dual encoders (defaults to `open_clip:ViT-B-32`). Handles lazy import of PyTorch/OpenCLIP so the rest of the backend runs without heavy ML dependencies installed.
- `FaissIndex`: Wraps FAISS `IndexFlatIP` inner-product search and sidecar JSON ID mapping.
- `RetrievalEngine`: Coordinates query vector creation, metadata candidate pre-filtering, index search, and cosine score normalization to $[0.0, 1.0]$.
- Self-test CLI: Contains `test_raster_chip_loader()` for deterministic verification using synthetic in-memory GeoTIFFs.

#### 5. `backend/src/change.py`
Phase 3 change detection module (currently 0 bytes). Intended for bi-temporal pixel differencing, spectral band ratios (NDVI, NDWI, NDBI), valid pixel SCL masking, confidence scoring, and candidate extraction.

---

# 7. Contracts / Data Flow

The data contract is the **single source of truth** for communication between the backend pipelines, API server, and frontend client.

### Source-of-Truth Contract Files
- Backend: [`backend/contracts.py`](file:///Users/praveenkumarjha/Desktop/PROJECTS/geosentinel/backend/contracts.py)
- Frontend: [`frontend/src/types/index.ts`](file:///Users/praveenkumarjha/Desktop/PROJECTS/geosentinel/frontend/src/types/index.ts)

### Naming Conventions and Serialisation
- **Backend Internal:** Python `snake_case` (e.g., `tile_id`, `cloud_cover_percent`, `similarity_score`).
- **Frontend / Wire Format:** JSON `camelCase` (e.g., `tileId`, `cloudCoverPercent`, `similarityScore`).
- **Conversion:** Handled transparently by `to_json()` in `backend/contracts.py`.
- **Timestamps:** ISO 8601 UTC strings (e.g., `2025-05-15T05:18:59Z`).
- **Score Ranges:** Similarity scores and confidence values are floats normalized to `[0.0, 1.0]`. Cloud, shadow, and valid pixel metrics are percentages in `[0.0, 100.0]`.

### Controlled Vocabularies

```python
CHANGE_TYPES = ("CONSTRUCTION", "CLEARANCE", "WATER", "ROAD")
CHECK_STATUS = ("PASS", "WARN", "FAIL")
CONFIDENCE_BUCKETS = ("HIGH", "MEDIUM", "LOW")
DISPOSITIONS = ("confirmed", "rejected", "flagged")
```

### End-to-End Data Flows

#### Flow 1: Semantic Retrieval
```text
Analyst enters prompt: "Khadakwasla reservoir with receding water"
  │
  ▼
Frontend creates SearchQuery payload (camelCase):
  { "text": "Khadakwasla reservoir...", "aoiId": "AOI-MAHARASHTRA-PUNE-METRO", "topK": 20 }
  │
  ▼  [HTTP POST /search] (Planned API)
Backend receives SearchQuery:
  1. RetrievalRegistry queries candidates matching AOI and date/cloud filters.
  2. EmbeddingProvider encodes text query into 512-dim unit vector.
  3. FaissIndex conducts inner-product search against indexed tile embeddings.
  4. Scores are mapped to [0, 1] and wrapped in SearchResult dataclasses.
  │
  ▼  to_json(results) converts snake_case -> camelCase
HTTP 200 OK: SearchResult[]
  [
    {
      "id": "retrieval-S2B_...-43QDF_r000_c000",
      "sceneId": "S2B_MSIL2A_20250515T051859_N0510_R019_T43QDF",
      "tileId": "43QDF_r000_c000",
      "similarityScore": 0.9124,
      "semanticRank": 1,
      "scene": { ... }
    }
  ]
  │
  ▼
Frontend SemanticRetrievalPage renders ranked tile cards with similarity badges.
```

#### Flow 2: Change Analysis & Review
```text
Analyst selects Baseline T1 (15 MAY 2025) and Comparison T2 (21 SEP 2025)
  │
  ▼
Frontend triggers ChangeQuery:
  { "aoiId": "AOI-MAHARASHTRA-PUNE-METRO", "startDate": "2025-05-15", "endDate": "2025-09-21" }
  │
  ▼  [HTTP POST /change] (Planned API)
Backend Change Engine (Planned):
  1. Loads band windows for T1 and T2 using ChipRecipe.
  2. Applies SCL mask (classes 4, 5, 6 clear surface; classes 3, 8, 9, 10 masked).
  3. Computes spectral deltas (NDWI delta for water expansion).
  4. Runs 14 QualityChecks (co-registration, shadow cover, radiometric consistency).
  5. Emits ChangeResult with confidence 0.94 and earliest supported observation.
  │
  ▼
Frontend ChangeAnalysisPage displays delta cards and PASS/WARN status.
  │
  ▼  Analyst clicks "Queue for Review" -> F4 AnalystReviewPage
Analyst inspects evidence, selects disposition: "confirmed", enters notes.
  │
  ▼  [HTTP POST /reviews] (Planned API)
Backend persists ReviewDecision in database.
```

---

# 8. Satellite Data Pipeline

The following diagram illustrates the complete data transformation lifecycle from raw Sentinel-2 L2A granules to analyst decisions.

```text
[1] AOI Definition (data/aoi/aoi.geojson)
        │
[2] Scene Catalog (data/catalogs/scenes.csv)
        │
[3] Imagery Assets (data/imagery/<product_id>/*.tif)
        │
        ▼
[4] Ingest & Validation (ingest.py) ───────────────────────────────────┐
        │                                                              │
        │ • Validates CRS & 10m/20m resolutions                        │
        │ • Computes SCL clear surface % (classes 4,5,6)               │
        │ • Computes SCL cloud % (8,9,10) & shadow % (3)               │
        │ • Calculates SHA-256 hash per band file                      │
        ▼                                                              ▼
[5] SQLite Scene Registry (data/registry/geosentinel.sqlite)     [Accepted Scene]
        │                                                              │
        ▼                                                              │
[6] Deterministic Tiling (tiling.py) ◄─────────────────────────────────┘
        │
        │ • Anchors grid at AOI top-left in native UTM (EPSG:32643)
        │ • Creates 2560m × 2560m cells ({mgrs}_r{row}_c{col})
        │ • Generates band window recipes (col_off, row_off, height, width)
        │ • Validates raster metadata with rasterio without reading pixels
        ▼
[7] Tile Observations & Chip Recipes (SQLite tables: tiles, tile_observations)
        │
        ▼
[8] Chip Loading & Preprocessing (RasterChipLoader in retrieval.py)
        │
        │ • Reads 256×256 windows for B04 (R), B03 (G), B02 (B)
        │ • Applies 2nd/98th percentile robust normalization
        │ • Outputs (256, 256, 3) float32 array in [0, 1]
        ▼
[9] Embedding Generation (OpenCLIP / SigLIP) ── [PLANNED]
        │
        │ • Encodes normalized chip into 512-dim unit vector
        │ • Stores vector array: data/embeddings/vectors.npy
        ▼
[10] Vector Indexing (FAISS IndexFlatIP) ────── [PLANNED]
        │
        │ • Builds index: data/indexes/tiles.faiss
        │ • Writes sidecar ID mapping: data/indexes/tiles.json
        ▼
[11] Semantic Search Execution (RetrievalEngine) ── [PLANNED LIVE]
        │
        │ • Pre-filters candidates via metadata
        │ • Queries FAISS index with text/image embedding
        │ • Normalizes inner-product score to [0, 1]
        ▼
[12] Analyst Workstation UI (React F1–F7) ──── [IMPLEMENTED / MOCK ACTIVE]
```

---

# 9. Ingestion

The ingestion engine is implemented in [`backend/src/ingest.py`](file:///Users/praveenkumarjha/Desktop/PROJECTS/geosentinel/backend/src/ingest.py).

### Expected Inputs
1. **Scene Catalog (`scenes.csv`):** Contains `product_id`, `baseline` (or `processing_baseline`), and optional quality hints.
2. **AOI GeoJSON (`aoi.geojson`):** Polygon defining the boundary of interest in EPSG:4326.
3. **Imagery Directory (`data/imagery/<product_id>/`):** Directory containing uncompressed GeoTIFF band files for each scene.

### Required Bands and Resolutions
Ingestion strictly enforces the presence of all 10 required Sentinel-2 L2A bands:

| Band | Description | Expected Resolution | Native Pixel Shape (Tile) |
|---|---|---|---|
| `B02` | Blue (490 nm) | 10 meters | $256 \times 256$ |
| `B03` | Green (560 nm) | 10 meters | $256 \times 256$ |
| `B04` | Red (665 nm) | 10 meters | $256 \times 256$ |
| `B08` | Broad NIR (842 nm) | 10 meters | $256 \times 256$ |
| `B05` | Red Edge 1 (705 nm) | 20 meters | $128 \times 128$ |
| `B06` | Red Edge 2 (740 nm) | 20 meters | $128 \times 128$ |
| `B07` | Red Edge 3 (783 nm) | 20 meters | $128 \times 128$ |
| `B11` | SWIR 1 (1610 nm) | 20 meters | $128 \times 128$ |
| `B12` | SWIR 2 (2190 nm) | 20 meters | $128 \times 128$ |
| `SCL` | Scene Classification Layer | 20 meters | $128 \times 128$ |

### SCL Quality Policy
The pilot SCL classification policy in `backend/src/ingest.py` is the single source of truth for atmospheric screening across the system:

```python
# Sentinel-2 Sen2Cor SCL Codes:
# 0: NO_DATA, 1: SATURATED, 2: DARK_AREA, 3: CLOUD_SHADOW, 4: VEGETATION,
# 5: NOT_VEGETATED, 6: WATER, 7: UNCLASSIFIED, 8: CLOUD_MEDIUM, 9: CLOUD_HIGH,
# 10: THIN_CIRRUS, 11: SNOW_ICE

SCL_CLOUD_CLASSES = frozenset({8, 9, 10})       # Medium prob, high prob, thin cirrus
SCL_CLOUD_SHADOW_CLASSES = frozenset({3})       # Cloud shadows
SCL_VALID_CLASSES = frozenset({4, 5, 6})        # Vegetation, bare ground, water
SCL_EXCLUDED_FROM_VALID = frozenset({0, 1, 2, 3, 7, 8, 9, 10, 11})
```

- **Valid Surface Coverage:** Only pixels classified as vegetation (4), non-vegetated (5), or water (6) count toward `valid_percent`.
- **Cloud Coverage:** Pixels with classes 8, 9, or 10 define `cloud_percent`.
- **Shadow Coverage:** Class 3 defines `shadow_percent`.

### Asset Validation and Fingerprinting
1. Opens each band with `rasterio` to ensure readable GeoTIFF format and expected CRS.
2. Checks that the bounding box covers the target AOI.
3. Computes the SHA-256 cryptographic hash of all accepted band rasters and writes them into `metadata_json` in SQLite for tamper-proof provenance.

### Ingestion CLI Command
From `backend/`:
```bash
python -m src.ingest \
  --scenes-csv ../data/catalogs/scenes.csv \
  --aoi ../data/aoi/aoi.geojson \
  --imagery-root ../data/imagery \
  --registry ../data/registry/geosentinel.sqlite \
  --verbose
```

Optional flag `--fingerprint-rejected-assets` hashes files even if rejected. Output is formatted JSON indicating counts of accepted, rejected, and skipped scenes.

---

# 10. Tiling

The tiling pipeline is implemented in [`backend/src/tiling.py`](file:///Users/praveenkumarjha/Desktop/PROJECTS/geosentinel/backend/src/tiling.py).

### Why Tiling Exists
Tiling partitions irregular, multi-gigabyte satellite scenes into uniform, invariant spatial cells. This guarantees that queries, embeddings, and change comparisons always evaluate the exact same patch of ground across different years and seasons.

### Coordinate Systems & Grid Origin
- **Display Coordinates:** Always EPSG:4326 (Latitude, Longitude in degrees) for map visualization.
- **Tiling & Processing Coordinates:** Native projected UTM CRS of the Sentinel-2 scene (e.g., **EPSG:32643** for MGRS tile `43QDF` in the Pune pilot).
- **Grid Origin:** Fixed at the top-left coordinate of the AOI bounding envelope in native UTM meters ($\text{origin}_x = \min(x)$, $\text{origin}_y = \max(y)$).
- **Indexing Convention:** Rows increase southward (descending $Y$); columns increase eastward (ascending $X$).

### Tile Dimensions and IDs
- **Ground Dimension:** $2560\text{ m} \times 2560\text{ m}$ per tile.
- **Pixel Dimensions:**
  - 10-meter bands (`B02`, `B03`, `B04`, `B08`): $256 \times 256$ pixels.
  - 20-meter bands (`B05`, `B06`, `B07`, `B11`, `B12`, `SCL`): $128 \times 128$ pixels.
- **ID Format:** `{mgrs_tile}_r{row:03d}_c{col:03d}` (e.g., `43QDF_r000_c000`, `43QDF_r000_c001`).

### Window Validation (Without Pixel Loading)
To keep tiling extremely fast and lightweight:
1. Calculates pixel window offsets using affine transformation matrices:
   $$\text{col\_off} = \frac{\min(X_{\text{tile}}) - X_0}{\text{res}_x}, \quad \text{row\_off} = \frac{Y_0 - \max(Y_{\text{tile}})}{\text{res}_y}$$
2. Checks that the referenced GeoTIFF file exists on disk.
3. Opens the file with `rasterio.open()` in metadata-validation mode only.
4. Verifies CRS match and confirms the computed window lies entirely within raster bounds $(0, 0, \text{width}, \text{height})$.
5. Saves the validated recipe as JSON in SQLite `tile_observations.chip_recipe_json`.

### Tiling Commands
From `backend/`:
```bash
# List accepted scenes in the registry:
python -m src.tiling --registry ../data/registry/geosentinel.sqlite --list-scenes

# Run full tiling and generate tile observation recipes:
python -m src.tiling \
  --registry ../data/registry/geosentinel.sqlite \
  --aoi ../data/aoi/aoi.geojson \
  --imagery-root ../data/imagery \
  --validate

# List persisted tiles for an AOI:
python -m src.tiling --registry ../data/registry/geosentinel.sqlite --list-tiles
```

---

# 11. Semantic Retrieval

The semantic retrieval architecture is implemented in [`backend/src/retrieval.py`](file:///Users/praveenkumarjha/Desktop/PROJECTS/geosentinel/backend/src/retrieval.py).

### Implemented Foundation vs. Remaining ML Work

> [!IMPORTANT]
> The architectural skeleton, data flow, chip loading, metadata candidate filtering, and interface boundaries for semantic retrieval are fully implemented and unit-tested. However, actual deep-learning embedding generation and real FAISS index construction remain planned tasks requiring PyTorch/OpenCLIP installation and GPU/CPU batch processing.

```text
IMPLEMENTED IN REPOSITORY:
  ✅ RetrievalRegistry: SQL query extracting accepted scenes, tiles, and ChipRecipes.
  ✅ Metadata candidate filtering: pre-filters on aoi_id, start/end date, sensor, cloud %.
  ✅ RasterChipLoader: reads B04, B03, B02 windows and normalizes to (256, 256, 3) float32.
  ✅ OpenCLIPProvider: abstraction boundary with lazy imports and tokenizer initialization.
  ✅ FaissIndex: thin wrapper around IndexFlatIP with sidecar JSON ID mapping.
  ✅ RetrievalEngine: query coordination and score normalization.
  ✅ CLI test suite: python -m src.retrieval --test-loader.

REMAINING ML IMPLEMENTATION:
  ⬜ Install torch, open-clip-torch, and faiss-cpu in environment.
  ⬜ Batch compute embeddings for all tile observations in registry.
  ⬜ Save vectors to data/embeddings/vectors.npy.
  ⬜ Build FAISS index at data/indexes/tiles.faiss with companion tiles.json.
  ⬜ Measure offline recall@k on labeled validation queries.
```

### Retrieval Candidates and Metadata Filtering
When a `SearchQuery` is submitted, `RetrievalRegistry.load_candidates()` evaluates candidate tile observations against metadata constraints **before** running vector similarity:
- `aoi_id`: Must match candidate's AOI identifier.
- `start_date` / `end_date`: Filters scene acquisition timestamps.
- `sensor`: Ensures matching sensor constellation (e.g., `MSI`).
- `max_cloud_percent`: Excludes scenes where cloud cover exceeds threshold.

### Score Normalization
Cosine similarity between L2-normalized vectors falls in $[-1.0, 1.0]$. The GeoSentinel contract requires similarity scores in $[0.0, 1.0]$. `RetrievalEngine` applies linear scaling:
$$\text{similarity\_score} = \text{clip}\left(\frac{\text{raw\_score} + 1.0}{2.0}, 0.0, 1.0\right)$$

Scores are rounded to 6 decimal places and paired with an integer `semantic_rank` ($1 = \text{best}$).

### Running the Retrieval Unit Test
Verify the retrieval raster loading foundation using the built-in synthetic test:
```bash
cd backend
source .venv/bin/activate
python -m src.retrieval --test-loader
```
Output:
```text
RasterChipLoader test: OK
```

---

# 12. Raster Chip Loading

Raster chip loading is handled by the `RasterChipLoader` class in [`backend/src/retrieval.py`](file:///Users/praveenkumarjha/Desktop/PROJECTS/geosentinel/backend/src/retrieval.py).

### Natural Color Band Mapping
Sentinel-2 MSI captures 13 spectral bands. For visual semantic embeddings and chip previews, GeoSentinel constructs natural color RGB chips using the 10-meter native bands:
- **Channel 0 (Red):** Band `B04` (Central wavelength: 665 nm)
- **Channel 1 (Green):** Band `B03` (Central wavelength: 560 nm)
- **Channel 2 (Blue):** Band `B02` (Central wavelength: 490 nm)

### Output Specification
- **Array Shape:** Exactly `(256, 256, 3)`
- **Data Type:** `numpy.float32`
- **Value Range:** Strictly bounded to `[0.0, 1.0]`

### Robust Percentile Normalization Algorithm
Raw Sentinel-2 L2A surface reflectance values (BOA) typically range from 0 to 10,000 (reflectance $\times 10,000$), with extreme outliers caused by cloud glint or shadow voids. Standard min-max normalization crushes surface contrast.

`RasterChipLoader.normalize_band()` applies robust percentile normalization:
1. Filters out non-finite pixels (`NaN`, `+inf`, `-inf`).
2. Computes the 2nd percentile ($v_{\min}$) and 98th percentile ($v_{\max}$) of valid pixels.
3. Handles flat/constant bands: If $v_{\max} - v_{\min} \le 10^{-6}$, returns an array of zeros to avoid division-by-zero.
4. Normalizes valid pixels:
   $$\text{normalized} = \text{clip}\left(\frac{\text{arr} - v_{\min}}{v_{\max} - v_{\min}}, 0.0, 1.0\right)$$
5. Converts the result to `float32`.

### Window Reading with Rasterio
Rather than reading a 500 MB GeoTIFF into memory to extract a tiny patch, `RasterChipLoader` uses `rasterio.windows.Window(col_off, row_off, width, height)` to read only the $256 \times 256$ window directly from the file:
```python
with rasterio.open(band_path) as src:
    data = src.read(1, window=Window(col_off=c, row_off=r, width=256, height=256))
```

This ensures low memory usage and high throughput during batch tile embedding.

---

# 13. Multi-Temporal Change Analysis

Multi-temporal change analysis is the core analytical capability of GeoSentinel. Its contracts and frontend workstation are fully implemented, while the backend engine is scheduled for Phase 3 implementation in `backend/src/change.py`.

### Bi-Temporal vs. Multi-Temporal Analysis
- **Bi-Temporal Analysis (F3):** Answers *"What changed between baseline date $T_1$ and comparison date $T_2$?"*
- **Multi-Temporal Analysis (F7):** Answers *"When did the change begin, how did it evolve across multiple observations, and what is the earliest supported date of change?"*

### Spectral Indices
The planned change engine calculates three primary normalized difference spectral ratios:
1. **NDWI (Normalized Difference Water Index):**
   $$\text{NDWI} = \frac{\text{B03 (Green)} - \text{B08 (NIR)}}{\text{B03} + \text{B08}}$$
   Sensitive to open surface water and reservoir expansion.
2. **NDVI (Normalized Difference Vegetation Index):**
   $$\text{NDVI} = \frac{\text{B08 (NIR)} - \text{B04 (Red)}}{\text{B08} + \text{B04}}$$
   Monitors vegetation clearing, crop cycles, and canopy loss.
3. **NDBI (Normalized Difference Built-up Index):**
   $$\text{NDBI} = \frac{\text{B11 (SWIR1)} - \text{B08 (NIR)}}{\text{B11} + \text{B08}}$$
   Identifies new urban expansion, construction pads, and road networks.

### Atmospheric and Cloud Masking (SCL Gate)
Change detection must never produce false alarms due to transient cloud cover or cast shadow. Using the SCL band:
- **Valid Pixels:** Only pixels with SCL values 4 (vegetation), 5 (bare soil), or 6 (water) are compared.
- **Masked Pixels:** Cloud (8, 9, 10), cloud shadow (3), snow/ice (11), and saturated pixels (1) are masked out before computing deltas.

### Quality Checks Suite
Every `ChangeResult` requires a full `QualityChecks` evaluation consisting of 14 specific verification gates:

```python
@dataclass
class QualityChecks:
    cloud_cover_t1: float           # 0-100%
    cloud_cover_t2: float           # 0-100%
    temporal_separation_days: int   # Days between T1 and T2
    co_registration: str            # PASS | WARN | FAIL
    scene_quality: str              # PASS | WARN | FAIL
    cloud_shadow_screening: str      # PASS | WARN | FAIL
    shadow_cover_t1: float          # 0-100%
    shadow_cover_t2: float          # 0-100%
    valid_pixels_t1: float          # 0-100%
    valid_pixels_t2: float          # 0-100%
    snow_haze_screening: str        # PASS | WARN | FAIL
    seasonal_variation: str         # PASS | WARN | FAIL
    illumination_geometry: str      # PASS | WARN | FAIL
    radiometric_consistency: str    # PASS | WARN | FAIL
    overall_confidence: str         # HIGH | MEDIUM | LOW
    flags: list[str]                # e.g., ['baseline_mismatch']
```

### The Earliest Supported Observation Rule
When an analyst observes an anomaly between May and September, they need to know when the change actually started. 
The system tests intermediate observations chronologically:
1. For each scene $t_i$ between $T_1$ and $T_2$, it computes change magnitude and runs quality gates.
2. The earliest observation $t_i$ where the change signal exceeds the detection threshold with **PASS** quality checks is designated the **Earliest Supported Observation**.

---

# 14. Pune Demo Scenario

To support end-to-end user experience testing and design validation prior to the availability of the complete ML/API backend, GeoSentinel includes a canonical pilot investigation dataset centered on Pune, India.

> [!CAUTION]
> **Explicit Verification Notice:** The values listed below are **frontend demonstration and mock narrative values**. They are designed to validate workstation ergonomics, layout responsiveness, and handoff flows. They are **not** real-time scientifically computed outputs from the current backend.

### Canonical Investigation Parameters
- **Investigation ID:** `INV-2025-PUNE-001`
- **Area of Interest (AOI):** `AOI-MAHARASHTRA-PUNE-METRO`
- **Geographic Designation:** Pune Metropolitan Basin & Khadakwasla Watershed
- **MGRS Tile Code:** `43QDF`
- **UTM Processing Projection:** `EPSG:32643` (UTM Zone 43N)
- **AOI Centroid:** `18.5204° N, 73.8567° E`
- **Target Phenomenon:** Monsoonal reservoir filling and catchment water expansion

### Primary Scene Pair (Bi-Temporal Analysis)
- **Baseline Scene ($T_1$):** `S2B_MSIL2A_20250515T051859_N0510_R019_T43QDF`
  - Acquisition Date: **15 MAY 2025** (Pre-monsoon dry season)
  - Baseline Water Surface Extent: **$11.20\text{ km}^2$**
  - Cloud Cover: $1.4\%$ | Shadow Cover: $0.2\%$ | Valid Pixels: $99.8\%$
- **Comparison Scene ($T_2$):** `S2A_MSIL2A_20250921T051831_N0511_R019_T43QDF`
  - Acquisition Date: **21 SEP 2025** (Post-monsoon peak)
  - Comparison Water Surface Extent: **$28.45\text{ km}^2$**
  - Cloud Cover: $6.8\%$ | Shadow Cover: $0.8\%$ | Valid Pixels: $98.4\%$
- **Net Water Extent Expansion:** **$+17.25\text{ km}^2$**
- **Relative Delta:** **$+154.0\%$**
- **Temporal Separation:** **$129\text{ days}$**
- **Earliest Supported Observation:** **18 JUN 2025**
- **Confidence Rating:** **HIGH** (numeric score: `0.94`)
- **Review Package ID:** `EV-2025-0921-01`
- **Evidence Package ID:** `EVPKG-2025-0921-01`

### Multi-Temporal 5-Date Sequence (F7)

| Date | Phase Label | Measured Water Extent | NDWI Mean | Context & Hydrological Progression |
|---|---|---|---|---|
| **15 MAY 2025** | Pre-Monsoon Dry Baseline | $11.20\text{ km}^2$ | -0.420 | Desiccated reservoir basin; exposed dry mudflat perimeter. |
| **18 JUN 2025** | Monsoon Onset / Earliest Obs | $16.80\text{ km}^2$ | -0.150 | First substantial inflow; initial water/vegetation transition. |
| **23 JUL 2025** | Ghats Orographic Surge | $22.10\text{ km}^2$ | +0.180 | Orographic precipitation along the Sahyadri ridge crests. |
| **31 AUG 2025** | High Discharge Inflow | $26.30\text{ km}^2$ | +0.340 | Active spillway discharge and turbid sediment runoff plumes. |
| **21 SEP 2025** | Post-Monsoon Peak | $28.45\text{ km}^2$ | +0.480 | Catchment reservoir at 100% capacity; peak inundation. |

---

# 15. How to Set Up the Project

This section provides complete, beginner-friendly setup instructions for a new developer starting with a clean clone.

### Prerequisites
- **Git**
- **Node.js:** v18.0 or higher (v20+ recommended) and `npm`
- **Python:** v3.10, v3.11, or v3.12 (tested on Python 3.12)

### 1. Clone the Repository
```bash
git clone https://github.com/Praveen-215/geosentinel.git
cd geosentinel
```

### 2. Frontend Setup
```bash
cd frontend

# Create environment file from template
cp .env.example .env

# Install dependencies
npm install

# Verify TypeScript compilation
npm run typecheck
```

### 3. Backend Setup
```bash
cd ../backend

# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
# macOS / Linux:
source .venv/bin/activate
# Windows PowerShell:
# .\.venv\Scripts\Activate.ps1

# Upgrade pip and install active Phase 0/1 dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Verification of Installation
Run the following two smoke tests to ensure your setup is operational:
```bash
# 1. Verify frontend type safety (from frontend/):
npm run typecheck

# 2. Verify backend raster chip loading (from backend/ with .venv active):
python -m src.retrieval --test-loader
```
If both commands return without error, your environment is ready.

---

# 16. How to Run the Project

### A. Running the Frontend Workstation
```bash
cd frontend
npm run dev
```
Open your browser and navigate to:
```text
http://localhost:3000
```
- Use the sidebar or press **F1–F7** to switch between modules.
- The workstation is fully interactive in offline mock mode.

### B. Running Backend Ingestion
Requires a local data directory containing `scenes.csv`, `aoi.geojson`, and GeoTIFFs:
```bash
cd backend
source .venv/bin/activate

python -m src.ingest \
  --scenes-csv ../data/catalogs/scenes.csv \
  --aoi ../data/aoi/aoi.geojson \
  --imagery-root ../data/imagery \
  --registry ../data/registry/geosentinel.sqlite \
  --verbose
```

### C. Running Deterministic Tiling
```bash
cd backend
source .venv/bin/activate

# View help and options:
python -m src.tiling --help

# Run tiling pipeline:
python -m src.tiling \
  --registry ../data/registry/geosentinel.sqlite \
  --aoi ../data/aoi/aoi.geojson \
  --imagery-root ../data/imagery \
  --validate
```

### D. Running Retrieval Foundation & Tests
```bash
cd backend
source .venv/bin/activate

# Run deterministic synthetic raster chip test:
python -m src.retrieval --test-loader

# View search CLI options:
python -m src.retrieval --help
```

### E. Backend HTTP API Server (Planned)
The FastAPI HTTP service is scheduled for Phase 4 and is **not yet present** in the repository. Do not attempt to run `uvicorn` until Phase 4 lands.

---

# 17. Environment Variables

### Frontend (`frontend/.env`)
Configured via `frontend/.env.example`:

| Variable | Default Value | Description & Behavior |
|---|---|---|
| `VITE_USE_MOCKS` | `true` | When `true`, frontend routes all service calls to local mock services. When `false`, frontend calls live backend REST endpoints. |
| `VITE_API_BASE_URL` | `http://localhost:8000` | The base URL of the backend API server. Used when `VITE_USE_MOCKS=false`. |

### Backend (Environment Variables)
Configured via shell environment or future `.env` file:

| Variable | Default Value | Description & Behavior |
|---|---|---|
| `GEOSENTINEL_DATA_ROOT` | `../data` | Root path to local data directory. |
| `GEOSENTINEL_REGISTRY` | `../data/registry/geosentinel.sqlite` | Path to SQLite registry database. |
| `GEOSENTINEL_INDEX` | `../data/indexes/tiles.faiss` | Path to FAISS vector index. |
| `GEOSENTINEL_EMBEDDING_MODEL` | `open_clip:ViT-B-32` | OpenCLIP vision-language model identifier. |

> [!WARNING]
> Never commit `.env` files or API secrets to the repository. The `.gitignore` file is configured to block `.env` and `.env.*` files (except `.env.example`).

---

# 18. Data Directory

Due to the massive size of satellite imagery, raster files and embeddings are **strictly gitignored** and stored locally under `data/`.

### Expected Local Directory Layout
```text
data/
├── aoi/
│   └── aoi.geojson                  # Pilot AOI polygon in EPSG:4326
├── catalogs/
│   └── scenes.csv                   # CSV listing product_id and baseline
├── imagery/                         # GeoTIFF raster assets
│   ├── S2B_MSIL2A_20250515.../
│   │   ├── B02.tif
│   │   ├── B03.tif
│   │   ├── ...
│   │   ├── B12.tif
│   │   └── SCL.tif
│   └── S2A_MSIL2A_20250921.../
│       └── ...
├── registry/
│   └── geosentinel.sqlite           # SQLite database for scenes, tiles, observations
├── tiles/                           # Extracted tile rasters (optional)
├── embeddings/
│   └── vectors.npy                  # Dense float32 vector embedding matrix
├── indexes/
│   ├── tiles.faiss                  # FAISS ANN index file
│   └── tiles.json                   # Row-to-(tile_id, scene_id) index mapping
└── exports/                         # Exported evidence packages, masks, eval summaries
```

### Git Hygiene Rules for Data
- **Never Commit Rasters:** `.tif`, `.tiff`, and JP2 files are blocked in `.gitignore`.
- **Never Commit Embeddings / Indexes:** `*.npy` and `*.faiss` files are blocked in `.gitignore`.
- **Never Commit Database Files:** `*.sqlite` and `/data/` are blocked in `.gitignore`.
- **Only Commit Code and Metadata Templates:** Only schemas, documentation, and configuration templates belong in Git.

---

# 19. How a New Developer Should Explore the Code

To get oriented efficiently without getting lost in technical minutiae, follow this recommended 9-step reading path:

```text
Step 1: Read README.md & docs/PROJECT_GUIDE.md
  │     Understand the mission, problem statement, and component maturity.
  ▼
Step 2: Read docs/architecture.md & docs/rules.md
  │     Understand the three-layer architecture, 2560m tile atom, and permanent rules.
  ▼
Step 3: Inspect backend/contracts.py
  │     Study the shared data structures (Scene, Tile, SearchQuery, QualityChecks).
  ▼
Step 4: Inspect frontend/src/types/index.ts
  │     Confirm how backend contracts map 1:1 to TypeScript interfaces.
  ▼
Step 5: Explore frontend/src/App.tsx & frontend/src/pages/
  │     Trace F1–F7 navigation, state handoffs, and UI workflow.
  ▼
Step 6: Study backend/src/ingest.py
  │     Understand SCL validation, cloud/shadow math, and SQLite registration.
  ▼
Step 7: Study backend/src/tiling.py
  │     Understand UTM grid anchoring, 2560m tile calculations, and window recipes.
  ▼
Step 8: Study backend/src/retrieval.py
  │     Understand RasterChipLoader, B04/B03/B02 normalization, and OpenCLIP/FAISS design.
  ▼
Step 9: Inspect backend/src/change.py
        Note what remains to be built for Phase 3 change detection.
```

---

# 20. How the Pieces Connect

The following ASCII architecture diagram details the relationships between the workstation UI, service interfaces, backend pipelines, and physical storage:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ANALYST WORKSTATION (React 18 + TS)                     │
│                                                                             │
│   [F1] Workspace    [F2] Retrieval     [F3] Change     [F4] Review         │
│   [F5] Similar      [F6] Evidence      [F7] Temporal   [Viewport SVG]       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                    TypeScript Service Interfaces
           (retrievalService, changeAnalysisService, reviewService)
                                       │
                   ┌───────────────────┴───────────────────┐
                   │                                       │
     (Current: VITE_USE_MOCKS=true)          (Phase 4: VITE_USE_MOCKS=false)
                   │                                       │
        ┌──────────▼──────────┐                 ┌──────────▼──────────┐
        │ Mock Data Services  │                 │  HTTP Client Layer  │
        │ (mockScenes, etc.)  │                 │  (Http*Service)     │
        └─────────────────────┘                 └──────────┬──────────┘
                                                           │
                                              JSON Wire Protocol (camelCase)
                                                           │
┌──────────────────────────────────────────────────────────▼──────────────────┐
│                             BACKEND PIPELINES                               │
│                                                                             │
│   contracts.py        Shared DTOs & to_json() camelCase serialization        │
│                                                                             │
│   ingest.py           L2A GeoTIFF Ingestion ──> SCL Quality ──> SHA-256     │
│                                                                             │
│   tiling.py           Deterministic UTM Grid (2560m) ──> Chip Recipes       │
│                                                                             │
│   retrieval.py        RasterChipLoader ──> OpenCLIP Embedder ──> FAISS Index │
│                                                                             │
│   change.py           Spectral Differencing (NDWI/NDVI) ──> QualityChecks   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                Storage Access
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                            LOCAL DATA & REGISTRY                            │
│                                                                             │
│   SQLite Database:         geosentinel.sqlite (scenes, tiles, observations) │
│   GeoTIFF Bands:           data/imagery/<product_id>/*.tif (10m & 20m)      │
│   Feature Embeddings:      data/embeddings/vectors.npy                      │
│   Similarity Index:        data/indexes/tiles.faiss                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# 21. Git / Team Workflow

### Collaboration Rules
1. **Branching Model:** 
   - `main` is the shared, stable integration baseline.
   - Developers work in dedicated feature branches (e.g., `feature/semantic-embeddings`, `feature/change-engine`, `RD`).
   - Merge to `main` strictly via GitHub Pull Requests.
2. **Never Overwrite a Teammate’s Work:**
   - Always run `git fetch origin` and rebase/merge cleanly before pushing.
   - Do not force push (`git push --force`) to `main` or shared feature branches.
3. **Contract Protection:**
   - Never alter `backend/contracts.py` or `frontend/src/types/index.ts` unilaterally. Any contract modification requires mutual agreement between frontend and backend developers.
4. **Current Baseline Commit:**
   - Baseline commit on `main`: `6c3c7d0 Implement Phase 2 retrieval pipeline foundation`.

### Pre-Commit Verification Checklist
Before committing any code or creating a PR:
```bash
# 1. Ensure frontend compiles with zero TypeScript errors:
cd frontend && npm run typecheck

# 2. Ensure backend raster chip loader test passes:
cd ../backend && python -m src.retrieval --test-loader

# 3. Check git status to ensure no data, rasters, or secrets are staged:
git status
```

---

# 22. Current Work Split

The project is structured into four logical developer domains:

### 1. Frontend & Workstation UX
- **Focus:** User interface, state management, and user interaction.
- **Responsibilities:** Polish F1–F7 workstation modules, maintain mock fidelity, implement `Http*Service` classes during Phase 4 live API integration, and optimize the `ImageryViewport` canvas.

### 2. Semantic Retrieval & ML
- **Focus:** Machine learning, dual encoders, and vector search.
- **Responsibilities:** Install PyTorch/OpenCLIP, configure embedding models (e.g., `ViT-B-32`), compute batch tile vectors into `data/embeddings/vectors.npy`, construct the FAISS index at `data/indexes/tiles.faiss`, and evaluate query recall@K.

### 3. Change Analysis & Remote Sensing
- **Focus:** Spectral mathematics, false-alarm suppression, and temporal logic.
- **Responsibilities:** Implement `backend/src/change.py`, calculate spectral indices (NDWI, NDVI, NDBI), enforce SCL cloud/shadow masking, compute the 14 `QualityChecks`, and calculate the **Earliest Supported Observation**.

### 4. Backend Systems & API
- **Focus:** Data persistence, REST services, and integration.
- **Responsibilities:** Build the FastAPI service (Phase 4), wire HTTP routes to pipeline modules, manage SQLite transactions, handle review decision persistence, and package evidence dossiers.

---

# 23. What Is Finished vs What Is Left

| Component / Feature | Maturity | Status |
|---|---|---|
| **F1 Workspace Page** | Production UI | ✅ Implemented |
| **F2 Semantic Retrieval Page** | Production UI | ✅ Implemented |
| **F3 Change Analysis Page** | Production UI | ✅ Implemented |
| **F4 Analyst Review Page** | Production UI | ✅ Implemented |
| **F5 Similar Sites Page** | Production UI | ✅ Implemented |
| **F6 Evidence & Provenance Page** | Production UI | ✅ Implemented |
| **F7 Multi-Temporal Analysis Page** | Production UI | ✅ Implemented |
| **Shared Contracts (`contracts.py`)** | Core DTOs + `to_json()` | ✅ Implemented |
| **Frontend Types (`types/index.ts`)** | Aligned with contracts | ✅ Implemented |
| **Sentinel-2 L2A Ingest (`ingest.py`)** | Full validation + hashing | ✅ Implemented |
| **SQLite Registry Schema** | Scenes, tiles, observations | ✅ Implemented |
| **Deterministic Tiling (`tiling.py`)** | 2560m UTM grid generation | ✅ Implemented |
| **Chip Window Recipes** | Per-band window generation | ✅ Implemented |
| **Raster Chip Loader (`retrieval.py`)** | RGB extraction + norm | ✅ Implemented |
| **Retrieval Architecture (`retrieval.py`)** | Query & candidate filtering | ✅ Implemented |
| **OpenCLIP Integration** | Interface boundary defined | 🟡 Foundation Ready |
| **FAISS Index Wrapper** | Class & mapping defined | 🟡 Foundation Ready |
| **Review Persistence** | Client-side mock active | 🟡 Foundation Ready |
| **Evidence Dossier Generation** | JSON/Markdown export active | 🟡 Foundation Ready |
| **Actual Tile Embedding Generation** | ML batch vectorization | ⬜ Planned |
| **Actual FAISS Index Construction** | Real vector ANN index | ⬜ Planned |
| **Retrieval Recall Evaluation** | Offline benchmark script | ⬜ Planned |
| **Change Engine (`change.py`)** | Bi-temporal spectral deltas | ⬜ Planned |
| **SCL Change Masking Backend** | Cloud/shadow suppression | ⬜ Planned |
| **Earliest Observation Algorithm** | Temporal sequence audit | ⬜ Planned |
| **FastAPI REST Server** | HTTP endpoints | ⬜ Planned |
| **Live Frontend-to-Backend Wiring** | `VITE_USE_MOCKS=false` | ⬜ Planned |

---

# 24. Common Mistakes / Things to Know

### 1. Do Not Confuse Mock Values with Real Satellite Analysis
The frontend displays realistic numbers (e.g., Khadakwasla Reservoir $+17.25\text{ km}^2$, $94\%$ confidence). These are mock narrative values designed for UI development and client demonstration. Never present mock data as scientifically computed output.

### 2. Do Not Commit Large Data Files
Never commit `.tif`, `.tiff`, `.jp2`, `.npy`, `.faiss`, or `.sqlite` files to Git. The repository must remain lightweight. All binary data belongs in `data/` or `models/artifacts/` which are gitignored.

### 3. Do Not Alter Contracts Unilaterally
Changing a field in `contracts.py` without updating `frontend/src/types/index.ts` will break serialization and cause runtime failures. Always update both files together.

### 4. Do Not Break Mock Mode While Building Live APIs
Mock services allow team members to develop and demonstrate the workstation offline. When creating live HTTP services, preserve the mock service implementations so that setting `VITE_USE_MOCKS=true` continues to work.

### 5. Do Not Claim ML Features Are Implemented
Having `retrieval.py` in the repository does **not** mean semantic search is fully operational. The module provides the architectural framework and chip loader; real vector embeddings and FAISS index generation are still pending.

### 6. Always Respect the 2560m Tile Unit
Do not attempt to perform semantic retrieval or change detection on un-tiled, full-scene rasters. Tiling is required to maintain fixed ground units across temporal observations.

---

# 25. Troubleshooting

### 1. `python: command not found` or `python3: command not found`
- **Cause:** Python is not on your shell `PATH`, or your virtual environment is not activated.
- **Solution:** Activate the project virtual environment:
  ```bash
  cd backend
  source .venv/bin/activate # macOS/Linux
  # or .\.venv\Scripts\Activate.ps1 on Windows
  ```

### 2. `RasterioUnavailable` / `No module named 'rasterio'`
- **Cause:** Geospatial C-libraries or `rasterio` are missing from your Python environment.
- **Solution:** Ensure you are using Python 3.10–3.12 and install dependencies:
  ```bash
  pip install -r requirements.txt
  ```

### 3. `EmbeddingProviderUnavailable` / `VectorIndexUnavailable`
- **Cause:** Running search CLI without optional Phase 2 ML dependencies installed.
- **Solution:** This is expected in Phase 1! The base backend runs without PyTorch or FAISS. When you are ready to implement Phase 2 ML, install:
  ```bash
  pip install torch open-clip-torch faiss-cpu pillow
  ```

### 4. TypeScript Typecheck Failures (`npm run typecheck`)
- **Cause:** Stale dependencies or mismatched type definitions.
- **Solution:** Reinstall node modules and verify:
  ```bash
  cd frontend
  rm -rf node_modules
  npm install
  npm run typecheck
  ```

### 5. SQLite Registry Not Found (`FileNotFoundError`)
- **Cause:** Running `tiling.py` or `retrieval.py` before running `ingest.py`.
- **Solution:** Ingestion must run first to create `geosentinel.sqlite`. Ensure your local `data/` directories are populated as described in Section 18.

---

# 26. Glossary

- **AOI (Area of Interest):** The geographic polygon defining the spatial envelope of an investigation.
- **EO (Earth Observation):** The gathering of information about planet Earth via remote sensing satellites.
- **Scene:** A full satellite acquisition product covering an MGRS tile at a specific date and time.
- **Tile:** A static $2560\text{ m} \times 2560\text{ m}$ square ground unit anchored to the AOI in native UTM projection.
- **Tile Observation:** The combination of a specific `Tile` and a specific `Scene` at time $t$.
- **Chip:** A small pixel array (e.g., $256 \times 256$) extracted from a tile observation.
- **MGRS (Military Grid Reference System):** The geographic grid system used by Sentinel-2 (e.g., `43QDF`).
- **CRS (Coordinate Reference System):** Spatial framework mapping coordinates to the Earth's surface.
- **UTM (Universal Transverse Mercator):** A metric map projection system preserving local shapes and distances.
- **Sentinel-2:** European Space Agency (ESA) twin polar-orbiting multispectral satellites (2A and 2B).
- **SCL (Scene Classification Layer):** Pixel-level classification band generated by Sen2Cor (cloud, shadow, vegetation, water).
- **NDVI (Normalized Difference Vegetation Index):** Spectral ratio measuring live green vegetation health.
- **NDWI (Normalized Difference Water Index):** Spectral ratio measuring open water extent and moisture content.
- **NDBI (Normalized Difference Built-up Index):** Spectral ratio highlighting urban structures and built-up land.
- **Embedding:** A dense mathematical vector representing the semantic features of an image chip or text query.
- **Vector Index:** An optimized data structure for rapid nearest-neighbor vector search.
- **FAISS (Facebook AI Similarity Search):** High-performance library for dense vector clustering and similarity search.
- **ANN (Approximate Nearest Neighbors):** Algorithmic technique for finding closest vectors in sub-linear time.
- **Semantic Retrieval:** Finding imagery by meaning and context rather than solely by metadata tags.
- **Multi-Temporal Analysis:** Analyzing satellite observations across multiple dates to track changes over time.
- **Change Detection:** Algorithmic identification of physical alterations on the Earth's surface between dates.
- **Provenance:** The verifiable chain of custody, data lineage, and processing steps that produced an analytical finding.
- **Evidence Package:** An immutable dossier containing source data, sensor metadata, quality checks, and analyst dispositions.

---

# 27. Quick Start for a New Teammate

*If you only have 15 minutes, read this section to get oriented immediately:*

1. **What GeoSentinel Is:** An Earth Observation platform that lets analysts search Sentinel-2 satellite imagery using natural language and detect land-cover changes over time.
2. **Where the Frontend Is:** In `frontend/`. It is a React 18 + Vite + TypeScript application running on port 3000.
3. **Where the Backend Is:** In `backend/`. Python pipelines for ingestion, tiling, retrieval, and change detection.
4. **Where Contracts Are:** In `backend/contracts.py` (Python dataclasses) and `frontend/src/types/index.ts` (TypeScript interfaces). They are the single source of truth.
5. **How to Run the Frontend:**
   ```bash
   cd frontend && npm install && npm run dev
   # Open http://localhost:3000 (F1–F7 switch modules)
   ```
6. **Which Backend Pieces Are Implemented:**
   - Scene ingestion and validation (`backend/src/ingest.py`).
   - Deterministic 2560m UTM tiling and chip window recipes (`backend/src/tiling.py`).
   - Retrieval foundation and natural color RGB chip loader (`backend/src/retrieval.py`).
7. **Which Pieces Are Still Being Developed:**
   - Tile embedding generation and FAISS vector index building.
   - Spectral change detection engine (`backend/src/change.py`).
   - FastAPI REST backend and live API integration.
8. **Where to Start Making Changes:**
   - **Frontend UI:** Edit components in `frontend/src/pages/` or `frontend/src/components/`.
   - **Semantic ML:** Work on embedding extraction in `backend/src/retrieval.py`.
   - **Change Engine:** Implement change detection algorithms in `backend/src/change.py`.
9. **What NOT to Modify Casually:**
   - Do NOT edit `backend/contracts.py` or `frontend/src/types/index.ts` without team consensus.
   - Do NOT commit large imagery rasters, `.npy` files, or `.faiss` indexes.
   - Do NOT remove or bypass the frontend mock services while developing live APIs.

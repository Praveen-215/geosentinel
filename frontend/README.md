# GeoSentinel — Analyst Workstation Frontend

Professional Earth Observation (EO) and GIS analyst workstation for semantic retrieval and multi-temporal change analysis of satellite imagery.

## Overview

GeoSentinel provides an intelligence/GIS analyst workstation interface tailored for high-density satellite imagery review, spectral analysis, semantic retrieval, and multi-temporal change detection without external GIS cloud dependencies during initial development.

## Tech Stack

- **Framework**: React 18 (TypeScript)
- **Bundler**: Vite
- **Iconography**: Lucide React
- **Design System**: Custom CSS design system (`src/styles/globals.css`) designed for GIS/mission-control operations:
  - Deep navy / slate chrome navigation (`#0c1424`, `#131e34`)
  - Off-white/slate light canvas workspace (`#edf1f6`, `#ffffff`)
  - Thin 1px borders with compact 2–4px radii
  - Monospace typography for coordinates, MGRS grids, scene IDs, and timestamps
  - Synthetic SVG-based local Earth-observation viewport with spectral band simulations (True Color RGB 4-3-2, False Color NIR 8-4-3, NDVI, Bi-temporal Delta Heatmaps)

## Directory Structure

```text
frontend/
├── index.html                 # Application entry point with IBM Plex typography
├── package.json               # Dependencies and build scripts
├── tsconfig.json              # TypeScript strict configuration
├── vite.config.ts             # Vite development server configuration
├── src/
│   ├── main.tsx               # Application mount point
│   ├── App.tsx                # Top-level state and provider hierarchy
│   ├── assets/                # Local static assets
│   ├── styles/
│   │   └── globals.css        # High-density GIS design system & utilities
│   ├── types/
│   │   └── index.ts           # Domain models: SatelliteScene, AOI, RetrievalResult, ChangeMetric
│   ├── data/
│   │   └── mockScenes.ts      # Realistic Sentinel-2 / Landsat-9 scene catalog & metrics
│   ├── services/
│   │   ├── retrievalService.ts     # Abstraction for semantic retrieval & embeddings
│   │   └── changeAnalysisService.ts # Abstraction for bi-temporal delta analysis
│   ├── components/
│   │   ├── Header.tsx         # Top application bar (telemetry, coordinates, status)
│   │   ├── Sidebar.tsx        # Left navigation rail (mission modules F1-F7)
│   │   ├── ImageryViewport.tsx# Local SVG Earth-observation cartographic canvas
│   │   └── MetadataPanel.tsx  # Right technical panel (scene, AOI, bands, metrics)
│   ├── layouts/
│   │   └── AnalystLayout.tsx  # Workstation frame layout
│   └── pages/
│       └── WorkspacePage.tsx  # Primary analyst console & imagery inspection
└── README.md
```

## Getting Started

### Prerequisites

- Node.js >= 18 (tested on Node 24)
- npm >= 9

### Installation

```bash
npm install
```

### Development Server

```bash
npm run dev
```

The workstation will be accessible at `http://localhost:3000`.

### Type Checking & Build

```bash
npm run typecheck
npm run build
```

## Backend & Model Team Integration

The frontend exposes clean, decoupled TypeScript service contracts in `src/services/`:

1. **`retrievalService.ts`**:
   - `queryScenesBySemanticPrompt(query: SemanticRetrievalQuery)`: Accepts natural-language search strings or reference scene IDs and returns ranked satellite scenes with similarity scores.
   - `listAvailableScenes()`: Retrieves scenes within the target AOI.

2. **`changeAnalysisService.ts`**:
   - `runTemporalChangeAnalysis(baselineSceneId, comparisonSceneId, aoiId)`: Triggers automated bi-temporal spectral change detection and returns quantitative metrics (NDVI, NDWI, impervious surface expansion, confidence scores).
   - `verifyMetric(metricId, analystNotes)`: Records human-in-the-loop analyst verification.

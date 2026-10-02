# GeoSentinel

Semantic Retrieval and Multi-Temporal Change Analysis of Satellite Imagery.

## Project Structure

- `frontend/` — GeoSentinel analyst interface
- `backend/` — pipelines, contracts, (planned) API
- `docs/` — product and engineering documentation
- `models/` — semantic retrieval and change-analysis model artifacts/scripts (optional)
- `data/` — local imagery, registry, indexes (gitignored)

## Documentation

| Doc | Purpose |
|---|---|
| [docs/prd.md](./docs/prd.md) | Product requirements |
| [docs/architecture.md](./docs/architecture.md) | System design |
| [docs/integration.md](./docs/integration.md) | Connections, setup, APIs, models, tools |
| [docs/phases.md](./docs/phases.md) | Delivery phases |
| [docs/rules.md](./docs/rules.md) | Permanent rules, context, constraints |

## Team Modules

### Frontend

Professional Earth Observation / GIS analyst workstation interface (F1–F7).

### Semantic Retrieval

Natural-language and image-based satellite imagery retrieval, similarity search and ranking.

### Change Analysis

Multi-temporal change detection, quality assessment and evidence generation.

## Development

The frontend initially uses local mock data and service interfaces so all team members can work independently.

```bash
cd frontend
npm install
npm run dev
```

Workstation: `http://localhost:3000`

Backend ingest (requires local data layout — see [integration.md](./docs/integration.md)):

```bash
cd backend
python -m venv .venv
# activate venv, then:
pip install -r requirements.txt
python -m src.ingest --help
```

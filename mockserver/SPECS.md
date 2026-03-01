# Specifications
Dashboard app with three components: frontend, backend, mockserver.
When updating or adding there specs, make sure to prefix (or update the prefix) with `[ ]` to mark it TODO. After processing, mark completed items with `[x]`.

Each component:
- [x] Runs in a container via `compose.yml` and `Containerfile`
- [x] No host package installs
- [x] Basic code formatting tools
- [x] No HTTPS between containers

## Mockserver
- [x] Python 3.14 + FastAPI; mirror src into container; ruff formatting
- [x] Read `DATA_SAMPLE_DIRECTORY` env var (e.g. `data/2026-03-01/`); replay all `.json` files from that directory in ascending filename order, serving each as the `/api/data` response
- [x] Read `DATA_SAMPLE_INTERVAL` env var (e.g. `5`) as the delay in seconds between samples; default `5`
- [x] Stop advancing after the last sample (hold last state); `POST /api/reset` restarts replay from the first file

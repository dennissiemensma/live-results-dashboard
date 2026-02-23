# Specifications
All agent CLI commands should start with a whitespace to avoid bloating local shell history.

Create a dashboard application that consists our of three components: 
- frontend
- backend
- mockserver

Each should:
- reside in a container, using compose files (`compose.yml`) and container files (`Containerfile`)
- not install packages on the host
- have some basic code formatting tools

Also:
- do not use https between containers

## Backend
- Python + FastAPI
- Async
- Serves websocket for frontend on port `5000`
- Periodically reads data from a predefined `DATA_SOURCE_URL` env var and updates the frontend via websocket
- Interval should be configurable via env var `DATA_SOURCE_INTERVAL`, default `2`
- Cache between intervals (aiocache)

## Frontend
- Angular with coreui
- Run on development server on port `4200`
- Also run on production server on port `8888` outside the container (mapped to `80` in the container)
- Uses websocket to receive data from backend, connection on backend port `5000`
- Do not alter or remove `mockserver/mappings/example.json`

## Mockserver
- For development without real data URL
- Wiremock

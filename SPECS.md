# Specifications
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
- Python 3.14 + FastAPI
- Async
- Serves websocket for frontend on port `5000`
- Mirror `src` into container

Specs:
- Periodically reads data from a predefined `DATA_SOURCE_URL` env var and updates the frontend via websocket
- Interval should be configurable via env var `DATA_SOURCE_INTERVAL`, default `1`
- Cache between intervals (aiocache)
- On websocket connect, broadcast `status` type data to frontend, including:
  - `data_source_url`: value of `DATA_SOURCE_URL`
  - `data_source_interval`: value of `DATA_SOURCE_INTERVAL`
- Then update frontend with `data` type data whenever data is fetched from `DATA_SOURCE_URL` and it differs from the last sent data
- Add logging for receiving new data and sending updates to frontend

## Frontend
- Node 22 + Angular + CoreUI
- Run on development server on port `4200`
- Also run on production server on port `8888` outside the container (mapped to `80` in the container)
- Uses websocket to receive data from backend, connection on backend port `5000`
- Do not alter or remove `mockserver/mappings/example.json`
- Relocate nginx config into separate folder

Specs:
- Connect to backend socket on startup and display `status` type data received.


## Mockserver
- For development without real data URL
- Wiremock

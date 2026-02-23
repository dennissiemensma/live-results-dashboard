# Specifications
Create a dashboard application that consists our of three components: 
- frontend
- backend
- mockserver

Each should:
- reside in a container, using compose files 
- not install packages on the host
- have some basic code formatting tools

## Backend
- Python
- Async
- Serves websocket for frontend
- Periodically reads data from a predefined `DATA_SOURCE_URL` and updates the frontend via websocket

## Frontend
- Angular with coreui
- Uses webs

## Mockserver
- For development without real data URL
- Wiremock
- Sample needed that grows over time.

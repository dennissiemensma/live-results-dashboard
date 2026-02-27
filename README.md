# Live results dashboard
Experimental - non commercial.

## Environment Configuration

- The frontend does not hardcode the backend URL. Instead, the backend URL is passed as the BACKEND_URL environment variable into the frontend container (see compose.yml and frontend/Containerfile).
- At runtime, the frontend reads BACKEND_URL from the injected environment and uses it for API/WebSocket connections.
- For local development, you can override BACKEND_URL in the compose file or via environment variables.

import asyncio
import os
import logging
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import List
from aiocache import Cache

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Configuration
DATA_SOURCE_URL = os.environ.get("DATA_SOURCE_URL", None)
DATA_SOURCE_INTERVAL = float(os.environ.get("DATA_SOURCE_INTERVAL", None))

# Cache
cache = Cache(Cache.MEMORY)


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Client connected. Active connections: {len(self.active_connections)}")

        # Send status immediately
        await websocket.send_json(
            {
                "type": "status",
                "data": {
                    "data_source_url": DATA_SOURCE_URL,
                    "data_source_interval": DATA_SOURCE_INTERVAL,
                },
            }
        )

        # Send current cached data if available
        current_data = await cache.get("latest_data")
        if current_data:
            logger.info("Sending cached data to new client")
            await websocket.send_json({"type": "data", "data": current_data})
        else:
            logger.info("No cached data available for new client")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        if message.get("type") == "data":
            logger.info(f"Broadcasting update to {len(self.active_connections)} client(s)")
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # Connection might be closed
                pass


manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection implementation simple, just wait for messages (though none expected from client)
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


async def fetch_data_loop():
    async with httpx.AsyncClient() as client:
        while True:
            try:
                response = await client.get(DATA_SOURCE_URL)
                if response.status_code == 200:
                    new_data = response.json()
                    old_data = await cache.get("latest_data")

                    if new_data != old_data:
                        logger.info("Received new data from source")
                        await cache.set("latest_data", new_data)
                        await manager.broadcast({"type": "data", "data": new_data})
                else:
                    logger.warning(f"Failed to fetch data: {response.status_code}")
            except Exception as e:
                logger.error(f"Error fetching data: {e}")

            await asyncio.sleep(DATA_SOURCE_INTERVAL)


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(fetch_data_loop())

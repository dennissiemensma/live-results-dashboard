import asyncio
import os
import logging
from contextlib import asynccontextmanager
from typing import List

import httpx
from aiocache import Cache
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATA_SOURCE_URL = os.environ.get("DATA_SOURCE_URL", "http://localhost:8080/api/data")
DATA_SOURCE_INTERVAL = float(os.environ.get("DATA_SOURCE_INTERVAL", "1"))

# Cache
cache = Cache(Cache.MEMORY)


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("Client connected. Active connections: %d", len(self.active_connections))
        await websocket.send_json({
            "type": "status",
            "data": {
                "data_source_url": DATA_SOURCE_URL,
                "data_source_interval": DATA_SOURCE_INTERVAL,
            },
        })
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
            logger.info("Broadcasting update to %d client(s)", len(self.active_connections))
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning("Failed to send to client, dropping: %s", repr(e))
                self.disconnect(connection)


manager = ConnectionManager()


async def fetch_data_loop():
    async with httpx.AsyncClient(timeout=10.0) as client:
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
                    logger.warning("Failed to fetch data: HTTP %d", response.status_code)
            except Exception as e:
                logger.error("Error fetching data: %s", repr(e))
            await asyncio.sleep(DATA_SOURCE_INTERVAL)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(fetch_data_loop())
    logger.info("Fetch loop started — url=%s interval=%.1fs", DATA_SOURCE_URL, DATA_SOURCE_INTERVAL)
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

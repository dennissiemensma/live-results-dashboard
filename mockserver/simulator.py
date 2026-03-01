"""
Mock server for live-results-dashboard.
Serves GET /api/data — replays pre-recorded JSON samples from DATA_SAMPLE_DIRECTORY
in ascending filename order, waiting DATA_SAMPLE_INTERVAL seconds between each.
Stops after the last file (holds last state). POST /api/reset restarts from the first file.
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DATA_SAMPLE_DIRECTORY = os.environ.get("DATA_SAMPLE_DIRECTORY", "")  # e.g. "data/2026-03-01/"
DATA_SAMPLE_INTERVAL = float(os.environ.get("DATA_SAMPLE_INTERVAL", "5"))

_state: dict = {}
_replay_task: asyncio.Task | None = None


def _sample_files() -> list[Path]:
    base = Path(__file__).parent / DATA_SAMPLE_DIRECTORY
    return sorted(base.glob("*.json"))


async def _replay_loop() -> None:
    global _state
    files = _sample_files()
    if not files:
        log.error("Replay: no JSON files found in %s", Path(__file__).parent / DATA_SAMPLE_DIRECTORY)
        return
    log.info("Replay: %d files, interval=%.1fs", len(files), DATA_SAMPLE_INTERVAL)
    for i, path in enumerate(files, 1):
        _state = json.loads(path.read_text())
        log.info("Replay: loaded %s (%d/%d)", path.name, i, len(files))
        await asyncio.sleep(DATA_SAMPLE_INTERVAL)
    log.info("Replay complete — holding last sample")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _replay_task
    _replay_task = asyncio.create_task(_replay_loop())
    yield
    _replay_task.cancel()


app = FastAPI(title="Live Results Mock Server", lifespan=lifespan)


@app.get("/api/data")
async def get_data():
    return JSONResponse(content=_state)


@app.post("/api/reset")
async def reset():
    global _replay_task
    if _replay_task and not _replay_task.done():
        _replay_task.cancel()
    _replay_task = asyncio.create_task(_replay_loop())
    log.info("Replay reset")
    return {"reset": True}

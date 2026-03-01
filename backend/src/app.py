"""
Live Results Dashboard — Backend

Fetches raw race data from DATA_SOURCE_URL on each interval, processes it fully
(sorting, grouping, gap calculation, position tracking), then pushes per-competitor
and per-distance update messages to all connected WebSocket clients.

WebSocket message types (backend → frontend):
  status            — sent on connect: { data_source_url, data_source_interval }
  event_name        — { name }
  error             — human-readable error string
  distance_meta     — scalar fields for one distance (sent when any field changes)
  competitor_update — one message per changed competitor
"""

import asyncio
import os
import re
import logging
from contextlib import asynccontextmanager

import httpx
from aiocache import Cache
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── config ────────────────────────────────────────────────────────────────────
DATA_SOURCE_URL = os.environ.get("DATA_SOURCE_URL", "http://localhost:8080/api/data")
DATA_SOURCE_INTERVAL = float(os.environ.get("DATA_SOURCE_INTERVAL", "1"))

cache = Cache(Cache.MEMORY)

MANAGEMENT_PASSWORD = os.environ.get("MANAGEMENT_PASSWORD", "")

# Helper for password check
async def check_management_password(request: Request):
    header_pw = request.headers.get("x-api-key")
    if not header_pw or header_pw != MANAGEMENT_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── time helpers ──────────────────────────────────────────────────────────────

def _parse_seconds(t: str) -> float:
    if not t:
        return 0.0
    parts = t.split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    return float(parts[0])


def _format_time(t: str) -> str:
    """Strip leading zeros, truncate to 3 decimal places."""
    if not t:
        return ""
    colon_parts = t.split(":")
    result: list[str] = []
    found_nonzero = False
    for i, part in enumerate(colon_parts):
        is_last = i == len(colon_parts) - 1
        if is_last:
            dot = part.find(".")
            if dot != -1:
                int_part = part[:dot]
                dec_part = part[dot + 1:][:3]
                if not found_nonzero:
                    int_part = int_part.lstrip("0") or "0"
                result.append(f"{int_part}.{dec_part}")
            else:
                int_part = part if found_nonzero else (part.lstrip("0") or "0")
                result.append(int_part)
        else:
            num = int(part)
            if not found_nonzero and num == 0:
                continue
            found_nonzero = True
            result.append(str(num))
    return ":".join(result)


# ── data processing ───────────────────────────────────────────────────────────

def _process(raw: dict) -> dict:
    """
    Parse raw source data into fully computed dashboard state.
    Returns:
      {
        "name": str,
        "distances": { dist_id: <distance_meta> },
        "competitors": { dist_id: { race_id: <competitor_update> } },
      }
    """
    distances_out: dict[str, dict] = {}
    competitors_out: dict[str, dict[str, dict]] = {}

    for dist in raw.get("distances", []):
        dist_id = dist["id"]
        races = dist.get("races", [])

        # mass start: >2 races all in same heat
        is_mass_start = (
            len(races) > 2
            and len({r["heat"] for r in races}) == 1
        )

        # extract metadata from title
        total_laps: int | None = None
        distance_meters: int | None = None
        if is_mass_start:
            m = re.search(r"(\d+)\s*(?:laps?|ronden?|rondes?)", dist["name"], re.IGNORECASE)
            if m:
                total_laps = int(m.group(1))
        else:
            m = re.search(r"(\d+)\s*(?:m\b|meter)", dist["name"], re.IGNORECASE)
            if m:
                distance_meters = int(m.group(1))

        # per-competitor base processing
        processed: list[dict] = []
        for race in races:
            laps = list(race.get("laps") or [])
            if is_mass_start and laps:
                laps = laps[1:]  # omit warmup

            total_time = ""
            formatted_total_time = ""
            if laps:
                total_time = sorted(laps, key=lambda l: l["time"])[-1]["time"]
                formatted_total_time = _format_time(total_time)

            lane = "black" if is_mass_start else (race.get("lane") or "black")
            lap_times = [_format_time(lap.get("lapTime", "")) for lap in laps]
            raw_pr = race.get("personalRecord") or ""
            personal_record = _format_time(raw_pr) if raw_pr else None

            invalid_reason = race.get("invalidReason") or None
            remark = race.get("remark") or None

            processed.append({
                "start_number": race["competitor"]["startNumber"],
                "laps_count": len(laps),
                "total_time": total_time,
                "id": race["id"],
                "distance_id": dist_id,
                "name": race["competitor"]["name"],
                "heat": race["heat"],
                "lane": lane,
                "formatted_total_time": formatted_total_time,
                "lap_times": lap_times,
                "personal_record": personal_record,
                "laps_remaining": None,
                "finished_rank": None,
                "invalid_reason": invalid_reason,
                "remark": remark,
            })

        # sort: laps desc, time asc — stable ordering for broadcast sequence only, not sent to frontend
        processed.sort(key=lambda r: (-r["laps_count"], _parse_seconds(r["total_time"]) if r["total_time"] else float("inf")))

        # mass-start specific
        any_finished = False


        if is_mass_start and total_laps:
            finish_rank = 1
            for r in processed:
                r["laps_remaining"] = max(0, total_laps - r["laps_count"])
                if r["laps_remaining"] == 0:
                    r["finished_rank"] = finish_rank
                    finish_rank += 1
                    any_finished = True

        # non-mass heat groups
        heat_groups: list[dict] = []
        if not is_mass_start:
            heat_map: dict[int, list[str]] = {}
            for r in processed:
                heat_map.setdefault(r["heat"], []).append(r["id"])
            heat_groups = [{"heat": h, "race_ids": heat_map[h]} for h in sorted(heat_map)]

        distances_out[dist_id] = {
            "id": dist_id,
            "name": dist["name"],
            "event_number": dist.get("eventNumber", 0),
            "is_live": dist.get("isLive", False),
            "is_mass_start": is_mass_start,
            "distance_meters": distance_meters,
            "total_laps": total_laps,
            "any_finished": any_finished,
            "heat_groups": heat_groups,
        }
        competitors_out[dist_id] = {r["id"]: r for r in processed}

    return {
        "name": raw.get("name", ""),
        "distances": distances_out,
        "competitors": competitors_out,
    }


def _diff(prev: dict | None, curr: dict) -> tuple[list[dict], list[dict]]:
    """Return (changed_distance_metas, changed_competitor_updates)."""
    dist_updates: list[dict] = []
    comp_updates: list[dict] = []
    prev_dists = (prev or {}).get("distances", {})
    prev_comps = (prev or {}).get("competitors", {})

    for dist_id, dist in curr["distances"].items():
        if prev_dists.get(dist_id) != dist:
            dist_updates.append(dist)
        prev_dist_comps = prev_comps.get(dist_id, {})
        for race_id, comp in curr["competitors"].get(dist_id, {}).items():
            if prev_dist_comps.get(race_id) == comp:
                continue  # unchanged
            is_new = race_id not in prev_dist_comps
            if not comp.get("total_time") and not is_new:
                continue  # suppress no-time updates after initial appearance
            comp_updates.append(comp)

    return dist_updates, comp_updates


# ── WebSocket connection manager ──────────────────────────────────────────────

class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)
        logger.info("Client connected. Active: %d", len(self.active))

        await ws.send_json({
            "type": "status",
            "data": {
                "data_source_url": DATA_SOURCE_URL,
                "data_source_interval": DATA_SOURCE_INTERVAL,
            },
        })

        state: dict | None = await cache.get("processed_state")
        if state:
            logger.info("Replaying latest state to new client")
            await ws.send_json({"type": "event_name", "data": {"name": state["name"]}})
            for dist in state["distances"].values():
                await ws.send_json({"type": "distance_meta", "data": dist})
            for dist_comps in state["competitors"].values():
                for comp in dist_comps.values():
                    await ws.send_json({"type": "competitor_update", "data": comp})

    def disconnect(self, ws: WebSocket) -> None:
        self.active = [c for c in self.active if c is not ws]

    async def broadcast(self, msg: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.active):
            try:
                await ws.send_json(msg)
            except Exception as e:
                logger.warning("Send failed, dropping client: %s", repr(e))
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


# ── fetch loop ────────────────────────────────────────────────────────────────

POLLING_ACTIVE = True

async def fetch_data_loop() -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            if not POLLING_ACTIVE:
                await asyncio.sleep(0.5)
                continue
            try:
                resp = await client.get(DATA_SOURCE_URL)
                if resp.status_code == 200:
                    raw = resp.json()
                    if raw.get("success") is False:
                        logger.warning("Source data has success=false")
                        await manager.broadcast({"type": "error", "data": "Source returned success=false"})
                    else:
                        curr = _process(raw)
                        prev: dict | None = await cache.get("processed_state")
                        if curr != prev:
                            logger.info("New data — computing diff")
                            dist_updates, comp_updates = _diff(prev, curr)
                            await cache.set("processed_state", curr)

                            if prev is None or prev.get("name") != curr["name"]:
                                await manager.broadcast({"type": "event_name", "data": {"name": curr["name"]}})

                            for dist in dist_updates:
                                await manager.broadcast({"type": "distance_meta", "data": dist})
                            for comp in comp_updates:
                                logger.info(
                                    "competitor_update: #%s %s — laps=%s total_time=%s (%s)",
                                    comp["start_number"],
                                    comp["name"],
                                    comp["laps_count"],
                                    comp["total_time"],
                                    comp["formatted_total_time"],
                                )
                                await manager.broadcast({"type": "competitor_update", "data": comp})

                            logger.info(
                                "Broadcast: %d distance_meta, %d competitor_update",
                                len(dist_updates), len(comp_updates),
                            )
                else:
                    logger.warning("Fetch failed: HTTP %d", resp.status_code)
            except Exception as e:
                logger.error("Error fetching data: %s", repr(e))
            await asyncio.sleep(DATA_SOURCE_INTERVAL)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(fetch_data_loop())
    logger.info(
        "Fetch loop started — url=%s interval=%.1fs",
        DATA_SOURCE_URL, DATA_SOURCE_INTERVAL,
    )
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)


@app.get("/manage/source_url")
async def get_source_url(request: Request):
    await check_management_password(request)
    return {"data_source_url": DATA_SOURCE_URL}


@app.post("/manage/source_url")
async def set_source_url(request: Request):
    await check_management_password(request)
    body = await request.json()
    url = body.get("data_source_url")
    if not url:
        raise HTTPException(status_code=400, detail="Missing data_source_url")
    global DATA_SOURCE_URL
    DATA_SOURCE_URL = url
    return {"data_source_url": DATA_SOURCE_URL}


@app.get("/manage/interval")
async def get_interval(request: Request):
    await check_management_password(request)
    return {"data_source_interval": DATA_SOURCE_INTERVAL}


@app.post("/manage/interval")
async def set_interval(request: Request):
    await check_management_password(request)
    body = await request.json()
    interval = body.get("data_source_interval")
    if interval is None:
        raise HTTPException(status_code=400, detail="Missing data_source_interval")
    global DATA_SOURCE_INTERVAL
    DATA_SOURCE_INTERVAL = float(interval)
    return {"data_source_interval": DATA_SOURCE_INTERVAL}


@app.post("/manage/reset")
async def reset_data(request: Request):
    await check_management_password(request)
    await cache.set("processed_state", None)
    return {"reset": True}


@app.get("/manage/polling")
async def get_polling(request: Request):
    await check_management_password(request)
    return {"polling": POLLING_ACTIVE}


@app.post("/manage/polling")
async def set_polling(request: Request):
    await check_management_password(request)
    body = await request.json()
    action = body.get("action")
    global POLLING_ACTIVE
    if action == "start":
        POLLING_ACTIVE = True
    elif action == "stop":
        POLLING_ACTIVE = False
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    return {"polling": POLLING_ACTIVE}

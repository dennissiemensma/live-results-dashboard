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
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── config ────────────────────────────────────────────────────────────────────
DATA_SOURCE_URL = os.environ.get("DATA_SOURCE_URL", "http://localhost:8080/api/data")
DATA_SOURCE_INTERVAL = float(os.environ.get("DATA_SOURCE_INTERVAL", "1"))

cache = Cache(Cache.MEMORY)


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


def _time_diff(a: str, b: str) -> float:
    if not a or not b:
        return 9999.0
    return abs(_parse_seconds(a) - _parse_seconds(b))


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
            formatted_total_time = "No Time"
            if laps:
                total_time = sorted(laps, key=lambda l: l["time"])[-1]["time"]
                formatted_total_time = _format_time(total_time)

            lane = "black" if is_mass_start else (race.get("lane") or "black")

            processed.append({
                "id": race["id"],
                "distance_id": dist_id,
                "start_number": race["competitor"]["startNumber"],
                "name": race["competitor"]["name"],
                "heat": race["heat"],
                "lane": lane,
                "laps_count": len(laps),
                "total_time": total_time,
                "formatted_total_time": formatted_total_time,
                "position": 0,
                "position_change": None,
                "gap_to_above": None,
                "laps_remaining": None,
                "is_final_lap": False,
                "finished_rank": None,
                "group_number": None,
            })

        # sort: laps desc, time asc
        processed.sort(key=lambda r: (-r["laps_count"], r["total_time"] or "99:99:99"))
        for i, r in enumerate(processed):
            r["position"] = i + 1

        # mass-start specific
        any_finished = False
        standings_groups: list[dict] = []

        # finishing line sits below the last competitor that has a total time
        with_time = [r for r in processed if r["total_time"]]
        finishing_line_after: str | None = with_time[-1]["id"] if with_time else None

        if is_mass_start and total_laps:
            finish_rank = 1
            for r in processed:
                r["laps_remaining"] = max(0, total_laps - r["laps_count"])
                r["is_final_lap"] = r["laps_remaining"] == 1
                if r["laps_remaining"] == 0:
                    r["finished_rank"] = finish_rank
                    finish_rank += 1
                    any_finished = True

            # standings groups (unfinished only, must have a total time)
            unfinished = [r for r in processed if r["finished_rank"] is None and r["total_time"]]
            groups: list[dict] = []
            cur: dict | None = None
            for r in unfinished:
                if cur is None:
                    cur = {"laps": r["laps_count"], "races": [r]}
                    groups.append(cur)
                elif r["laps_count"] == cur["laps"] and _time_diff(cur["races"][-1]["total_time"], r["total_time"]) <= 2.0:
                    cur["races"].append(r)
                else:
                    cur = {"laps": r["laps_count"], "races": [r]}
                    groups.append(cur)

            leader_time = groups[0]["races"][0]["total_time"] if groups and groups[0]["races"] else None

            for gi, group in enumerate(groups):
                gnum = gi + 1
                for ri, r in enumerate(group["races"]):
                    r["group_number"] = gnum
                    if ri > 0:
                        diff = _time_diff(group["races"][ri - 1]["total_time"], r["total_time"])
                        r["gap_to_above"] = f"+{diff:.3f}s"

                first = group["races"][0]
                gap_to_ahead: str | None = None
                behind_leader: str | None = None
                if gi > 0:
                    prev_last = groups[gi - 1]["races"][-1]
                    if prev_last["total_time"] and first["total_time"]:
                        gap_to_ahead = f"+{_time_diff(prev_last['total_time'], first['total_time']):.3f}s"
                    if leader_time and first["total_time"]:
                        behind_leader = f"+{_time_diff(leader_time, first['total_time']):.3f}s"

                standings_groups.append({
                    "group_number": gnum,
                    "laps": group["laps"],
                    "leader_time": first["formatted_total_time"] if first["total_time"] else None,
                    "gap_to_group_ahead": gap_to_ahead,
                    "time_behind_leader": behind_leader,
                    "is_last_group": False,
                    "race_ids": [r["id"] for r in group["races"]],
                })

            if standings_groups:
                standings_groups[-1]["is_last_group"] = True

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
            "finishing_line_after": finishing_line_after,
            "standings_groups": standings_groups,
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
            if prev_dist_comps.get(race_id) != comp:
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

async def fetch_data_loop() -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
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
                                    "competitor_update: #%s %s — laps=%s total_time=%s (%s) pos=%s (%s)",
                                    comp["start_number"],
                                    comp["name"],
                                    comp["laps_count"],
                                    comp["total_time"],
                                    comp["formatted_total_time"],
                                    comp["position"],
                                    comp["position_change"] or "=",
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

"""
Dynamic mock server for live-results-dashboard.
Serves GET /api/data — returns example.json with the live mass-start distance
mutated in real-time to simulate a realistic inline-skating mass-start race.

Simulation model
────────────────
• Competitors are split into two tiers at race start:
  - Main pack (all but last): paces drawn within a 10 s window so they
    stay on the same lap and produce realistic group / position-change dynamics.
  - Loner (last competitor): a distinctly slower fixed pace, always a lap
    or more behind the pack.
• A per-lap noise of ±LAP_NOISE (5 s) is applied to pack competitors each lap,
  clamped to [LAP_MIN - LAP_NOISE, LAP_MAX + LAP_NOISE].  The loner gets no
  noise — it moves at a steady, predictable rate.
• Competitors are ticked independently: a competitor completes their next lap
  once wall-clock time ≥ their scheduled next-lap timestamp.
• Once every competitor has completed MAX_LAPS the distance is marked
  isLive=False. Competitors that finished are kept in the standings but receive
  no further laps. The simulation stays idle until POST /api/reset is called.

Does NOT modify example.json on disk.
"""

import asyncio
import copy
import json
import logging
import random
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from faker import Faker
from fastapi import FastAPI
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

_fake = Faker()
Faker.seed(0)  # reproducible across restarts until explicitly re-seeded each race

# ── config ────────────────────────────────────────────────────────────────────
TICK_INTERVAL = 0.5     # seconds between simulation ticks (fine-grained)
LAP_MIN = 10.0          # minimum lap time (seconds)
LAP_MAX = 30.0          # maximum lap time (seconds)
LAP_NOISE = 5.0         # ± per-lap random noise on top of personal pace
MAX_LAPS = 20           # total race laps (excl. warmup lap)

# ── load base data ────────────────────────────────────────────────────────────
_base_path = Path(__file__).parent / "data" / "example.json"
_base_data: dict = json.loads(_base_path.read_text())


def _find_live_mass_start(data: dict) -> dict | None:
    """Return the live mass-start distance dict, or None."""
    for dist in data.get("distances", []):
        if not dist.get("isLive"):
            continue
        races = dist.get("races", [])
        if len(races) > 2 and len({r["heat"] for r in races}) == 1:
            return dist
    return None


_base_dist = _find_live_mass_start(_base_data)
_live_dist_id: str | None = _base_dist["id"] if _base_dist else None
log.info("Live mass-start distance id: %s", _live_dist_id)


# ── time helpers ──────────────────────────────────────────────────────────────

def _parse_time(t: str) -> float:
    """Parse HH:MM:SS.fffffff → total seconds."""
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def _fmt(total_seconds: float) -> str:
    """Format seconds → HH:MM:SS.7f matching source-data format."""
    total_seconds = max(0.0, total_seconds)
    h = int(total_seconds // 3600)
    rem = total_seconds - h * 3600
    m = int(rem // 60)
    s = rem - m * 60
    return f"{h:02d}:{m:02d}:{s:010.7f}"


# ── per-competitor simulation state ──────────────────────────────────────────

@dataclass
class CompetitorSim:
    race_id: str
    personal_pace: float          # target seconds/lap
    next_lap_at: float            # wall-clock time when next lap completes
    elapsed_race_time: float      # cumulative race time in seconds
    laps_done: int                # laps completed (excl. warmup)


_sims: dict[str, CompetitorSim] = {}   # race_id → CompetitorSim
_state: dict = {}
_race_finished = False


def _assign_fake_names(state: dict) -> None:
    """Replace every competitor name in the live mass-start distance with a
    freshly generated fake full name.  Re-seeded with a random seed each call
    so each simulated race has a different field of competitors."""
    Faker.seed(random.randint(0, 2**32))
    dist = _find_live_mass_start(state)
    if not dist:
        return
    for race in dist["races"]:
        race["competitor"]["name"] = _fake.name()
    log.info("Assigned fake names to %d competitors", len(dist["races"]))


def _init_simulation() -> None:
    """Build fresh _state and _sims from the base data."""
    global _state, _sims, _race_finished

    _state = copy.deepcopy(_base_data)
    _assign_fake_names(_state)
    _sims = {}
    _race_finished = False

    dist = _find_live_mass_start(_state)
    if not dist:
        log.warning("No live mass-start distance found — simulation idle")
        return

    # Ensure isLive is True at the start of a new race
    dist["isLive"] = True

    now = time.monotonic()
    races = dist["races"]

    # Two-tier pacing:
    #   Main pack (all but last): paces within a 10s window so they stay
    #   on the same lap and produce interesting group dynamics.
    #   Last competitor: a distinctly slower steady pace on its own.
    PACK_WINDOW = 10.0          # max spread within the main pack (seconds/lap)
    LONER_GAP   = 15.0          # how much slower the loner is vs the slowest pack member

    pack_base = random.uniform(LAP_MIN, LAP_MAX - PACK_WINDOW)
    pack_races = races[:-1]
    loner_race  = races[-1]

    for race in pack_races:
        rid = race["id"]
        warmup_time = _parse_time(race["laps"][0]["time"]) if race["laps"] else 0.0
        pace = pack_base + random.uniform(0.0, PACK_WINDOW)
        jitter = random.uniform(0.0, pace * 0.25)
        _sims[rid] = CompetitorSim(
            race_id=rid,
            personal_pace=pace,
            next_lap_at=now + warmup_time + pace + jitter,
            elapsed_race_time=warmup_time,
            laps_done=len(race["laps"]) - 1,
        )

    # Loner: fixed slow pace, no jitter so it moves at a steady predictable rate
    loner_pace = pack_base + PACK_WINDOW + LONER_GAP
    loner_warmup = _parse_time(loner_race["laps"][0]["time"]) if loner_race["laps"] else 0.0
    _sims[loner_race["id"]] = CompetitorSim(
        race_id=loner_race["id"],
        personal_pace=loner_pace,
        next_lap_at=now + loner_warmup + loner_pace,
        elapsed_race_time=loner_warmup,
        laps_done=len(loner_race["laps"]) - 1,
    )

    log.info(
        "Simulation initialised: %d competitors — pack base=%.1fs window=%.1fs, loner=%.1fs/lap",
        len(_sims), pack_base, PACK_WINDOW, loner_pace,
    )


def _tick() -> None:
    """Advance the simulation by one tick — complete any due laps."""
    global _race_finished

    if _race_finished:
        return

    dist = next((d for d in _state["distances"] if d["id"] == _live_dist_id), None)
    if not dist:
        return

    now = time.monotonic()
    any_updated = False

    for race in dist["races"]:
        rid = race["id"]
        sim = _sims.get(rid)
        if not sim or sim.laps_done >= MAX_LAPS:
            continue
        if now < sim.next_lap_at:
            continue

        # Competitor completes a lap.
        # Loner (last race) runs at fixed pace; pack gets ± noise each lap.
        dist_races = dist["races"]
        is_loner = (race is dist_races[-1])
        if is_loner:
            lap_secs = sim.personal_pace
        else:
            noise = random.uniform(-LAP_NOISE, LAP_NOISE)
            lap_secs = max(LAP_MIN - LAP_NOISE, min(LAP_MAX + LAP_NOISE, sim.personal_pace + noise))
        sim.elapsed_race_time += lap_secs
        sim.laps_done += 1

        race["laps"].append({
            "time": _fmt(sim.elapsed_race_time),
            "lapTime": _fmt(lap_secs),
        })

        name = race["competitor"]["name"]
        start_num = race["competitor"]["startNumber"]
        log.info(
            "Mocked lap: #%s %s — lap %d/%d  lap=%.3fs  total=%s",
            start_num, name, sim.laps_done, MAX_LAPS, lap_secs, _fmt(sim.elapsed_race_time),
        )

        # Schedule next lap (loner: fixed interval; pack: fresh noise)
        if is_loner:
            sim.next_lap_at = now + sim.personal_pace
        else:
            next_noise = random.uniform(-LAP_NOISE, LAP_NOISE)
            next_lap = max(LAP_MIN - LAP_NOISE, min(LAP_MAX + LAP_NOISE, sim.personal_pace + next_noise))
            sim.next_lap_at = now + next_lap
        any_updated = True

    if any_updated:
        finished_count = sum(1 for s in _sims.values() if s.laps_done >= MAX_LAPS)
        log.info(
            "Standings: %d/%d competitors finished all %d laps",
            finished_count, len(_sims), MAX_LAPS,
        )

    # Check if all competitors have finished
    if all(s.laps_done >= MAX_LAPS for s in _sims.values()):
        dist["isLive"] = False
        _race_finished = True
        log.info("Race finished — use POST /api/reset to restart")


# ── background simulation loop ────────────────────────────────────────────────

async def _simulation_loop() -> None:
    _init_simulation()
    while True:
        await asyncio.sleep(TICK_INTERVAL)
        if not _race_finished:
            _tick()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_simulation_loop())
    log.info(
        "Simulator ready — tick=%.1fs, lap_range=%.0f–%.0fs, noise=±%.0fs, max_laps=%d",
        TICK_INTERVAL, LAP_MIN, LAP_MAX, LAP_NOISE, MAX_LAPS,
    )
    yield
    task.cancel()


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Live Results Mock Server", lifespan=lifespan)


@app.get("/api/data")
async def get_data():
    return JSONResponse(content=_state)


@app.post("/api/reset")
async def reset():
    """Restart the simulation immediately from the example.json baseline."""
    _init_simulation()
    log.info("Simulation manually reset")
    return {"reset": True}

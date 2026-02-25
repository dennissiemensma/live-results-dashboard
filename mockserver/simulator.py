"""
Dynamic mock server for live-results-dashboard.
Serves GET /api/data — returns a fully simulated event with:

  • One live mass-start distance (20 rondes Mass.start) — competitors from example.json
  • Four non-mass-start distances: 100m, 500m, 1000m, 1500m
    First lap starts before the finish line; each subsequent lap is 400 m:
      100m  — first lap 100 m  (starts 100 m before finish)
      500m  — first lap 500 m  (starts 100 m before finish)
      1000m — first lap 1000 m (starts 200 m before finish)
      1500m — first lap 1500 m (starts 300 m before finish)

Simulation model
────────────────
• Mass start: main pack + one slower loner; paces within 5 s window.
• Non-mass start: 2–4 heats of 2–4 competitors each, each assigned a lane;
  competitors run independently; once all finish the distance goes isLive=False.
• Next lap is scheduled from the competitor's due time to prevent drift.
• total_time measured from a shared race-start origin per distance.
• A competitor's total_time is strictly monotonically increasing.

Does NOT modify example.json on disk.
"""

import asyncio
import copy
import json
import logging
import random
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from faker import Faker
from fastapi import FastAPI
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

_fake = Faker()
Faker.seed(0)

# ── config ────────────────────────────────────────────────────────────────────
TICK_INTERVAL = 0.5       # seconds between simulation ticks
WARMUP_MIN = 10.0         # warmup lap min duration (mass start)
WARMUP_MAX = 15.0         # warmup lap max duration (mass start)
LAP_MIN = 10.0            # min lap time for mass start
LAP_MAX = 30.0            # max lap time for mass start
LAP_NOISE = 1.0           # ± per-lap noise (mass start)
MAX_LAPS = 20             # mass-start race laps (excl. warmup)
MAX_COMPETITORS = None    # limit field size for debugging (None = all)

# Non-mass-start speed range (meters/second)
NMS_SPEED_MIN = 8.0       # ~28.8 km/h
NMS_SPEED_MAX = 14.0      # ~50.4 km/h
NMS_SPEED_NOISE = 0.3     # ± per-lap noise (m/s)

# Non-mass-start distance definitions
# heats: list of (heat_number, lane_colors_list)
NON_MASS_DISTANCES = [
    {
        "name": "100 meter",
        "event_number": 1.0,
        "first_lap_meters": 100.0,   # 100 % 400 = 100
        "lap_meters": 400.0,
        "heats": [
            (1, ["white", "yellow"]),
            (2, ["blue", "red"]),
            (3, ["white", "yellow", "blue"]),
        ],
    },
    {
        "name": "500 meter",
        "event_number": 2.0,
        "first_lap_meters": 100.0,   # 500 % 400 = 100
        "lap_meters": 400.0,
        "heats": [
            (1, ["white", "yellow"]),
            (2, ["blue", "red", "white"]),
        ],
    },
    {
        "name": "1000 meter",
        "event_number": 3.0,
        "first_lap_meters": 200.0,   # 1000 % 400 = 200
        "lap_meters": 400.0,
        "heats": [
            (1, ["white", "yellow", "blue", "red"]),
            (2, ["white", "yellow", "blue"]),
        ],
    },
    {
        "name": "1500 meter",
        "event_number": 4.0,
        "first_lap_meters": 300.0,   # 1500 % 400 = 300
        "lap_meters": 400.0,
        "heats": [
            (1, ["white", "yellow", "blue", "red"]),
            (2, ["white", "yellow", "blue", "red"]),
        ],
    },
]

# ── load base data ────────────────────────────────────────────────────────────
_base_path = Path(__file__).parent / "data" / "example.json"
_base_data: dict = json.loads(_base_path.read_text())


def _find_live_mass_start(data: dict) -> dict | None:
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

def _fmt(total_seconds: float) -> str:
    """Format seconds → HH:MM:SS.fff (3 decimal places)."""
    total_seconds = max(0.0, total_seconds)
    h = int(total_seconds // 3600)
    rem = total_seconds - h * 3600
    m = int(rem // 60)
    s = rem - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


# ── per-competitor simulation state ──────────────────────────────────────────

@dataclass
class CompetitorSim:
    race_id: str
    dist_id: str
    personal_pace: float      # m/s (non-mass) or s/lap (mass)
    next_lap_at: float        # wall-clock time when next lap completes
    elapsed_race_time: float
    laps_done: int
    last_committed_time: float
    finished: bool = False
    is_loner: bool = False
    is_mass_start: bool = False
    meters_remaining: float = 0.0   # non-mass: meters left after current lap
    lap_meters: float = 400.0       # non-mass: subsequent lap length


_sims: dict[str, CompetitorSim] = {}
_state: dict = {}
_dist_finished: dict[str, bool] = {}
_race_starts: dict[str, float] = {}


def _total_laps_for(defn: dict) -> int:
    """Total number of laps for a timed distance definition."""
    first_m = defn["first_lap_meters"]
    # distance_meters is derivable from the name
    name = defn["name"]
    m = __import__("re").search(r"(\d+)", name)
    dist_m = float(m.group(1)) if m else first_m
    if dist_m <= first_m:
        return 1
    remaining = dist_m - first_m
    return 1 + int(round(remaining / defn["lap_meters"]))


def _build_non_mass_distances(now: float) -> list[dict]:
    """Build non-mass-start distance dicts and initialise their sims."""
    distances = []
    start_num = random.randint(1, 20)
    for defn in NON_MASS_DISTANCES:
        dist_id = str(uuid.uuid4())
        races = []
        # pre-compute expected total laps and distance meters for this defn
        name = defn["name"]
        import re as _re
        m = _re.search(r"(\d+)", name)
        dist_meters = float(m.group(1)) if m else defn["first_lap_meters"]
        total_laps = _total_laps_for(defn)

        for heat_num, lane_colors in defn["heats"]:
            for i, lane in enumerate(lane_colors):
                race_id = str(uuid.uuid4())
                # ~50% of competitors get a personal record
                # PR is set slightly above their expected time so ~half will beat it
                speed = random.uniform(NMS_SPEED_MIN, NMS_SPEED_MAX)
                expected_secs = dist_meters / speed
                # 1-in-2 chance: set PR between expected*1.0 and expected*1.15 (beatable)
                # 1-in-2 chance: set PR between expected*0.85 and expected*1.0 (not beatable)
                if random.random() < 0.5:
                    pr_secs = expected_secs * random.uniform(1.01, 1.15)  # beatable PR
                else:
                    pr_secs = expected_secs * random.uniform(0.85, 0.99)  # unbeatable PR
                personal_record = _fmt(pr_secs) if random.random() < 0.7 else None

                races.append({
                    "id": race_id,
                    "competitor": {
                        "id": str(uuid.uuid4()),
                        "name": _fake.name(),
                        "startNumber": str(start_num),
                        "category": "SEN",
                        "nationality": "NED",
                        "clubCode": "DEV",
                        "personalRecord": personal_record,
                    },
                    "heat": heat_num,
                    "lane": lane,
                    "points": None,
                    "rank": None,
                    "remark": "",
                    "invalidReason": "",
                    "status": 0,
                    "time": "00:00:00",
                    "personalRecord": personal_record,
                    "laps": [],
                })
                start_num += 1

                first_m = defn["first_lap_meters"]
                lap_m = defn["lap_meters"]
                first_secs = first_m / speed
                jitter = random.uniform(0.0, 2.0)
                meters_remaining = dist_meters - first_m  # 0 for 100m, 400 for 500m, etc.

                _sims[race_id] = CompetitorSim(
                    race_id=race_id,
                    dist_id=dist_id,
                    personal_pace=speed,
                    next_lap_at=now + first_secs + jitter,
                    elapsed_race_time=0.0,
                    laps_done=0,
                    last_committed_time=0.0,
                    is_mass_start=False,
                    meters_remaining=meters_remaining,
                    lap_meters=lap_m,
                )

        dist = {
            "id": dist_id,
            "name": defn["name"],
            "eventNumber": defn["event_number"],
            "isLive": True,
            "races": races,
            "_total_laps": total_laps,  # internal: used for completion check
        }
        _dist_finished[dist_id] = False
        _race_starts[dist_id] = now
        distances.append(dist)
    return distances


def _init_simulation() -> None:
    """Build fresh _state and _sims."""
    global _state, _sims, _dist_finished, _race_starts

    _sims = {}
    _dist_finished = {}
    _race_starts = {}

    Faker.seed(random.randint(0, 2**32))
    now = time.monotonic()

    # ── Non-mass-start distances ──────────────────────────────────────────────
    non_mass_dists = _build_non_mass_distances(now)

    # ── Mass-start distance ───────────────────────────────────────────────────
    mass_state = copy.deepcopy(_base_data)
    _assign_fake_names(mass_state)
    mass_dist = _find_live_mass_start(mass_state)

    if mass_dist:
        races = mass_dist["races"]
        if MAX_COMPETITORS is not None:
            races = races[:MAX_COMPETITORS]
            mass_dist["races"] = races

        mass_dist["isLive"] = True
        _dist_finished[mass_dist["id"]] = False
        _race_starts[mass_dist["id"]] = now

        PACK_WINDOW = 5.0
        LONER_GAP = 15.0
        pack_base = random.uniform(LAP_MIN, LAP_MAX - PACK_WINDOW)
        pack_races = races[:-1]
        loner_race = races[-1]

        for race in pack_races:
            rid = race["id"]
            warmup_secs = random.uniform(WARMUP_MIN, WARMUP_MAX)
            pace = pack_base + random.uniform(0.0, PACK_WINDOW)
            jitter = random.uniform(0.0, pace * 0.25)
            race["laps"] = [{"time": _fmt(warmup_secs), "lapTime": _fmt(warmup_secs)}]
            _sims[rid] = CompetitorSim(
                race_id=rid,
                dist_id=mass_dist["id"],
                personal_pace=pace,
                next_lap_at=now + warmup_secs + pace + jitter,
                elapsed_race_time=0.0,
                laps_done=0,
                last_committed_time=0.0,
                is_mass_start=True,
            )

        loner_warmup = random.uniform(WARMUP_MIN, WARMUP_MAX)
        loner_pace = pack_base + PACK_WINDOW + LONER_GAP
        loner_race["laps"] = [{"time": _fmt(loner_warmup), "lapTime": _fmt(loner_warmup)}]
        _sims[loner_race["id"]] = CompetitorSim(
            race_id=loner_race["id"],
            dist_id=mass_dist["id"],
            personal_pace=loner_pace,
            next_lap_at=now + loner_warmup + loner_pace,
            elapsed_race_time=0.0,
            laps_done=0,
            last_committed_time=0.0,
            is_loner=True,
            is_mass_start=True,
        )
        log.info(
            "Mass-start init: %d competitors — pack_base=%.1fs loner=%.1fs/lap",
            len(races), pack_base, loner_pace,
        )

    # ── Assemble final state ──────────────────────────────────────────────────
    all_dists = non_mass_dists + ([mass_dist] if mass_dist else [])
    all_dists.sort(key=lambda d: d.get("eventNumber", 0))

    _state = {
        "id": mass_state.get("id", str(uuid.uuid4())),
        "name": mass_state.get("name", "Simulated Event"),
        "isInternational": False,
        "distances": all_dists,
        "success": True,
        "errorMessage": "",
        "errorMode": False,
        "resultUrl": "",
    }

    log.info("Simulation initialised: %d distances", len(all_dists))


def _assign_fake_names(state: dict) -> None:
    dist = _find_live_mass_start(state)
    if not dist:
        return
    for race in dist["races"]:
        race["competitor"]["name"] = _fake.name()
    log.info("Assigned fake names to %d mass-start competitors", len(dist["races"]))


def _tick() -> None:
    """Advance the simulation by one tick."""
    now = time.monotonic()
    dists_by_id: dict[str, dict] = {d["id"]: d for d in _state.get("distances", [])}

    for rid, sim in list(_sims.items()):
        if sim.finished or _dist_finished.get(sim.dist_id, True):
            continue
        if now < sim.next_lap_at:
            continue

        dist = dists_by_id.get(sim.dist_id)
        if not dist:
            continue
        race = next((r for r in dist["races"] if r["id"] == rid), None)
        if not race:
            continue

        race_start = _race_starts.get(sim.dist_id, now)

        if sim.is_mass_start:
            _tick_mass(sim, race, race_start)
        else:
            _tick_non_mass(sim, race, dist, race_start)

    # Check per-distance completion
    for dist_id, dist in dists_by_id.items():
        if _dist_finished.get(dist_id):
            continue
        dist_sims = [s for s in _sims.values() if s.dist_id == dist_id]
        if not dist_sims:
            continue
        required_laps = dist.get("_total_laps")
        if required_laps is not None:
            # timed distance: all competitors must have completed all required laps
            all_done = all(s.laps_done >= required_laps for s in dist_sims)
        else:
            # mass start: all competitors marked finished
            all_done = all(s.finished for s in dist_sims)
        if all_done:
            dist["isLive"] = False
            _dist_finished[dist_id] = True
            log.info("Distance '%s' finished — all competitors done", dist.get("name"))


def _tick_mass(sim: CompetitorSim, race: dict, race_start: float) -> None:
    """Tick one mass-start competitor lap."""
    is_loner = sim.is_loner
    if is_loner:
        lap_secs = sim.personal_pace
    else:
        noise = random.uniform(-LAP_NOISE, LAP_NOISE)
        lap_secs = max(LAP_MIN - LAP_NOISE, min(LAP_MAX + LAP_NOISE, sim.personal_pace + noise))

    total_race_time = sim.next_lap_at - race_start
    sim.laps_done += 1

    if total_race_time <= sim.last_committed_time:
        log.warning(
            "Skipping retroactive mass-start time for #%s: %.3fs ≤ %.3fs",
            race["competitor"]["startNumber"], total_race_time, sim.last_committed_time,
        )
        sim.laps_done -= 1
        sim.next_lap_at += lap_secs
        return

    sim.last_committed_time = total_race_time
    sim.elapsed_race_time = total_race_time

    race["laps"].append({
        "time": _fmt(total_race_time),
        "lapTime": _fmt(lap_secs),
    })
    log.info(
        "Mass lap: #%s %s — lap %d/%d  split=%.3fs  total=%s",
        race["competitor"]["startNumber"], race["competitor"]["name"],
        sim.laps_done, MAX_LAPS, lap_secs, _fmt(total_race_time),
    )

    if sim.laps_done >= MAX_LAPS:
        sim.finished = True
        return

    next_noise = random.uniform(-LAP_NOISE, LAP_NOISE)
    next_lap = sim.personal_pace if is_loner else max(LAP_MIN - LAP_NOISE, min(LAP_MAX + LAP_NOISE, sim.personal_pace + next_noise))
    sim.next_lap_at += next_lap


def _tick_non_mass(sim: CompetitorSim, race: dict, dist: dict, race_start: float) -> None:
    """Tick one non-mass-start competitor lap."""
    # Determine lap distance and compute split time
    if sim.laps_done == 0:
        # First lap — find its distance from the distance definition
        lap_m = _first_lap_meters(dist["name"])
    else:
        lap_m = sim.lap_meters

    noise = random.uniform(-NMS_SPEED_NOISE, NMS_SPEED_NOISE)
    speed = max(NMS_SPEED_MIN * 0.5, sim.personal_pace + noise)
    lap_secs = lap_m / speed

    total_race_time = sim.next_lap_at - race_start
    sim.laps_done += 1

    if total_race_time <= sim.last_committed_time:
        log.warning(
            "Skipping retroactive non-mass time for #%s: %.3fs ≤ %.3fs",
            race["competitor"]["startNumber"], total_race_time, sim.last_committed_time,
        )
        sim.laps_done -= 1
        retry_m = sim.lap_meters if sim.meters_remaining > 0 else lap_m
        sim.next_lap_at += retry_m / max(1.0, sim.personal_pace)
        return

    sim.last_committed_time = total_race_time
    sim.elapsed_race_time = total_race_time

    race["laps"].append({
        "time": _fmt(total_race_time),
        "lapTime": _fmt(lap_secs),
    })
    log.info(
        "Non-mass lap: #%s %s [%s] — lap %d  split=%.3fs  total=%s  rem=%.0fm",
        race["competitor"]["startNumber"], race["competitor"]["name"],
        dist["name"], sim.laps_done, lap_secs, _fmt(total_race_time), sim.meters_remaining,
    )

    if sim.meters_remaining <= 0:
        sim.finished = True
        return

    next_m = min(sim.lap_meters, sim.meters_remaining)
    sim.meters_remaining -= next_m
    next_noise = random.uniform(-NMS_SPEED_NOISE, NMS_SPEED_NOISE)
    next_speed = max(NMS_SPEED_MIN * 0.5, sim.personal_pace + next_noise)
    sim.next_lap_at += next_m / next_speed


def _first_lap_meters(dist_name: str) -> float:
    for defn in NON_MASS_DISTANCES:
        if defn["name"] == dist_name:
            return defn["first_lap_meters"]
    return 400.0


# ── background simulation loop ────────────────────────────────────────────────

async def _simulation_loop() -> None:
    _init_simulation()
    while True:
        await asyncio.sleep(TICK_INTERVAL)
        _tick()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_simulation_loop())
    log.info(
        "Simulator ready — tick=%.1fs  mass_max_laps=%d  non-mass distances=%d",
        TICK_INTERVAL, MAX_LAPS, len(NON_MASS_DISTANCES),
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
    """Restart the simulation immediately."""
    _init_simulation()
    log.info("Simulation manually reset")
    return {"reset": True}

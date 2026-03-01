# Specifications
Dashboard app with three components: frontend, backend, mockserver.
When updating or adding there specs, make sure to prefix (or update the prefix) with `[ ]` to mark it TODO. After processing, mark completed items with `[x]`.

Each component:
- [x] Runs in a container via `compose.yml` and `Containerfile`
- [x] No host package installs
- [x] Basic code formatting tools
- [x] No HTTPS between containers

## Mockserver
- [x] Python 3.14 + FastAPI; mirror src into container; ruff formatting
- [x] Do not alter/remove `example.json`
- [x] Simulate mass start live distance from `example.json`
- [x] Simulate four timed distances: **100m**, **500m**, **1000m**, **1500m**; all run live simultaneously alongside the mass start
  - First lap distance = `distance_meters % 400`, or `400` when the remainder is zero (i.e. the distance is an exact multiple of 400m)
  - Each subsequent lap = 400m
  - 100m: first lap = 100m (100 % 400 = 100); only 1 lap total
  - 500m: first lap = 100m (500 % 400 = 100); then 1 × 400m lap = 500m total
  - 1000m: first lap = 200m (1000 % 400 = 200); then 2 × 400m laps = 1000m total
  - 1500m: first lap = 300m (1500 % 400 = 300); then 3 × 400m laps = 1500m total
- [x] Timed distances: 2–4 heats of 2–4 competitors each with assigned lane colors; all distances start simultaneously at init/reset; on init all timed competitors are emitted immediately without times (empty `laps`) so the frontend can pre-render the full start list before any lap times arrive
- [x] Timed distance competitors: each has a stable personal speed (m/s) with per-lap noise; lap split time computed from distance ÷ speed; ~70% of competitors have a `personalRecord`; ~50% of those records are set slightly above the competitor's expected time (beatable), ensuring some PR badges appear on finish
- [x] Timed distances marked `isLive=False` only once **every** competitor has a lap time for **every** required lap of that distance; a distance where any competitor is still missing any lap time remains live
- [x] All other distances from `example.json` are **not** included in the simulated output — only the mass-start distance and the four timed distances above

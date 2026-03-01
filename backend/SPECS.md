# Specifications
Dashboard app with three components: frontend, backend, mockserver.
When updating or adding there specs, make sure to prefix (or update the prefix) with `[ ]` to mark it TODO. After processing, mark completed items with `[x]`.

Each component:
- [x] Runs in a container via `compose.yml` and `Containerfile`
- [x] No host package installs
- [x] Basic code formatting tools
- [x] No HTTPS between containers

## Backend
- [x] Python 3.14 + FastAPI, async
- [x] WebSocket for frontend on port `5000`
- [x] Mirror `src` into container
- [x] Periodically fetches `DATA_SOURCE_URL` and pushes updates via WebSocket
- [x] Fetch interval via `DATA_SOURCE_INTERVAL` env var (default `1`)
- [x] Cache between intervals (aiocache)
- [x] On WS connect: send `status` message with `data_source_url` and `data_source_interval`; replay latest processed state — sends `event_name`, one `distance_meta` per distance, then **all** `competitor_update` entries including those with no `total_time` (full start list); the no-time suppression rule applies only to live diff broadcasts, not the initial replay; each replayed `competitor_update` includes the full `lap_times` array with all laps completed so far — this ensures timed-distance competitors' lap history is fully restored on reconnect/refresh
- [x] Log when new data is received and when updates are sent; log each competitor_update sent (start number, name, laps, total time, formatted total time)

### Data management endpoints (backend)
- [x] Add endpoints for managing data source URL (`GET`/`POST`), fetch interval (`GET`/`POST`), reset data (`POST`), and start/stop polling (`POST`)
- [x] Add new env var `MANAGEMENT_PASSWORD` for password-protected access to these endpoints
- [x] Endpoints require password (header: X-Management-Password)

### Data processing (backend)
- [x] Parse raw source data on each fetch; diff against previous parsed state
- [x] Mass start detection: distance with >2 races all sharing the same `heat`
- [x] Mass start: omit first lap (warmup); extract total laps from distance title; mass-start lap time badges are coloured according to the Lap Δ rules (green / orange / purple) — they are not black
- [x] Timed distance: first lap counts; extract distance in meters from title; badges colored by `lane`
- [x] Per competitor: `id`, `startNumber`, `name`, `heat`, `lane`, lap count, total time (highest lap `time`), formatted time (leading zeros stripped, truncated to 3 decimals)
- [x] Backend sorts competitors (laps descending, total time ascending, no-time last) to produce a stable ordering for `competitor_update` broadcast sequence only; this order is not sent to the frontend and is not used for UI positioning
- [x] `position` and `position_change` are not computed by the backend and are not included in `competitor_update`
- [x] Mass start: compute standings groups (same lap count + within configurable threshold); assign group number, gap to group ahead, time behind leader, intra-group gap, leader time; mark tail group; competitors with no total time are not grouped; **group threshold computed in frontend**
- [x] Mass start: compute `any_finished`, `laps_remaining`, `finished_rank` per competitor; `is_final_lap` and `finishing_line_after` are not computed by the backend — both derived in frontend
- [x] Timed distance: group by heat, sorted by heat then time; a timed distance is only marked complete (`isLive=False`) once **every** competitor in the distance has a lap time recorded for **every** expected lap — partial completion (some competitors still missing laps) keeps the distance live
- [x] Backend does not compute standings groups; sends flat sorted competitor list only
- [x] Reject source updates with top-level `success: false`; broadcast `error` message to clients

### WebSocket messages (backend → frontend)
- [x] `status`: connection metadata (`data_source_url`, `data_source_interval`)
- [x] `error`: human-readable error string
- [x] `distance_meta`: per-distance scalar fields (`id`, `name`, `event_number`, `is_live`, `is_mass_start`, `distance_meters`, `total_laps`, `any_finished`, `heat_groups`); no standings groups; `finishing_line_after` is not used — computed in frontend
- [x] `competitor_update`: one message per changed competitor; fields: `start_number`, `laps_count`, `total_time`, `distance_id`, `id`, `name`, `heat`, `lane`, `formatted_total_time`, `lap_times` (list of `lapTime` strings for each completed lap, in order), `laps_remaining`, `finished_rank`, `personal_record` (formatted time string or `null`), `invalid_reason` (string or `null` — sourced from raw `invalidReason` field, empty string coerced to `null`), `remark` (string or `null` — sourced from raw `remark` field, empty string coerced to `null`); `position` and `position_change` are not sent — computed in frontend; **not sent when `total_time` is empty after the initial appearance** — first appearance (start list) is always sent regardless
- [x] On each fetch cycle: send one `distance_meta` per changed distance, then one `competitor_update` per changed competitor

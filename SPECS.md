# Specifications
Dashboard app with three components: frontend, backend, mockserver.

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
- [x] On WS connect: send `status` message with `data_source_url` and `data_source_interval`; replay latest processed state
- [x] Log when new data is received and when updates are sent; log each competitor_update sent (start number, name, laps, total time, formatted total time, position, position change)

### Data processing (backend)
- [x] Parse raw source data on each fetch; diff against previous parsed state
- [x] Mass start detection: distance with >2 races all sharing the same `heat`
- [x] Mass start: omit first lap (warmup); extract total laps from distance title; badges in black
- [x] Non-mass start: first lap counts; extract distance in meters from title; badges colored by `lane`
- [x] Per competitor: `id`, `startNumber`, `name`, `heat`, `lane`, lap count, total time (highest lap `time`), formatted time (leading zeros stripped, truncated to 3 decimals)
- [x] Sort competitors: laps descending, then total time ascending
- [x] Detect position changes per competitor vs previous state
- [x] Mass start: compute standings groups (same lap count + within configurable threshold); assign group number, gap to group ahead, time behind leader, intra-group gap, leader time; mark tail group; competitors with no total time are not grouped; **group threshold computed in frontend**
- [x] Mass start: compute `finishing_line_after` (last competitor with a total time in standings order)
- [x] Mass start: compute `any_finished`, `laps_remaining`, `is_final_lap`, `finished_rank` per competitor
- [x] Non-mass start: group by heat, sorted by heat then time
- [x] Backend does not compute standings groups; sends flat sorted competitor list only
- [x] Reject source updates with top-level `success: false`; broadcast `error` message to clients

### WebSocket messages (backend → frontend)
- [x] `status`: connection metadata (`data_source_url`, `data_source_interval`)
- [x] `error`: human-readable error string
- [x] `distance_meta`: per-distance scalar fields (`id`, `name`, `event_number`, `is_live`, `is_mass_start`, `distance_meters`, `total_laps`, `any_finished`, `finishing_line_after`, `heat_groups`); no standings groups
- [x] `competitor_update`: one message per changed competitor; fields: `distance_id`, `id`, `start_number`, `name`, `heat`, `lane`, `laps_count`, `total_time`, `formatted_total_time`, `position`, `position_change`, `gap_to_above`, `laps_remaining`, `is_final_lap`, `finished_rank`, `group_number`
- [x] On each fetch cycle: send one `distance_meta` per changed distance, then one `competitor_update` per changed competitor

## Frontend
- [x] Node 24 LTS + Angular + CoreUI
- [x] Dev server on port `4200`; prod server on port `8888` (maps to `80` in container)
- [x] WebSocket to backend port `5000`
- [x] nginx config in separate folder
- [x] Reconnect every 5s on lost connection, show error

### Data layer
- [x] No data processing in the frontend — consume backend messages directly
- [x] Apply `distance_meta` and `competitor_update` messages to local state
- [x] Persist state in local storage; restore on reconnect
- [x] Incoming updates are queued; each render cycle is completed before starting the next
- [x] Max render cycle duration configurable (`RENDER_INTERVAL_MS`, default `250ms`)
- [x] Group threshold (seconds) is a local GUI setting (default `2.0s`), persisted in localStorage; frontend computes standings groups dynamically using this value; recomputes on every update and on threshold change

### Dashboard
- [x] Auto-connect on page load; show pulsing placeholder animations while connecting
- [x] Button to clear local storage and refresh
- [x] Group threshold input in top bar: numeric field (seconds), updates grouping live, persisted in localStorage

#### Rendering
- [x] HTML page title: `<event name> | Live Results Dashboard`; updated reactively when event name changes
- [x] Top bar: event `name` + connection status badge + seconds since last update
- [x] Each distance in full-width accordion, sorted by `event_number` descending; accordion body height scales to fit its content (no fixed/max height clipping); expanded/active accordion header uses brand info color
- [x] Button to clear local storage and refresh, labeled "Clear all data"
- [x] Group threshold input in top bar: numeric field (seconds), updates grouping live, persisted in localStorage
- [x] Group strip updates are debounced: only rendered after no competitor changes have been received for the group threshold duration, to let groups settle before re-rendering
- [x] Animate `is_live` badge; auto-expand live accordion on load (not on updates)
- [x] `start_number` badges: fixed min-width for 2 digits, centered

##### Inside each accordion
- [x] Mass start: top row of group cards; non-mass-start: group by heat in cards sorted by heat then time
- [x] Group cards: title "Group X"; show total time for first, time delta for each subsequent
- [x] Head group tagged "Head of the race" (green badge); remove badge after first finish
- [x] Between groups: orange badge with time gap
- [x] Remove finished competitors from groups
- [x] Sync highlight/animate updates between strip and standings list
- [x] Animate position changes in both columns

##### Competitor list row
- [x] All competitors; mass start: single list (black badges); non-mass start: grouped by heat
- [x] Sort: laps descending, then time ascending
- [x] "Final lap" (blue) / "Finished" (green) badge; finished competitor rows are slightly opaque
- [x] Rank prefix: "1ˢᵗ" style with raised superscript, light gray
- [x] Laps badge: "X/total" with total in small gray; rendered after the time field
- [x] Time: decimals in small gray
- [x] Animate row background to light yellow on update for 1s **only when the competitor received an actual backend update**; no highlight on restore or group recompute
- [x] Animate position changes with row-swap animation
- [x] Finishing line: rendered below last lap-completed competitor; animate to new position; styled as a solid 3px bright orange line with a small "Lap completed" label
- [x] Group separator lines with group name; styled as a thin 1px gray line; small top margin above each group divider
- [x] Click to select competitor; reflected in both strip and standings; click again/elsewhere to deselect

## Mockserver
- [x] Python 3.14 + FastAPI; mirror src into container; ruff formatting
- [x] Do not alter/remove `example.json`
- [x] Simulate mass start live distance from `example.json`
- [x] On init/reset: clear all existing laps; seed each competitor with a single warmup lap (lap 0) taking 10–15s; race starts at lap 0
- [x] Each competitor has a stable personal pace with per-lap noise
- [x] Competitors complete laps independently based on pace
- [x] Lap duration 10–30s ± 1s noise; main pack within 5s window; last competitor has its own slow steady pace
- [x] Faster competitors can lap slower ones (differing lap counts)
- [x] Stop updating finishers (reached `MAX_LAPS`); keep in standings
- [x] When all finish: set `isLive: false`, stay idle until manual reset
- [x] `POST /api/reset` to restart immediately
- [x] Log mocked changes
- [x] Use `faker` for competitor names

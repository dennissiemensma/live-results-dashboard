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
- [x] On WS connect: send `status` message with `data_source_url` and `data_source_interval`; replay latest processed state — sends `event_name`, one `distance_meta` per distance, then **all** `competitor_update` entries including those with no `total_time` (full start list); the no-time suppression rule applies only to live diff broadcasts, not the initial replay
- [x] Log when new data is received and when updates are sent; log each competitor_update sent (start number, name, laps, total time, formatted total time)

### Data processing (backend)
- [x] Parse raw source data on each fetch; diff against previous parsed state
- [x] Mass start detection: distance with >2 races all sharing the same `heat`
- [x] Mass start: omit first lap (warmup); extract total laps from distance title; badges in black
- [x] Non-mass start: first lap counts; extract distance in meters from title; badges colored by `lane`
- [x] Per competitor: `id`, `startNumber`, `name`, `heat`, `lane`, lap count, total time (highest lap `time`), formatted time (leading zeros stripped, truncated to 3 decimals)
- [x] Backend sorts competitors (laps descending, total time ascending, no-time last) to produce a stable ordering for `competitor_update` broadcast sequence only; this order is not sent to the frontend and is not used for UI positioning
- [x] `position` and `position_change` are not computed by the backend and are not included in `competitor_update`
- [x] Mass start: compute standings groups (same lap count + within configurable threshold); assign group number, gap to group ahead, time behind leader, intra-group gap, leader time; mark tail group; competitors with no total time are not grouped; **group threshold computed in frontend**
- [x] Mass start: compute `any_finished`, `laps_remaining`, `finished_rank` per competitor; `is_final_lap` and `finishing_line_after` are not computed by the backend — both derived in frontend
- [x] Non-mass start: group by heat, sorted by heat then time
- [x] Backend does not compute standings groups; sends flat sorted competitor list only
- [x] Reject source updates with top-level `success: false`; broadcast `error` message to clients

### WebSocket messages (backend → frontend)
- [x] `status`: connection metadata (`data_source_url`, `data_source_interval`)
- [x] `error`: human-readable error string
- [x] `distance_meta`: per-distance scalar fields (`id`, `name`, `event_number`, `is_live`, `is_mass_start`, `distance_meters`, `total_laps`, `any_finished`, `heat_groups`); no standings groups; `finishing_line_after` is not used — computed in frontend
- [x] `competitor_update`: one message per changed competitor; fields: `start_number`, `laps_count`, `total_time`, `distance_id`, `id`, `name`, `heat`, `lane`, `formatted_total_time`, `laps_remaining`, `finished_rank`; `position` and `position_change` are not sent — computed in frontend; **not sent when `total_time` is empty after the initial appearance** — first appearance (start list) is always sent regardless
- [x] On each fetch cycle: send one `distance_meta` per changed distance, then one `competitor_update` per changed competitor

## Frontend
- [x] Node 24 LTS + Angular + CoreUI
- [x] Dev server on port `4200`; prod server on port `8888` (maps to `80` in container)
- [x] WebSocket to backend port `5000`
- [x] nginx config in separate folder
- [x] Reconnect every 5s on lost connection, show error

### Data layer
- [x] Apply `distance_meta` and `competitor_update` messages to local state
- [x] Incoming updates are queued; each render cycle is completed before starting the next
- [x] Max render cycle duration configurable (`RENDER_INTERVAL_MS`, default `250ms`)
- [x] Group threshold (seconds) is a local GUI setting (default `2.0s`), persisted in localStorage; frontend computes standings groups dynamically using this value; recomputes on every update and on threshold change
- [x] `is_final_lap` is computed in the frontend: a competitor is on their final lap when `laps_remaining === 1`; recomputed on every competitor update
- [x] `position` is computed in the frontend after every update: competitors are sorted laps descending then total time ascending (numeric seconds); competitors with no time sort last; `position_change` (`up` / `down` / `null`) is derived by comparing the new position against the previous position for each competitor; both recomputed on every competitor update
- [x] No other state is persisted; backend replays full state on every WebSocket connect; "Clear all data" reloads the page
- [x] Reconnect every 5s on lost connection, show error

### Dashboard
- [x] Auto-connect on page load; show pulsing placeholder animations while connecting
- [x] "Clear all data" button: clears localStorage (threshold only) and reloads the page
- [x] Group threshold input in top bar: numeric field (seconds, 0–10), updates grouping live, persisted in localStorage
- [x] Max groups input in top bar: numeric field (default 4); `0` disables the group strip **and** the group separator lines in the standings entirely; competitors beyond the last group are collected into a synthetic "Tail of the race" group; persisted in localStorage

#### Rendering
- [x] HTML page title: `<event name> | Live Results Dashboard`; updated reactively when event name changes
- [x] Top bar: event `name` + connection status badge + seconds since last update; dark/black background
- [x] Each distance in full-width accordion, sorted by `event_number` descending; accordion body height scales to fit content; expanded accordion header uses dark slate (`#2c3e50`)
- [x] Completed ("Done") accordion items are rendered at reduced opacity unless they are currently expanded
- [x] Animate `is_live` badge; auto-expand live accordion on load (not on updates)
- [x] Distance status badges rendered **before** the distance name in the accordion header: "Live" (red/animated) for the live distance; "Done" (black) for distances with a lower `event_number` than the live one; no badge for upcoming/not-yet-live distances
- [x] `start_number` badges: fixed min-width for 2 digits, centered
- [x] Group strip updates are debounced: only rendered after no competitor changes for the group threshold duration

##### Inside each accordion
- [x] Mass start: top row of group cards; non-mass-start: group by heat in cards sorted by heat then time
- [x] Group cards: first group titled **"Head of the race"** while no one has finished; once anyone finishes the first group reverts to **"Group 1"**; overflow/tail group titled **"Tail of the race"**; intermediate groups titled "Group X"; card header shows only the group title; finished competitors are removed from group cards immediately
- [x] Tail of the race group card: when any competitor in the tail group is 1 or more laps behind the leader (first group), show a gap badge (same style as other group gap badges) indicating the lap deficit (e.g. `+X lap(s)`) right-aligned in the card header
- [x] "Leader" badge (green): shown **right-aligned in the leader's row** in the group strip card; hidden once anyone has finished; also shown inline after the leader's name in the standings row list (same condition)
- [x] Gap badge (`+Xs` / `+X lap(s)`): shown **right-aligned in the first (top) competitor row** of each non-head group card; for the head group the right slot shows "Leader" (green) instead; if the top competitor is on their final lap and no gap badge applies, "Final lap" (blue) is shown instead
- [x] Between groups: gap badge shown top-right in the card header; shows `+Xs` time diff when the group is on the same lap count as the leader (first group), or `+X lap(s)` when the group is at least one lap behind the leader — lap count is always compared against the first group, not the group immediately ahead
- [x] Group strip shown immediately on initial load (no debounce delay on first render); subsequent updates still debounced by group threshold
- [x] Sync highlight/animate updates between strip and standings list
- [x] Animate position changes in both columns
- [x] Group separator lines in standings list use the same naming: "Head of the race" / "Group X" / "Tail of the race"; first group reverts to "Group 1" once anyone finishes (mirrors card behaviour)

##### Competitor list row
- [x] All competitors; mass start: single list (black badges); non-mass start: grouped by heat
- [x] Group cards: group leader right-side slot shows **"Final lap"** label (blue) when `is_final_lap` is true (frontend-computed), nothing otherwise; subsequent competitors show their gap to the **group leader**: time diff (`+Xs`) when both have a `total_time` and are on the same lap; lap diff (`+X lap(s)`) when the competitor is on a different lap count than the group leader or has no `total_time`
- [x] Sort: laps descending, then total time ascending; computed by frontend after each update using numeric seconds comparison; competitors with no time sort last
- [x] "Final lap" (blue) / "Finished" (green) badge; finished competitor rows are slightly opaque
- [x] All competitors show either their `gap_to_above` (time diff or lap diff) **or** their `formatted_total_time` — never both; group leaders and finished competitors show `formatted_total_time`; non-leader unfinished competitors show `gap_to_above` instead; rendered before the laps badge
- [x] Rank prefix: "1ˢᵗ" style with raised superscript, light gray
- [x] Laps badge: "X/total" with total in small gray; rendered after the time/gap field; fixed min-width for "XX/XX" (5 chars + padding), centered, monospace — same sizing logic as `start_number` badge
- [x] Time: decimals in small gray
- [x] Animate row background to light yellow on update for 1s **only when the competitor received an actual backend update**; no highlight on restore or group recompute
- [x] On each competitor update: (1) recompute positions and resort `processedRaces` immediately; (2) flash-highlight the updated row at its new sorted position for 1s; (3) show the finishing line below that row for the same 1s; the deferred sort is removed — sorting always happens before the highlight, never after
- [x] Finishing line: rendered as an **inline DOM element** in the list flow, below the competitor currently at `finishingLineAfter`; styled as a solid 3px bright orange line with a small "Lap completed" label; `finishingLineAfter` is set to the id of the most recently updated competitor after the list has been resorted; it is cleared automatically after 1s; never shown in more than one place at a time
- [x] Group separator lines with group name; styled as a thin 1px gray line; small top margin above each group divider; a gray transparent count badge (competitor count) and an orange gap badge (`+Xs` / `+X lap(s)`, same value as the group card header gap) are rendered inline after the group name on the separator line; head group shows no gap badge
- [x] Click to select competitor; reflected in both strip and standings; click again/elsewhere to deselect

## Mockserver
- [x] Python 3.14 + FastAPI; mirror src into container; ruff formatting
- [x] Do not alter/remove `example.json`
- [x] Simulate mass start live distance from `example.json`
- [x] On init/reset: clear all existing laps; seed each competitor with a single warmup lap (lap 0) taking 10–15s; race starts at lap 0
- [x] Each competitor has a stable personal pace with per-lap noise
- [x] Competitors complete laps independently based on pace
- [x] Lap duration 10–30s ± 1s noise; main pack within 5s window; last competitor has its own slow steady pace
- [x] All competitors' `total_time` is measured from a single shared race-start origin (`_race_start = now` at init); computed as `due_crossing_time − _race_start` so times are directly comparable across competitors and strictly reflect crossing order; warmup lap retains its own split time but does not count toward the race clock
- [x] Next lap is scheduled from the competitor's *due time* (not wall-clock now) to preserve relative timing between competitors across ticks and prevent drift
- [x] A competitor's `total_time` is strictly monotonically increasing: each committed lap must produce a higher cumulative time than the last; laps that would produce a retroactive or equal time are skipped with a warning log
- [x] Faster competitors can lap slower ones (differing lap counts)
- [x] Stop updating finishers (reached `MAX_LAPS`); keep in standings
- [x] When all finish: set `isLive: false`, stay idle until manual reset
- [x] `POST /api/reset` to restart immediately
- [x] Log mocked changes
- [x] Use `faker` for competitor names

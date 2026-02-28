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
- [x] Add new env var `MANAGEMENT_PASSWORD_FILE` for password-protected access to these endpoints
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
- [x] `competitor_update`: one message per changed competitor; fields: `start_number`, `laps_count`, `total_time`, `distance_id`, `id`, `name`, `heat`, `lane`, `formatted_total_time`, `lap_times` (list of `lapTime` strings for each completed lap, in order), `laps_remaining`, `finished_rank`, `personal_record` (formatted time string or `null`); `position` and `position_change` are not sent — computed in frontend; **not sent when `total_time` is empty after the initial appearance** — first appearance (start list) is always sent regardless
- [x] On each fetch cycle: send one `distance_meta` per changed distance, then one `competitor_update` per changed competitor

### CORS
- [ ] [TODO] Add CORS response header to allow all origins (Access-Control-Allow-Origin: *). Ensure all backend endpoints include this header for cross-origin requests.

### Backend API Endpoints
- Data retrieval endpoints (e.g. /api/results, /api/status, /api/events, /api/distances) do **not** require authentication.
- Management endpoints (e.g. /api/manage/*) require authentication via password.

## Frontend
- [x] Node 24 LTS + Angular + CoreUI
- [x] Dev server on port `4200`; prod server on port `8888` (maps to `80` in container)
- [x] WebSocket to backend port `5000`
- [x] nginx config in separate folder
- [x] Reconnect every 5s on lost connection, show error
- [x] Frontend must not hardcode backend URL. Pass backend URL as environment variable into the frontend container, similar to backend. Frontend reads this value at runtime and uses it for API/WebSocket connections. Container, compose, and code updated accordingly.

### Data layer
- [x] Apply `distance_meta` and `competitor_update` messages to local state; `distance_meta` stores the authoritative `raceIds` list per heat group so that competitor cards can be resolved correctly on reconnect/refresh even before all competitor updates have been applied
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
- [x] Each UI setting in the top bar (**Max seconds gap between groups**, Max groups, Lap Δ, Lap times) and the **Show server updates** button each have a CSS hover popover anchored below them; hovering reveals a popover with the setting name as a bold title and a description; the Lap Δ popover description uses inline colored badges (green/orange/purple) to illustrate the three states, plus a second paragraph with a concrete example; the popover has an upward-pointing arrow; implemented in pure CSS (no JS); no special cursor on the label
- [x] **Lap times** toggle: checkbox in the top bar (default on); when unchecked the lap-time badge strip (including placeholders) is hidden but the **lap counter badge remains visible and vertically aligned across all rows**; setting persisted in localStorage
- [ ] Hide all mass start settings in the top bar when there is no mass start in any of the distances

### Management popup (frontend)
- [x] Add popup for managing backend settings:
    - **Connect to backend**: URL for the web client to connect the socket to (used by frontend for API/WebSocket)
    - **Backend data source**: URL the backend uses for its data source (e.g., mockserver)
    - Interval, reset button, start/stop toggle, password input
- [x] Display latest backend "status" info (data source value, interval, polling state) in the popup
- [x] Trigger popup by clicking the "connected" status badge
- [x] Show errors/messages from backend in the popup
- [x] Frontend reads current backend settings (data source value, interval, polling state) from backend on popup open and after save/reset
- [x] Management settings popup floats in a window visually similar to the server updates panel (same style, z-index, and animation)
- [x] Add option in the frontend GUI to change the backend URL for the web client (socket/API). Integrate this option into the backend settings dialog. The dialog must include appropriate padding for improved UI consistency. The backend URL change should be validated and persisted in localStorage, and the dialog should visually reflect the updated URL and padding.
- [x] Add missing backend data source value field to management popup. Add "Manage Frontend Settings" title above "Manage Backend Settings". Add button "Save frontend config". Rework polling buttons to a status badge toggle that acts as a button. Rename "Reset Data" to "Clear backend cache". Update "Save Settings" to "Save backend config".
- [x] Rename label from "Backend URL" to "Connect to backend" everywhere in the management popup and related dialogs.

#### Rendering
- [x] HTML page title: `<event name> | Live Results Dashboard`; updated reactively when event name changes
- [x] Top bar: event `name` + connection status badge + **Show server updates** button; dark/black background
- [x] Each distance in full-width accordion, sorted by `event_number` descending; accordion body height scales to fit content; expanded accordion header uses dark slate (`#2c3e50`)
- [x] Completed ("Done") accordion items are rendered at a mild reduced opacity (suggested: opacity 0.85) unless they are currently expanded; timed-distance content must remain clearly readable (avoid heavy dimming)
- [x] Animate `is_live` badge; auto-expand live accordion on load (not on updates)
- [x] Distance status badges rendered **before** the distance name in the accordion header: "Live" (red/animated) for the live distance; "Done" (black) for distances with a lower `event_number` than the live one; no badge for upcoming/not-yet-live distances
- [x] `start_number` badges: fixed min-width for 2 digits, centered
- [x] Group strip updates are debounced: only rendered after no competitor changes for the group threshold duration

##### Inside each accordion
- [x] Mass start: top row of group cards; timed distance: one plain unstyled row per heat (no card, no border, no background — just a label and the competitor cards below it); inside each heat row, each competitor is rendered as a card (always 4 cards per row, left-aligned, fixed width); the card title contains the start-number badge + competitor name + "Finished" green badge inline after the name (when all laps done); the card body contains one row per expected lap distance (e.g. 200m, 600m, 1000m) showing the lap time when available or `·` when pending
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
- [x] All competitors; mass start: single list (black badges); timed distance: per-heat rows, per-competitor cards
- [x] Timed distance competitor card: card title = start-number badge + competitor name + "Finished" green badge inline after the name (when all laps done) + "New PB" yellow badge **right-aligned** + purple time-improvement badge (e.g. `- 0.521 s`) immediately after it in the card title; card body = one row per expected lap distance labelled with the cumulative distance (e.g. 200m, 600m, 1000m); each lap row shows: for laps after the first the individual split time in a small opaque gray badge (prepended, left side) shown truncated to 1 decimal (not rounded), then the **cumulative total time** up to that lap as the main time value (right-aligned) shown truncated to 3 decimals (not rounded); the first lap does not display the split badge (it is omitted); `·` when the lap is pending; finished competitor cards are rendered with mild dimming (suggested opacity 0.85) so content remains easily readable; personal-best indicators (the yellow badge and the purple diff) are only displayed once the competitor's final lap time for the distance has been recorded; personal-best cards show a golden left border; competitor cards laid out in fixed lane-color columns **white → red → yellow → blue**; absent lanes use empty placeholder cards
- [x] Mockserver and backend send lap times truncated to 3 decimal places; the frontend receives up to 3 decimals but displays lap-time badges truncated to 1 decimal (not rounded); leading zeros are still stripped and the decimal part is shown smaller and muted
- [x] Group cards: group leader right-side slot shows **"Final lap"** label (blue) when `is_final_lap` is true (frontend-computed), nothing otherwise; subsequent competitors show their gap to the **group leader**: time diff (`+Xs`) when both have a `total_time` and are on the same lap; lap diff (`+X lap(s)`) when the competitor is on a different lap count than the group leader or has no `total_time`
- [x] Top bar layout (left to right): event name → connection status badge → **"Show server updates"** button → last-change timestamp → (ms-auto) **"Mass Start Settings"** label + vertical separator → UI settings (Max seconds gap, Max groups, Lap Δ, Lap times toggle)
- [x] Mass-start competitor rows have a **three-column** flex layout: **[left]** `flex: 0 1 auto` — rank + start number + name (up to 18rem) + status badges; **[centre]** `flex: 1 1 0` — scrollable lap-time badge strip with a fixed left offset and the lap counter as plain text (`X/total`) appended **after** the badges inside the strip — lap counter is always visible regardless of the Lap times toggle; **[right]** `flex: 0 0 auto` — gap / total time; badge colors: **green** = within threshold, **orange** = slower, **purple** = faster; lap times truncated to 1 decimal; only latest badge full opacity; new badge pops with spring overshoot; spacing between consecutive lap-time badges is reduced to a single whitespace (no larger gap)
- [x] "Final lap" (blue) badge: rendered immediately to the right of the lap counter inside the centre column (i.e. between the lap counter and the right column that shows gap/total time); "Finished" (green) badge: shown inline after the competitor name for timed-distance cards and also used where specified; finished competitor rows are slightly opaque
- [x] All competitors show either their `gap_to_above` (time diff or lap diff) **or** their `formatted_total_time` — never both; group leaders and finished competitors show `formatted_total_time`; non-leader unfinished competitors show `gap_to_above` instead; rendered before the laps badge
- [x] Rank prefix: "1ˢᵗ" style with raised superscript, light gray
- [x] Laps badge: **mass start only** — "X/total" with total in small gray; fixed min-width for "XX/XX" (5 chars + padding), centered, monospace, rendered inline after the time/gap field; **timed distance**: no laps badge; instead show a "Finished" badge (green) pinned to the right side of the row once all expected laps are completed, nothing otherwise
- [x] Mass start: when a competitor has no total time yet, display a pending symbol (e.g. `·` or `—`) instead of a time string; never show a "No Time" text label anywhere in the UI
- [x] Time: decimals in small gray
- [x] Animate row background to light yellow on update for 1s **only when the competitor received an actual backend update**; no highlight on restore or group recompute
- [x] On each competitor update: (1) recompute positions and resort `processedRaces` immediately; (2) flash-highlight the updated row at its new sorted position for 1s; (3) show the finishing line below that row for the same 1s; the deferred sort is removed — sorting always happens before the highlight, never after
- [x] Finishing line: rendered as an **inline DOM element** in the list flow, below the competitor currently at `finishingLineAfter`; styled as a solid 3px bright orange line with a small "Lap completed" label; `finishingLineAfter` is set to the id of the most recently updated competitor after the list has been resorted; it **persists** at that position until a new competitor update moves it; never shown in more than one place at a time
- [x] Group separator lines with group name; styled as a thin 1px gray line; small top margin above each group divider; a gray transparent count badge (competitor count) and an orange gap badge (`+Xs` / `+X lap(s)`, same value as the group card header gap) are rendered inline after the group name on the separator line; head group shows no gap badge
- [x] Click to select competitor; reflected in both strip and standings; click again/elsewhere to deselect
- [x] Debug view: a toggleable panel opened by a **"Show server updates"** button in the top bar; lists incoming `competitor_update` messages in arrival order; each entry shows: arrival timestamp, distance name, start number, competitor name, which lap this update is for as an ordinal (e.g. "1st lap", "2nd lap", "3rd lap"), current lap time (most recent `lap_times` entry), and formatted total time; all columns are left-aligned; columns are balanced (distance name and competitor name share equal proportional width; fixed columns for timestamp, start number, lap, lap time, total time); rows have right-side padding; columns are readable with distinct colors on the dark background; capped at a configurable maximum number of entries (e.g. last 200); does not affect normal rendering or data flow

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


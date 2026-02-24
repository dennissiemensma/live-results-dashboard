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
- [x] On WS connect: broadcast `status` message with `data_source_url` and `data_source_interval`
- [x] Send `data` message when fetched data differs from last sent
- [x] Log when new data is received and when updates are sent

## Frontend
- [x] Node 24 LTS + Angular + CoreUI
- [x] Dev server on port `4200`; prod server on port `8888` (maps to `80` in container)
- [x] WebSocket to backend port `5000`
- [x] nginx config in separate folder
- [x] Reconnect every 5s on lost connection, show error

### Dashboard
- [x] Persist state in local storage
- [x] Auto-connect on page load; show pulsing placeholder animations while connecting
- [x] Button to clear local storage and refresh

#### Data processing (`data` type updates)
- [x] Reject updates with top-level `success: false`; show dismissable error
- [x] Mass start detection: distance with >2 races all sharing the same `heat`
- Mass start:
  - [x] Omit first lap (warmup)
  - [x] Extract total laps from distance title
  - [x] `startNumber` badges in black
- Non-mass start:
  - [x] First lap counts
  - [x] Extract distance in meters from title
  - [x] `startNumber` badges colored by `lane`
- Per race, extract: `id`, `startNumber`, `name`, `heat`, lap count, `lane`, highest `time` (total), `lapTime` per lap
- [x] Store in local storage for diffing

#### Rendering
- [x] Re-render only changed items on each update
- [x] Top bar: top-level `name` + connection status badge + seconds since last update ("Last change received: X seconds ago")
- [x] Each distance in full-width accordion, sorted by `eventNumber` descending (hide `eventNumber`)
- [x] Animate `isLive` badge; auto-expand live accordion on load (not on updates)
- [x] `startNumber` badges: fixed min-width for 2 digits, centered

##### Inside each accordion
- [x] Mass start: top row of group cards (see below); non-mass-start: group by `heat` in cards sorted by `heat` then `time`
- [x] Groups: sorted by lap count then total time (within 2s threshold)
- [x] Group cards: title "Group X" (X=1 for head); show total time for first, time delta for each subsequent
- [x] Head group tagged "Head of the race" (green badge); remove badge after first finish
- [x] Between groups: orange badge with time gap between last of leading group and first of trailing group
- [x] Remove finished competitors from groups
- [x] Sync highlight/animate updates between strip and standings list
- [x] Animate position changes in both columns

##### Competitor list row
- [x] All competitors; mass start: all in one list (no heat grouping, black colors); non-mass start: grouped by heat
- [x] Sort: laps descending, then time ascending
- [x] "Final lap" (green) / "Finished" (gray) badge
- [x] Rank prefix: "1ˢᵗ" style with raised superscript, light gray
- [x] Laps badge: "Laps: 3/10" with total in small gray
- [x] Time: drop leading zeros, truncate (not round) to 3 decimals, decimals in small gray
- [x] Animate row background to light yellow on update for 3s; re-sort after update
- [x] Animate position changes with row-swap animation (no color for position changes)
- [x] Finishing line: rendered below last lap-completed competitor per update; animate to new position
- [x] Group separator lines with group name
- [x] Duplicate the finishing line above the first competitor of each group to indicate the group and its name (only at the top of each group)
- [x] Click to select competitor (highlight border/bg); reflected in both strip and standings; click again/elsewhere to deselect; one selection at a time

## Mockserver
- [x] Python 3.14 + FastAPI; mirror src into container; ruff formatting
- [x] Do not alter/remove `example.json`
- [x] Simulate mass start live distance from `example.json`
- [x] Each competitor has a stable personal pace with per-lap noise
- [x] Competitors complete laps independently based on pace
- [x] Lap duration 10–30s ± 5s noise; main pack within 10s window; last competitor has its own slow steady pace
- [x] Faster competitors can lap slower ones (differing lap counts)
- [x] Stop updating finishers (reached `MAX_LAPS`); keep in standings
- [x] When all finish: set `isLive: false`, stay idle until manual reset
- [x] `POST /api/reset` to restart immediately
- [x] Log mocked changes
- [x] Use `faker` for competitor names

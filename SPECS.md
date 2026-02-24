# Specifications
Create a dashboard application that consists our of three components: 
- [x] frontend
- [x] backend
- [x] mockserver

Each should:
- [x] reside in a container, using compose files (`compose.yml`) and container files (`Containerfile`)
- [x] not install packages on the host
- [x] have some basic code formatting tools

Also:
- [x] do not use https between containers

## Backend
- [x] Python 3.14 + FastAPI
- [x] Async
- [x] Serves websocket for frontend on port `5000`
- [x] Mirror `src` into container

Specs:
- [x] Periodically reads data from a predefined `DATA_SOURCE_URL` env var and updates the frontend via websocket
- [x] Interval should be configurable via env var `DATA_SOURCE_INTERVAL`, default `1`
- [x] Cache between intervals (aiocache)
- [x] On websocket connect, broadcast `status` type data to frontend, including:
  - [x] `data_source_url`: value of `DATA_SOURCE_URL`
  - [x] `data_source_interval`: value of `DATA_SOURCE_INTERVAL`
- [x] Then update frontend with `data` type data whenever data is fetched from `DATA_SOURCE_URL` and it differs from the last sent data
- [x] Add logging for receiving new data and sending updates to frontend

## Frontend
- [x] Node 24 LTS + Angular + CoreUI
- [x] Run on development server on port `4200`
- [x] Also run on production server on port `8888` outside the container (mapped to `80` in the container)
- [x] Uses websocket to receive data from backend, connection on backend port `5000`
- [x] Relocate nginx config into separate folder

Specs:
- [x] Disconnect with an error when the connection to the backend is lost
  - [x] Try to reconnect every 5 seconds 
- Dashboard:
  - [x] Keep local storage
  - [x] Automatically connect to websocket when page is loaded - Reflect this in placeholder animations (pulsing effect) for the top bar and main content accordions (see below) 
  - When connected:
    - Data processing of `data` type updates:
      - [x] Reject updates that have top-level data `success` field as `false` - show dismissable error messages on top of screen
      - [x] when a distance has more than 2 `races`, but the same `heat` in all of them, it's a mass start, keep track of this
      - when a distance is flagged as mass start
        - [x] omit the first lap for everyone as it's the warmup/dummy lap not counting towards total laps
        - [x] try to extract the total number of laps from the distance title (free format) 
        - [x] render `startNumber` badges in black color
      - when a distance is **not** flagged as mass start:
        - [x] the first lap counts towards total distance
        - [x] try to extract the distance in meters from the distance title (free format)
        - [x] render `startNumber` badges in the color of the `lane` value
      - parse each distance's `races` array:
        - [x] extract the race `id`, `competitor` object `startNumber` and  `name`
        - [x] extract the `heat`
        - [x] the number of `laps` so far
        - [x] the color, known as `lane`
        - [x] the highest `time` value among the `laps` (total time)
        - [x] the `lapTime` for each lap
      - [x] store these in local storage in a data structure that allows to easily compare with new updates
        
    - Rendering:
      - [x] Refresh the dashboard with each update, but only re-render items that have changed
      - [x] Display top-level `name` field of data in top bar (black style) - followed by connection status badge
      - [x] Also show the time in seconds since the last update was received, prefixed with "Last change received: X seconds ago"
      - [x] Add a button in to right to clear local storage and refresh the page, to reset the dashboard to initial state
      - Render each distance in the main content area too:
        - [x] full width, using angular accordions 
        - [x] Reverse sorting by distance `eventNumber` descending - hide `eventNumber`
        - [x] Mark any `isLive` with an animated badge "Live"
        - [x] By default, expand the one tagged with `isLive` initially (but not after new updates)
        - [x] Ensure the `startNumbers` have a fixed width for at least 2 digits and centered within the badge
      - Inside each accordion:
        - [x] When a mass start, add a row on top for rendering groups along each other (see further below) 
          - [x] place the head of the race group to the right and each following group left of it.
          - [x] limit the amount of groups to render depending on the viewport media size
          - [x] group competitors by laps count, then by total time if they are within 2 seconds of each other
          - Render each group in a card with the following:
            - [x] Title should be "group X" where X is the group number starting from 1 for the head of the race
            - [x] Top group should be tagged as "Head of the race" in a green badge as well
            - [x] Within each group
              - sort by total time ascending
              - show the total time for the first competitor in the group
              - then show the time difference for each subsequent competitor in the group, compared to each one above another
            - [x] Between each group, show the time difference between the first competitor of the group behind and the last competitor of the next group ahead. Show this in an orange badge after the group name.
          - [x] Apply updates that are animated in the left column similarly in the right column, so that it's clear which competitor got updated in both columns
            - [x] Animate position changes too, so that it's clear when a competitor moves up or down in the ranking
              
        - New row:
          - [x] Containing all competitors
          - [x] When it is **not** a mass start: 
            - Group by `heat` in cards, then sort by `heat` ascending, then by total time in `time` ascending
          - [x] When it is a mass start: 
            - Do not group by `heat`, just show all in order (see sort below), do not use `heat` colors (use black everywhere)
            - [x] use stored race data above
            - [x] show each item in `races`
            - [x] show `competitor` object `startNumber` in badge format (use the `lane` color in badge) and  `name`
            - [x] sort by count of `laps` descending, secondary sort by `time` ascending
            - [x] Add a badge after the name with "Final lap" if they have one remaining
            - [x] Show the `laps` count and remaining in badge, e.g. "Laps: 3/10", rendering the total laps in small gray text
            - [x] Show the time along it, make decimals gray and small, also make sure to remove any leading zeroes and drop (do not round) any precision over 3 decimals (e.g. `00:01:23.4560000` should be shown as `1:23.456`)
            - [x] On any update of a race item (use `time` value to determine if it is an update), animate the background color of the item to light green for a few seconds to indicate an update. Resort races if needed.
            - [x] Animate position changes too, so that it's clear when a competitor moves up or down in the ranking - use a verbose animation swapping rows
            - [x] Keep track of the finishing line and render it below the last competitor that completed a lap in each data update.
            - [x] Render a small gap between the groups of competitors
            - Selection:
              - [x] Clicking a competitor row selects them — highlighted with a distinct border/background
              - [x] The selection is reflected in both the strip and the standings list simultaneously
              - [x] Clicking again or clicking elsewhere deselects
              - [x] Only one competitor can be selected at a time

## Mockserver
- [x] For development without real data URL
- [x] Do not alter or remove `example.json` (you may relocate it)
- [x] Python 3.14 + FastAPI, mirrors src into container
- [x] Basic code formatting tools (ruff)
- Dynamically mock the `example.json` data to change every few seconds
  - [x] Only applies to mass start distance that is live. Simulate competitors doing laps and changing positions (slightly)
  - [x] Each competitor has a stable personal pace (drawn once at race start) with small per-lap noise, so rankings change gradually and realistically
  - [x] Competitors complete laps independently — not all at the same tick — based on their pace
  - [x] Faster competitors naturally lap slower ones over time, producing different lap counts between competitors
  - [x] When all competitors have finished (reached MAX_LAPS), mark the distance `isLive: false` and pause, then restart the whole simulation after a few seconds
  - [x] Expose a `POST /api/reset` endpoint to restart the simulation immediately
  - [x] Output to logs when a change is mocked

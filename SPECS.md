# Specifications
Create a dashboard application that consists our of three components: 
- frontend
- backend
- mockserver

Each should:
- reside in a container, using compose files (`compose.yml`) and container files (`Containerfile`)
- not install packages on the host
- have some basic code formatting tools

Also:
- do not use https between containers

## Backend
- Python 3.14 + FastAPI
- Async
- Serves websocket for frontend on port `5000`
- Mirror `src` into container

Specs:
- Periodically reads data from a predefined `DATA_SOURCE_URL` env var and updates the frontend via websocket
- Interval should be configurable via env var `DATA_SOURCE_INTERVAL`, default `1`
- Cache between intervals (aiocache)
- On websocket connect, broadcast `status` type data to frontend, including:
  - `data_source_url`: value of `DATA_SOURCE_URL`
  - `data_source_interval`: value of `DATA_SOURCE_INTERVAL`
- Then update frontend with `data` type data whenever data is fetched from `DATA_SOURCE_URL` and it differs from the last sent data
- Add logging for receiving new data and sending updates to frontend

## Frontend
- Node 24 LTS + Angular + CoreUI
- Run on development server on port `4200`
- Also run on production server on port `8888` outside the container (mapped to `80` in the container)
- Uses websocket to receive data from backend, connection on backend port `5000`
- Relocate nginx config into separate folder

Specs:
- Disconnect with an error when the connection to the backend is lost
- Dashboard:
  - Centered card with title "Live Results Dashboard"
  - Status section to display Connection status
  - Button to connect to backend websocket, connect to websocket when user want to connect
  - Wipe local storage on connect, to clear any previous data
  - When successfully connected, go to `/live` route to display live data
- Live:
  - Return the dashboard when the page was (re)loaded without a websocket connection
  - Display top-level `name` field of data in top bar
  - Also show the time in seconds since the last update was received, and animate it (e.g. pulse) when a new update is received
  - Reject updates that have top-level data `success` field as `false` - show dismissable error messages on top of screen
  - Use the `isLive` flag of each distance to determine if it should be highlighted in the sidebar, along with a red dot badge right of it, animated glowing.
  - For each `data` update:
    - parse each distance's `races` array
    - extract the race `id`, `competitor` object `startNumber` and  `name`
    - the `heat`
    - the number of `laps`
    - the color, known as `lane`, or use black if not provided / mass start (see below)
    - the highest `time` value among the `laps` (total time)
    - the `lapTime` for each lap
    - when a distance has over 2 `races`, but the same `heat` in all of them, it's a mass start, then omit the first lap for everyone as it's the warmup/dummy lap 
    - store these in local storage
  - Render the distances in the main content area too:
    - full width, using angular accordions 
    - Use distance name for each one
    - By default, expand the one tagged with `isLive` initially (but not after new updates)
  - Inside the accordion split into two columns:
    - Ensure the `startNumbers` are fixed with for at least 2 digits and centered
    - Left column: 
      - When it is **not** a mass start: Use full width and omit right column. Group by `heat` in cards, then sort by `heat` ascending, then by total time in `time` ascending
      - When it is a mass start: Do not group by `heat`, just show all in order (see sort below), do not use `heat` colors (use black everywhere)
      - use stored race data above
      - show each item in `races`
      - show `competitor` object `startNumber` in badge format (use the `lane` color in badge) and  `name`
      - sort by count of `laps` descending, secondary sort by `time` ascending
      - Show the `laps` count per race too in badge
      - Show the time along it, make decimals gray and small, also make sure to remove any leading zeroes and drop (do not round) any precision over 3 decimals (e.g. `00:01:23.4560000` should be shown as `1:23.456`)
      - On any update of a race item (use `time` value to determine if it is an update), animate the background color of the item to light green for a few seconds to indicate an update. Resort races if needed.
      - Animate position changes too, so that it's clear when a competitor moves up or down in the ranking
    - Right column:
      - Omit when it is **not** a mass start, then just show the left column full width
      - Similar to left column but now groups competitors
        - group by laps count, then by total time if they are within 2 seconds of each other
      - Render each group in a card, with the laps count time difference between them
        - Top group should be tagged as "Head of race" in a green badge
        - Within each group, sort by total time ascending, show the total time for the first competitor in the group, and then show the time difference for each subsequent competitor in the group compared to each one above another
      - Between each group, show the time difference between the last competitor of the previous group and the first competitor of the next group
        - Show this in an orange badge between the groups.
      - Apply updates that are animated in the left column similarly in the right column, so that it's clear which competitor got updated in both columns
        - Animate position changes too, so that it's clear when a competitor moves up or down in the ranking

## Mockserver
- For development without real data URL
- Do not alter or remove `example.json`
- Wiremock

# Sema — Frontend Behaviour Specification

**Version:** 1.0
**Scope:** Logic and behaviour only. No visual design, no CSS. Covers what happens on load, how screens transition, how state is managed in memory, how maps are initialised, how polls are started and stopped, and how the frontend responds to every meaningful event.

---

## 1. File Structure

```
rider.html        — all rider screens, loads rider.js and Mapbox GL JS
rider.js          — all rider state, navigation, polling, map logic
driver.html       — all driver screens, loads driver.js and Mapbox GL JS
driver.js         — all driver state, navigation, polling, map logic
```

Each HTML file contains all screens for that role as `<div>` elements. Only one screen is visible at a time. All others have `display: none`. Navigation is handled entirely by JS — no page reloads, no URL changes.

---

## 2. Screen Visibility

### Rule
Every screen is a `<div>` with a unique `id`. Exactly one screen has `display: block` at any time. All others have `display: none`.

### Navigation function
One function handles all screen transitions for each role:

```
function showScreen(screenId)
  — set all screen divs to display: none
  — set the target screen div to display: block
  — scroll the target screen to the top
  — call the onEnter handler for the target screen if one exists
  — call the onExit handler for the previous screen if one exists
```

### onEnter and onExit handlers
Each screen that needs setup or teardown logic registers an `onEnter` and/or `onExit` handler. These are called automatically by `showScreen`. Examples:
- Search screen `onEnter`: fetch active trips for the default route, initialise the map
- Active trip screen `onEnter` (driver): start Poll 1 and Poll 3
- Waiting screen `onExit` (rider): stop Poll 2 if the rider navigates away manually

---

## 3. Global State — Rider

One global state object lives in memory for the duration of the session. It is initialised on page load and updated by polls and user actions.

```
RiderState {
  // Auth
  user: {
    id:     integer,
    name:   string,
    phone:  string
  } or null,

  // Route and trip selection
  selectedRouteId:   string or null,
  selectedTripId:    integer or null,
  selectedTrip:      full trip object or null,

  // Active pickup
  activePickup: {
    id:              integer,
    trip_id:         integer,
    pickup_type:     string,
    status:          string,
    stop_id:         string,
    stop_name:       string,
    pickup_lat:      float,
    pickup_lng:      float,
    seats_requested: integer,
    alert_level:     string,
    pickup_window_start: datetime or null,
    pickup_window_end:   datetime or null
  } or null,

  // Map
  map:               Mapbox map instance or null,
  matutuMarker:      Mapbox marker instance or null,
  pickupMarker:      Mapbox marker instance or null,

  // Poll handles
  gpspollInterval:      interval handle or null,
  pickupPollInterval:   interval handle or null,

  // UI
  currentScreen:     string,
  lastAlertLevel:    string or null,
  errorBannerActive: boolean
}
```

### Rules
- `user` is null until login succeeds
- `selectedTrip` holds the full trip object returned by GET /api/trips/:id — the map and detail screen read from this, not from separate fetches
- `activePickup` is null until POST /api/pickups succeeds. It is updated on every Poll 2 response
- Map instances are stored here so they can be accessed from any function without re-querying the DOM
- Poll interval handles are stored here so they can be cleared from anywhere

---

## 4. Global State — Driver

```
DriverState {
  // Auth
  user: {
    id:     integer,
    name:   string,
    phone:  string,
    plate:  string,
    sacco:  string
  } or null,

  // Active trip
  activeTrip: {
    id:               integer,
    route_id:         string,
    status:           string,
    seats_total:      integer,
    seats_available:  integer,
    fare:             integer,
    current_lat:      float,
    current_lng:      float,
    current_step:     integer,
    active_stops:     array of stop objects
  } or null,

  // Riders on current trip
  riders:            array of pickup objects,
  lastRidersSnapshot: array of pickup objects,

  // Map
  map:               Mapbox map instance or null,
  matututMarker:      Mapbox marker instance or null,
  riderMarkers:      object keyed by pickup_id, values are Mapbox marker instances,

  // Poll handles
  gpsPollInterval:    interval handle or null,
  ridersPollInterval: interval handle or null,

  // UI
  currentScreen:      string,
  errorBannerActive:  boolean
}
```

### Rules
- `activeTrip` is null until POST /api/trips succeeds. It is set then and updated on pause, resume, and end responses
- `riders` is the current array from the last Poll 3 response
- `lastRidersSnapshot` is the previous poll's array — used for diffing to avoid unnecessary re-renders
- `riderMarkers` is a live registry of all marker instances on the map, keyed by `pickup_id` — used to add and remove dots without clearing and redrawing the whole layer

---

## 5. Page Load Behaviour

### Both roles

On page load, before any screen is shown:

1. Read the Mapbox token from the global JS variable injected by Flask
2. Check if a session exists by calling `GET /api/auth/session` (a lightweight endpoint that returns the current user or 401)
3. If session exists: populate `RiderState.user` or `DriverState.user`, navigate to the home screen
4. If no session: navigate to the login screen
5. Fetch all routes from `GET /api/config/routes` and store in a module-level variable accessible to all functions — this is fetched once and never re-fetched unless the page reloads

### Route data
Routes are fetched once on page load and stored in memory. All subsequent references to route names, stop names, stop coordinates, and coordinate arrays read from this in-memory store. No screen fetches route data independently.

---

## 6. Screen Behaviour — Rider

---

### Login screen

**On enter:**
- Clear any previous error state
- Focus the phone input

**On submit:**
- Validate phone is not empty
- Call POST /api/auth/login with `{phone, role: 'rider'}`
- On success: populate `RiderState.user`, navigate to home screen
- On 404: show inline error "Phone number not found"
- On any other error: show inline error "Something went wrong — try again"

---

### Home screen

**On enter:**
- If `RiderState.user` is null: redirect to login
- Render user's name in the greeting
- No polls active on this screen

**User actions:**
- Tap "Find a matatu" → navigate to search screen
- Tap "Schedule ride" → navigate to search screen with reservation mode flagged in state
- Tap a recent route → navigate to search screen with that route pre-selected

---

### Search screen

**On enter:**
- If `RiderState.selectedRouteId` is set: immediately fetch trips for that route
- Initialise the map centred on Nairobi (see Map Initialisation section)
- Render route selector

**On route selected:**
- Set `RiderState.selectedRouteId`
- Call `GET /api/trips?route_id={id}`
- Render trip cards from response
- Render matatu dots on map from `current_lat`, `current_lng` of each trip
- Render the selected route line on the map from the in-memory route data

**On trip card tapped:**
- Set `RiderState.selectedTripId` and `RiderState.selectedTrip`
- Navigate to matatu detail screen

**On exit:**
- Do not clear `selectedRouteId` or `selectedTripId` — rider may return to this screen

---

### Matatu detail screen

**On enter:**
- Read trip data from `RiderState.selectedTrip` — do not re-fetch
- Render route line, matatu dot, and stop markers on map
- Start Poll 1 (GPS) using `RiderState.selectedTripId`

**On Poll 1 response:**
- Move matatu dot using interpolation
- If `status = ended`: show toast "This trip has ended", stop Poll 1, navigate to search screen

**User actions:**
- Tap "Flag me now" → navigate to flagging screen
- Tap "Set pickup spot" → navigate to pickup spot screen
- Tap "Reserve a seat" → navigate to reservation screen
- Tap back → stop Poll 1, navigate to search screen

**On exit:**
- Stop Poll 1

---

### Flagging screen

**On enter:**
- Map is already initialised — reuse the existing map instance
- Show rider's selected stop marker (from stop selection, or prompt rider to select a stop)
- Poll 1 continues from matatu detail screen

**On "Flag me now" tapped:**
- Validate a stop is selected
- Call POST /api/pickups with `{trip_id, pickup_type: 'flagging', stop_id, seats_requested}`
- On 201: set `RiderState.activePickup`, start Poll 2, navigate to waiting screen
- On 409 "not enough seats": show toast "No seats available at this stop"
- On 409 "trip is not active": show toast "This trip is no longer available", navigate to search screen

---

### Waiting screen (flagging and reservation)

**On enter:**
- Poll 1 and Poll 2 are both running
- Render the matatu dot moving on the map
- Render the rider's pickup stop marker

**On Poll 2 response — handle each status transition:**

| Status received | Action |
|---|---|
| `pending` | No change |
| `accepted` | Navigate to boarding confirm screen |
| `rejected` | Stop Poll 2. Show toast "Driver could not pick you up." Navigate to search screen. |
| `cancelled` | Stop Poll 2. Navigate to search screen silently. |
| `no_show` | Stop Poll 2. Show toast "You missed your pickup window." Navigate to search screen. |

**On alert level change:**

| Alert level | Action |
|---|---|
| `none` → `approaching` | Show approaching banner. Store new level in `RiderState.lastAlertLevel`. |
| `approaching` → `near` | Replace banner with near banner. Store new level. |
| No change | Do nothing — compare against `lastAlertLevel` before updating DOM |

**On "Cancel" tapped:**
- Call PATCH /api/pickups/:id/cancel
- On success: stop Poll 2, stop Poll 1, navigate to search screen
- On error: show toast "Could not cancel — try again"

**On exit (manual navigation):**
- Stop Poll 2
- Poll 1 continues if rider is still viewing a map screen

---

### Boarding confirm screen

**On enter:**
- Poll 1 continues
- Poll 2 continues — in case driver reverses acceptance (edge case)
- Render trip summary from `RiderState.activePickup` and `RiderState.selectedTrip`

**On "I'm On Board" tapped:**
- Call PATCH /api/pickups/:id/board
- On success: stop Poll 2, set `RiderState.activePickup.status = completed`, navigate to live trip screen
- On 409: show toast "Boarding could not be confirmed — try again"

**On "Not my matatu" tapped:**
- Call PATCH /api/pickups/:id/cancel
- On success: stop Poll 2, navigate to flagging screen to re-flag

**Auto-cancel timer:**
- Start a 3-minute countdown on enter
- If timer expires before "I'm On Board" is tapped: call PATCH /api/pickups/:id/cancel, show toast "Boarding window expired", navigate to flagging screen
- If rider taps "I'm On Board" before timer expires: clear the timer

---

### Pickup spot screen

**On enter:**
- Render map with route line and stop markers
- Stop markers are tappable

**On stop tapped:**
- Highlight the selected stop marker
- Store `stop_id` in state

**On "Alert Me When Near" tapped:**
- Validate a stop is selected
- Navigate to waiting screen with `pickup_type = 'flagging'` and the selected stop
- Pickup is created on the waiting screen entry (same flow as flagging)

---

### Reservation screen

**On enter:**
- Render route stops as selectable options
- Render time slot selector

**On "Confirm Reservation" tapped:**
- Validate stop and time slot are selected and seats requested is between 1 and 3
- Call POST /api/pickups with `{trip_id, pickup_type: 'reservation', stop_id, seats_requested, pickup_window_start, pickup_window_end}`
- On 201: set `RiderState.activePickup`, navigate to reservation success screen
- On 409: show inline error with the error message from the response

---

### Reservation success screen

**On enter:**
- Render reservation details from `RiderState.activePickup`
- No polls active — rider is not yet tracking anything

**When trip becomes active:**
- Poll 2 starts automatically when the rider returns to the app and the pickup status is `pending`
- This is handled on home screen enter: if `RiderState.activePickup` is not null and status is `pending`, start Poll 2 and navigate to waiting screen

---

### Live trip screen

**On enter:**
- Poll 1 continues
- Render route line and matatu dot
- Render progress indicator from `current_step` vs total route steps

**On Poll 1 response:**
- Move matatu dot
- Update progress indicator
- If `status = ended`: stop Poll 1, navigate to trip ended screen

**On "End trip / I've arrived" tapped:**
- Show confirmation dialog
- On confirm: stop Poll 1, navigate to trip ended screen

---

### Trip ended screen

**On enter:**
- All polls are stopped
- Render trip summary from `RiderState.selectedTrip` and `RiderState.activePickup`
- Clear `RiderState.activePickup`

**On "Back to home" tapped:**
- Clear `RiderState.selectedTripId` and `RiderState.selectedTrip`
- Navigate to home screen

---

### My trips screen

**On enter:**
- Call GET /api/pickups/history
- Render pickup history grouped by status

---

### Profile screen

**On enter:**
- Render user details from `RiderState.user`

**On "Sign out" tapped:**
- Call POST /api/auth/logout
- Clear `RiderState` entirely
- Stop all active polls
- Navigate to login screen

---

## 7. Screen Behaviour — Driver

---

### Login screen

**On enter:**
- Clear any previous error state

**On submit:**
- Call POST /api/auth/login with `{phone, role: 'driver'}`
- On success: populate `DriverState.user`, navigate to home screen
- On 404: show inline error "Phone number not found"

---

### Home screen

**On enter:**
- If `DriverState.activeTrip` is not null and status is `active` or `paused`: show banner "You have an active trip" with link to active trip screen
- Render upcoming reservations for today — call GET /api/trips/history filtered to today (derived from existing ended trips — upcoming reservations are active pickups on active trips assigned to this driver)
- No polls active

**On "Start a trip" tapped:**
- Navigate to start trip form screen

---

### Start trip form screen

**On enter:**
- Render route selector from in-memory route data
- Render stop toggles for the selected route

**On route selected:**
- Render that route's stops as toggles, all on by default

**On "Begin trip" tapped:**
- Validate destination selected, at least one stop active, seats between 1 and 30, fare is positive
- Call POST /api/trips
- On 201: set `DriverState.activeTrip`, navigate to active trip screen
- On 409 "driver already has an active trip": show toast "You already have an active trip", navigate to active trip screen

---

### Active trip screen

**On enter:**
- Initialise map centred on `DriverState.activeTrip.current_lat`, `DriverState.activeTrip.current_lng`
- Render route line from in-memory route data
- Place driver dot at current position
- Render active stop markers
- Start Poll 1 (GPS)
- Start Poll 3 (riders)

**On Poll 1 response:**
- Move driver dot using interpolation
- Update seat counter display
- If `status = paused`: show paused banner, stop dot animation
- If `status = ended`: stop both polls, navigate to end trip summary screen

**On Poll 3 response:**
- Run diff against `DriverState.lastRidersSnapshot`
- For new pickups: add dot to map, add card to feed
- For changed statuses: update card state, remove dot if completed/rejected/cancelled/no_show
- For cancellations: show toast "{rider_name} cancelled"
- Update `DriverState.lastRidersSnapshot`

**On "Accept" tapped on a rider card:**
- Call PATCH /api/pickups/:id/accept
- On success: update card to accepted state
- On 409 "not enough seats": show toast "Not enough seats for this rider"

**On "Reject" tapped on a rider card:**
- Navigate to reject rider screen with `pickup_id` stored in state

**On pause toggle:**
- Call PATCH /api/trips/:id/pause
- On success: update `DriverState.activeTrip.status`, show paused banner

**On "End trip" tapped:**
- If there are pending or accepted pickups: show dialog "You have riders who haven't boarded. End anyway?"
- On confirm: call PATCH /api/trips/:id/end
- On success: stop Poll 1 and Poll 3, navigate to end trip summary screen

---

### Paused trip screen

**On enter:**
- Both polls continue running
- Matatu dot stops animating (server is not advancing position)
- Show paused state on map (dashed route line)

**On "Resume" tapped:**
- Call PATCH /api/trips/:id/resume
- On success: update `DriverState.activeTrip.status = active`, navigate to active trip screen

**On "End trip" tapped:**
- Same flow as active trip screen end trip

---

### Cluster view screen

**On enter:**
- Render zoomed map showing individual rider dots at the cluster location
- Render rider cards for all riders at this stop
- Read cluster data from `DriverState.riders` filtered by `stop_id`

**On accept/reject:**
- Same as active trip screen rider card actions
- On return to active trip screen: Poll 3 will have updated the rider list

---

### Pickup confirm screen

**On enter:**
- Render reserved riders at the current stop
- Show pickup window countdown timer
- Poll 3 continues — rider ready status updates arrive via this poll

**On "Confirm boarding" tapped:**
- Call PATCH /api/pickups/:id/board
- On success: update card to boarded state, decrement seat counter

**On "No-show" tapped:**
- Call PATCH /api/pickups/:id — set status to no_show via the reject endpoint with no_show reasoning
- On success: update card to no-show state

**Pickup window countdown:**
- Calculate time remaining from `pickup_window_end`
- Update countdown display every second using `setInterval` (separate from poll intervals)
- When countdown reaches zero: show "Pickup window expired" banner

---

### Reject rider screen

**On enter:**
- Render rider name from the pickup stored in `DriverState.riders`
- Render reason selector chips

**On "Confirm rejection" tapped:**
- Call PATCH /api/pickups/:id/reject
- On success: navigate back to previous screen, show toast "{rider_name} rejected"

---

### End trip summary screen

**On enter:**
- All polls are stopped
- Call GET /api/trips/:id (one-time fetch for summary data)
- Render stats and reservation breakdown
- Clear `DriverState.activeTrip`
- Clear `DriverState.riders`
- Clear all map markers from `DriverState.riderMarkers`

**On "Back to home" tapped:**
- Navigate to home screen

**On "Start another trip" tapped:**
- Navigate to start trip form screen

---

### Trip history screen

**On enter:**
- Call GET /api/trips/history
- Render trip cards grouped by day

---

### Profile screen

**On "Sign out" tapped:**
- Call POST /api/auth/logout
- Clear `DriverState` entirely
- Stop all active polls
- Navigate to login screen

---

## 8. Map Initialisation

### When the map is initialised
The Mapbox map is initialised once per screen that contains a map. It is stored in `RiderState.map` or `DriverState.map`. If a screen is re-entered, the existing map instance is reused — it is not destroyed and reinitialised.

### Initial view
- Centre: Nairobi city centre (`-1.2921, 36.8219`)
- Zoom: 12 for overview screens (search, home map)
- Zoom: 14 for active tracking screens (waiting, live trip, active driver trip)

### Layers added on initialisation
1. Route line — a GeoJSON LineString source added from the in-memory route coordinate array. Rendered as a solid coloured line. Added once. Never removed during the trip.
2. Stop markers — one marker per active stop. Added once on initialisation.
3. Matatu dot — one marker, positioned at `current_lat`, `current_lng`. Updated on every GPS poll response.
4. Rider dots (driver map only) — one marker per active pickup. Added and removed dynamically by Poll 3 diff logic.
5. Pickup location marker (rider map only) — one marker at the rider's selected stop. Added when the rider selects a stop.

### Marker interpolation
The matatu dot moves smoothly between positions. On each GPS poll response, the frontend records the previous position and the new position, then animates the marker along the straight line between them over 5 seconds using `requestAnimationFrame`. When the next poll response arrives, the animation restarts from wherever the marker currently is.

---

## 9. State Persistence Rules

| State | Persists across screens | Cleared when |
|---|---|---|
| `user` | Yes | Logout |
| `selectedRouteId` | Yes | Logout or new route selected |
| `selectedTripId` | Yes | Logout or trip ended |
| `selectedTrip` | Yes | Logout or trip ended |
| `activePickup` | Yes | Logout or pickup reaches terminal status |
| `activeTrip` (driver) | Yes | Logout or trip ended |
| `riders` (driver) | Yes | Trip ended |
| Map instance | Yes — per screen | Page reload |
| Poll intervals | Per screen | Explicitly stopped on exit or terminal status |
| `lastAlertLevel` | Yes | New pickup created |
| `lastRidersSnapshot` | Yes | Trip ended |

---

## 10. Navigation Map

### Rider
```
Login
  └─► Home
        ├─► Search
        │     └─► Matatu Detail
        │           ├─► Flagging → Waiting → Boarding Confirm → Live Trip → Trip Ended
        │           ├─► Pickup Spot → Waiting → Boarding Confirm → Live Trip → Trip Ended
        │           └─► Reservation → Reservation Success
        ├─► My Trips
        └─► Profile
```

### Driver
```
Login
  └─► Home
        └─► Start Trip Form
              └─► Active Trip
                    ├─► Paused Trip → Active Trip
                    ├─► Cluster View → Active Trip
                    ├─► Pickup Confirm → Active Trip
                    ├─► Reject Rider → Active Trip
                    └─► End Trip Summary → Home or Start Trip Form
```

---

*End of Sema Frontend Behaviour Specification v1.0*
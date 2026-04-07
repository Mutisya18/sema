# Sema — Development Guide
Version: 1.0
Scope: Phased development plan for LLM-assisted coding. Each phase covers one feature end-to-end, produces something testable, and has a sign-off checklist before the next phase begins.

---

## Principles

**One feature at a time.** Each phase gives the LLM a single, bounded task. The LLM reads only the spec documents listed for that phase — nothing else. This keeps context tight and hallucination low.

**Backend and frontend together per feature.** Each phase delivers a working slice: the database rows, the endpoint, and the screen that uses it. You can see and test the feature immediately.

**Nothing moves forward until you sign off.** Each phase ends with a checklist. You test manually, confirm every item, and only then hand the next phase to the LLM.

**The frontend is always in a runnable state.** No phase leaves the app broken. If a feature is not yet built, the screen either does not exist yet or shows a clear placeholder — never a crash or blank error.

**Amend freely on the frontend.** UI changes, copy tweaks, colour adjustments, and minor journey changes are low-risk. Make them between phases or flag them as amendments at the start of the next phase prompt. The spine — schema, API contract, polling contract — does not change without a deliberate decision.

---

## Environment Setup (Phase 0)

**What the LLM builds:**
The complete project skeleton with no feature logic. Everything compiles and runs. No screens, no endpoints — just the frame.

**Spec documents to give the LLM:**
- Project Structure Spec v1.0

**What gets built:**
- Folder structure exactly as defined in the Project Structure Spec
- `run.py`, `config.py`, `database.py`, `seed.py`, `gps.py` (routes stubbed with empty coordinate arrays — to be filled later)
- Flask app factory with all blueprints registered but routes returning `501 Not Implemented`
- `rider.html` and `driver.html` served at `/rider` and `/driver` — blank pages with correct structure, Mapbox token injection, and JS/CSS file links
- Empty `rider.js`, `driver.js`, `rider.css`, `driver.css`
- `.env.example`, `.gitignore`, `requirements.txt`
- `pytest` configured, `conftest.py` with fixtures, test files stubbed but empty
- `POST /api/dev/reset` implemented and working

**Sign-off checklist:**
- [ ] `python run.py` starts without errors
- [ ] `http://localhost:5000/rider` loads a blank white page with no console errors
- [ ] `http://localhost:5000/driver` loads a blank white page with no console errors
- [ ] `python seed.py` runs without errors and inserts seed data
- [ ] `POST /api/dev/reset` returns `{message: 'database reset and reseeded'}`
- [ ] `pytest` runs with zero failures (all tests skipped/empty is fine)
- [ ] `.env` is not committed to version control

---

## Phase 1 — Auth & Login

**What the LLM builds:**
Login screens for both roles. Session management. Page load state restoration.

**Spec documents to give the LLM:**
- API Contract Spec v1.0 → §1 Auth only
- Frontend Behaviour Spec v1.0 → Login screen, page load sequence
- Rider UI Spec v2.1 → S-00 Login
- Driver UI Spec v1.0 → D-00 Login
- Supporting Reference Spec v1.0 → Part 1 Session & State (§1.1, §1.2 user field only, §1.3 user field only)
- Design System → Colours, Typography, Buttons, Inputs

**What gets built:**
- `POST /api/auth/login` and `POST /api/auth/logout`
- `GET /api/auth/session`
- Rider login screen rendered and functional
- Driver login screen rendered and functional
- `showScreen()` navigation function in both JS files
- `RiderState` and `DriverState` objects initialised
- Page load sequence: check session → route to correct screen

**Sign-off checklist:**
- [ ] Rider at `/rider` sees the login screen
- [ ] Rider logs in with `+254712345001` — lands on a blank home screen (placeholder div is fine)
- [ ] Rider logs in with an unknown number — sees "Phone number not found" inline error
- [ ] Driver at `/driver` logs in with `+254722100001` — lands on blank home screen
- [ ] Refreshing the page while logged in stays logged in (session restored)
- [ ] Refreshing while logged out shows the login screen
- [ ] Sign out clears the session and returns to login
- [ ] No console errors on any of the above

---

## Phase 2 — Route Config Endpoint & Map Initialisation

**What the LLM builds:**
Route data served from `gps.py`. Maps initialised on both frontends. No trips yet — just the map rendering correctly with route lines and stop markers.

**Spec documents to give the LLM:**
- API Contract Spec v1.0 → §2 Config (GET /api/config/routes)
- Maps & Simulation Spec v1.0 → §1 Core Concepts, §2 Route Definition
- Map Initialisation Spec v1.0 → §1 Shared Rules, §3 Rider Search Map (initialisation only, no trip dots yet), §5 Driver Active Trip Map (initialisation only)
- Project Structure Spec v1.0 → gps.py section

**Important note for the LLM:** At this phase, `gps.py` coordinate arrays are placeholders — use 5–10 hardcoded coordinates per route sufficient to draw a visible line. Real route coordinates will be pasted in before Phase 5.

**What gets built:**
- `gps.py` with `ROUTES` dictionary, `get_route()`, `get_stop()` functions, placeholder coordinate arrays
- `GET /api/config/routes` endpoint
- Both frontends fetch routes on page load and store in memory
- Rider search screen initialised with Mapbox map, route selector chips, route line renders when a route is selected, stop markers appear
- Driver start trip form screen initialised (no map yet — just the route selector populating from config)

**Sign-off checklist:**
- [ ] `GET /api/config/routes` returns all 3 routes with stops and coordinates
- [ ] Rider search screen shows a map centred on Nairobi
- [ ] Selecting "CBD → Thika" draws a route line on the map
- [ ] Stop markers appear at correct positions
- [ ] Driver start trip form shows route stop names from config
- [ ] NavigationControl (zoom/compass) visible on map
- [ ] Tile load failure shows "Map unavailable — check your connection" banner (test by temporarily using a bad token)
- [ ] No console errors

---

## Phase 3 — Driver: Start Trip & Simulator

**What the LLM builds:**
Driver can start a trip. Simulator thread spawns and advances the matatu position. Driver sees their own dot moving on the map.

**Spec documents to give the LLM:**
- Database Schema Spec v1.1 → TRIP, TRIP_STOPS tables
- API Contract Spec v1.0 → POST /api/trips, GET /api/trips/:trip_id/gps, PATCH /api/trips/:trip_id/pause, PATCH /api/trips/:trip_id/resume, PATCH /api/trips/:trip_id/end
- Maps & Simulation Spec v1.0 → §4 Position Simulation, §9 The Abstraction Boundary
- Project Structure Spec v1.0 → app/simulator/engine.py section
- Frontend Behaviour Spec v1.0 → Driver: Start trip form screen, Active trip screen (Poll 1 only — no riders yet)
- Driver UI Spec v1.0 → D-02 Start Trip Form, D-04 Active Trip (map and header only), D-05 Paused Trip, D-07 End Trip Summary
- Polling Contract Spec v1.0 → Poll 1 (Driver side only)
- Activity Diagram v2.0 → §2.2 Start Trip, §2.3 Active Trip (Poll 1 only), §2.4 Pause and Resume, §2.5 End Trip, §4 Simulator Lifecycle

**What gets built:**
- `POST /api/trips`, `GET /api/trips/:id/gps`, `PATCH` pause/resume/end
- Simulator engine: thread spawn, step advancement, position write, thread exit
- Driver start trip form: route selector, stop stack builder, fare input, seats stepper, begin trip button
- Driver active trip screen: map with moving driver dot (Poll 1), pause/resume/end buttons
- Driver paused screen
- Driver end trip summary screen
- `GET /api/trips/history` and driver history screen (basic list)

**Sign-off checklist:**
- [ ] Driver fills form and taps Begin Trip — trip row created in DB
- [ ] Driver dot appears on map at route origin (coordinate index 0)
- [ ] Dot moves every 5 seconds — smoothly interpolated, not snapping
- [ ] `GET /api/trips/:id/gps` returns updated lat/lng on each poll
- [ ] Pausing stops the dot — resuming starts it again
- [ ] Dot stops when trip ends — summary screen shows correct trip stats
- [ ] Simulator thread stops cleanly when trip ends
- [ ] Refreshing page mid-trip restores active trip state and resumes Poll 1
- [ ] History screen shows ended trips
- [ ] `POST /api/dev/reset` stops all threads and clears all trip data
- [ ] No console errors

---

## Phase 4 — Rider: Search & Matatu Discovery

**What the LLM builds:**
Rider can search for a route, see active matatus, and view matatu detail. No pickup yet — just discovery.

**Spec documents to give the LLM:**
- API Contract Spec v1.0 → GET /api/trips (with route_id filter), GET /api/trips/:trip_id
- Frontend Behaviour Spec v1.0 → Rider: Search screen, Matatu detail screen (Poll 1 only)
- Rider UI Spec v2.1 → S-01 Home, S-02 Search, S-04 Matatu Detail
- Polling Contract Spec v1.0 → Poll 1 (Rider side only)
- Activity Diagram v2.0 → §3.1 Login and State Restoration, §3.2 Flagging (search and matatu list steps only)

**What gets built:**
- `GET /api/trips?route_id=...` and `GET /api/trips/:trip_id`
- Rider home screen: greeting, Quick Trip card, Schedule Ride card, recent routes (hardcoded for now)
- Rider search screen: dual from/to inputs, matatu list, matatu cards with step-based filter (matatus past rider's stop excluded)
- Rider matatu detail screen: route summary, stats, driver info, Poll 1 running, action buttons present but non-functional (placeholder)
- Step-based exclusion: matatus whose current_step has passed rider's from stop index are excluded

**Sign-off checklist:**
- [ ] Home screen renders correctly with rider's name
- [ ] Tapping search bar opens search screen with two inputs
- [ ] Typing a destination filters to defined stops
- [ ] With a driver's active trip running (from Phase 3), rider sees it in the matatu list
- [ ] Matatu card shows correct plate, sacco, fare, ETA
- [ ] Tapping a card opens matatu detail
- [ ] Matatu dot moves on detail screen map (Poll 1 running)
- [ ] A matatu that has passed the rider's from stop does not appear in the list
- [ ] Tapping Quick Trip pre-fills and locks the from input
- [ ] No console errors

---

## Phase 5 — GeoJSON Routes

**What the LLM builds:**
Nothing new — this is a content phase. Real coordinate arrays are pasted into `gps.py`. Stop step indices are updated to match.

**Spec documents to give the LLM:**
- Maps & Simulation Spec v1.0 → §2 Route Definition (step field explanation)
- Supporting Reference Spec v1.0 → Part 3 Seed Data §3.3 Routes

**Your work before this phase:**
1. Open geojson.io
2. Draw each route (CBD→Thika, CBD→Westlands, CBD→Ngong) as a LineString
3. Place a vertex exactly at each stop location while drawing
4. Export the GeoJSON, extract the coordinates array
5. Note the array index of each stop vertex — this becomes its `step` value
6. Paste the three coordinate arrays and updated step values into `gps.py`

**What the LLM does:**
- Replaces placeholder coordinate arrays in `gps.py` with the real ones you provide
- Updates `step` values on each stop to match the real indices
- No other changes

**Sign-off checklist:**
- [ ] Route lines on the map follow actual Nairobi roads
- [ ] Stop markers appear at correct real-world positions
- [ ] Simulator advances through real coordinates — dot follows the road
- [ ] Proximity check fires at approximately the right distance from each stop
- [ ] All three routes work correctly

---

## Phase 6 — Flagging Journey (End to End)

**What the LLM builds:**
The complete flagging flow. Rider flags a matatu, driver sees the dot, accepts or rejects, rider boards.

**Spec documents to give the LLM:**
- Database Schema Spec v1.1 → PICKUP table (flagging rows only)
- API Contract Spec v1.0 → POST /api/pickups, GET /api/pickups/active, PATCH accept, PATCH reject, PATCH cancel, PATCH board
- API Contract Addendum v1.1 → PATCH /api/pickups/:id/spot (full spec)
- Polling Contract Spec v1.0 → Poll 2 (full), Poll 3 (full)
- Frontend Behaviour Spec v1.0 → Rider: Flagging screen, Waiting screen, Boarding Confirm screen, Live Trip screen, Trip Ended screen. Driver: Active trip screen (full — rider feed, dots, diff logic)
- Rider UI Spec v2.1 → S-04 (Flag Matatu button), S-06 Flagging Waiting, S-09 Boarding Confirm, S-10 Live Trip, S-11 Trip Ended
- Driver UI Spec v1.0 → D-04 Active Trip (full), D-03 Reject Rider
- Supporting Reference Spec v1.0 → Part 2 §2.1 Seat race condition, §2.2 Driver ends trip with pending riders, §2.3 Trip ends while rider on board, §2.9 Driver pauses — rider perspective
- Activity Diagram v2.0 → §3.2 Flagging (full), §3.5 Boarding and Live Trip, §6 Intersection Points, §9 PICKUP state machine

**What gets built:**
- All pickup endpoints (flagging type)
- Proximity checker in simulator: Haversine distance, alert_level writes
- `PATCH /api/pickups/:id/spot` endpoint
- Rider: flagging waiting screen with proximity banners, Pick Me Up button, cancel
- Rider: boarding confirm screen with 3-minute timer
- Rider: live trip screen and trip ended screen
- Driver: full rider feed with diff logic, orange dots, accept/reject, spotted card priority, white dot on spotted

**Sign-off checklist:**
- [ ] Rider taps "Flag Matatu" — pickup row created, rider dot appears on driver map
- [ ] Driver sees orange dot at rider's stop, rider card in feed
- [ ] Proximity banners update correctly as matatu advances (none → approaching → near)
- [ ] Rider taps "Pick Me Up" — button changes to "Signalled ✓", driver card moves to top with spotted style, dot turns white
- [ ] Driver accepts — rider sees boarding confirm screen
- [ ] Rider taps "I'm On Board" — seats_available decrements, rider navigates to live trip
- [ ] Driver rejects — rider sees rejection toast, navigates to search
- [ ] Rider cancels — driver sees toast, dot removed
- [ ] 3-minute boarding timer expires — pickup cancelled, rider returned to waiting
- [ ] Driver ends trip with pending riders — confirmation dialog appears, pending pickups cancelled, affected riders notified via poll
- [ ] No-show check fires correctly for expired windows
- [ ] Seat race condition returns 409 on second board attempt
- [ ] No console errors throughout

---

## Phase 7 — Pickup Journey (End to End)

**What the LLM builds:**
The pickup journey. Structurally identical to flagging on the backend — the difference is purely in the frontend flow and the "Pick Me Up" timing.

**Spec documents to give the LLM:**
- Rider UI Spec v2.1 → S-02 Search (pickup entry), S-04 Matatu Detail (Set as Pickup Matatu button), S-07 Pickup Waiting
- Frontend Behaviour Spec v1.0 → Rider: Pickup spot screen, Pickup waiting screen
- Activity Diagram v2.0 → §3.3 Pickup Journey
- Polling Contract Spec v1.0 → Poll 2 (pickup waiting differences — Pick Me Up gated by alert_level)

**What gets built:**
- Search screen from/to inputs fully editable (pickup journey entry)
- "Set as Pickup Matatu" button on matatu detail — same API call as flagging
- Pickup waiting screen: no Pick Me Up button until `alert_level = near`, countdown starts at near, button appears
- All other behaviour identical to Phase 6

**Sign-off checklist:**
- [ ] Tapping search bar (not Quick Trip) opens search with both inputs editable
- [ ] Rider selects from stop and to stop — sees correct matatu list
- [ ] Tapping "Set as Pickup Matatu" creates a flagging pickup
- [ ] On waiting screen: no Pick Me Up button until matatu is near
- [ ] At `alert_level = near`: countdown appears, Pick Me Up button appears
- [ ] Pick Me Up flow behaves identically to Phase 6 from that point
- [ ] Quick Trip (flagging) still works correctly — not broken by this phase
- [ ] No console errors

---

## Phase 8 — Booking Journey (End to End)

**What the LLM builds:**
The complete booking flow. Advance reservation for a future trip.

**Spec documents to give the LLM:**
- Database Schema Spec v1.1 → PICKUP table (reservation type, pickup_window fields)
- API Contract Spec v1.0 → POST /api/pickups (reservation type), GET /api/pickups/history
- Rider UI Spec v2.1 → S-03 Booking Destination, S-05 Booking From, S-08 Booking Date & Time, S-11 Booking Matatu List, S-12 Booking Seat Count, S-13 Booking Confirm, S-14 Booking Success, S-15 My Trips
- Frontend Behaviour Spec v1.0 → Rider: Reservation screen, Reservation success screen, My trips screen, Home screen (Schedule Ride entry)
- Activity Diagram v2.0 → §3.4 Booking Journey
- Supporting Reference Spec v1.0 → Part 2 §2.4 Rider's pickup window expires (no-show)
- Polling Contract Spec v1.0 → Poll 2 (no-show handling), Poll 3 (no-show on driver side)

**What gets built:**
- Booking flow: 6-step form (destination → from → date & time → matatu list → seat count → confirm)
- Future trip filter on matatu list (trips not yet started)
- Pickup window calculation: window_start and window_end derived from selected departure time
- No-show check: server sets status = no_show when window_end has passed
- My Trips screen: active, upcoming, and past sections
- Driver booking card: blue border/background, pickup window shown, expands at `alert_level = near` with countdown, confirm/no-show buttons
- `GET /api/pickups/history`

**Sign-off checklist:**
- [ ] Tapping "Schedule Ride" on home enters the booking flow
- [ ] Each step of the 6-step form works and validates correctly
- [ ] Booking confirmed — pickup row created with reservation type and window times
- [ ] My Trips shows the booking in Upcoming section
- [ ] When the linked trip goes active, booking moves to Active section in My Trips
- [ ] Tapping active booking in My Trips re-enters the monitoring flow
- [ ] Driver sees booking card with blue style and pickup window
- [ ] At `alert_level = near` booking card expands with countdown and confirm/no-show buttons
- [ ] Confirming boarding decrements seats, card clears after 3 seconds
- [ ] No-show sets status correctly — seat not decremented (was never held)
- [ ] Window expiry correctly triggers no-show on next poll cycle
- [ ] Rider notified via Poll 2 when no-show occurs
- [ ] No console errors

---

## Phase 9 — Polish & Edge Cases

**What the LLM builds:**
Error states, edge cases, and the remaining UI details that were deferred.

**Spec documents to give the LLM:**
- Supporting Reference Spec v1.0 → Part 2 (all edge cases not yet covered), Part 4 Notification & Banner Logic (complete)
- Polling Contract Spec v1.0 → Error Banner Behaviour
- Frontend Behaviour Spec v1.0 → all onExit handlers, error boundary behaviours
- Activity Diagram v2.0 → §7 Edge Cases and Terminal States

**What gets built:**
- All poll error banners (network error, 500, 401 redirect, 404 trip not found)
- Driver: "already has active trip" guard and redirect
- Seat full auto-pause flow
- Simulator thread crash recovery (try/except → controlled end)
- Boarding window expired flow (3-minute timer cancels pickup)
- Page load restoration for all active states (not just auth)
- Profile screens (rider and driver) — sign out functional
- Driver trip history screen polished
- Driver home screen: today's bookings section, active trip banner

**Sign-off checklist:**
- [ ] Killing network mid-poll shows "Connection issue — retrying" banner, clears on reconnect
- [ ] 401 mid-poll redirects to login silently
- [ ] Driver starting second trip redirected to active trip with toast
- [ ] Matatu full → auto-paused → driver sees warning banner
- [ ] Boarding timer expiry cancels pickup and returns rider to waiting screen
- [ ] Profile sign out works for both roles
- [ ] Dev reset stops all threads, clears all data, works from any screen state
- [ ] Refreshing from every major screen restores correct state
- [ ] No console errors in any flow

---

## Phase 10 — Local QA & Deployment Prep

**What the LLM builds:**
Tests, environment hardening, and deployment configuration.

**Spec documents to give the LLM:**
- Project Structure Spec v1.0 → tests/ section (all four test files)
- Supporting Reference Spec v1.0 → Part 3 Seed Data §3.5 Dev Reset Behaviour

**What gets built:**
- All pytest tests as defined in the Project Structure Spec
- `POST /api/dev/reset` protected (disabled or guarded in non-development environments)
- `requirements.txt` with pinned versions
- Production `config.py` settings (DEBUG=False, secure SECRET_KEY)
- Deployment instructions for the chosen host (Railway, Render, or similar — to be decided at deploy time)
- `Procfile` or equivalent if needed

**Sign-off checklist:**
- [ ] `pytest` passes all tests with zero failures
- [ ] `POST /api/dev/reset` returns 404 when `FLASK_ENV != development`
- [ ] App runs correctly with `FLASK_DEBUG=0`
- [ ] No secrets in source code or version control
- [ ] App deploys and runs correctly on the chosen host
- [ ] All three routes work on deployed version
- [ ] Rider and driver login both work on deployed version

---

## Phase Reference Table

| Phase | Feature | Screens built | Endpoints built |
|---|---|---|---|
| 0 | Project skeleton | None | None (stubs only) |
| 1 | Auth & login | Login (both) | /api/auth/* |
| 2 | Route config & maps | Search map, Start trip selector | /api/config/routes |
| 3 | Driver trip & simulator | Start trip, Active trip, Paused, End summary, History | /api/trips (full) |
| 4 | Rider search & discovery | Home, Search, Matatu detail | /api/trips (GET only) |
| 5 | GeoJSON routes | — (content only) | — |
| 6 | Flagging journey | Flagging waiting, Boarding confirm, Live trip, Trip ended, Driver feed | /api/pickups (flagging) + /spot |
| 7 | Pickup journey | Pickup waiting | (reuses Phase 6 endpoints) |
| 8 | Booking journey | Booking flow (6 screens), My trips, Driver booking card | /api/pickups (reservation) + history |
| 9 | Polish & edge cases | Profile, Driver home (full) | — |
| 10 | QA & deployment | — | — |

---

## How to Hand a Phase to the LLM

Each phase prompt should follow this structure:

```
You are building the Sema matatu hailing app. 

This is Phase {N} — {Phase name}.

Your task: {one sentence description of what to build}

Spec documents to use (attached or pasted below):
- {list exactly the documents specified for this phase}

Rules:
- Only build what is listed above. Do not add features not in the specs.
- Do not modify files outside the scope of this phase.
- Do not change the database schema unless this phase explicitly requires it.
- Ask before making any decision not covered by the specs.
- After completing each file, confirm what was built before moving to the next file.

Start with: {the first file to build, e.g. "app/auth/routes.py"}
```

---

## Iteration Rules (Frontend Amendments)

When you want to change something on the frontend between phases:

- **Visual changes** (colours, spacing, font sizes, card layout): hand directly to the LLM with the specific file and element. No spec update needed.
- **Copy changes** (button labels, toast text, banner text): hand directly to the LLM. Update the Supporting Reference Spec if the change affects a banner or toast definition.
- **Flow changes** (adding a step, changing a navigation path, renaming a journey): update the relevant UI Spec section first, then hand to the LLM with the updated section attached.
- **Structural changes** (new screen, new pickup type, new API field): update the Schema, API Contract, and UI Spec before coding. Treat as a mini-phase.

*End of Sema Development Guide v1.0*
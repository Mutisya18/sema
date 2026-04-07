# Sema — Supporting Reference Specification

**Version:** 1.0
**Scope:** Covers session and state management, error and edge case handling, seed data, and notification/banner logic. All in one document for agent reference.

---

## Part 1 — Session & State

---

### 1.1 Flask Session

The Flask session is a signed cookie stored in the browser. It is created on login and destroyed on logout or browser close.

**What is written to the session on login:**

| Key | Type | Value |
|---|---|---|
| `user_id` | integer | The authenticated user's database id |
| `role` | string | `rider` or `driver` |
| `user_name` | string | The user's full name |
| `user_phone` | string | The user's phone number |
| `plate` | string | Driver's plate number — driver only, omitted for riders |
| `sacco` | string | Driver's sacco — driver only, omitted for riders |

**Session rules:**
- Session expires on browser close — Flask default, no `PERMANENT_SESSION_LIFETIME` set
- Every API endpoint except `POST /api/auth/login` and `GET /api/auth/session` checks for `user_id` in the session
- If `user_id` is absent, the endpoint returns `401 {error: 'unauthorized'}`
- Role-specific endpoints additionally check that `session.role` matches the expected role. A rider calling a driver endpoint receives `403 {error: 'forbidden'}`
- The session is never modified after login except on logout — it is read-only during the session lifetime

**What is cleared on logout:**
- The entire Flask session is cleared with `session.clear()`

---

### 1.2 Frontend State — Rider

The full `RiderState` object and its rules are defined in the Frontend Behaviour Spec. This section defines what persists, what is cleared, and when.

**State lifecycle:**

| State field | Set when | Cleared when |
|---|---|---|
| `user` | Login succeeds | Logout |
| `selectedRouteId` | Rider selects a route | Logout |
| `selectedTripId` | Rider selects a matatu | Logout or trip ends |
| `selectedTrip` | Rider selects a matatu | Logout or trip ends |
| `activePickup` | POST /api/pickups succeeds | Pickup reaches terminal status or logout |
| `lastAlertLevel` | First proximity alert received | New pickup created |
| `map` | Map initialised on a screen | Page reload only |
| `matututMarker` | Matatu dot placed on map | Page reload only |
| `pickupMarker` | Rider stop selected | New stop selected or logout |
| `gpsPollInterval` | Poll 1 started | Poll 1 stopped |
| `pickupPollInterval` | Poll 2 started | Poll 2 stopped |
| `errorBannerActive` | Error banner shown | Successful response received |

**Rules:**
- No state is written to `localStorage` or `sessionStorage` — everything lives in memory
- If the rider reloads the page, all in-memory state is lost. The session cookie persists so the rider is still logged in, but `RiderState` is reinitialised from scratch. The page load sequence re-fetches the active pickup via `GET /api/pickups/active` and restores state from the response.
- `activePickup` is the single most important field — it drives which screen is shown on page load if the rider has an active pickup in progress

**Page load state restoration — rider:**
1. Page loads — `RiderState` is empty
2. Call `GET /api/auth/session` — if 401, navigate to login and stop
3. Populate `RiderState.user` from session response
4. Fetch routes from `GET /api/config/routes` — store in memory
5. Call `GET /api/pickups/active`
   - If response contains an active pickup with status `pending` or `accepted`: populate `RiderState.activePickup`, restore `selectedTripId`, start Poll 1 and Poll 2, navigate to waiting screen
   - If response is null: navigate to home screen

---

### 1.3 Frontend State — Driver

**State lifecycle:**

| State field | Set when | Cleared when |
|---|---|---|
| `user` | Login succeeds | Logout |
| `activeTrip` | POST /api/trips succeeds | Trip ends or logout |
| `riders` | First Poll 3 response | Trip ends or logout |
| `lastRidersSnapshot` | Poll 3 diff runs | Trip ends or logout |
| `map` | Map initialised | Page reload only |
| `matututMarker` | Driver dot placed on map | Page reload only |
| `riderMarkers` | Rider dot added to map | Dot removed or page reload |
| `gpsPollInterval` | Poll 1 started | Poll 1 stopped |
| `ridersPollInterval` | Poll 3 started | Poll 3 stopped |
| `errorBannerActive` | Error banner shown | Successful response received |

**Page load state restoration — driver:**
1. Page loads — `DriverState` is empty
2. Call `GET /api/auth/session` — if 401, navigate to login and stop
3. Populate `DriverState.user` from session response
4. Fetch routes from `GET /api/config/routes` — store in memory
5. Call `GET /api/trips` filtered to `driver_id = session.user_id` and `status = active or paused`
   - If an active or paused trip exists: populate `DriverState.activeTrip`, start Poll 1 and Poll 3, navigate to active trip screen
   - If no active trip: navigate to home screen

---

### 1.4 Server-Side Auth Checks

Every protected endpoint performs these checks in order before any other logic:

1. Check `session.user_id` exists — if not, return `401`
2. Check the endpoint's required role matches `session.role` — if not, return `403`
3. For endpoints that operate on a specific resource (e.g. PATCH /api/trips/:trip_id/pause): check that the resource belongs to the session user — if not, return `403 {error: 'not your trip'}` or `403 {error: 'not your pickup'}`

---

## Part 2 — Error & Edge Cases

---

### 2.1 Seat Race Condition

**Scenario:** Two riders attempt to book the last seat on a trip at the same time.

**Server behaviour:**
- `POST /api/pickups` does not decrement seats — seats are held only on boarding
- `PATCH /api/pickups/:id/board` decrements seats atomically
- Before decrementing, the server re-checks `TRIP.seats_available >= pickup.seats_requested`
- If the check fails: return `409 {error: 'not enough seats available'}`
- The second rider to board receives the 409

**Frontend behaviour — rider:**
- Show toast "No seats available — another rider just boarded"
- Navigate to search screen

**Frontend behaviour — driver:**
- The accept action does not decrement seats, so no race condition exists at the accept step
- Race condition only occurs at boarding

---

### 2.2 Driver Ends Trip With Pending Riders

**Scenario:** Driver taps "End trip" while one or more pickups are still in `pending` or `accepted` status.

**Frontend behaviour — driver:**
- Before calling `PATCH /api/trips/:id/end`, check `DriverState.riders` for any pickup with status `pending` or `accepted`
- If any exist: show dialog "You have {n} riders who haven't boarded. End anyway?"
- If driver confirms: proceed with end trip call
- If driver cancels: dismiss dialog, stay on active trip screen

**Server behaviour:**
- `PATCH /api/trips/:id/end` sets all `pending` and `accepted` pickups on this trip to `cancelled`
- Sets `TRIP.status = ended` and `ended_at = now`
- Stops the simulator thread

**Frontend behaviour — rider (whose pickup was cancelled):**
- Poll 2 next cycle receives `trip_status = ended`
- Stop Poll 2
- Show toast "This trip has ended"
- Navigate to home screen

---

### 2.3 Trip Ends While Rider Is On Board

**Scenario:** Rider has status `completed` (on board, live trip screen active) and the driver ends the trip.

**Frontend behaviour — rider:**
- Poll 1 next cycle receives `status = ended`
- Stop Poll 1
- Navigate to trip ended screen
- This is the normal happy path — no error state

---

### 2.4 Rider's Pickup Window Expires (No-Show)

**Scenario:** A reservation pickup's `pickup_window_end` has passed and the rider has not boarded.

**Server behaviour:**
- No-show check runs on every `GET /api/trips/:id/riders` (Poll 3) and `GET /api/pickups/active` (Poll 2) response
- Server checks all `pending` and `accepted` reservation pickups on the trip
- Any pickup where `pickup_window_end < now`: set status to `no_show`
- The updated status is included in the response

**Frontend behaviour — rider:**
- Poll 2 receives `status = no_show`
- Stop Poll 2
- Show toast "You missed your pickup window"
- Navigate to search screen

**Frontend behaviour — driver:**
- Poll 3 receives the pickup with `status = no_show`
- Remove rider dot from map
- Update rider card to no-show state
- Remove card from feed after 3 seconds

---

### 2.5 Simulator Thread Reaches End of Route With Active Pickups

**Scenario:** The matatu reaches the final coordinate but one or more pickups are still `pending` or `accepted`.

**Server behaviour:**
- Simulator marks trip `ended`
- All `pending` and `accepted` pickups are set to `cancelled`
- Thread exits

**Frontend behaviour:** same as section 2.2 — riders receive `trip_status = ended` on next Poll 2 cycle.

---

### 2.6 Simulator Thread Crashes

**Scenario:** An unhandled exception occurs inside the simulator thread.

**Server behaviour:**
- The thread exits due to the exception
- The trip row remains in `active` status — it is not automatically ended
- The trip will appear active to riders but the matatu dot will stop moving

**Recovery:**
- On the next `GET /api/trips/:id/gps` poll, the server returns the last written position
- The frontend continues polling and showing the last known position
- The driver must manually end the trip via `PATCH /api/trips/:id/end`
- The dev reset endpoint can be used to clear all state

**Note:** The simulator thread must wrap its main loop in a try/except that catches all exceptions, logs the error, and cleanly ends the trip before exiting. This converts a crash into a controlled end.

---

### 2.7 Poll Returns 404 for a Trip

**Scenario:** A rider or driver is polling for a trip that no longer exists in the database (e.g. after a dev reset).

**Frontend behaviour:**
- Show inline error banner "This trip no longer exists"
- Stop the GPS poll
- Stop the riders poll (driver) or pickup poll (rider)
- Navigate to home screen after 2 seconds

---

### 2.8 Poll Returns 401

**Scenario:** Session has expired or was cleared (e.g. browser cookie deleted manually).

**Frontend behaviour:**
- Stop all active polls immediately
- Clear all state
- Redirect to login screen silently — no toast or banner

---

### 2.9 Driver Pauses Trip — Rider Perspective

**Scenario:** Driver pauses the trip while a rider is on the waiting screen.

**Server behaviour:**
- `TRIP.status = paused`
- Simulator thread skips position advancement
- GPS poll responses return `status = paused`

**Frontend behaviour — rider:**
- Poll 1 returns `status = paused`
- Stop animating the matatu dot
- Show banner "Matatu is temporarily unavailable — the driver may resume shortly"
- Keep polling — the driver may resume
- Poll 2 continues — pickup status is unaffected by pause

**Frontend behaviour — when driver resumes:**
- Poll 1 returns `status = active`
- Clear the paused banner
- Resume matatu dot animation

---

### 2.10 Rider Creates Pickup on a Full Trip

**Scenario:** Rider attempts to flag or reserve on a trip where `seats_available_at_stop = 0`.

**Server behaviour:**
- `POST /api/pickups` checks `seats_available_at_stop` before inserting
- Returns `409 {error: 'not enough seats available'}`

**Frontend behaviour:**
- Show toast "No seats available at this stop"
- Stay on current screen — rider can select a different stop or a different trip

---

### 2.11 Network Failure During a User Action

**Scenario:** Rider taps "Flag me now" or driver taps "Accept" and the request fails due to network error.

**Frontend behaviour:**
- Show inline error banner "Connection issue — please try again"
- Re-enable the tapped button
- Do not change any state
- Do not navigate away from the current screen
- The user retries manually

---

### 2.12 Driver Tries to Start a Second Trip

**Scenario:** Driver already has an active or paused trip and attempts to start another.

**Server behaviour:**
- `POST /api/trips` checks for existing active or paused trip for this driver
- Returns `409 {error: 'driver already has an active trip'}`

**Frontend behaviour:**
- Show toast "You already have an active trip"
- Navigate to active trip screen

---

## Part 3 — Seed Data

---

### 3.1 Riders

| id | name | phone | email |
|---|---|---|---|
| 1 | Amina Wanjiru | +254712345001 | amina@sema.test |
| 2 | Brian Otieno | +254712345002 | brian@sema.test |
| 3 | Peter Kamau | +254712345003 | peter@sema.test |

---

### 3.2 Drivers

| id | name | phone | plate | sacco |
|---|---|---|---|---|
| 1 | James Mwangi | +254722100001 | KJA 001A | Super Metro |
| 2 | Susan Njoki | +254722100002 | KBZ 445K | OMA Sacco |
| 3 | Kevin Ochieng | +254722100003 | KDA 223B | City Shuttle |

---

### 3.3 Routes

Routes are defined in `gps.py` — not in the database. The seed script does not insert routes. The following three routes must exist in `gps.py` at MVP. Coordinate arrays are populated when the developer draws the routes in geojson.io and pastes the results into `gps.py`.

**Route 1: CBD → Thika Town**
- `route_id`: `cbd_thika`
- `name`: CBD → Thika Town
- Stops in order:

| stop_id | name | notes |
|---|---|---|
| `cbd` | CBD | Origin — index 0 |
| `muthaiga` | Muthaiga Stage | Mid-route |
| `githurai` | Githurai Stage | Mid-route |
| `ruiru` | Ruiru Stage | Mid-route |
| `thika` | Thika Town | Destination — final index |

**Route 2: CBD → Westlands**
- `route_id`: `cbd_westlands`
- `name`: CBD → Westlands
- Stops in order:

| stop_id | name | notes |
|---|---|---|
| `cbd` | CBD | Origin — index 0 |
| `university_way` | University Way | Mid-route |
| `museum_hill` | Museum Hill | Mid-route |
| `westlands` | Westlands | Destination — final index |

**Route 3: CBD → Ngong**
- `route_id`: `cbd_ngong`
- `name`: CBD → Ngong
- Stops in order:

| stop_id | name | notes |
|---|---|---|
| `cbd` | CBD | Origin — index 0 |
| `community` | Community | Mid-route |
| `dagoretti` | Dagoretti Corner | Mid-route |
| `ngong` | Ngong Town | Destination — final index |

---

### 3.4 Runtime Data at Startup

No trips, pickups, or reservations exist at startup. The app starts in a clean state. All runtime data is created by users interacting with the app.

---

### 3.5 Dev Reset Behaviour

`POST /api/dev/reset` restores the database to this exact seed state:

1. Stop all active simulator threads
2. Delete all rows from `PICKUP`
3. Delete all rows from `TRIP_STOPS`
4. Delete all rows from `TRIP`
5. Delete all rows from `DRIVER`
6. Delete all rows from `RIDER`
7. Re-insert seed riders and drivers as defined above
8. Return `{message: 'database reset and reseeded'}`

Routes are not affected — they live in `gps.py` and are never in the database.

---

## Part 4 — Notification & Banner Logic

---

### 4.1 Definitions

**Toast** — A floating message that appears for 2.5 seconds then disappears automatically. Used for one-off events. Cannot be dismissed manually. Appears at the bottom of the screen above the nav bar.

**Banner** — A persistent coloured block that stays visible until the condition that triggered it is resolved. Used for ongoing states. Appears inline within the screen content. Dismissed by the system when the state changes — never by the user tapping it.

**Inline error** — A small error message that appears directly below a form field or button. Used for validation and action failures. Cleared when the user retries or navigates away.

---

### 4.2 Banner Types

| Type | Colour | Used for |
|---|---|---|
| `info` | Blue | Neutral status — monitoring, waiting |
| `warning` | Orange | Action required or something changed |
| `success` | Green | Positive confirmation |
| `error` | Red | Something went wrong |

---

### 4.3 All Toasts — Rider

| Trigger | Text | Type |
|---|---|---|
| Pickup rejected by driver | "Driver could not pick you up" | warning |
| Pickup cancelled by rider | Silent — no toast | — |
| No seats at stop | "No seats available at this stop" | warning |
| No seats on boarding (race condition) | "No seats available — another rider just boarded" | warning |
| Pickup window expired | "You missed your pickup window" | warning |
| Trip ended while rider waiting | "This trip has ended" | warning |
| Boarding window expired (3 min) | "Boarding window expired" | warning |
| Network error on action | "Connection issue — please try again" | error |
| Cancel failed | "Could not cancel — try again" | error |

---

### 4.4 All Toasts — Driver

| Trigger | Text | Type |
|---|---|---|
| Rider cancels pickup | "{rider_name} cancelled" | info |
| Rider accepted successfully | Silent — card updates | — |
| Rider rejected successfully | "{rider_name} rejected" | info |
| Accept failed — not enough seats | "Not enough seats for this rider" | warning |
| Accept failed — race condition 409 | "Seat already taken by another rider" | warning |
| Boarding confirmed | Silent — card updates | — |
| No-show recorded | "Seat freed" | info |
| Trip already active on start attempt | "You already have an active trip" | warning |
| Network error on action | "Connection issue — please try again" | error |
| Seats reach zero | "Matatu is full — trip paused automatically" | warning |

---

### 4.5 All Banners — Rider

| Screen | Trigger | Text | Type | Dismissed when |
|---|---|---|---|---|
| Waiting | Default state | "You are visible to drivers — waiting for a matatu" | info | Pickup accepted or cancelled |
| Waiting | `alert_level = approaching` | "Matatu is 1.5 km away — head to your stop now" | warning | Alert level changes |
| Waiting | `alert_level = near` | "Matatu is 500m away — be at your stop now" | warning | Pickup accepted or cancelled |
| Waiting | `trip_status = paused` | "Matatu is temporarily unavailable — the driver may resume shortly" | warning | Trip resumes or ends |
| Any screen with poll | Network error on poll | "Connection issue — retrying" | error | Next successful poll response |
| Any screen with poll | 500 on poll | "Something went wrong — retrying" | error | Next successful poll response |
| Any screen with poll | 404 on GPS poll | "This trip no longer exists" | error | Auto-dismissed after 2s, navigate home |
| Boarding confirm | Default state | "Driver accepted — board the matatu and confirm" | success | Rider boards or cancels |

---

### 4.6 All Banners — Driver

| Screen | Trigger | Text | Type | Dismissed when |
|---|---|---|---|---|
| Active trip | Default state | No banner — normal operating state | — | — |
| Active trip | Reserved stop approaching (≤ 2km) | "Reserved pickup in {n} km — {rider_name} at {stop_name}" | info | Stop passed or pickup resolved |
| Active trip | Reserved stop arriving (≤ 200m) | "Arriving at {stop_name} — confirm pickups" | success | Auto-dismissed after 3s |
| Active trip | Seats reach zero | "Matatu is full — you have been paused" | warning | Driver manually resumes |
| Paused trip | Always shown | "You are paused — riders cannot see your matatu" | warning | Driver resumes |
| Pickup confirm | Within pickup window | "You have arrived at {stop_name} — confirm each rider" | success | All riders confirmed or window expires |
| Pickup confirm | Window expired | "Pickup window has expired" | error | Driver navigates away |
| Any screen with poll | Network error on poll | "Connection issue — retrying" | error | Next successful poll response |
| Any screen with poll | 500 on poll | "Something went wrong — retrying" | error | Next successful poll response |

---

### 4.7 Inline Errors

| Screen | Trigger | Text |
|---|---|---|
| Login | Phone not found (404) | "Phone number not found" |
| Login | Server error | "Something went wrong — try again" |
| Start trip form | No route selected | "Please select a route" |
| Start trip form | No stops selected | "Please select at least one stop" |
| Start trip form | Invalid seats | "Seats must be between 1 and 30" |
| Start trip form | Invalid fare | "Fare must be a positive number" |
| Reservation screen | No stop selected | "Please select a pickup stop" |
| Reservation screen | No time slot selected | "Please select a departure time" |
| Reservation screen | Seats out of range | "You can request between 1 and 3 seats" |
| Reservation screen | Not enough seats (409) | "Not enough seats available at this stop" |
| Any action button | Network failure | "Connection issue — please try again" |

---

### 4.8 Silent State Changes

These events update the UI without any toast or banner. The agent must not add toasts to these.

| Event | UI change |
|---|---|
| Rider pickup created | Rider dot appears on driver map |
| Driver accepts pickup | Rider card updates to accepted state |
| Rider boards | Rider card updates to boarded state, dot removed after 3s |
| Trip paused | Matatu dot stops moving on rider map |
| Trip resumed | Matatu dot resumes moving on rider map |
| Seat count decrements | Seat counter updates on driver screen |
| No-show auto-set | Rider card updates to no-show state on driver screen |

---

*End of Sema Supporting Reference Specification v1.0*
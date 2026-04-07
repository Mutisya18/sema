# Sema — Activity & Event Diagram
Version: 2.0
Scope: Full system flow covering both roles, all three rider journeys, the simulator lifecycle, poll lifecycle, and all terminal states. Treated as current scope — no phase distinctions.

---

## 1. System State at Startup

```
Server starts
  └─► init_db() — create tables if not exist
  └─► seed.py — insert 3 riders, 3 drivers if not present
  └─► ROUTES loaded from gps.py into memory
  └─► No active trips, no active pickups
  └─► Simulator thread registry is empty
  └─► Flask session store is empty

Frontend loads (rider or driver)
  └─► MAPBOX_TOKEN injected into HTML at render time
  └─► GET /api/auth/session
        ├─► 200: populate state, fetch routes, restore active state (see §2, §3)
        └─► 401: navigate to Login
  └─► GET /api/config/routes — store all routes + stops in memory
```

---

## 2. Driver Flow

### 2.1 Login
```
Driver opens /driver
  └─► GET /api/auth/session
        ├─► 200 + active trip exists → restore DriverState, start Poll 1 + Poll 3, navigate to D-04
        ├─► 200 + no active trip → navigate to D-01 (Home)
        └─► 401 → navigate to D-00 (Login)

Driver enters phone → POST /api/auth/login {phone, role: 'driver'}
  ├─► 200 → populate DriverState.user, navigate to D-01
  └─► 404 → inline error "Phone number not found"
```

### 2.2 Start Trip
```
Driver taps "Start a trip" → navigate to D-02 (Start Trip Form)

Driver builds route:
  └─► Selects Start (Terminus A) — constrained to route stops
  └─► Adds stages via "+ Add Stage" — constrained to route stops
  └─► Selects Destination (Terminus B) — constrained to route stops
  └─► Sets fare and seat count (1–30)
  └─► Optionally saves trip configuration for reuse

Driver taps "Begin trip"
  └─► POST /api/trips {route_id, active_stop_ids, seats_total, fare}
        ├─► 201:
        │     └─► Set DriverState.activeTrip
        │     └─► Server inserts TRIP row, inserts TRIP_STOPS rows
        │     └─► Server spawns simulator thread for trip_id
        │     └─► Trip starts at coordinate index 0 (route origin)
        │     └─► Navigate to D-04 (Active Trip)
        │     └─► Start Poll 1 (GPS) + Poll 3 (riders)
        ├─► 409 "driver already has active trip" → toast, navigate to D-04
        └─► 400 validation errors → inline errors on form
```

### 2.3 Active Trip
```
D-04 loads
  └─► Map initialised, route line drawn, driver dot placed at current_lat/lng
  └─► Poll 1 starts → driver dot moves every 5s via interpolation
  └─► Poll 3 starts → rider feed populated, diff applied every 5s

Poll 1 cycle (every 5s):
  └─► GET /api/trips/:trip_id/gps
        ├─► status = active → interpolate driver dot to new position
        ├─► status = paused → stop dot animation, show paused banner
        └─► status = ended → stop Poll 1, navigate to D-07

Poll 3 cycle (every 5s):
  └─► GET /api/trips/:trip_id/riders
        └─► Server runs no-show check before responding
        └─► Diff against DriverState.lastRidersSnapshot:
              ├─► New pickup → add dot to map, add card to feed
              ├─► status = accepted → update card badge, no dot change
              ├─► status = completed → remove dot, card → completed style → remove after 3s
              ├─► status = rejected → remove dot, remove card immediately
              ├─► status = cancelled → remove dot, remove card, toast "{name} cancelled"
              ├─► status = no_show → remove dot, card → no-show style → remove after 3s
              ├─► pickup_type = flagging, spotted = false → orange dot, flagging card
              ├─► pickup_type = flagging, spotted = true → white dot (orange ring), card moves to top
              ├─► pickup_type = reservation, spotted = false → blue dot, booking card
              └─► pickup_type = reservation, spotted = true → white dot (blue ring), card moves to top

Driver accepts a rider:
  └─► PATCH /api/pickups/:id/accept
        ├─► 200 → card updates to accepted state
        └─► 409 "not enough seats" → toast "Not enough seats for this rider"

Driver rejects a rider:
  └─► Navigate to D-03 (Reject Rider)
  └─► PATCH /api/pickups/:id/reject
        ├─► 200 → navigate to D-04, toast "{name} rejected"
        └─► Error → inline error, stay on D-03

Booking card at alert_level = near:
  └─► Card expands to show countdown (2:00), Confirm boarding, No-show buttons
  └─► Countdown runs per second via setInterval (separate from poll)
  └─► On "Confirm boarding" → PATCH /api/pickups/:id/board
        ├─► 200 → card completed style, removed after 3s, seat counter decrements
        └─► 409 → toast "Seat already taken"
  └─► On "No-show" → PATCH /api/pickups/:id/reject
        └─► 200 → card no-show style, removed after 3s, toast "Seat freed"
  └─► Countdown expires → "Pickup window expired" shown on card, buttons remain active
```

### 2.4 Pause and Resume
```
Driver taps "Pause trip"
  └─► PATCH /api/trips/:id/pause
        └─► 200 → DriverState.activeTrip.status = paused, navigate to D-05
        └─► Server sets TRIP.status = paused
        └─► Simulator thread continues running but skips position advancement
        └─► Poll 1 + Poll 3 continue on D-05
        └─► Matatu dot stops animating
        └─► Matatu hidden from rider search results

Driver taps "Resume trip"
  └─► PATCH /api/trips/:id/resume
        └─► 200 → DriverState.activeTrip.status = active, navigate to D-04
        └─► Simulator thread resumes position advancement on next cycle
        └─► Matatu dot resumes interpolation
        └─► Matatu visible in rider search results again
```

### 2.5 End Trip
```
Driver taps "End trip"
  └─► If pending or accepted pickups exist:
  │     └─► Dialog "You have {n} riders who haven't boarded. End trip anyway?"
  │           ├─► Cancel → dismiss dialog, stay on screen
  │           └─► Confirm → proceed
  └─► PATCH /api/trips/:id/end
        └─► 200:
              └─► Server sets TRIP.status = ended, writes ended_at
              └─► Server sets all pending + accepted pickups to cancelled
              └─► Simulator thread exits on next cycle
              └─► Stop Poll 1 + Poll 3 immediately
              └─► Clear DriverState.activeTrip, riders, markers
              └─► Navigate to D-07 (End Trip Summary)

Simulator reaches final coordinate (auto-end):
  └─► Thread sets TRIP.status = ended
  └─► Thread cancels all pending + accepted pickups
  └─► Thread exits
  └─► Poll 1 next cycle receives status = ended
        └─► Stop Poll 1 + Poll 3
        └─► Navigate to D-07
```

---

## 3. Rider Flow

### 3.1 Login and State Restoration
```
Rider opens /rider
  └─► GET /api/auth/session
        ├─► 401 → navigate to S-00 (Login)
        └─► 200:
              └─► populate RiderState.user
              └─► GET /api/pickups/active
                    ├─► active pickup (pending or accepted):
                    │     └─► populate RiderState.activePickup
                    │     └─► restore selectedTripId
                    │     └─► start Poll 1 + Poll 2
                    │     └─► navigate to waiting screen for active journey
                    └─► null → navigate to S-01 (Home)

Rider enters phone → POST /api/auth/login {phone, role: 'rider'}
  ├─► 200 → populate RiderState.user, navigate to S-01
  └─► 404 → inline error "Phone number not found"
```

### 3.2 Journey A — Flagging
```
Rider taps "Quick Trip" on Home
  └─► Navigate to S-02 (Search)
        └─► From input: pre-filled with route origin stop, locked (not editable)
        └─► Rider types destination → filters to defined stops
        └─► Both inputs filled → GET /api/trips?route_id=...
              └─► Matatu list: active trips where current_step < rider's from stop index
              └─► Matatus past rider's stop excluded silently

Rider taps a matatu card → navigate to S-04 (Matatu Detail)
  └─► Poll 1 starts

Rider taps "Flag Matatu"
  └─► POST /api/pickups {trip_id, pickup_type: 'flagging', stop_id, seats_requested}
        ├─► 201:
        │     └─► Set RiderState.activePickup
        │     └─► Server inserts PICKUP row with pickup_lat/lng from stop config
        │     └─► Start Poll 2
        │     └─► Navigate to S-06 (Flagging Waiting)
        ├─► 409 "not enough seats" → toast "No seats available at this stop"
        └─► 409 "trip is not active" → toast "This matatu is no longer available", navigate to S-02

On S-06 (Flagging Waiting):
  └─► Poll 1 running — matatu dot moves
  └─► Poll 2 running — proximity banner updates, status monitored
  └─► "Pick Me Up" button visible immediately
  └─► Rider taps "Pick Me Up" (optional — priority signal only)
        └─► PATCH /api/pickups/:id/spot
        └─► Button changes to "Signalled ✓", disabled
        └─► On driver's next Poll 3: card moves to top of feed, dot turns white

  └─► alert_level = approaching → orange banner "Matatu 1.5 km away"
  └─► alert_level = near → red banner "Matatu 500m away", countdown starts (2:00)
  └─► Countdown expires → driver at liberty to leave, rider remains on screen

Poll 2 status transitions on S-06:
  ├─► pending → no change
  ├─► accepted → update status line to "Driver accepted — matatu is on its way"
  │             reveal "I'm On Board ✓" button — do NOT navigate away
  ├─► rejected → stop Poll 2, toast "Driver could not pick you up", navigate to S-02
  ├─► cancelled → stop Poll 2, navigate to S-02 silently
  ├─► no_show → stop Poll 2, toast "You missed your pickup window", navigate to S-02
  └─► trip_status = ended → stop Poll 2, toast "This trip has ended", navigate to S-01

Rider taps "I'm On Board ✓" (after status = accepted):
  └─► PATCH /api/pickups/:id/board → navigate to S-10 (Live Trip)
```

### 3.3 Journey B — Pickup
```
Rider taps search bar on Home
  └─► Navigate to S-02 (Search)
        └─► From input: editable, filters to defined stops on keystroke
        └─► To input: editable, filters to defined stops on keystroke
        └─► Both filled → GET /api/trips?route_id=...
              └─► Same filter as flagging: active trips, current_step < rider's from stop index

Rider taps a matatu card → navigate to S-04 (Matatu Detail)
  └─► Poll 1 starts

Rider taps "Set as Pickup Matatu"
  └─► POST /api/pickups {trip_id, pickup_type: 'flagging', stop_id, seats_requested}
        └─► Same API call as flagging — distinction is UI only
        └─► On 201: navigate to S-07 (Pickup Waiting)

On S-07 (Pickup Waiting):
  └─► Poll 1 running — matatu dot moves
  └─► Poll 2 running — proximity banner updates
  └─► "Pick Me Up" button NOT shown until alert_level = near
  └─► alert_level = none → blue info banner "Waiting at {stop name}"
  └─► alert_level = approaching → orange banner "Matatu 1.5 km away"
  └─► alert_level = near:
        └─► Red banner "Matatu 500m away — be at your stop now"
        └─► Countdown starts (2:00)
        └─► "Pick Me Up" button appears (required signal)
        └─► Rider taps "Pick Me Up" → same spotted flow as flagging

Poll 2 status transitions on S-07: identical to S-06
```

### 3.4 Journey C — Booking
```
Rider taps "Schedule Ride" on Home → navigate to S-03 (Booking: Destination)
  └─► Rider selects destination → navigate to S-05 (Booking: From)
  └─► Rider selects from stop → navigate to S-08 (Booking: Date & Time)
  └─► Rider selects date + time slot → GET /api/trips?route_id=... (future trips)
  └─► Rider selects matatu → navigate to S-12 (Booking: Seat Count)
  └─► Rider sets seat count (1–30) → navigate to S-13 (Booking: Confirm)
  └─► Rider taps "Confirm Booking"
        └─► POST /api/pickups {trip_id, pickup_type: 'reservation', stop_id,
                               seats_requested, pickup_window_start, pickup_window_end}
              ├─► 201:
              │     └─► Set RiderState.activePickup
              │     └─► Navigate to S-14 (Booking: Success)
              └─► 409 → inline error from response

No active trip yet at booking time:
  └─► No polls start
  └─► Rider navigates to S-15 (My Trips) to monitor

When trip goes active (rider returns via My Trips):
  └─► Rider taps active booking card → navigate to S-04 (Matatu Detail)
  └─► Poll 1 starts
  └─► Navigate to S-07 (Pickup Waiting) — booking follows pickup waiting flow
  └─► Poll 2 starts
  └─► alert_level = near → countdown, Pick Me Up button appears
  └─► Same Poll 2 status transitions as S-07
```

### 3.5 Boarding and Live Trip (all journeys)
<!-- EDIT v2.2: Boarding Confirm (S-09) is no longer triggered automatically by Poll 2 receiving accepted.
     Instead: accepted unlocks the "I'm On Board" button on the monitoring screen (S-06/S-07).
     Rider taps "I'm On Board" → navigates to S-09 → confirms boarding → S-10. -->
```
Poll 2 receives status = accepted
  └─► Update status line on monitoring screen (S-06/S-07): "Driver accepted — matatu is on its way"
  └─► Reveal "I'm On Board ✓" button on monitoring screen
  └─► Do NOT navigate away — rider stays on monitoring screen
  └─► Poll 1 continues
  └─► Poll 2 continues

Rider taps "I'm On Board ✓" (on monitoring screen, after status = accepted):
  └─► PATCH /api/pickups/:id/board → navigate to S-10 (Live Trip)
        ├─► 200:
        │     └─► Stop Poll 2
        │     └─► Server sets PICKUP.status = completed, writes boarded_at
        │     └─► Server decrements TRIP.seats_available by seats_requested
        │     └─► If seats_available reaches 0: server sets TRIP.status = paused
        │     └─► Navigate to S-10 (Live Trip)
        │     └─► Poll 1 continues
        └─► 409 → toast "Boarding could not be confirmed — try again"

Rider taps "Not my matatu"
  └─► PATCH /api/pickups/:id/cancel
        └─► 200 → stop Poll 2, navigate back to waiting screen

On S-10 (Live Trip):
  └─► Poll 1 continues — matatu dot moves, progress bar advances
  └─► Poll 1 receives status = ended → stop Poll 1, navigate to S-11 (Trip Ended)
  └─► Rider taps "End trip / I've arrived" → stop Poll 1, navigate to S-11

On S-11 (Trip Ended):
  └─► Clear RiderState.activePickup, selectedTrip
  └─► All polls stopped
```

---

## 4. Simulator Lifecycle

```
Trip created (POST /api/trips)
  └─► start_simulator(trip_id, route_id) called
  └─► Daemon thread spawned, registered in thread registry

Thread loop (every 5 seconds):
  └─► Check stop signal → if set, mark trip ended and exit
  └─► Read TRIP.status from database
        ├─► paused → skip advancement this cycle, wait 5s, repeat
        └─► ended → exit thread
  └─► Read current_step from TRIP row
  └─► Call get_next_position(route_id, current_step)
        └─► Returns {lat, lng, next_step, is_final}
  └─► Write new lat, lng, next_step to TRIP row
  └─► If is_final = true:
        └─► Set TRIP.status = ended, write ended_at
        └─► Set all pending + accepted PICKUP rows to cancelled
        └─► Exit thread
  └─► Run proximity check for all active pickups on this trip:
        └─► For each PICKUP where status = pending or accepted:
              └─► compute_distance(trip.lat, trip.lng, pickup.pickup_lat, pickup.pickup_lng)
              └─► compute_alert_level(distance_metres)
              └─► Write alert_level to PICKUP row
  └─► Wait 5 seconds
  └─► Repeat

Thread crash (unhandled exception):
  └─► try/except wraps entire loop
  └─► On exception: set TRIP.status = ended, cancel pending pickups, exit
  └─► Trip appears ended to all polling clients on next cycle

stop_simulator(trip_id):
  └─► Set stop signal for that thread
  └─► Thread exits on next cycle

stop_all_simulators():
  └─► Set stop signal for all registered threads
  └─► Called by POST /api/dev/reset
```

---

## 5. Poll Lifecycle

### Poll 1 — GPS Position
```
Starts:
  ├─► Rider: on S-04 (Matatu Detail) entry
  └─► Driver: on D-04 (Active Trip) entry, or restored on page load

Runs every 5s → GET /api/trips/:trip_id/gps

Response handling:
  ├─► status = active → interpolate dot to new position over 5s
  ├─► status = paused → stop dot animation, show paused banner, keep polling
  └─► status = ended → stop Poll 1, transition to ended state

Stops:
  ├─► status = ended received
  ├─► Rider navigates away from all map screens
  ├─► Driver manually ends trip (stop immediately, don't wait for next cycle)
  └─► 401 received → stop all polls, redirect to login

Error (network/5xx): show "Connection issue — retrying" banner, keep polling
404: show "This trip no longer exists" banner, stop Poll 1
```

### Poll 2 — Rider Pickup Status
```
Starts:
  └─► Immediately after POST /api/pickups returns 201

Runs every 5s → GET /api/pickups/active
  └─► Server runs no-show check before responding

Response handling:
  ├─► pending → no change
  ├─► accepted → navigate to S-09 (Boarding Confirm)
  ├─► completed → stop Poll 2, navigate to S-10
  ├─► rejected → stop Poll 2, toast, navigate to S-02
  ├─► cancelled → stop Poll 2, navigate to S-02 silently
  ├─► no_show → stop Poll 2, toast, navigate to S-02
  ├─► trip_status = ended → stop Poll 2, toast, navigate to S-01
  ├─► alert_level = none → clear proximity banner
  ├─► alert_level = approaching → show approaching banner
  └─► alert_level = near → show near banner, start countdown, show Pick Me Up (pickup journey only)

Stops:
  ├─► Any terminal status received
  ├─► Rider manually cancels pickup
  └─► 401 received
```

### Poll 3 — Driver Rider List
```
Starts:
  └─► On D-04 (Active Trip) entry, or restored on page load

Runs every 5s → GET /api/trips/:trip_id/riders
  └─► Server runs no-show check before responding
  └─► Diff applied against DriverState.lastRidersSnapshot
  └─► Only changed or new entries trigger re-render

Stops:
  ├─► Driver ends trip (stop immediately)
  └─► 401 received

Never stops due to empty riders array — driver map stays live for full trip duration
```

---

## 6. Intersection Points — Where Driver and Rider Flows Meet

```
Rider creates pickup (POST /api/pickups)
  └─► PICKUP row inserted with status = pending
  └─► Driver's next Poll 3 → new rider dot appears on map, card added to feed

Rider taps "Pick Me Up"
  └─► PATCH /api/pickups/:id/spot
        ├─► 200 → PICKUP.spotted = true, PICKUP.spotted_at = now
        │     └─► Rider: button → "Signalled ✓" disabled state
        │     └─► Driver's next Poll 3: spotted = true in rider object
        │           └─► Dot turns white with coloured ring
        │           └─► Card moves to top of feed, spotted style applied
        └─► 409 "already spotted" → silently ignore (idempotency)

Driver accepts pickup (PATCH /api/pickups/:id/accept)
  └─► PICKUP.status = accepted
  └─► Rider's next Poll 2 → status = accepted → navigate to Boarding Confirm

Driver rejects pickup (PATCH /api/pickups/:id/reject)
  └─► PICKUP.status = rejected
  └─► Rider's next Poll 2 → status = rejected → toast, navigate to Search
  └─► Driver's next Poll 3 → dot removed, card removed

Rider confirms boarding (PATCH /api/pickups/:id/board)
  └─► PICKUP.status = completed, boarded_at written
  └─► TRIP.seats_available decremented
  └─► If seats_available = 0 → TRIP.status = paused
  └─► Rider: navigate to Live Trip
  └─► Driver's next Poll 3 → dot removed, card → completed style → removed after 3s

Rider cancels pickup
  └─► PICKUP.status = cancelled
  └─► Driver's next Poll 3 → dot removed, card removed, toast "{name} cancelled"

No-show (server-side, triggered on poll):
  └─► Server sets PICKUP.status = no_show on any poll cycle where window expired
  └─► Rider's Poll 2 → toast "You missed your pickup window", navigate to Search
  └─► Driver's Poll 3 → dot removed, card → no-show style → removed after 3s

Driver ends trip mid-ride:
  └─► All pending + accepted pickups → cancelled
  └─► Affected riders' Poll 2 next cycle → trip_status = ended → toast, navigate to Home
```

---

## 7. Edge Cases and Terminal States

```
Seat race condition (two riders boarding simultaneously):
  └─► First PATCH /api/pickups/:id/board → 200, seats decremented
  └─► Second PATCH → 409 "not enough seats available"
  └─► Second rider sees toast "No seats available — another rider just boarded"
  └─► Second rider navigates to Search

Matatu full (seats_available reaches 0 on boarding):
  └─► Server sets TRIP.status = paused
  └─► Driver sees toast "Matatu is full — trip paused automatically"
  └─► Matatu hidden from rider searches
  └─► Driver can manually resume when space opens (no-show frees seat)

No-show frees seat:
  └─► seats_available does not change — seats were never decremented for a reserved pickup
  └─► No-show only updates PICKUP.status; seat count is unaffected

Driver starts second trip while one is active:
  └─► POST /api/trips → 409
  └─► Toast "You already have an active trip", navigate to D-04

Rider polls trip that no longer exists (after dev reset):
  └─► GET /api/trips/:id/gps → 404
  └─► Banner "This trip no longer exists", stop Poll 1, navigate to Home after 2s

Session expires mid-trip (401 on any poll):
  └─► Stop all polls immediately
  └─► Clear all state
  └─► Redirect to Login silently

Simulator thread crashes:
  └─► try/except catches exception
  └─► TRIP.status = ended, pending pickups cancelled
  └─► All polling clients receive ended on next cycle and transition accordingly

Driver pauses, rider is waiting:
  └─► Poll 1 returns status = paused
  └─► Rider sees "Matatu is temporarily unavailable" banner
  └─► Poll 1 continues — dot stops moving
  └─► Poll 2 continues — pickup status unaffected

Trip ends while rider is on board (live trip screen):
  └─► Poll 1 returns status = ended
  └─► Stop Poll 1
  └─► Navigate to Trip Ended screen
  └─► Normal happy path — no error state

Dev reset (POST /api/dev/reset):
  └─► stop_all_simulators() called
  └─► All TRIP, TRIP_STOPS, PICKUP rows deleted
  └─► RIDER, DRIVER rows deleted and reseeded
  └─► All active polls on connected clients will receive 404 on next cycle
  └─► Clients navigate to Home or Login accordingly
```

---

## 8. State Machine — TRIP

```
[created] → active
  ├─► active → paused       (driver pauses, or seats_available = 0)
  ├─► paused → active       (driver resumes)
  ├─► active → ended        (driver ends, or simulator reaches final coordinate)
  └─► paused → ended        (driver ends from paused state)
```

## 9. State Machine — PICKUP

```
[created] → pending
  ├─► pending → accepted    (driver accepts)
  ├─► pending → rejected    (driver rejects)
  ├─► pending → cancelled   (rider cancels, or trip ended, or driver ends trip)
  ├─► pending → no_show     (pickup window expired — server-side)
  ├─► accepted → completed  (rider boards)
  ├─► accepted → rejected   (driver rejects after accepting)
  ├─► accepted → cancelled  (rider cancels, or trip ended, or driver ends trip)
  └─► accepted → no_show    (pickup window expired — server-side)

Terminal states (no further transitions):
  completed | rejected | cancelled | no_show
```

---

*End of Sema Activity & Event Diagram v2.0*
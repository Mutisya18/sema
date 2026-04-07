# Sema — API Contract Specification

**Version:** 1.0
**Scope:** Logic and contract only. No code, no implementation detail.
**Base URL:** All endpoints are prefixed with `/api`
**Auth:** All endpoints except `/api/auth/login` and `/api/config` require an active session. Requests without a valid session return `401 {error: 'unauthorized'}`.
**Error shape:** `{error: 'description of what went wrong'}` with an appropriate HTTP status code.
**Token delivery:** Mapbox token is injected into every HTML page by Flask at render time as a global JavaScript variable. No endpoint needed.

---

## 1. Auth

---

### POST /api/auth/login

**Who calls it:** Rider or driver login screen
**Purpose:** Authenticate a seeded user by phone number and role. Creates a Flask session.

**Request body:**
```
{
  phone:  string,   // e.g. "+254712345001"
  role:   string    // "rider" or "driver"
}
```

**Success response — 200:**
```
{
  user: {
    id:     integer,
    name:   string,
    phone:  string,
    role:   string    // "rider" or "driver"

    // driver only:
    plate:  string,
    sacco:  string
  }
}
```

**Errors:**
- `404 {error: 'user not found'}` — phone does not match any seeded user with that role
- `400 {error: 'role must be rider or driver'}` — invalid role value

**Side effects:**
- Writes `user_id`, `role` to the Flask session

---

### POST /api/auth/logout

**Who calls it:** Rider or driver profile screen
**Purpose:** Destroy the current session.

**Request body:** none

**Success response — 200:**
```
{error: 'logged out'}
```

**Side effects:**
- Clears the Flask session entirely

---

## 2. Config

---

### GET /api/config/routes

**Who calls it:** Both frontends on page load
**Purpose:** Return all available routes and their stops so the frontend can populate route selectors and render stop markers on the map. Coordinates come from the `gps.py` config.

**Request params:** none

**Success response — 200:**
```
{
  routes: [
    {
      id:       string,   // e.g. "cbd_thika"
      name:     string,   // e.g. "CBD → Thika Town"
      stops: [
        {
          id:   string,   // e.g. "githurai"
          name: string,   // e.g. "Githurai Stage"
          lat:  float,
          lng:  float,
          step: integer   // index in coordinate array
        }
      ],
      coordinates: [      // full route coordinate array for map rendering
        [lng, lat],       // Mapbox format — longitude first
        ...
      ]
    }
  ]
}
```

**Errors:** none — this endpoint always succeeds if the server is running

---

## 3. Trips

---

### POST /api/trips

**Who calls it:** Driver — start trip form
**Purpose:** Create a new active trip. Spawn the simulator thread for this trip.

**Request body:**
```
{
  route_id:        string,    // must exist in gps.py config
  active_stop_ids: [string],  // subset of stop ids for this route
  seats_total:     integer,   // 1–30
  fare:            integer    // KSh, positive integer
}
```

**Success response — 201 — full trip object:**
```
{
  trip: {
    id:               integer,
    driver_id:        integer,
    route_id:         string,
    status:           string,   // "active"
    seats_total:      integer,
    seats_available:  integer,  // equals seats_total at creation
    fare:             integer,
    current_lat:      float,    // first coordinate of route
    current_lng:      float,
    current_step:     integer,  // 0
    active_stops: [
      {
        id:   string,
        name: string,
        lat:  float,
        lng:  float,
        step: integer
      }
    ],
    started_at:       datetime,
    ended_at:         null
  }
}
```

**Errors:**
- `400 {error: 'invalid route_id'}` — route not found in config
- `400 {error: 'no active stops selected'}` — active_stop_ids is empty
- `400 {error: 'seats_total must be between 1 and 30'}`
- `400 {error: 'fare must be a positive number'}`
- `409 {error: 'driver already has an active trip'}` — driver cannot run two trips simultaneously

**Side effects:**
- Inserts one row into TRIP
- Inserts one row into TRIP_STOPS per active stop
- Spawns simulator thread for this trip_id
- Sets `current_lat` and `current_lng` to the first coordinate of the route

---

### GET /api/trips

**Who calls it:** Rider — route discovery / search screen
**Purpose:** Return all active trips on a given route for a rider to browse.

**Request params:**
```
route_id:  string   // required
```

**Success response — 200:**
```
{
  trips: [
    {
      id:               integer,
      driver_id:        integer,
      driver_name:      string,
      plate:            string,
      sacco:            string,
      route_id:         string,
      route_name:       string,
      status:           string,   // "active" or "paused"
      seats_available:  integer,
      fare:             integer,
      current_lat:      float,
      current_lng:      float,
      active_stops: [
        {
          id:           string,
          name:         string,
          lat:          float,
          lng:          float,
          seats_available_at_stop: integer  // derived — see schema spec
        }
      ]
    }
  ]
}
```

**Errors:**
- `400 {error: 'route_id is required'}`
- `400 {error: 'invalid route_id'}`

**Notes:**
- Only returns trips with `status = active` or `status = paused` — ended trips are excluded
- `seats_available_at_stop` is computed per stop: `trip.seats_available` minus `seats_requested` of all `pending` and `accepted` pickups at that stop

---

### GET /api/trips/:trip_id

**Who calls it:** Rider — matatu detail screen
**Purpose:** Return full detail for one trip.

**Success response — 200:**
```
{
  trip: {
    id:               integer,
    driver_id:        integer,
    driver_name:      string,
    plate:            string,
    sacco:            string,
    route_id:         string,
    route_name:       string,
    status:           string,
    seats_available:  integer,
    fare:             integer,
    current_lat:      float,
    current_lng:      float,
    current_step:     integer,
    active_stops: [
      {
        id:                      string,
        name:                    string,
        lat:                     float,
        lng:                     float,
        seats_available_at_stop: integer
      }
    ],
    started_at:  datetime,
    ended_at:    datetime or null
  }
}
```

**Errors:**
- `404 {error: 'trip not found'}`

---

### GET /api/trips/:trip_id/gps

**Who calls it:** Rider and driver — polled every 5 seconds while a trip is active
**Purpose:** Return only the current position of the matatu. Lightweight — called frequently.

**Success response — 200:**
```
{
  trip_id:      integer,
  status:       string,   // "active", "paused", or "ended"
  current_lat:  float,
  current_lng:  float,
  current_step: integer
}
```

**Errors:**
- `404 {error: 'trip not found'}`

**Notes:**
- If `status = ended` the frontend stops polling and shows the trip ended state
- If `status = paused` the frontend shows the paused banner but keeps polling

---

### PATCH /api/trips/:trip_id/pause

**Who calls it:** Driver — active trip screen, toggle off
**Purpose:** Pause the trip. Matatu stops moving. Hidden from new rider searches.

**Request body:** none

**Success response — 200 — full trip object:** same shape as POST /api/trips response

**Errors:**
- `404 {error: 'trip not found'}`
- `403 {error: 'not your trip'}`
- `409 {error: 'trip is not active'}` — can only pause an active trip

**Side effects:**
- Sets `TRIP.status = paused`
- Simulator thread continues running but skips position advancement

---

### PATCH /api/trips/:trip_id/resume

**Who calls it:** Driver — paused trip screen
**Purpose:** Resume a paused trip.

**Request body:** none

**Success response — 200 — full trip object:** same shape as POST /api/trips response

**Errors:**
- `404 {error: 'trip not found'}`
- `403 {error: 'not your trip'}`
- `409 {error: 'trip is not paused'}`

**Side effects:**
- Sets `TRIP.status = active`
- Simulator thread resumes position advancement on next cycle

---

### PATCH /api/trips/:trip_id/end

**Who calls it:** Driver — active or paused trip screen
**Purpose:** End the trip permanently.

**Request body:** none

**Success response — 200:**
```
{
  trip: {
    id:              integer,
    status:          string,    // "ended"
    ended_at:        datetime,
    total_pickups:   integer,   // count of completed pickups on this trip
    seats_total:     integer,
    fare:            integer,
    route_name:      string,
    started_at:      datetime
  }
}
```

**Errors:**
- `404 {error: 'trip not found'}`
- `403 {error: 'not your trip'}`
- `409 {error: 'trip is already ended'}`

**Side effects:**
- Sets `TRIP.status = ended`, writes `ended_at`
- Simulator thread exits on next cycle
- All `pending` pickups on this trip are set to `cancelled`
- All `accepted` pickups on this trip are set to `cancelled`

---

### GET /api/trips/:trip_id/riders

**Who calls it:** Driver — polled every 5 seconds during active trip
**Purpose:** Return all active riders on this trip for the driver map and feed.

**Success response — 200:**
```
{
  riders: [
    {
      pickup_id:       integer,
      rider_id:        integer,
      rider_name:      string,
      pickup_type:     string,   // "flagging" or "reservation"
      status:          string,
      stop_id:         string,
      stop_name:       string,
      pickup_lat:      float,
      pickup_lng:      float,
      seats_requested: integer,
      alert_level:     string,
      pickup_window_start: datetime or null,
      pickup_window_end:   datetime or null
    }
  ]
}
```

**Errors:**
- `404 {error: 'trip not found'}`
- `403 {error: 'not your trip'}`

**Notes:**
- Returns pickups with status `pending` or `accepted` only
- `no_show` check runs server-side before returning: any reservation pickup whose `pickup_window_end` has passed and status is still `pending` or `accepted` is automatically set to `no_show` before the response is built
- Driver uses this to render rider dots on the map and populate the feed

---

### GET /api/trips/history

**Who calls it:** Driver — trip history screen
**Purpose:** Return all ended trips for the logged-in driver.

**Success response — 200:**
```
{
  trips: [
    {
      id:             integer,
      route_name:     string,
      status:         string,   // "ended"
      seats_total:    integer,
      fare:           integer,
      total_pickups:  integer,
      started_at:     datetime,
      ended_at:       datetime
    }
  ]
}
```

**Notes:**
- Sorted by `started_at` descending — most recent first
- Filtered to `status = ended` and `driver_id = session.user_id`

---

## 4. Pickups

---

### POST /api/pickups

**Who calls it:** Rider — flagging active screen or pickup spot waiting screen
**Purpose:** Create a new pickup request. Works for both flagging and reservation.

**Request body:**
```
{
  trip_id:          integer,
  pickup_type:      string,    // "flagging" or "reservation"
  stop_id:          string,    // must be an active stop on this trip
  seats_requested:  integer,   // 1–3

  // reservation only:
  pickup_window_start: datetime or null,
  pickup_window_end:   datetime or null
}
```

**Success response — 201 — full pickup object:**
```
{
  pickup: {
    id:                  integer,
    trip_id:             integer,
    rider_id:            integer,
    pickup_type:         string,
    status:              string,    // "pending"
    stop_id:             string,
    stop_name:           string,
    pickup_lat:          float,
    pickup_lng:          float,
    seats_requested:     integer,
    alert_level:         string,    // "none"
    pickup_window_start: datetime or null,
    pickup_window_end:   datetime or null,
    created_at:          datetime
  }
}
```

**Errors:**
- `404 {error: 'trip not found'}`
- `409 {error: 'trip is not active'}`
- `400 {error: 'stop is not active on this trip'}`
- `400 {error: 'seats_requested must be between 1 and 3'}`
- `409 {error: 'not enough seats available'}` — `seats_available_at_stop` < `seats_requested`
- `409 {error: 'rider already has an active pickup on this trip'}`

**Side effects:**
- Inserts one row into PICKUP
- Sets `pickup_lat` and `pickup_lng` from the stop's coordinates in the config
- Does NOT decrement `seats_available` yet — seats are only held on boarding confirmation

---

### GET /api/pickups/active

**Who calls it:** Rider — polled every 5 seconds while waiting for pickup
**Purpose:** Return the rider's current active pickup and its latest state.

**Request params:** none — rider is identified from session

**Success response — 200:**
```
{
  pickup: {
    id:                  integer,
    trip_id:             integer,
    pickup_type:         string,
    status:              string,
    stop_id:             string,
    stop_name:           string,
    pickup_lat:          float,
    pickup_lng:          float,
    seats_requested:     integer,
    alert_level:         string,
    pickup_window_start: datetime or null,
    pickup_window_end:   datetime or null,
    boarded_at:          datetime or null,

    // trip context for map rendering:
    current_lat:         float,
    current_lng:         float,
    trip_status:         string
  }
  or null   // null if no active pickup exists
}
```

**Notes:**
- Active means status is `pending` or `accepted`
- Returns null if the rider has no active pickup — frontend shows the idle state
- `no_show` check runs here too: if a reservation pickup window has expired, status is updated before responding

---

### PATCH /api/pickups/:pickup_id/accept

**Who calls it:** Driver — rider card accept button
**Purpose:** Driver accepts a pending pickup request.

**Request body:** none

**Success response — 200 — full pickup object:** same shape as POST /api/pickups response

**Errors:**
- `404 {error: 'pickup not found'}`
- `403 {error: 'not your trip'}`
- `409 {error: 'pickup is not pending'}`
- `409 {error: 'not enough seats available'}` — race condition guard

**Side effects:**
- Sets `PICKUP.status = accepted`

---

### PATCH /api/pickups/:pickup_id/reject

**Who calls it:** Driver — reject rider flow
**Purpose:** Driver rejects a pending or accepted pickup.

**Request body:** none

**Success response — 200 — full pickup object:** same shape as POST /api/pickups response

**Errors:**
- `404 {error: 'pickup not found'}`
- `403 {error: 'not your trip'}`
- `409 {error: 'pickup cannot be rejected in its current status'}` — completed, cancelled, no_show

**Side effects:**
- Sets `PICKUP.status = rejected`

---

### PATCH /api/pickups/:pickup_id/board

**Who calls it:** Rider — boarding confirm screen ("I'm On Board")
**Purpose:** Rider confirms they have boarded. Final confirmation step.

**Request body:** none

**Success response — 200 — full pickup object:** same shape as POST /api/pickups response

**Errors:**
- `404 {error: 'pickup not found'}`
- `403 {error: 'not your pickup'}`
- `409 {error: 'pickup is not accepted'}` — must be accepted before boarding
- `409 {error: 'not enough seats available'}` — final race condition guard

**Side effects:**
- Sets `PICKUP.status = completed`
- Sets `PICKUP.boarded_at` to now
- Decrements `TRIP.seats_available` by `seats_requested`
- If `TRIP.seats_available` reaches 0, sets `TRIP.status = paused`

---

### PATCH /api/pickups/:pickup_id/cancel

**Who calls it:** Rider — any waiting screen
**Purpose:** Rider cancels their pickup request before boarding.

**Request body:** none

**Success response — 200 — full pickup object:** same shape as POST /api/pickups response

**Errors:**
- `404 {error: 'pickup not found'}`
- `403 {error: 'not your pickup'}`
- `409 {error: 'pickup cannot be cancelled in its current status'}` — completed, no_show

**Side effects:**
- Sets `PICKUP.status = cancelled`
- Does NOT change `TRIP.seats_available` — seats were never held

---

### GET /api/pickups/history

**Who calls it:** Rider — my trips screen
**Purpose:** Return all pickups for the logged-in rider, joined with trip data.

**Success response — 200:**
```
{
  pickups: [
    {
      pickup_id:      integer,
      pickup_type:    string,
      status:         string,
      seats_requested: integer,
      boarded_at:     datetime or null,
      stop_name:      string,
      trip: {
        id:           integer,
        route_name:   string,
        fare:         integer,
        plate:        string,
        sacco:        string,
        started_at:   datetime,
        ended_at:     datetime or null
      }
    }
  ]
}
```

**Notes:**
- Sorted by `created_at` descending — most recent first
- All statuses included — rider sees their full history including cancelled and no-show

---

## 5. Dev / Reset

---

### POST /api/dev/reset

**Who calls it:** Developer only — not exposed in the UI
**Purpose:** Wipe all runtime data and reseed the database to its initial state. Stops all running simulator threads.

**Request body:** none

**Success response — 200:**
```
{
  message: 'database reset and reseeded'
}
```

**Notes:**
- Deletes all rows from TRIP, TRIP_STOPS, PICKUP
- Reinserts seed RIDER and DRIVER rows
- Stops all active simulator threads
- Does not require auth — dev use only
- Must be removed or protected before any public deployment

---

## 6. Polling Summary

| Endpoint | Caller | Interval | Purpose |
|---|---|---|---|
| GET /api/trips/:trip_id/gps | Rider + Driver | 5s | Move matatu dot on map |
| GET /api/trips/:trip_id/riders | Driver | 5s | Rebuild rider dots, trigger no-show checks |
| GET /api/pickups/active | Rider | 5s | Read alert_level, status changes |

---

## 7. HTTP Status Code Reference

| Code | Meaning |
|---|---|
| 200 | Success |
| 201 | Created successfully |
| 400 | Bad request — invalid input |
| 401 | Unauthorized — no valid session |
| 403 | Forbidden — valid session but wrong user |
| 404 | Resource not found |
| 409 | Conflict — valid request but current state prevents it |

---

*End of Sema API Contract Specification v1.0*
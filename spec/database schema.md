# Sema — Database Schema Specification
Version: 1.1
Scope: Logic and structure only. No SQL dialect, no code.

---

## Tables

### RIDER

Represents a registered rider.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | integer | primary key, auto-increment | Unique rider identifier |
| name | text | not null | Full name |
| phone | text | not null, unique | Phone number |
| email | text | not null, unique | Email address |
| created_at | datetime | not null, default now | Row creation time |
| updated_at | datetime | not null, default now | Last update time |

**Notes:**
- No password, no OTP, no verified flag — onboarding is skipped for MVP
- Seed data provides 3 riders at startup

---

### DRIVER

Represents a registered and approved driver.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | integer | primary key, auto-increment | Unique driver identifier |
| name | text | not null | Full name |
| phone | text | not null, unique | Phone number |
| plate | text | not null, unique | Matatu plate number |
| sacco | text | not null | Sacco affiliation |
| created_at | datetime | not null, default now | Row creation time |
| updated_at | datetime | not null, default now | Last update time |

**Notes:**
- No approval flow, no password for MVP — drivers are pre-seeded
- Seed data provides 3 drivers at startup

---

### TRIP

Represents one driver's run along a route. This is the central table — most other tables reference it.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | integer | primary key, auto-increment | Unique trip identifier |
| driver_id | integer | not null, foreign key → DRIVER.id | The driver running this trip |
| route_id | text | not null | Identifier of the route from the config (e.g. `cbd_thika`) |
| status | text | not null, default `active` | Current trip status: `active`, `paused`, or `ended` |
| seats_total | integer | not null | Total seats on the matatu at trip start |
| seats_available | integer | not null | Current available seats — decrements on confirmed pickup |
| fare | integer | not null | Fare in KSh for this trip |
| current_lat | real | not null | Current latitude of the matatu |
| current_lng | real | not null | Current longitude of the matatu |
| current_step | integer | not null, default 0 | Current position index in the route's coordinate array |
| started_at | datetime | not null, default now | When the trip was started |
| ended_at | datetime | nullable | When the trip ended — null until status becomes `ended` |
| created_at | datetime | not null, default now | Row creation time |
| updated_at | datetime | not null, default now | Last update time |

**Notes:**
- `current_lat`, `current_lng`, and `current_step` are written by the simulator every 5 seconds
- `seats_available` starts equal to `seats_total` and is managed at the trip level
- Trip history for the driver history screen is this table filtered by `status = ended` and `driver_id`
- Trip history for the rider history screen is derived from the PICKUP table joined to this table

---

### TRIP_STOPS

Records which stops a driver has chosen to serve on a specific trip. One row per active stop per trip.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | integer | primary key, auto-increment | Unique row identifier |
| trip_id | integer | not null, foreign key → TRIP.id | The trip this stop belongs to |
| stop_id | text | not null | Identifier of the stop from the route config (e.g. `githurai`) |
| created_at | datetime | not null, default now | Row creation time |
| updated_at | datetime | not null, default now | Last update time |

**Unique constraint:** `trip_id` + `stop_id` — a stop can only appear once per trip.

**Notes:**
- Stop coordinates and names are not stored here — always looked up from the route config using `stop_id`
- The proximity checker queries this table to know which stops are active, then fetches coordinates from the config
- Riders browsing a trip see only the stops present in this table for that trip

---

### PICKUP

Unified table covering both spontaneous flagging and seat reservations. One row per rider per trip.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | integer | primary key, auto-increment | Unique pickup identifier |
| trip_id | integer | not null, foreign key → TRIP.id | The trip this pickup is on |
| rider_id | integer | not null, foreign key → RIDER.id | The rider |
| pickup_type | text | not null | `flagging` or `reservation` |
| status | text | not null, default `pending` | Current status — see status table below |
| spotted | boolean | not null, default false | Whether the rider has tapped "Pick Me Up" — signals to the driver that the rider can see the matatu |
| stop_id | text | not null | The stop where the rider expects to be picked up — references the route config |
| pickup_lat | real | not null | Latitude of the rider's pickup location |
| pickup_lng | real | not null | Longitude of the rider's pickup location |
| seats_requested | integer | not null, default 1 | Number of seats the rider needs |
| alert_level | text | not null, default `none` | Current proximity alert: `none`, `approaching`, or `near` |
| pickup_window_start | datetime | nullable | For reservations only — start of the pickup window |
| pickup_window_end | datetime | nullable | For reservations only — end of the pickup window |
| boarded_at | datetime | nullable | When the rider confirmed boarding — null until status becomes `completed` |
| spotted_at | datetime | nullable | When the rider tapped "Pick Me Up" — null until spotted becomes true |
| created_at | datetime | not null, default now | Row creation time |
| updated_at | datetime | not null, default now | Last update time |

**Unique constraint:** `trip_id` + `rider_id` — a rider can only have one active pickup per trip at a time.

**Notes:**
- `spotted` is independent of `status` — a rider can be spotted while still pending (driver hasn't accepted yet) or while accepted (driver confirmed, rider now visible)
- `spotted` is one-way — once set to true it is never set back to false
- `spotted_at` records when the signal was sent, for debugging and future analytics
- `pickup_lat` and `pickup_lng` are always the coordinates of the selected stop for MVP
- `pickup_window_start` and `pickup_window_end` are null for flagging pickups
- No-show logic: when `pickup_window_end` has passed and status is still `pending` or `accepted`, the server sets status to `no_show` on the next poll cycle
- `seats_requested` decrements `TRIP.seats_available` when status moves to `completed`
- `seats_requested` does NOT decrement `seats_available` when status moves to `accepted`

---

### PICKUP status values

| Status | Meaning |
|---|---|
| `pending` | Rider has flagged or reserved — driver has not yet responded |
| `accepted` | Driver has accepted the pickup |
| `rejected` | Driver has rejected the pickup |
| `cancelled` | Rider cancelled before boarding |
| `completed` | Rider boarded and confirmed — trip is counted |
| `no_show` | Pickup window expired without rider confirming — reservations only |

**Note:** `spotted` is not a status value — it is a separate boolean field. A rider can be `pending + spotted`, `accepted + spotted`, etc.

---

### SESSION

Flask session cookies handle auth state in memory. No session table is needed in the database.

---

## Relationships

```
DRIVER ──< TRIP ──< TRIP_STOPS
                └──< PICKUP >── RIDER
```

---

## Seat Availability Logic

**Trip level — `TRIP.seats_available`**
Decrements by `seats_requested` when a pickup reaches `completed`. Never goes below zero.

**Stop level — derived, not stored**
Available seats at a specific stop: take `TRIP.seats_available` and subtract `seats_requested` of all `pending` and `accepted` pickups whose `stop_id` matches that stop. Always computed on demand, never stored.

---

## Seed Data

**Riders**

| id | name | phone | email |
|---|---|---|---|
| 1 | Amina Wanjiru | +254712345001 | amina@sema.test |
| 2 | Brian Otieno | +254712345002 | brian@sema.test |
| 3 | Peter Kamau | +254712345003 | peter@sema.test |

**Drivers**

| id | name | phone | plate | sacco |
|---|---|---|---|---|
| 1 | James Mwangi | +254722100001 | KJA 001A | Super Metro |
| 2 | Susan Njoki | +254722100002 | KBZ 445K | OMA Sacco |
| 3 | Kevin Ochieng | +254722100003 | KDA 223B | City Shuttle |

**Routes** — defined in gps.py, not in the database.

**Trips, pickups** — none at startup. Clean state.

---

## Indexes

| Table | Column(s) | Reason |
|---|---|---|
| TRIP | driver_id | Driver history screen, active trip lookup |
| TRIP | status | Finding all active trips for route discovery |
| TRIP | route_id | Filtering trips by route |
| TRIP_STOPS | trip_id | Finding active stops for a trip |
| TRIP_STOPS | stop_id | Finding trips serving a specific stop |
| PICKUP | trip_id | Proximity checker, driver rider list |
| PICKUP | rider_id | Rider history screen, active pickup lookup |
| PICKUP | status | Filtering active pickups for proximity checks |
| PICKUP | spotted | Sorting spotted riders to top of driver feed |
| PICKUP | trip_id + status | Combined — most common query pattern |

---

## What Is Not In The Schema

The following are intentionally excluded from MVP:

- Password or credential columns on RIDER or DRIVER
- OTP or verification tables
- Admin table or approval workflow
- Rating or review tables
- Payment or fare transaction tables
- Notification log table
- Seat map or individual seat assignment tables
- Preferred places or saved locations tables

*End of Sema Database Schema Specification v1.1*
# Sema — Maps & Simulation Specification

**Version:** 1.0
**Scope:** Logic only. No stack, no language, no code.

---

## 1. Core Concepts

**Route** — A named corridor between an origin and a destination. A route is a fixed, predefined path. It does not change between trips. It contains an ordered sequence of coordinates and a set of named stops.

**Stop** — A named point along a route where riders can board or alight. Every stop sits exactly on a coordinate in the route's coordinate sequence. A stop knows its position in that sequence.

**Trip** — A single driver's run along a route on a given day. A trip references a route and inherits its coordinate sequence. A trip has its own position tracker that advances independently of all other trips on the same route.

**Position** — A coordinate pair (latitude, longitude) representing where a matatu currently is. For simulation, this is read from the route's coordinate sequence. For live maps later, this is read from the driver's device. The rest of the system does not know or care which source it came from.

**Pickup Location** — A coordinate pair representing where a rider expects to be picked up. For MVP, this is always the coordinate of a named stop. For live maps later, this could be any coordinate. The rest of the system does not know or care which source it came from.

---

## 2. Route Definition

Each route is defined once and never changes at runtime. A route contains:

- A unique identifier
- A human-readable name (e.g. "CBD → Thika Town")
- An ordered list of coordinate pairs forming the path from origin to destination. Coordinates are spaced approximately 100 metres apart.
- An ordered list of stops. Each stop contains:
  - A unique identifier within the route
  - A human-readable name (e.g. "Githurai Stage")
  - A coordinate pair (must match exactly one coordinate in the route's coordinate list)
  - An index indicating its position in the route's coordinate list

The first coordinate in the list is the route origin. The last coordinate is the route destination. The destination is also treated as the final stop.

**Constraint:** Stop coordinates are not approximated. When a route is drawn, a vertex is placed exactly at each stop location. The index of that vertex is recorded as the stop's position index.

---

## 3. Trip Configuration

When a driver starts a trip they select:

1. A route — this determines the coordinate sequence and the full list of possible stops
2. Which stops they will serve — they may deselect stops they are skipping. At least the destination must remain selected.
3. Seat availability and fare (not relevant to simulation)

The trip record stores:
- Which route it is running
- Which stops are active for this trip
- The current position index (starts at 0)
- The current latitude and longitude (starts at the route's first coordinate)
- The trip status (active, paused, ended)

---

## 4. Position Simulation

### How it works

Once a trip is started, a position advancement process begins for that trip. It runs independently for every active trip. Multiple trips on the same route run independently and never interfere with each other.

The process follows this cycle:

1. Read the trip's current position index
2. Check if the trip is paused — if so, do nothing this cycle and wait
3. Check if the trip is ended — if so, stop the process entirely
4. Advance the position index by one
5. If the new index is beyond the last coordinate in the route, mark the trip as ended and stop
6. Look up the coordinate at the new index in the route's coordinate list
7. Write the new latitude and longitude to the trip record
8. Trigger a proximity check (see Section 6)
9. Wait 5 seconds
10. Repeat from step 1

### Pausing

When a driver pauses their trip, the advancement process continues running but skips steps 4–8 each cycle. The matatu dot stops moving on the map. The trip's position is preserved exactly where it was when paused. When the driver resumes, advancement continues from that position.

### Ending

When the process reaches the last coordinate in the route, or when the driver manually ends the trip, the trip is marked ended and the process stops. The matatu dot disappears from rider searches. Any active pickup requests or reservations on this trip are resolved (see Section 7).

---

## 5. Rider Pickup Location

A rider's pickup location is a coordinate pair stored when the rider takes an action (flagging, setting a pickup spot, or making a reservation).

**For spontaneous flagging:** The rider selects a stop on the map as their current location. The coordinate of that stop is stored as their pickup location.

**For preferred pickup spot:** The rider selects a stop along the route. The coordinate of that stop is stored as their pickup location.

**For seat reservation:** The rider selects a stop when booking. The coordinate of that stop is stored as the reservation's pickup location.

In all three cases, the stored value is identical in structure — a coordinate pair. The rest of the system treats all three the same way.

**Future swap point:** In live maps mode, the coordinate pair for flagging and preferred pickup spot will come from the rider's device location or a map pin rather than a stop selection. The stored value and everything downstream remains unchanged.

---

## 6. Proximity Checking

Proximity checking determines how close a matatu currently is to each rider waiting on that trip. It runs automatically every time the simulator advances a step (every 5 seconds).

### What gets checked

Every active pickup request and every active reservation linked to the current trip is checked. Each has a stored pickup location (a coordinate pair).

### How distance is calculated

The straight-line distance between the matatu's current position and the rider's pickup location is calculated geometrically from their coordinate pairs. No mapping service is involved. The result is a distance in metres.

**Future swap point:** This calculation can be replaced with a road-distance calculation later without changing anything else.

### Alert levels

Based on the calculated distance, an alert level is assigned to the pickup request or reservation:

| Alert Level | Condition |
|---|---|
| `none` | Distance is greater than 1500 metres |
| `approaching` | Distance is 1500 metres or less |
| `near` | Distance is 500 metres or less |

The alert level is written to the pickup request or reservation record. Riders read this on their next poll.

### Stop-based optimisation (optional later)

Because stops have known position indices, it is possible to skip proximity checks entirely until the simulator is within a few steps of a stop's index. This is an optimisation and is not required for MVP.

---

## 7. Map Rendering

### What the map shows

**Rider's map:**
- The route line for the selected trip's route
- A dot representing the matatu's current position, moving in real time
- A marker for the rider's own pickup location
- Stop markers along the route

**Driver's map:**
- The route line for their active trip's route
- A dot representing their own matatu's current position
- A dot for each rider who has an active pickup request or reservation on this trip, placed at their stored pickup location
- Stop markers for their active stops

### How the map stays current

Neither the rider nor the driver app computes or simulates anything. They only read from the server.

Every 5 seconds, the rider app asks the server for the matatu's current position. The server returns the latitude and longitude stored in the trip record. The rider app moves the matatu dot to that position.

Every 5 seconds, the driver app asks the server for the list of active riders on the trip. The server returns each rider's stored pickup location and status. The driver app redraws the rider dots.

The route line does not move or change. It is rendered once when the map loads, from the route's coordinate list, and stays static for the duration of the trip.

### Matatu dot movement

The matatu dot does not jump between positions. It moves smoothly between its previous position and its new position over the 5-second interval. This is a frontend interpolation — the dot animates continuously between two known coordinates rather than snapping.

### Future swap point

When live maps are enabled, the matatu dot's position will update from real device coordinates rather than simulated ones. The map rendering logic does not change. The only change is the source of the coordinate values returned by the server.

---

## 8. Route Line

The route line is a static visual. It is drawn once from the route's predefined coordinate list when the map loads. It does not change during the trip.

The full route line is always shown. The portion of the route already travelled may optionally be rendered in a different style (e.g. dimmed) to give a sense of progress. This is a visual enhancement and does not affect any logic.

**Future swap point:** The hardcoded coordinate list can be replaced with a coordinate list returned by a live routing service. The map renders it identically either way.

---

## 9. The Abstraction Boundary

The entire simulation is isolated behind two interfaces. Everything outside these interfaces is already written for live maps.

**Interface 1 — Position source**
One operation: given a trip's current step and route, return the next position (latitude, longitude) and the new step index.
- Simulation: looks up the coordinate at the next index in the hardcoded route array
- Live: reads the latest coordinate posted by the driver's device

**Interface 2 — Rider location source**
One operation: given a rider's pickup action, return a coordinate pair for their pickup location.
- Simulation: looks up the coordinate of the selected stop from the route config
- Live: reads the coordinate from the rider's device location or map pin

Nothing outside these two interfaces needs to change when switching from simulation to live maps.

---

## 10. Lifecycle Summary

```
Route defined (once, never changes)
  └─► Driver selects route + active stops → Trip created → Position starts at index 0
        └─► Simulator advances position every 5s
              ├─► Writes new lat/lng to trip record
              ├─► Runs proximity check on all active pickups/reservations
              │     └─► Writes alert_level to each record
              └─► Riders + driver poll every 5s
                    ├─► Riders read matatu position → dot moves on map
                    ├─► Riders read alert_level → banner updates
                    └─► Driver reads rider locations + statuses → dots update on map
                          └─► Trip reaches final coordinate OR driver ends trip
                                └─► Trip marked ended → simulator stops → dots removed
```

---

*End of Maps & Simulation Specification v1.0*
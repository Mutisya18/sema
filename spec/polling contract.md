# Sema — Polling Contract Specification

**Version:** 1.0
**Scope:** Logic only. Defines what is polled, by whom, at what interval, what the frontend does with each response, and when polling starts and stops.

---

## Core Rules

- All polling is done via `setInterval` in the browser — no WebSockets, no long-polling
- Default interval is 5 seconds for all polls
- All polls are GET requests to the API
- All polls require an active session — a 401 response stops polling and redirects to the login screen
- A failed poll (network error or 5xx) shows an error banner and retries on the next interval — it does not stop polling
- A successful poll always clears any existing error banner
- When `status = ended` is received on any poll, that poll stops immediately and the frontend transitions to the ended state
- Only one poll of each type runs at a time — if the previous request has not returned before the next interval fires, the new request is skipped that cycle

---

## Poll 1 — Matatu GPS Position

**Endpoint:** `GET /api/trips/:trip_id/gps`
**Caller:** Rider and Driver
**Interval:** 5 seconds
**Purpose:** Keep the matatu dot moving on the map

**When it starts:**
- Rider: when they are on the matatu detail screen and have selected a trip, and on all subsequent screens where the map is visible (waiting screen, boarding screen, live trip screen)
- Driver: immediately when the trip is created and the active trip screen loads

**When it stops:**
- Response contains `status = ended` → stop immediately, transition to ended state
- Rider navigates away from all map screens → stop
- Driver ends the trip → stop after the end trip response is received (do not wait for the next poll cycle)
- Session is destroyed → stop

**What the frontend does with each response:**

| Field received | Frontend action |
|---|---|
| `status = active` | Move matatu dot to `current_lat`, `current_lng` using smooth interpolation over 5 seconds |
| `status = paused` | Stop animating the matatu dot. Show paused banner. Keep polling. |
| `status = ended` | Stop polling. Transition to ended state. |
| `current_lat`, `current_lng` | Update matatu dot position on map |
| `current_step` | Store in memory — used to estimate progress along route |

**Interpolation rule:** The dot does not snap to the new position. It animates smoothly from its current position to the new position over the full 5-second interval, so it appears to move continuously rather than jump every 5 seconds.

**Error behaviour:** Show a small banner "Connection issue — retrying". Keep polling. Do not move the dot. When the next successful response arrives, snap the dot to the latest position and resume interpolation.

---

## Poll 2 — Rider Active Pickup Status

**Endpoint:** `GET /api/pickups/active`
**Caller:** Rider only
**Interval:** 5 seconds
**Purpose:** Track the status of the rider's current pickup request and receive proximity alerts

**When it starts:**
- Immediately after a pickup is successfully created (POST /api/pickups returns 201)

**When it stops:**
- Response contains `status = completed` → stop polling, transition to live trip screen
- Response contains `status = rejected` → stop polling, show rejection banner, return to search screen
- Response contains `status = cancelled` → stop polling, return to search screen
- Response contains `status = no_show` → stop polling, show no-show banner, return to search screen
- Response contains `trip_status = ended` → stop polling, show trip ended banner, return to home screen
- Rider manually cancels (PATCH /api/pickups/:id/cancel succeeds) → stop polling
- Session is destroyed → stop

**What the frontend does with each response:**

| Field / value received | Frontend action |
|---|---|
| `status = pending` | No change — keep waiting |
| `status = accepted` | Update status line on monitoring screen: "Driver accepted — matatu is on its way". Reveal "I'm On Board ✓" button. Do NOT navigate away. Keep polling. |
| `status = completed` | Stop polling. Navigate to live trip screen. |
| `status = rejected` | Stop polling. Show toast "Driver could not pick you up." Navigate to search screen. |
| `status = cancelled` | Stop polling. Return to search screen silently. |
| `status = no_show` | Stop polling. Show toast "You missed your pickup window." Navigate to search screen. |
| `trip_status = ended` | Stop polling. Show toast "This trip has ended." Navigate to home screen. |
| `alert_level = none` | No banner shown |
| `alert_level = approaching` | Show approaching banner "Matatu is 1.5 km away — head to your stop" |
| `alert_level = near` | Show near banner "Matatu is 500m away — be at your stop now" |
| `current_lat`, `current_lng` | Update matatu dot position on map if map is visible |
| `null` (no active pickup) | No action — rider has no active pickup. Do not start this poll if null is returned on first call. |

**No-show check:** The server runs the no-show check before building this response. If the pickup window has expired and status is still pending or accepted, the server sets status to no_show before responding. The frontend receives no_show and handles it as above.

---

## Poll 3 — Driver Rider List

**Endpoint:** `GET /api/trips/:trip_id/riders`
**Caller:** Driver only
**Interval:** 5 seconds
**Purpose:** Keep the driver's map and feed current with all active rider dots and cards

**When it starts:**
- Immediately when the active trip screen loads

**When it stops:**
- Driver ends the trip → stop after end trip response is received
- Response contains an empty riders array for three consecutive cycles after previously having riders → keep polling (riders may flag later in the trip)
- Session is destroyed → stop

**Note:** This poll never stops due to an empty riders array — the driver map must stay live for the full duration of the trip in case new riders flag later.

**What the frontend does with each response:**

| Field / value received | Frontend action |
|---|---|
| New pickup appears (id not seen before) | Add rider dot to map at `pickup_lat`, `pickup_lng`. Add rider card to feed. |
| Existing pickup, status unchanged | No re-render — compare by pickup_id and status, skip if identical |
| `status = accepted` | Update rider card to accepted state. No dot change. |
| `status = completed` | Remove rider dot from map. Update card to boarded state. After 3 seconds remove card from feed. |
| `status = rejected` | Remove rider dot from map. Remove card from feed immediately. |
| `status = cancelled` | Remove rider dot from map. Remove card from feed. Show toast "{rider_name} cancelled." |
| `status = no_show` | Remove rider dot from map. Update card to no-show state. After 3 seconds remove card from feed. |
| `pickup_type = reservation` | Render dot in blue. Render card with reservation style. Sort above flagging cards in feed. |
| `pickup_type = flagging` | Render dot in orange. Render card with flagging style. Sort below reservation cards in feed. |
| `alert_level = approaching` | No driver-side action — alert level is for rider only |
| `alert_level = near` | Show banner on driver map "Approaching pickup point for {rider_name} at {stop_name}" |

**No-show check:** The server runs the no-show check before building this response. Expired reservation pickups are marked no_show server-side. The driver receives them as no_show and the frontend handles them as above.

**Diff logic:** The frontend keeps a local copy of the last riders array in memory. On each poll response, it compares by `pickup_id` and `status`. Only changed or new entries trigger a re-render. This prevents the map and feed from flickering every 5 seconds.

---

## Poll Lifecycle — Rider Journey

```
Rider selects trip
  └─► Start Poll 1 (GPS)

  Rider creates pickup (POST /api/pickups)
    └─► Start Poll 2 (pickup status)

    Poll 2 receives status=accepted
      └─► Update status line on monitoring screen. Reveal "I'm On Board ✓" button.
      └─► Continue Poll 1 + Poll 2. Do NOT navigate away.

      Rider taps "I'm On Board ✓" (on monitoring screen):
        └─► PATCH /api/pickups/:id/board
          └─► Stop Poll 2.
            └─► Navigate to live trip screen.
              └─► Poll 1 continues.

            Poll 1 receives status=ended
              └─► Stop Poll 1.
                └─► Navigate to trip ended screen.
                ```

                ---

                ## Poll Lifecycle — Driver Journey

                ```
                Driver creates trip (POST /api/trips)
                  └─► Start Poll 1 (GPS) — driver reads own position back from server
                    └─► Start Poll 3 (riders)

                    Driver pauses trip (PATCH /api/trips/:id/pause)
                      └─► Poll 1 continues — matatu dot stops moving (server stops advancing)
                        └─► Poll 3 continues — rider dots remain visible

                        Driver resumes trip (PATCH /api/trips/:id/resume)
                          └─► Poll 1 continues — matatu dot resumes moving
                            └─► Poll 3 continues

                            Driver ends trip (PATCH /api/trips/:id/end)
                              └─► Stop Poll 1 immediately
                                └─► Stop Poll 3 immediately
                                  └─► Navigate to end trip summary screen
                                  ```

                                  ---

## Simultaneous Polls
The rider runs at most two polls simultaneously: Poll 1 (GPS) and Poll 2 (pickup status). The driver runs at most two polls simultaneously: Poll 1 (GPS) and Poll 3 (riders). No user runs more than two polls at the same time.

Each poll is managed by its own independent `setInterval`. They do not share state or timing. A slow response on one poll does not delay the other.

 ---

## Error Banner Behaviour

A single error banner position exists on every screen that has active polls. It appears at the top of the screen, above all other content.

| Condition | Banner text | Behaviour |
|---|---|---|
| Network error on any poll | "Connection issue — retrying" | Show banner. Keep polling. Clear banner on next success. |
| 500 on any poll | "Something went wrong — retrying" | Show banner. Keep polling. Clear banner on next success. |
| 401 on any poll | "Session expired — please log in again" | Show banner. Stop all polls. Redirect to login after 2 seconds. |
| 404 on GPS poll | "This trip no longer exists" | Show banner. Stop GPS poll. |

---

## Poll Timing Reference

| Poll | Endpoint | Caller | Interval | Starts | Stops |
|---|---|---|---|---|---|
| Poll 1 — GPS | GET /api/trips/:trip_id/gps | Rider + Driver | 5s | Trip selected (rider) / Trip created (driver) | status=ended received or manual end |
| Poll 2 — Pickup status | GET /api/pickups/active | Rider | 5s | Pickup created | Terminal status received or manual cancel |
| Poll 3 — Rider list | GET /api/trips/:trip_id/riders | Driver | 5s | Active trip screen loads | Trip ended |

---

*End of Sema Polling Contract Specification v1.0*
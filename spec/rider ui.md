# Sema — Rider UI Specification
Version: 2.1
Scope: Screen layout, components, interactions, and navigation for the rider frontend. No implementation detail. All screens live in rider.html as hidden divs; only one is visible at a time.

---

## Design Language

**Colours:** Primary blue `#1a5cff`. Background `#fff`. Surface grey `#f8f8f8`. Border `#f0f0f0`. Text primary `#111`. Text secondary `#888`.
**Typography:** System sans-serif. Screen titles 20px/700. Section labels 12px/400 `#888`. Body 14px/400.
**Radius:** Cards 14px. Buttons 12px. Chips 20px. Inputs 10px.
**Buttons:** Primary — blue fill, white text. Secondary — `#f2f2f2` fill, `#333` text. Outline — white fill, blue border and text. Danger — `#ff3b30` fill, white text. All full-width unless noted, 14px padding, 15px/600.
**Badges:** Inline pill labels. Green `#e6f6ee / #0a7a3e`. Blue `#e8f0ff / #1a5cff`. Orange `#fff3e0 / #d06000`. Red `#ffe8e8 / #d00`.
**Alert banners:** Full-width coloured blocks, 12px padding, 10px radius. Orange for warnings, blue for info, green for success.
**Toasts:** Dark `#111` pill, bottom of screen above nav, 13px/500, auto-dismiss after 2.5s.
**Bottom nav:** 3 tabs — Home, Trips, Profile. Active tab icon and label in `#1a5cff`. Inactive in `#bbb`.
**Map areas:** Rendered by Mapbox GL JS. Shown as a coloured placeholder block in the prototype.

---

## The Three Journeys

**Flagging** — Rider is physically at the roadside and wants to board now. Entry via Quick Trip on home. From location is automatic (current location in live maps; preconfigured stop per route in simulation — not editable by rider). Rider searches destination, sees active matatus on that route that have not yet passed their from stop, selects one, and monitors it approaching. "Pick Me Up" is available immediately on the waiting screen. When the rider taps it, their status updates to signal the driver. Countdown starts when `alert_level = near`. Rider boards and confirms.

**Pickup** — Rider is not yet at the road and wants to be picked up at a specific stop. Entry via the search bar. Rider selects both a from stop and a destination from defined route stops. Same active trip filter as flagging. Rider monitors the matatu. "Pick Me Up" only appears once the countdown starts (`alert_level = near`). Driver sees the rider dot at the from stop coordinate. Rider boards and confirms.

**Booking** — Advance reservation for a future trip. Entry via Schedule Ride on home. Flow: destination → from → date & time → available future matatus → seat count → confirm. No active matatu exists at booking time. Rider re-enters the monitoring flow via My Trips once the trip goes active.

---

## Navigation Structure

```
Login
  └─► Home
        ├─► Quick Trip (Flagging)
        │     └─► Search (from pre-filled, locked)
        │           └─► Matatu List
        │                 └─► Matatu Detail
        │                       └─► Flagging Waiting → Boarding Confirm → Live Trip → Trip Ended
        ├─► Search bar (Pickup)
        │     └─► Search (from + to editable)
        │           └─► Matatu List
        │                 └─► Matatu Detail
        │                       └─► Pickup Waiting → Boarding Confirm → Live Trip → Trip Ended
        ├─► Schedule Ride (Booking)
        │     └─► Booking: Destination → From → Date & Time → Matatu List → Seat Count → Confirm → Success
        │           └─► My Trips → Matatu Detail → Pickup Waiting → Boarding Confirm → Live Trip → Trip Ended
        ├─► My Trips
        └─► Profile
```

---

## Screens

### S-00 — Login
**Route:** `/rider` (initial load, no session)

**Layout:** Full-screen blue `#1a5cff` background. Centred column, 40px padding.

**Components:**
- App icon: 72×72px white rounded square, matatu SVG in blue.
- App name: "Sema" 32px/800 white, letter-spacing -1px.
- Tagline: "Matatu hailing, reimagined" 14px white 70% opacity.
- Phone input: white background, placeholder "+254 7XX XXX XXX".
- Login button: primary style, label "Sign in →".
- Inline error state below input: "Phone number not found" in red.

**Behaviour:**
- On submit: call `POST /api/auth/login` with `{phone, role: 'rider'}`.
- On 200: populate `RiderState.user`, navigate to Home.
- On 404: show inline error.

---

### S-01 — Home
**Layout:** Scrollable content. Fixed bottom nav. 80px bottom padding.

**Header (16px top, 20px sides):**
- Left: "Good morning," 13px `#888` + user name + wave emoji 20px/700.
- Right: 40px avatar circle, initials, blue `#e8f0ff` background.

**Content (20px horizontal padding):**

Search bar — full-width input, search icon left, placeholder "Where are you going?". Tapping navigates to S-02 with both inputs editable (Pickup journey entry).

Quick action cards — two equal-width side-by-side cards:
- **Quick Trip** (blue fill, white text, bus emoji 🚍): Flagging journey entry. Tapping navigates to S-02 with from pre-filled and locked to the route's origin stop for simulation, and current location for live. Destination input is editable.
- **Schedule Ride** (`#f7f9ff` fill, blue border, calendar emoji 📅): Booking journey entry. Tapping navigates to S-03 (Booking: Destination).

Recent routes section — label "Recent routes" 14px/700. Each row: icon + route name + subtitle (fare · time ago) + chevron. Tapping a row navigates to S-02 with that route's destination pre-filled.

**Bottom nav:** Home tab active.

---

### S-02 — Search
**Layout:** Fixed header with two inputs. Map. Scrollable matatu list. No bottom nav.

**Header (16px padding):**
- Back button (32px circle, `#f2f2f2`).
- **From input:** Stop name. In Pickup journey: editable, placeholder "From where?", filters to defined route stops on keystroke. In Flagging journey: pre-filled with route origin stop (simulation) or current location label (live), not editable — shown with a locked style (grey background).
- **To input:** Destination stop. Editable, placeholder "Where to?", filters to defined route stops on keystroke.
- When both inputs are filled, the matatu list loads automatically.

**Map:** 160px tall Mapbox map. Shows route line (blue), matatu dots for active trips on the selected route, and the rider's from location dot (blue, pulsing).

**Matatu list:**
- Count label: "{n} matatus found · {route name}" 13px `#888`.
- One Matatu Card per active trip that has not yet passed the rider's from stop index.
- If a matatu has already passed the rider's from stop: it is excluded from the list. If the rider somehow selects it (e.g. tapping a dot on the map), show inline error: "This matatu has already passed your stop — please select another."
- Tapping a card navigates to S-04 (Matatu Detail).

**Matatu Card component:**
- Border 1.5px `#f0f0f0`, radius 14px, 14px padding, 12px margin sides.
- Header row: plate 16px/700 + sacco 12px `#888` left; seat badge right (green ≥6, orange 2–5, red 1).
- Stats row: ETA to rider's stop / Fare / — each as stat-value (14px/600) + stat-label (10px `#aaa`).

---

### S-03 — Booking: Destination
**Layout:** Header. Scrollable content. No bottom nav.

**Header:** Back → Home. Title "Schedule a ride".

**Content (16px padding):**
- Destination input: placeholder "Where to?", filters to defined stops on keystroke.
- Primary button: "Next →" — enabled only when destination is selected. Navigates to S-05 (Booking: From).

---

### S-04 — Matatu Detail
**Layout:** Header. Map. Scrollable content. No bottom nav.

**Header:** Back → S-02. Plate number centred 16px/700. Seat badge right.

**Map:** 180px tall. Shows route line, named stop dots with labels, and moving matatu dot. Poll 1 starts on this screen.

**Content (14px padding):**
- Route summary card: grey surface, origin → stops → destination as inline chips with arrows.
- 2×2 stat grid: ETA to rider's stop / Fare / Sacco / — each in a grey surface card.
- Driver row: 40px avatar with initials + name 14px/600 + plate and sacco 12px `#888`.
- Action button — one button, label depends on journey:
  - Flagging journey: primary button "Flag Matatu" → creates pickup via `POST /api/pickups` with `pickup_type: 'flagging'`, navigates to S-06.
  - Pickup journey: primary button "Set as Pickup Matatu" → creates pickup via `POST /api/pickups` with `pickup_type: 'flagging'`, navigates to S-07.

**Error handling:** On 409 "not enough seats": toast "No seats available at this stop". On 409 "trip is not active": toast "This matatu is no longer available", navigate to S-02.

---

### S-05 — Booking: From
**Layout:** Header. Scrollable content. No bottom nav.

**Header:** Back → S-03. Title "Schedule a ride".

**Content (16px padding):**
- From input: placeholder "Pickup stop", filters to defined stops on keystroke.
- Primary button: "Next →" — navigates to S-08 (Booking: Date & Time).

---

### S-06 — Flagging Waiting
<!-- EDIT v2.2: Pick Me Up decoupled from boarding flow. Accepted now shows monitoring screen, not boarding confirm. Pick Me Up is an optional priority signal throughout. -->
**Layout:** Header. Map. Scrollable content. No bottom nav.

**Header:** Back → S-04. Title "Waiting for pickup". Orange "Live" badge right.

**Map:** 240px tall. Shows route line, moving matatu dot (Poll 1 active), and rider dot (pulsing blue) at the preconfigured from stop.

**Content (12px padding):**
- Proximity banner — updates on each Poll 2 response:
  - `alert_level = none`: blue info banner "You are visible to drivers — waiting for a matatu."
  - `alert_level = approaching`: orange warning banner "📍 Matatu 1.5 km away — start making your way to the road."
  - `alert_level = near`: red warning banner "🚨 Matatu 500m away — be at your stop now." Countdown timer appears below banner (counts down from 2 minutes).
- Trip summary card: grey surface. Plate + sacco 12px `#888`. Status line: "Waiting for driver to accept" (pending) or "Driver accepted — matatu is on its way" (accepted).
- **"Pick Me Up! 🙋" button** (primary, floating): visible at all times after pickup is created. Optional — tapping signals the driver that the rider can see the matatu. Button changes to "Signalled ✓" (disabled, green tint) after tap. Cannot be tapped twice. Does NOT gate boarding.
- **"I'm On Board ✓" button** (primary): appears only after `status = accepted`. Tapping calls `PATCH /api/pickups/:id/board` and navigates to S-10 (Live Trip) on success.
- Cancel button (secondary): "Cancel request" — calls `PATCH /api/pickups/:id/cancel`, stops polls, navigates to S-02.

**Poll behaviour:** Poll 2 runs throughout. `status = accepted` updates the status line and reveals the "I'm On Board" button — does NOT navigate away. Terminal statuses handled per polling contract.

**Countdown:** Starts when `alert_level = near`. Visible countdown from 2:00 to 0:00. On expiry: driver is at liberty to leave. Rider remains on screen.

---

### S-07 — Pickup Waiting
<!-- EDIT v2.2: Pick Me Up required at alert_level=near (I'm here signal). Accepted shows monitoring screen with I'm On Board button. -->
**Layout:** Header. Map. Scrollable content. No bottom nav.

**Header:** Back → S-04. Title "Monitoring matatu". Blue "Active" badge right.

**Map:** 220px. Shows route line, moving matatu dot (Poll 1 active), and red pin at rider's selected from stop.

**Content (14px padding):**
- Status card: blue surface. Pin emoji + "Waiting at {stop name}" 13px/700 + "Monitoring {plate} · {sacco}" 12px `#888`.
- Proximity banner:
  - `alert_level = none`: blue info banner "Monitoring matatu — head to your stop when it gets close."
  - `alert_level = approaching`: orange warning banner "📍 Matatu 1.5 km away — start making your way to the road."
  - `alert_level = near`: red banner + countdown starts + **"Pick Me Up! 🙋" button appears** (required signal — rider must tap to confirm they are at the stop). Same single-tap confirmation behaviour as S-06.
- **"I'm On Board ✓" button** (primary): appears only after `status = accepted`. Tapping calls `PATCH /api/pickups/:id/board` and navigates to S-10 on success.
- Cancel button (secondary): "Cancel monitoring" — cancel pickup, navigate to S-01.

**Poll behaviour:** Poll 2 runs throughout. `status = accepted` updates the status card and reveals the "I'm On Board" button — does NOT navigate away. Same terminal status handling as S-06.

---

### S-08 — Booking: Date & Time
**Layout:** Header. Scrollable content. No bottom nav.

**Header:** Back → S-05. Title "Schedule a ride".

**Content (16px padding):**
- Date input: date picker.
- Departure time grid: 3-column chip grid, one selectable at a time. Time slots are active trips on the selected route departing within the selected date.
- Primary button: "Find available matatus →" — navigates to S-02 variant (Booking matatu list). Enabled only when date and time are selected.

---

### S-09 — Boarding Confirm
<!-- EDIT v2.2: S-09 is now reached when rider taps "I'm On Board" on the monitoring screen (S-06/S-07), not automatically on driver acceptance. Driver acceptance only unlocks the I'm On Board button. -->
**Layout:** Centred column, 20px padding. No map. No bottom nav.

**Components:**
- Bus emoji in 72px blue `#e8f0ff` circle.
- Title "Driver accepted!" 20px/700.
- Subtitle "{plate} is stopping for you. Board and confirm." 14px `#888`.
- Green success banner: "✓ Driver: {driver name} confirmed your request."
- Summary card (grey surface): Matatu / Destination / Fare.
- Primary button: "I'm On Board ✓" — calls `PATCH /api/pickups/:id/board`. On success navigates to S-10.
- Danger button: "Not my matatu" — calls `PATCH /api/pickups/:id/cancel`, navigates back to S-06 or S-07 depending on active journey.
- 3-minute background countdown. On expiry: cancel pickup, show toast "Boarding window expired", navigate back to waiting screen.

---

### S-10 — Live Trip
**Layout:** Compact header. Large map. Stats strip. Progress row. No bottom nav.

**Header (14px padding):** "En route to" 12px `#888` + destination 17px/700 left. Green pulsing "● Live" badge right.

**Map:** 300px tall. Shows full route line (faded for completed portion), stop dots, and moving matatu dot with "You're here" label. Poll 1 continues.

**Stats strip:** Three equal columns separated by 1px dividers: mins left / km away / fare.

**Progress row (12px padding):**
- "Next stop: {stop name}" 13px/700.
- Progress bar: blue fill advances with `current_step`.
- Danger button: "End trip / I've arrived" → S-11.

---

### S-11 — Trip Ended
**Layout:** Centred column, 20px padding. No bottom nav.

**Components:**
- Checkered flag emoji 🏁 in 72px green `#e6f6ee` circle.
- Title "You've arrived!" 20px/700.
- Subtitle: destination + arrival time 14px `#888`.
- Summary card (grey surface): Route / Duration / Matatu / Fare paid.
- Primary button: "Back to home" → S-01.

**Behaviour on enter:** Stop Poll 1. Clear `RiderState.activePickup` and `selectedTrip`.

---

### S-12 — Booking: Seat Count
**Layout:** Header. Scrollable content. No bottom nav.

**Header:** Back → S-08 matatu list. Title "How many seats?".

**Content (16px padding):**
- Selected matatu summary card: grey surface. Plate / Sacco / Departure time / Fare per seat.
- Seat count control: minus button (secondary, 40px square) + numeric input (centre, 20px/700, editable directly) + plus button (secondary, 40px square). Min 1, max 30. Stepper increments/decrements by 1. Direct input clamped to 1–30 on blur.
- Total fare display: "KSh {fare × seats} total" 16px/700 right-aligned, updates live as seat count changes.
- Primary button: "Review & Confirm →" → S-13.

---

### S-13 — Booking: Confirm
**Layout:** Header. Scrollable content. No bottom nav.

**Header:** Back → S-12. Title "Confirm booking".

**Booking summary card (blue-bordered `#c0d0ff`, `#f7f9ff` background):**
- "Booking summary" label 11px `#888`.
- Route title 15px/700.
- Divider.
- Rows: Matatu / Sacco / Date / Departure / Pickup stop / Pickup window / Seats.
- Divider.
- Total fare row: bold label + blue value 16px/700.

**Info banner (blue):** "You'll be notified when the matatu starts its trip and again when it's approaching your stop."

**Buttons:**
- Primary: "Confirm Booking ✓" — calls `POST /api/pickups` with `pickup_type: 'reservation'`. On 201 navigates to S-14.
- Secondary: "Edit" → S-12.

**Error handling:** On 409 show inline error with message from API response.

---

### S-14 — Booking: Success
**Layout:** Centred column, 20px padding. No bottom nav.

**Components:**
- Green checkmark ✓ in 72px green `#e6f6ee` circle.
- Title "Booking confirmed!" 20px/700.
- Subtitle "Head to My Trips to monitor your ride." 14px `#888`.
- Booking summary card: Booking ID large blue 28px/800 centred (e.g. #SMA-4721). Rows: Matatu / Pickup stop / Window / Seats / Fare.
- Primary button: "Back to home" → S-01.
- Secondary button: "View my trips" → S-15.

---

### S-15 — My Trips
**Layout:** Fixed header. Scrollable content. Fixed bottom nav.

**Header (16px padding):** Title "My trips" 20px/700. Filter chips: All / Active / Upcoming / Past.

**Content (16px horizontal padding):**
- **Active section** — bookings where the linked trip is now active. Blue-bordered card. Shows route, matatu, pickup stop, pickup window, countdown to window if applicable. Tapping navigates to S-04 (Matatu Detail) to re-enter the monitoring flow.
- **Upcoming section** — confirmed bookings for future trips not yet active. Blue-bordered card. Route / date / time / plate / seats / fare / booking ID badge.
- **Past section** — all ended pickups. Standard bordered card. Route / date / status badge (green Completed, red No-show, orange Cancelled) / plate / fare.

**Bottom nav:** Trips tab active.

---

### S-16 — Profile
**Layout:** Fixed header. Scrollable content. Fixed bottom nav.

**Header (24px padding, centred):**
- Avatar 72px circle, initials, blue background.
- Name 18px/700. Phone 13px `#888`.
- Badges: "Verified ✓" blue + "{n} trips" green.

**Content (16px horizontal padding):**
- Settings list card (grey surface): Personal info / Notifications / Saved places / Help & support — each a tappable row with chevron. Placeholder for MVP.
- Sign out button (secondary): calls `POST /api/auth/logout`, clears `RiderState`, stops all polls, navigates to S-00.

**Bottom nav:** Profile tab active.

---

## Component Reference

| Component | Screens |
|---|---|
| Matatu Card | S-02, S-08 matatu list |
| Proximity banner + countdown | S-06, S-07 |
| Pick Me Up button | S-06 (immediate), S-07 (at alert_level = near only) |
| Booking summary card | S-13, S-14, S-15 |
| Bottom nav (3-tab) | S-01, S-15, S-16 |
| Mapbox map area | S-02, S-04, S-06, S-07, S-10 |

---

## Journey Entry Point Summary

| Journey | Entry point | From location |
|---|---|---|
| Flagging | Quick Trip on Home | Auto — per-route origin stop (simulation) / current location (live). Not editable. |
| Pickup | Search bar on Home or Recent route row | Rider selects from defined stops. Editable. |
| Booking | Schedule Ride on Home | Rider selects from defined stops. Editable. |

---

## What Is Removed vs Prototype

| Prototype element | Status | Reason |
|---|---|---|
| Splash screen | Removed | Replaced by Login |
| Registration form | Removed | Onboarding skipped — phone login only |
| OTP verification | Removed | Skipped for MVP |
| Seat picker grid | Removed | Seat count only, no specific seat selection |
| Search tab in bottom nav | Removed | Search accessed via home bar or Quick Trip |
| Rating prompt | Removed | Ratings not in MVP schema |
| "Flag me now" label | Renamed | "Flag Matatu" on Flagging journey, "Set as Pickup Matatu" on Pickup journey |

*End of Sema Rider UI Specification v2.1*
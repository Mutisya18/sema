# Sema — Driver UI Specification
Version: 1.0
Scope: Screen layout, components, interactions, and navigation for the driver frontend. No implementation detail. All screens live in driver.html as hidden divs; only one is visible at a time.

---

## Design Language

**Colours:** Primary green `#0d7a3e`. Background `#fff`. Surface grey `#f8f8f8`. Border `#f0f0f0`. Text primary `#111`. Text secondary `#888`.
**Typography:** System sans-serif. Screen titles 20px/700. Section labels 12px/400 `#888`. Body 14px/400.
**Radius:** Cards 14px. Buttons 12px. Chips 20px. Inputs 10px.
**Buttons:** Primary — green fill `#0d7a3e`, white text. Secondary — `#f2f2f2` fill, `#333` text. Outline — white fill, green border and text. Danger — `#ff3b30` fill, white text. All full-width unless noted, 14px padding, 15px/600.
**Badges:** Green `#e6f6ee / #0a7a3e`. Blue `#e8f0ff / #1a5cff`. Orange `#fff3e0 / #d06000`. Red `#ffe8e8 / #d00`. Grey `#f2f2f2 / #666`.
**Alert banners:** Full-width coloured blocks, 12px padding, 10px radius. Orange for warnings, blue for info, green for success, red for errors.
**Toasts:** Dark `#111` pill, bottom of screen above nav, 13px/500, auto-dismiss 2.5s.
**Bottom nav:** 4 tabs — Home, Live Trip, History, Profile. Active tab in `#0d7a3e`. Inactive in `#bbb`. When a trip is active and the driver is on any other tab, the Live Trip tab shows a small green pulsing dot badge on its icon.
**Map areas:** Rendered by Mapbox GL JS. Shown as green-tinted placeholder in prototype.

---

## Rider Dot Colour System

All rider dots appear on the driver's map. Colour indicates status.

| Dot colour | Meaning |
|---|---|
| Orange | Flagging rider — pending, not yet spotted matatu |
| Blue | Booking rider — pending, not yet spotted matatu |
| White (with coloured ring) | Any rider who has tapped "Pick Me Up" — spotted the matatu |
| Dimmed / faded | Accepted rider — boarding confirmed, about to be removed |

White dot with a coloured ring (orange ring for flagging, blue ring for booking) is used for spotted riders. This draws maximum attention on the green map background.

---

## Rider Card States

Rider cards appear in the feed on the active trip screen and cluster view. Sort order from top to bottom:

1. Spotted riders (tapped Pick Me Up) — regardless of journey type
2. Booking riders — pending or accepted, not yet spotted
3. Flagging riders — pending or accepted, not yet spotted

**Spotted card style:** Darker border `#0d7a3e`, tinted background `#f0faf4`, green "Spotted ✓" badge. Card sits at top of feed.
**Booking card style:** Blue border `#a8c0ff`, background `#f7f9ff`, blue "Booking ★" badge.
**Flagging card style:** Default border `#f0f0f0`, white background, orange "Flagging" badge.
**Accepted card style:** Same as base type but with green "Accepted ✓" badge replacing action buttons, dimmed slightly.
**Completed card style:** Green background `#f0faf4`, green border, "Boarded ✓" label. Removed from feed after 3 seconds.
**No-show card style:** Red tint `#fff8f8`, red border, "No-show" label. Removed after 3 seconds.

---

## Navigation Structure

```
Login
  └─► Home
        └─► Start Trip Form
              ├─► (Saved trip tapped) → pre-filled form → Active Trip
              └─► (New trip) → Active Trip
                    ├─► Paused Trip → Active Trip
                    ├─► Cluster View → Active Trip
                    ├─► Pickup Confirm → Active Trip
                    ├─► Reject Rider → Active Trip
                    └─► End Trip Summary → Home or Start Trip Form

Bottom nav (always):
  Home | Live Trip (badge when active) | History | Profile
```

---

## Screens

### D-00 — Login
**Route:** `/driver` (initial load, no session)

**Layout:** Full-screen green `#0d7a3e` background. Centred column, 40px padding.

**Components:**
- App icon: 72×72px white rounded square, matatu SVG in green.
- App name: "Sema" 32px/800 white, letter-spacing -1px.
- Tagline: "Driver portal" 14px white 70% opacity.
- Sub-label: "For matatu operators" — small pill, white 15% opacity background.
- Phone input: white background, placeholder "+254 7XX XXX XXX".
- Login button: white fill, green text, label "Sign in →".
- Inline error state below input: "Phone number not found" in red.

**Behaviour:**
- On submit: call `POST /api/auth/login` with `{phone, role: 'driver'}`.
- On 200: populate `DriverState.user`, navigate to Home.
- On 404: show inline error.

---

### D-01 — Home
**Layout:** Scrollable content. Fixed bottom nav. 80px bottom padding.

**Header (16px top, 20px sides):**
- Left: "Good morning," 13px `#888` + driver name + wave emoji 20px/700.
- Right: 40px avatar circle, initials, green `#e6f6ee` background.

**Active trip banner:** If `DriverState.activeTrip` is not null on enter, show a green info banner at the top: "You have an active trip — {route name}." with a "Back to trip →" link that navigates to D-04.

**Content (20px horizontal padding):**

Start a Trip button — large primary button, full width, 18px/700, 18px padding, label "Start a trip 🚍". Navigates to D-02.

Today's bookings section — label "Today's bookings" 14px/700. One booking card per active booking assigned to this driver for today's trips. Each card: blue-bordered `#dce6ff`, `#f7f9ff` background. Rider name 14px/700 + stop name + pickup window 12px `#888`. Route + booking ID 12px `#888`. Seat count badge blue right. If no bookings: "No bookings for today" 13px `#888`.

**Bottom nav:** Home tab active.

---

### D-02 — Start Trip Form
**Layout:** Header. Scrollable content. No bottom nav.

**Header:** Back → D-01. Title "Set up trip".

**Saved trips section (shown above the form):**
Label "Your saved trips" 13px/700 `#888`. Horizontal scroll row of saved trip chips. Each chip shows route name (e.g. "CBD → Thika"). Tapping a chip pre-fills the entire form below — route, all stops, fare — and scrolls down to the form. Driver can edit any field before starting.

**Trip builder form (16px padding):**

Route start and destination — two constrained inputs at top and bottom of the stop stack. In simulation, both filter to defined route stops on keystroke. Labels: "Start (Terminus A)" and "Destination (Terminus B)".

Stop stack — vertical list between Start and Destination. Each stop entry is a row: constrained text input (filters to available stops on keystroke) + remove button (✕, 32px, grey). In simulation, available stops are the predefined stops for the route defined by the selected Start + Destination pair. The order the driver enters stops does not affect the trip — the simulator always follows the predefined coordinate order regardless.

"+ Add Stage" button — appears below the last added stop, above Destination. Tapping inserts a new empty stop input row. After the driver selects a stop in the new row, a fresh "+ Add Stage" button appears below it. There is no limit to stages for MVP.

Fare input — label "Fare (KSh)", numeric input, centre-aligned 18px/700.

Seats input — label "Available seats", stepper: minus button (36px square) + count display 20px/800 + plus button. Min 1, max 30. No direct text edit — stepper only.

Save trip toggle — label "Save this trip for later", toggle switch. Off by default. When on, this trip configuration is saved and appears in the saved trips section next time.

Begin trip button — primary, full width, 16px/700, label "Begin trip 🚍". Calls `POST /api/trips`. On 201: set `DriverState.activeTrip`, navigate to D-04. On 409 "driver already has an active trip": toast "You already have an active trip", navigate to D-04.

**Validation inline errors:**
- No start selected: "Please select a start point"
- No destination selected: "Please select a destination"
- Start equals destination: "Start and destination cannot be the same"
- No fare entered: "Please enter a fare"
- Fare not positive: "Fare must be a positive number"

---

### D-03 — Reject Rider
**Layout:** Centred column, 24px padding. No bottom nav.

**Components:**
- Red ✕ in 72px red `#ffe8e8` circle.
- Title "Reject this rider?" 20px/700.
- Subtitle: "{rider name} will be notified." 14px `#888`.
- Summary card (grey surface): Rider name / Journey type / Stop.
- Danger button: "Confirm rejection" — calls `PATCH /api/pickups/:id/reject`. On success: navigate to D-04, show toast "{rider name} rejected."
- Secondary button: "Cancel" → D-04.

**Notes:** No reason selector — rejection reason is not stored for MVP.

---

### D-04 — Active Trip
**Layout:** Fixed header. Map. Scrollable feed. Fixed bottom nav.

**Header (10px top, 16px sides):**
- Left: route name 12px `#888` + "Active trip" 16px/700.
- Right: seats remaining label 10px `#888` + seat count 24px/800 green. Below seat count: two explicit buttons side by side — "Pause trip" (secondary, small) and "End trip" (danger, small). "Pause trip" calls `PATCH /api/trips/:id/pause`, navigates to D-05. "End trip" — see end trip flow below.

**Map (300px tall):**
- Shows full route line in green.
- Driver dot: 20px green circle with white border, labelled "You" in green pill.
- Rider dots per colour system above. Tapping a dot opens an inline popup showing rider name, journey type, destination, and Accept / Reject buttons.
- Cluster circles: shown when 2+ rider dots are within close proximity at the same stop. Orange circle for flagging clusters, blue for booking clusters. Number inside shows count. Tapping navigates to D-06 (Cluster View) filtered to that stop.
- Map legend (bottom-left corner, white pill): Flagging (orange) / Booking (blue) / Spotted (white) / You (green).
- Proximity banner overlaid at top of map when a booking stop is approaching: "🔵 Reserved pickup in {n} km — {rider name} · {stop name}".

**Feed (below map, scrollable):**
- "Incoming requests" label 13px/700 `#111`.
- One rider card per active pickup on this trip. Sort order: spotted first, then booking, then flagging. Within each group, sorted by distance to driver (closest first).
- Each card has Accept and Reject buttons. Accept calls `PATCH /api/pickups/:id/accept`. Reject navigates to D-03 with that pickup stored in state.
- Spotted cards (white dot, tapped Pick Me Up): darker green border `#0d7a3e`, `#f0faf4` background, "Spotted ✓" green badge. These sit at the very top.
- Booking cards: blue border, `#f7f9ff` background, "Booking ★" blue badge. Shows pickup window below rider name. When `alert_level = near` for this rider's stop, the card expands to show: pickup window countdown (counts down from 2:00, updates every second, "Pickup window expired" in red on expiry), "Confirm boarding" primary button, and "No-show" reject-style button. Driver can still confirm boarding after window expires. On "Confirm boarding": calls `PATCH /api/pickups/:id/board`, card updates to completed style, removed after 3 seconds, seat counter decrements. On "No-show": calls `PATCH /api/pickups/:id/reject`, card updates to no-show style, removed after 3 seconds, toast "Seat freed."
- Flagging cards: default border, "Flagging" orange badge.

**End trip flow from header button:**
- If any pickups have status pending or accepted: show confirmation dialog "You have {n} riders who haven't boarded. End trip anyway?"
- On confirm: call `PATCH /api/trips/:id/end`. On success: stop Poll 1 and Poll 3, navigate to D-07.
- If no pending/accepted pickups: call end trip directly, navigate to D-07.

**Poll behaviour:** Poll 1 (GPS) and Poll 3 (riders) both run while this screen is active. Diff logic applied to rider cards on every Poll 3 response — no full re-render.

**Bottom nav:** Live Trip tab active, no badge (already on this screen).

---

### D-05 — Paused Trip
**Layout:** Fixed header. Map. Content. Fixed bottom nav.

**Header:** Same as D-04 header. "Pause trip" button replaced by "Resume trip" (primary, small). "End trip" danger button remains.

**Map (260px):** Route line rendered in dashed grey. Driver dot grey. Rider dots remain visible. No movement animation.

**Content (16px padding):**
- Orange warning banner: "⏸ You are paused — riders cannot see your matatu. Tap Resume to continue."
- Resume trip button (primary, full width): calls `PATCH /api/trips/:id/resume`. On success: update `DriverState.activeTrip.status`, navigate to D-04.
- End trip button (danger, full width): same end trip flow as D-04.

**Poll behaviour:** Poll 1 and Poll 3 continue running while paused. Matatu dot stops moving (server not advancing). Rider dots remain live.

**Bottom nav:** Live Trip tab active.

---

### D-06 — Cluster View
**Layout:** Header. Map. Scrollable feed. No bottom nav.

**Header:** Back → D-04. Title "{n} riders at {stop name}".

**Map (160px):** Zoomed in to the cluster stop. Individual rider dots visible (no cluster circle at this zoom). Driver dot shown with distance label "You ({n} km)".

**Feed (14px padding):**
- Label: "All riders · {stop name}" 13px `#888`.
- One rider card per rider in the cluster. Same card styles and sort order as D-04 feed. Accept navigates back after a short delay. Reject navigates to D-03.
- No "Navigate" button — dropped for MVP.

---

### D-07 — End Trip Summary
**Layout:** Centred column, 24px padding. No bottom nav.

**Components:**
- Checkered flag 🏁 in 72px green `#e6f6ee` circle.
- Title "Trip complete!" 20px/700.
- Subtitle: route name + time range 14px `#888`.
- 2×2 stat grid (grey surface cards): Total pickups / Duration / — / — . Earnings and distance dropped for MVP.
- Bookings summary card (green-bordered `#c0e8d0`, `#f0faf4` background):
  - Label "Bookings this trip" 13px/700 green.
  - One row per booking pickup: "✓ {rider name} — {stop name} ({n} seats)" for completed. "✗ {rider name} — no-show (seat freed)" for no-shows. Greyed out text for no-shows.
  - If no bookings: "No bookings on this trip" 13px `#888`.
- Primary button: "Back to home" → D-01.
- Secondary button: "Start another trip" → D-02.

**Behaviour on enter:** Stop Poll 1 and Poll 3. Clear `DriverState.activeTrip`. Clear `DriverState.riders`. Clear all map markers.

---

### D-08 — Trip History
**Layout:** Fixed header. Scrollable content. Fixed bottom nav.

**Header (16px padding):** Title "Trip history" 20px/700.

**Content (16px horizontal padding):**
- Trip cards grouped by day. Day label in 12px/700 `#aaa` uppercase.
- Each card: route name 14px/700 + time range + duration 12px `#888`. Status badge green "Completed". Pickup count 13px `#888` left. No earnings shown for MVP.
- Tapping a card navigates to D-07 (End Trip Summary) loaded with that trip's data.

**Bottom nav:** History tab active.

---

### D-09 — Profile
**Layout:** Fixed header area. Scrollable content. Fixed bottom nav.

**Header (24px padding, centred):**
- Avatar 72px circle, initials, green `#e6f6ee` background.
- Name 18px/700. Phone 13px `#888`.
- Badges row: "Approved ✓" green + plate number grey + sacco grey.

**Content (16px horizontal padding):**
- Settings list card (grey surface): Matatu details / Notifications / Help & support — each a tappable row with chevron. Placeholder for MVP.
- Sign out button (secondary): calls `POST /api/auth/logout`, clears `DriverState`, stops all polls, navigates to D-00.

**Bottom nav:** Profile tab active.

---

## Component Reference

| Component | Screens |
|---|---|
| Rider card (all states) | D-04, D-06, D-08 |
| Rider dot + popup | D-04, D-06 |
| Cluster circle | D-04 |
| Stop stack builder | D-02 |
| Saved trip chips | D-02 |
| Proximity banner | D-04 |
| Pickup window countdown | D-04 (on booking card at alert_level = near) |
| Booking summary card | D-07 |
| Bottom nav (4-tab + badge) | D-01, D-04, D-05, D-09, D-10 |
| Mapbox map area | D-04, D-05, D-06, D-08 |

---

## Rider Journey Mapping — Driver Perspective

| Rider journey | Driver sees |
|---|---|
| Flagging | Orange dot on map. Orange "Flagging" card in feed. Accept / Reject actions. |
| Pickup | Orange dot on map (same pickup_type). Orange "Flagging" card. Same actions. |
| Booking | Blue dot on map. Blue "Booking ★" card with pickup window shown. |
| Any rider taps Pick Me Up | Dot turns white with coloured ring. Card moves to top of feed with "Spotted ✓" green style. |

---

## What Is Removed vs Prototype

| Prototype element | Status | Reason |
|---|---|---|
| Splash screen | Removed | Replaced by Login |
| Registration form | Removed | Onboarding skipped — phone login only |
| Pending approval screen | Removed | Admin approval skipped for MVP |
| Approved notification screen | Removed | Skipped for MVP |
| Password field on login | Removed | Phone only, consistent with rider |
| Rejection reason chips | Removed | Not stored in MVP schema |
| Seat numbers on cards | Removed | Seat count only, no specific seats |
| Earnings display | Removed | Not in MVP schema |
| Rating display | Removed | Not in MVP schema |
| "Navigate to Point D" button | Removed | No GPS navigation for MVP |
| Notifications screen | Removed | Replaced by inline banners and toasts |
| Pickup Confirm screen | Removed | All confirm/no-show actions moved to booking card on D-04 at alert_level = near |
| Free-text pit stop inputs | Replaced | Constrained stop stack from route config |

*End of Sema Driver UI Specification v1.0*
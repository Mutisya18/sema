# Sema — Map Initialisation Specification
Version: 1.0
Scope: Covers every map instance in both frontends — how each is created, what layers and controls are added, how markers are managed, how errors are handled, and what changes between simulation and live maps. No visual design, no CSS.

---

## 1. Shared Rules (Both Frontends)

### One instance per map container
Each screen that contains a map has exactly one Mapbox GL JS map instance. The instance is created the first time that screen is entered and stored in `RiderState.map` or `DriverState.map`. If the screen is re-entered, the existing instance is reused — it is never destroyed and recreated during a session. If the page is reloaded, the instance is lost and recreated on next entry.

### Token
The Mapbox token is read from the global JS variable `MAPBOX_TOKEN` injected by Flask at render time. It is set as `mapboxgl.accessToken = MAPBOX_TOKEN` once, at the top of `rider.js` and `driver.js`, before any map is initialised. It is never set per-map-instance.

### Map style
Both maps use the Mapbox Streets style: `mapbox://styles/mapbox/streets-v12`. This is hardcoded. No style switching for MVP.

### Controls
Every map instance has exactly one control added: the Mapbox `NavigationControl` (zoom in, zoom out, compass). It is added to the top-right corner of the map container. No other controls are added — no geolocate button, no scale bar, no fullscreen.

### Tile load failure
If Mapbox tiles fail to load (bad token, no internet, Mapbox service error), the map fires an `error` event. On that event, show an inline error banner within the map container: **"Map unavailable — check your connection"**. The banner overlays the empty map container. No other action is taken — polls continue running, the rest of the screen remains functional.

### Map resize
When a screen containing a map becomes visible via `showScreen()`, call `map.resize()` immediately after the container becomes visible. This corrects rendering issues that occur when Mapbox is initialised inside a hidden `div`.

### Coordinate format
Mapbox GL JS uses `[longitude, latitude]` order everywhere — in `LngLat` objects, in GeoJSON sources, and in `setLngLat()` calls. All coordinate data from `gps.py` and the API is stored and passed as `{lat, lng}` objects. Every map call must reverse to `[lng, lat]` at the point of use.

---

## 2. Map Instances

There are four distinct map contexts across the two frontends. Each has its own initial view, layers, and update logic.

| Map | File | Screen(s) | Stored in |
|-----|------|-----------|-----------|
| Rider search map | rider.js | Search screen | RiderState.map |
| Rider tracking map | rider.js | Matatu detail, Waiting, Boarding confirm, Live trip | RiderState.map (same instance, reused) |
| Driver active trip map | driver.js | Active trip, Paused trip, Cluster view, Pickup confirm | DriverState.map |

The rider uses one map instance across all post-search screens. The driver uses one map instance across all active-trip screens.

---

## 3. Rider Search Map

### When it is initialised
On first entry to the search screen.

### Initial view
- Centre: Nairobi city centre — `[-1.2921, 36.8219]` (lat/lng), passed as `[36.8219, -1.2921]` to Mapbox
- Zoom: 11
- No route line on initialisation — route line is added when a route is selected

### What is added on initialisation
- `NavigationControl` — top-right

### What is added when a route is selected
When the rider selects a route from the selector, the following are added to the map. If a previous route was selected, its layers and sources are removed before adding the new ones.

**Route line source and layer**
- Source id: `route-line`
- Source type: GeoJSON
- Data: a GeoJSON `LineString` built from the selected route's `coordinates` array (from in-memory route data)
- Layer id: `route-line-layer`
- Layer type: `line`
- Paint: solid line, medium weight

**Stop markers**
- One `mapboxgl.Marker` per stop in the selected route's `active_stops` array
- Positioned at each stop's `[lng, lat]`
- Each marker has a popup showing the stop name — popup opens on click
- Stored in a local array so they can be removed when the route changes

**Matatu dot markers**
- One `mapboxgl.Marker` per trip returned by `GET /api/trips?route_id=...`
- Positioned at each trip's `current_lat`, `current_lng`
- Styled distinctly from stop markers
- Each marker has a popup showing driver name, plate, sacco, fare, seats available — popup opens on click
- Tapping the marker is equivalent to tapping the trip card — sets `RiderState.selectedTripId` and navigates to matatu detail screen
- Stored in a local array so they can be removed when the route changes or the screen is exited

### Fit bounds
After adding the route line and markers, call `map.fitBounds()` using the bounding box of the route's coordinate array, with padding of 40px on all sides. This frames the entire route in view.

### Cleanup on exit
When the rider navigates to the matatu detail screen, the matatu dot markers and stop markers remain on the map — the same map instance is reused on the detail screen. The search-specific cleanup (removing trip dots for unchosen trips) happens on detail screen entry.

---

## 4. Rider Tracking Map

This is the same map instance as the search map, reused from the matatu detail screen onward.

### On matatu detail screen entry
- Remove all trip dot markers except the one for `RiderState.selectedTripId`
- Ensure the route line for the selected trip's route is rendered (it will already be present from the search screen)
- Ensure stop markers for the selected trip's active stops are rendered
- Centre the map on the matatu's current position: `map.easeTo({center: [lng, lat], zoom: 14})`
- The matatu dot marker for the selected trip remains and becomes the tracked dot going forward

### Layers present during tracking
All of the following are present from matatu detail through to live trip screen:

| Layer | Description |
|-------|-------------|
| Route line | Full GeoJSON LineString for the selected route — static, never changes |
| Stop markers | One marker per active stop on the selected trip |
| Matatu dot | One marker — moves on every GPS poll response |
| Pickup marker | One marker at the rider's selected stop — added when rider selects a stop |

### Matatu dot movement (interpolation)
The matatu dot does not snap to new positions. It interpolates smoothly between its previous position and the new position over the 5-second poll interval.

Implementation:

1. On each GPS poll response, record `previousPosition` (current marker position) and `targetPosition` (new `current_lat`, `current_lng` from response)
2. Record `animationStartTime = Date.now()`
3. Start a `requestAnimationFrame` loop
4. On each frame, compute `progress = (Date.now() - animationStartTime) / 5000`, clamped to 1.0
5. Compute interpolated position: `lat = previousPosition.lat + (targetPosition.lat - previousPosition.lat) * progress`, same for `lng`
6. Call `marker.setLngLat([interpolatedLng, interpolatedLat])`
7. If `progress < 1.0`, continue the loop. If `progress >= 1.0`, stop the loop.
8. When the next poll response arrives, cancel any running animation frame loop and start a new one from the current marker position

On poll error: do not move the dot. Do not start a new animation. The dot stays at its last known position until the next successful response.

On `status = paused`: stop the animation loop. The dot stays at its current position. Keep polling.

On `status = ended`: stop the animation loop. Stop polling.

### Pickup marker
- Added when the rider selects a stop (on the flagging screen, pickup spot screen, or reservation screen)
- Positioned at the selected stop's `[lng, lat]` from in-memory route data
- Styled distinctly from stop markers and the matatu dot
- Popup shows the stop name
- Stored in `RiderState.pickupMarker` — replaced (not duplicated) if the rider changes their selected stop
- Removed when `RiderState.activePickup` is cleared (pickup reaches terminal status or logout)

### Zoom on waiting screen entry
When the rider enters the waiting screen, call `map.fitBounds()` using the bounding box that contains both the matatu's current position and the rider's pickup marker, with 80px padding. This keeps both dots in view.

### Zoom on live trip screen entry
When the rider enters the live trip screen (after boarding), remove the pickup marker. Call `map.easeTo({center: [matatu_lng, matatu_lat], zoom: 14})`.

### Cleanup on trip end
When the trip ends and the rider navigates to the trip ended screen:
- Stop the animation loop
- Remove all markers
- Remove the route line layer and source
- Do not destroy the map instance

---

## 5. Driver Active Trip Map

### When it is initialised
On first entry to the active trip screen, after `POST /api/trips` succeeds.

### Initial view
- Centre: the first coordinate of the trip's route (the route origin) — this is `activeTrip.current_lat`, `current_lng` at trip start
- Zoom: 13

### Layers present during active trip

| Layer | Description |
|-------|-------------|
| Route line | Full GeoJSON LineString for the trip's route — static |
| Active stop markers | One marker per stop in `activeTrip.active_stops` |
| Driver dot | One marker — the driver's own matatu position, moves on GPS poll |
| Rider dots | One marker per active pickup — added and removed dynamically by Poll 3 diff logic |

### Route line
- Source id: `route-line`
- Source type: GeoJSON
- Data: GeoJSON `LineString` built from the trip's route `coordinates` array
- Layer id: `route-line-layer`
- Added once on map initialisation. Never updated during the trip.

### Active stop markers
- One `mapboxgl.Marker` per stop in `activeTrip.active_stops`
- Positioned at each stop's `[lng, lat]`
- Popup shows stop name and current `seats_available_at_stop` (read from the trip object at initialisation — updated when Poll 3 diff detects seat count changes)
- Stored in a local array

### Driver dot
- One `mapboxgl.Marker` positioned at `activeTrip.current_lat`, `current_lng`
- Styled distinctly — the driver's own dot is visually different from rider dots
- Stored in `DriverState.matutMarker`
- Moves using the same interpolation logic as the rider tracking map (section 4)
- On `status = paused`: stop animation, dot stays in place
- On `status = ended`: stop animation, stop polling

### Rider dots
Rider dots are managed by the Poll 3 diff logic. The diff compares the new `riders` array against `DriverState.lastRidersSnapshot` on every poll cycle.

**Adding a new dot**
- When a `pickup_id` appears in the new array that was not in the snapshot:
  - Create a `mapboxgl.Marker`
  - Position at `pickup_lat`, `pickup_lng`
  - Style: orange for `pickup_type = flagging`, blue for `pickup_type = reservation`
  - Popup shows rider name, stop name, seats requested, pickup type
  - Register in `DriverState.riderMarkers[pickup_id]`

**Updating an existing dot**
- When a `pickup_id` exists in both arrays but `status` has changed:
  - `accepted` → no dot change, update popup content
  - `completed` → remove dot immediately, update feed card, remove card after 3 seconds
  - `rejected` → remove dot immediately, remove feed card immediately
  - `cancelled` → remove dot immediately, remove feed card immediately, show toast
  - `no_show` → remove dot immediately, update feed card to no-show state, remove card after 3 seconds

**Removing a dot**
- Call `DriverState.riderMarkers[pickup_id].remove()`
- Delete `DriverState.riderMarkers[pickup_id]`

**No re-render if unchanged**
- If `pickup_id` and `status` are identical to the snapshot, skip entirely — no DOM or map update

### Cluster view
When the driver taps a stop marker that has two or more rider dots within 100m of each other:
- Call `map.easeTo({center: [stop_lng, stop_lat], zoom: 16})`
- The individual rider dots are already on the map — zooming in reveals them
- No special cluster layer is needed — the zoom level separates dots that appeared overlapping at zoom 13
- Render the rider cards for that stop in the feed panel

### Fit bounds on initialisation
After adding all initial layers, call `map.fitBounds()` using the bounding box of the route's coordinate array, with 60px padding.

### Cleanup on trip end
When the driver ends the trip:
- Stop all animation loops
- Call `.remove()` on all entries in `DriverState.riderMarkers`
- Clear `DriverState.riderMarkers` to an empty object
- Remove the route line layer and source
- Remove active stop markers
- Remove the driver dot marker
- Do not destroy the map instance

---

## 6. Layer and Source ID Reference

All layer and source IDs are fixed strings. Using consistent IDs ensures that add/remove operations target the correct layer.

| ID | Type | Used in |
|----|------|---------|
| `route-line` | GeoJSON source | Both frontends |
| `route-line-layer` | Line layer | Both frontends |

Markers (Mapbox `Marker` objects) do not use source/layer IDs — they are DOM elements managed via their JS references stored in state.

---

## 7. Abstraction Boundary — Live Maps Swap

The map rendering logic does not change when switching from simulation to live GPS. The only things that change are the data sources feeding coordinate values to the map.

| What changes | Where | Impact on map code |
|---|---|---|
| Matatu position source | `gps.py` `get_next_position()` → replaced by real device POST | None — map reads `current_lat/lng` from the same API response fields |
| Route line source | Hardcoded GeoJSON array → Mapbox Directions API response | The GeoJSON `LineString` format is identical — the source `setData()` call is unchanged |
| Rider pickup location source | Stop coordinates → browser `navigator.geolocation` | None — map reads `pickup_lat/lng` from the same PICKUP row fields |

No map initialisation code, no layer definitions, no marker management logic, and no interpolation logic changes at the live maps swap.

---

## 8. Map Initialisation Sequence Summary

```
Page loads
  └─► mapboxgl.accessToken = MAPBOX_TOKEN

Search screen entered (first time)
  └─► new mapboxgl.Map({container, style, center, zoom})
  └─► map.addControl(new NavigationControl(), 'top-right')
  └─► map.on('error', showMapErrorBanner)
  └─► store in RiderState.map

Route selected
  └─► Remove previous route line, stop markers, trip dots (if any)
  └─► Add route line source + layer
  └─► Add stop markers
  └─► Add matatu dot markers (one per active trip on route)
  └─► map.fitBounds(routeBounds, {padding: 40})

Trip selected → Matatu detail screen
  └─► map.resize()
  └─► Remove non-selected trip dots
  └─► map.easeTo({center: matatu position, zoom: 14})
  └─► Start Poll 1

Stop selected (flagging / pickup spot / reservation)
  └─► Add or replace RiderState.pickupMarker at stop coordinates

Waiting screen entered
  └─► map.fitBounds(bounds containing matatu + pickup marker, {padding: 80})
  └─► Start Poll 2

Live trip screen entered
  └─► Remove pickup marker
  └─► map.easeTo({center: matatu position, zoom: 14})

Trip ended screen entered
  └─► Stop animation loop
  └─► Remove all markers
  └─► Remove route line layer and source

Driver: Active trip screen entered (first time)
  └─► new mapboxgl.Map({container, style, center: route origin, zoom: 13})
  └─► map.addControl(new NavigationControl(), 'top-right')
  └─► map.on('error', showMapErrorBanner)
  └─► store in DriverState.map
  └─► Add route line source + layer
  └─► Add active stop markers
  └─► Add driver dot at current_lat/lng
  └─► map.fitBounds(routeBounds, {padding: 60})
  └─► Start Poll 1 + Poll 3

Driver: Trip ended
  └─► Stop animation loop
  └─► Remove all rider dots (DriverState.riderMarkers)
  └─► Remove route line layer and source
  └─► Remove stop markers
  └─► Remove driver dot
```

---

*End of Sema Map Initialisation Specification v1.0*
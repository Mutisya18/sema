# Sema — Project Structure Specification

**Version:** 1.0
**Scope:** File and folder structure only. Describes every file, what it contains, and how files relate to each other. No implementation detail.

---

## Root Structure

```
sema/
├── .env
├── .env.example
├── .gitignore
├── requirements.txt
├── run.py
├── config.py
├── database.py
├── seed.py
├── gps.py
│
├── app/
│   ├── __init__.py
│   ├── auth/
│   │   ├── __init__.py
│   │   └── routes.py
│   ├── trips/
│   │   ├── __init__.py
│   │   └── routes.py
│   ├── pickups/
│   │   ├── __init__.py
│   │   └── routes.py
│   ├── config/
│   │   ├── __init__.py
│   │   └── routes.py
│   ├── dev/
│   │   ├── __init__.py
│   │   └── routes.py
│   └── simulator/
│       ├── __init__.py
│       └── engine.py
│
├── static/
│   ├── js/
│   │   ├── rider.js
│   │   └── driver.js
│   └── css/
│       ├── rider.css
│       └── driver.css
│
├── templates/
│   ├── rider.html
│   └── driver.html
│
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── test_auth.py
    ├── test_trips.py
    ├── test_pickups.py
    └── test_simulator.py
```

---

## Root Level Files

---

### `.env`
Contains all environment-specific secrets and configuration. Never committed to version control.

**Contains:**
```
MAPBOX_TOKEN=your_mapbox_token_here
SECRET_KEY=your_flask_secret_key_here
DATABASE_PATH=sema.db
FLASK_ENV=development
FLASK_DEBUG=1
```

---

### `.env.example`
A committed copy of `.env` with all values blanked out. Serves as documentation for anyone setting up the project.

**Contains:**
```
MAPBOX_TOKEN=
SECRET_KEY=
DATABASE_PATH=sema.db
FLASK_ENV=development
FLASK_DEBUG=1
```

---

### `.gitignore`
Specifies files that must not be committed.

**Must include:**
- `.env`
- `sema.db`
- `__pycache__/`
- `*.pyc`
- `.pytest_cache/`
- `venv/`

---

### `requirements.txt`
Lists all Python dependencies with pinned versions.

**Must include:**
- flask
- python-dotenv
- pytest
- flask-testing (for test client support)

---

### `run.py`
Entry point for the application. Imports the Flask app factory, loads environment variables, and starts the server.

**Responsibilities:**
- Load `.env` via python-dotenv before anything else
- Call the app factory from `app/__init__.py`
- Run the Flask development server

**This is the only file a developer runs to start the application:**
```
python run.py
```

---

### `config.py`
Reads environment variables and exposes them as a Python configuration object. All other files that need configuration import from here — they never read from `os.environ` directly.

**Exposes:**
- `MAPBOX_TOKEN` — string
- `SECRET_KEY` — string
- `DATABASE_PATH` — string, path to the SQLite file
- `FLASK_ENV` — string
- `DEBUG` — boolean, derived from `FLASK_ENV`

---

### `database.py`
Manages the SQLite connection and schema creation. Contains one function to get a database connection and one function to initialise the schema (create all tables if they do not exist).

**Responsibilities:**
- Provide a `get_db()` function that returns a connection to the SQLite database at `DATABASE_PATH`
- Provide an `init_db()` function that creates all tables defined in the schema spec if they do not already exist
- All connections use `row_factory = sqlite3.Row` so rows can be accessed by column name

**Used by:** all blueprint route files, `seed.py`, and the simulator engine

---

### `seed.py`
Populates the database with the seed data defined in the schema spec. Safe to run multiple times — checks for existing data before inserting.

**Responsibilities:**
- Call `init_db()` to ensure tables exist
- Insert the 3 seeded riders if they do not already exist (checked by phone number)
- Insert the 3 seeded drivers if they do not already exist (checked by phone number)
- Print a confirmation message when complete

**Run manually by the developer:**
```
python seed.py
```

**Also called by:** `POST /api/dev/reset` after wiping runtime data

---

### `gps.py`
The single source of truth for all route and simulation data. Contains the `ROUTES` dictionary and all simulation logic interfaces.

**Responsibilities:**
- Define the `ROUTES` dictionary containing all hardcoded routes, their coordinate arrays, and their stops
- Expose a `get_route(route_id)` function that returns a route definition or raises an error if not found
- Expose a `get_stop(route_id, stop_id)` function that returns a stop definition
- Expose a `get_next_position(route_id, current_step)` function that returns `{lat, lng, next_step, is_final}` — this is the abstraction boundary for simulation vs live GPS
- Expose a `compute_distance(lat1, lng1, lat2, lng2)` function implementing Haversine — returns distance in metres
- Expose a `compute_alert_level(distance_metres)` function that returns `none`, `approaching`, or `near`

**This file is the only place route coordinates and stop coordinates exist. No other file hardcodes coordinates.**

---

## app/ — Flask Application

---

### `app/__init__.py`
The Flask application factory. Creates and configures the Flask app instance.

**Responsibilities:**
- Create the Flask app instance
- Load config from `config.py`
- Set `SECRET_KEY` for session management
- Call `init_db()` to ensure the schema exists on startup
- Register all blueprints with their URL prefixes
- Inject `MAPBOX_TOKEN` into the Jinja2 template context so it is available to all templates

**Blueprint registrations:**
```
auth blueprint      →  /api/auth
trips blueprint     →  /api/trips
pickups blueprint   →  /api/pickups
config blueprint    →  /api/config
dev blueprint       →  /api/dev
```

**Template routes (not blueprints — defined directly in the factory):**
```
GET /rider   →  renders templates/rider.html
GET /driver  →  renders templates/driver.html
GET /        →  redirects to /rider
```

---

### `app/auth/routes.py`
Handles all authentication endpoints.

**Endpoints defined here:**
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

**Imports:** `database.py`, `config.py`

---

### `app/trips/routes.py`
Handles all trip-related endpoints.

**Endpoints defined here:**
- `POST /api/trips`
- `GET /api/trips`
- `GET /api/trips/history`
- `GET /api/trips/:trip_id`
- `GET /api/trips/:trip_id/gps`
- `GET /api/trips/:trip_id/riders`
- `PATCH /api/trips/:trip_id/pause`
- `PATCH /api/trips/:trip_id/resume`
- `PATCH /api/trips/:trip_id/end`

**Imports:** `database.py`, `gps.py`, `app/simulator/engine.py`

---

### `app/pickups/routes.py`
Handles all pickup-related endpoints.

**Endpoints defined here:**
- `POST /api/pickups`
- `GET /api/pickups/active`
- `GET /api/pickups/history`
- `PATCH /api/pickups/:pickup_id/accept`
- `PATCH /api/pickups/:pickup_id/reject`
- `PATCH /api/pickups/:pickup_id/board`
- `PATCH /api/pickups/:pickup_id/cancel`

**Imports:** `database.py`, `gps.py`

---

### `app/config/routes.py`
Handles the routes config endpoint.

**Endpoints defined here:**
- `GET /api/config/routes`

**Imports:** `gps.py`

**Note:** This blueprint serves route and stop data from `gps.py` to the frontend. It does not touch the database.

---

### `app/dev/routes.py`
Handles development-only endpoints.

**Endpoints defined here:**
- `POST /api/dev/reset`

**Imports:** `database.py`, `seed.py`, `app/simulator/engine.py`

**Note:** This blueprint must be disabled or removed before any public deployment. In production `FLASK_ENV`, this blueprint is not registered.

---

### `app/simulator/engine.py`
Contains all simulator thread logic. This is the only file that spawns and manages background threads.

**Responsibilities:**
- Maintain a module-level registry of active simulator threads, keyed by `trip_id`
- Expose a `start_simulator(trip_id, route_id)` function that spawns a daemon thread for the given trip
- Expose a `stop_simulator(trip_id)` function that signals the thread for that trip to exit on its next cycle
- Expose a `stop_all_simulators()` function that stops all active threads — called by the dev reset endpoint
- The simulator thread loop:
  1. Check if the trip is paused — if so skip advancement this cycle
  2. Check if the trip is ended or a stop signal has been received — if so exit
  3. Call `gps.get_next_position(route_id, current_step)`
  4. Write new `lat`, `lng`, `current_step` to the TRIP row
  5. If `is_final` is true: mark trip as ended, exit thread
  6. Run proximity checks for all active pickups on this trip
  7. For each pickup: call `gps.compute_distance()` and `gps.compute_alert_level()`, write result to PICKUP row
  8. Sleep 5 seconds
  9. Repeat

**Imports:** `database.py`, `gps.py`

**Threading rules:**
- All threads are daemon threads — they exit automatically if the main process exits
- The thread registry is a plain Python dict protected by a threading lock
- No thread writes to the database simultaneously with another thread for the same trip — each trip has exactly one thread

---

## static/ — Frontend Assets

---

### `static/js/rider.js`
All JavaScript for the rider frontend.

**Contains:**
- `RiderState` global object
- `showScreen(screenId)` navigation function and all screen `onEnter`/`onExit` handlers
- All poll management functions (start, stop, handle response) for Poll 1 and Poll 2
- All API call functions (one per endpoint the rider uses)
- All map management functions (initialise, add markers, interpolate dot)
- All form validation and user action handlers
- All toast and banner display functions

---

### `static/js/driver.js`
All JavaScript for the driver frontend.

**Contains:**
- `DriverState` global object
- `showScreen(screenId)` navigation function and all screen `onEnter`/`onExit` handlers
- All poll management functions for Poll 1 and Poll 3
- All API call functions (one per endpoint the driver uses)
- All map management functions including rider dot diff and cluster logic
- All form validation and user action handlers
- All toast and banner display functions

---

### `static/css/rider.css`
All styles for the rider frontend. Rider brand colours and component styles.

---

### `static/css/driver.css`
All styles for the driver frontend. Driver brand colours and component styles.

---

## templates/

---

### `templates/rider.html`
The single HTML file served to riders at `GET /rider`.

**Structure:**
- `<head>`: loads Mapbox GL JS and CSS from CDN, loads `rider.css`, sets the Mapbox token as a global JS variable injected by Flask
- `<body>`: contains all rider screen `<div>` elements, all initially `display: none` except the login screen
- Bottom of `<body>`: loads `rider.js`

**Mapbox token injection:**
```html
<script>
  const MAPBOX_TOKEN = "{{ mapbox_token }}";
</script>
```
This variable is read by `rider.js` on initialisation. It is never hardcoded in the JS file.

---

### `templates/driver.html`
The single HTML file served to drivers at `GET /driver`.

**Structure:** identical pattern to `rider.html` but with driver screens and loads `driver.js` and `driver.css`.

---

## tests/

---

### `tests/conftest.py`
Pytest configuration and shared fixtures.

**Contains:**
- A `app` fixture that creates a Flask test app instance with a fresh in-memory SQLite database
- A `client` fixture that provides a Flask test client
- A `seeded_db` fixture that runs the seed script against the test database
- A `rider_session` fixture that logs in as Rider 1 and returns an authenticated client
- A `driver_session` fixture that logs in as Driver 1 and returns an authenticated client

---

### `tests/test_auth.py`
Tests for all auth endpoints.

**Covers:**
- Login with valid rider phone
- Login with valid driver phone
- Login with unknown phone
- Login with wrong role
- Logout clears session
- Session endpoint returns current user
- Session endpoint returns 401 when not logged in

---

### `tests/test_trips.py`
Tests for all trip endpoints.

**Covers:**
- Create trip with valid data
- Create trip with invalid route_id
- Create trip when driver already has active trip
- Get trips filtered by route_id
- Get single trip
- Pause active trip
- Resume paused trip
- End active trip
- End trip clears pending pickups
- GPS endpoint returns current position
- Riders endpoint returns active pickups
- Riders endpoint triggers no-show check

---

### `tests/test_pickups.py`
Tests for all pickup endpoints.

**Covers:**
- Create flagging pickup
- Create reservation pickup
- Create pickup on inactive stop
- Create pickup with insufficient seats
- Accept pending pickup
- Reject pending pickup
- Board accepted pickup decrements seats
- Board accepted pickup pauses trip when seats reach zero
- Cancel pending pickup
- Cancel accepted pickup
- History returns all pickups for rider
- Active pickup returns null when no active pickup exists

---

### `tests/test_simulator.py`
Tests for simulator logic.

**Covers:**
- Simulator advances position on each step
- Simulator writes correct lat/lng to trip row
- Simulator skips advancement when trip is paused
- Simulator marks trip ended when final coordinate is reached
- Simulator updates alert_level on pickup rows
- Stop simulator stops the thread
- Stop all simulators stops all threads

---

## Dependency Map

```
run.py
  └─► app/__init__.py
        ├─► config.py  ←─────────────────── .env
        ├─► database.py  ←──────────────── config.py
        ├─► app/auth/routes.py  ←───────── database.py
        ├─► app/trips/routes.py  ←──────── database.py, gps.py, simulator/engine.py
        ├─► app/pickups/routes.py  ←────── database.py, gps.py
        ├─► app/config/routes.py  ←─────── gps.py
        ├─► app/dev/routes.py  ←────────── database.py, seed.py, simulator/engine.py
        └─► app/simulator/engine.py  ←──── database.py, gps.py

seed.py  ←──────────────────────────────── database.py

templates/rider.html  ←─────────────────── static/js/rider.js, static/css/rider.css
templates/driver.html  ←────────────────── static/js/driver.js, static/css/driver.css
```

---

## Developer Setup Sequence

The following steps take a developer from zero to a running application:

1. Clone the repository
2. Create and activate a Python virtual environment
3. Run `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and fill in `MAPBOX_TOKEN` and `SECRET_KEY`
5. Run `python seed.py` to initialise the database and insert seed data
6. Run `python run.py` to start the Flask development server
7. Open `http://localhost:5000/rider` for the rider app
8. Open `http://localhost:5000/driver` for the driver app
9. To reset the database at any time: `POST http://localhost:5000/api/dev/reset`
10. To run tests: `pytest`

---

*End of Sema Project Structure Specification v1.0*
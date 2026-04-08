# 🚍 Sema — Matatu Hailing, Reimagined

Sema is a real-time matatu hailing and booking platform built for Nairobi. It connects **riders** who need a ride with **drivers** running active routes — with live GPS tracking, seat booking, and proximity alerts.

---

## 🗺️ What It Does

### For Riders
- **Quick Trip (Flagging)** — You're on the road. Find a matatu on your route, flag it, and tap "Pick Me Up" when it's close.*For the demo, the riders location has been defaulted to CBD."
- **Pickup** — Set a specific stop as your pickup point. The driver sees your dot on the map.
- **Booking** — Reserve a seat on a scheduled future trip. Monitor it via My Trips.

### For Drivers
- **Start a trip** — Select your route, active stops, fare, and seat count. Begin immediately or schedule for later.
- **Saved trips** — Save your common routes as templates for one-tap reuse.
- **Live feed** — See all riders flagging or booking on your route in real time. Accept or reject with one tap.
- **Proximity alerts** — The system automatically tracks how close you are to each rider's stop and triggers countdowns.

---

## 🏗️ Architecture

```
sema/
├── run.py                  # Entry point
├── config.py               # Environment config
├── database.py             # SQLite connection + schema
├── seed.py                 # Seed data (riders + drivers)
├── gps.py                  # Route definitions, simulator logic, Haversine distance
│
├── app/
│   ├── __init__.py         # Flask app factory, role-isolated sessions
│   ├── auth/               # Login, logout, session
│   ├── trips/              # Trip CRUD, GPS poll, rider feed, saved trips, bookings
│   ├── pickups/            # Pickup lifecycle (create, accept, reject, board, cancel, noshow)
│   ├── config/             # Route config endpoint
│   ├── dev/                # Dev reset endpoint
│   └── simulator/          # Background thread engine — advances matatu position
│
├── static/
│   ├── js/rider.js         # All rider frontend logic (~1400 lines)
│   └── js/driver.js        # All driver frontend logic (~1300 lines)
│
└── templates/
    ├── rider.html          # Single-page app shell for riders
    └── driver.html         # Single-page app shell for drivers
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Single-page apps (no framework) | Vanilla JS keeps the bundle zero and the logic transparent |
| SQLite | Simple, file-based, zero config — perfect for demo/MVP |
| Role-isolated sessions | Rider and driver use separate cookies (`sema_rider_session`, `sema_driver_session`) so both roles can be tested in the same browser |
| Simulator threads | Each active trip gets a daemon thread that advances position every N seconds (configurable) |
| Polling over WebSockets | GPS + pickup status use 5s polls — simple, debuggable, sufficient for demo |
| `/rider/api/*` + `/driver/api/*` | API paths are role-prefixed so session cookies are scoped correctly |

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, Flask 3.0 |
| Database | SQLite (via `sqlite3`) |
| Frontend | Vanilla JS (ES2020), no framework |
| Maps | Mapbox GL JS v3.3 |
| Tests | pytest |

---

## 🚦 Development Phases

| Phase | Feature | Status |
|---|---|---|
| 0 | Project skeleton | ✅ Done |
| 1 | Auth & login (both roles) | ✅ Done |
| 2 | Route config & Mapbox maps | ✅ Done |
| 3 | Driver trip & simulator engine | ✅ Done |
| 4 | Rider search & matatu discovery | ✅ Done |
| 5 | Real Nairobi GeoJSON coordinates | ✅ Done |
| 6 | Flagging journey (end-to-end) | ✅ Done |
| 7 | Pickup journey | ✅ Done |
| 8 | Booking journey + scheduled trips | ✅ Done |
| 9 | Polish & edge cases | 🔲 Upcoming |
| 10 | QA & deployment | 🔲 Upcoming |

**Current state:** Phases 0–8 complete. All three rider journeys work end-to-end. 48 automated tests passing.

---

## ⚙️ Setup Guide

### 1. Clone and install

```bash
git clone <repo-url>
cd sema
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
MAPBOX_TOKEN=pk.eyJ1IjoibXV0aXN5YTEwMSIsImEiOiJjbW15dDhrYWowMWVyMnJxczh5NnhpeW04In0.wqNhw_xdYHZAxBjhO8YuLA
SECRET_KEY=your-secret-key-here
DATABASE_PATH=sema.db
FLASK_ENV=development
FLASK_DEBUG=1
SIMULATOR_STEP_INTERVAL_SECONDS=30
```

> 🗝️ The Mapbox token above is the project token. It renders the live Nairobi map tiles.

### 3. Seed the database

```bash
python seed.py
```

This creates the SQLite database and inserts the 3 test riders and 3 test drivers.

### 4. Run the server

```bash
python run.py
```

Open:
- **Rider app** → `http://localhost:5000/rider`
- **Driver app** → `http://localhost:5000/driver`

### 5. Run tests

```bash
pytest
```

---

## 👤 Test Accounts

### Riders
| Name | Phone |
|---|---|
| Amina Wanjiru | +254712345001 |
| Brian Otieno | +254712345002 |
| Peter Kamau | +254712345003 |

### Drivers
| Name | Phone | Plate | Sacco |
|---|---|---|---|
| James Mwangi | +254722100001 | KJA 001A | Super Metro |
| Susan Njoki | +254722100002 | KBZ 445K | OMA Sacco |
| Kevin Ochieng | +254722100003 | KDA 223B | City Shuttle |

---

## 🗺️ Routes

Three real Nairobi routes are configured:

| Route | Stops |
|---|---|
| CBD → Thika Town | CBD · Ngara · Muthaiga · Allsops · Kasarani · Githurai · Ruiru · Juja · Thika |
| CBD → Ruaka | CBD · Mathare · Karura · Ridgeways · Fourways Junction · Runda · Ruaka |
| CBD → Pipeline | CBD · Railways · Nyayo · Imaara Daima · Utawala · Pipeline |

---

## 🧭 Usage Guide

### Testing a full flagging journey

1. Open `/driver` in one tab, `/rider` in another (same browser is fine — sessions are isolated)
2. **Driver:** Log in as James Mwangi → Start a trip on CBD → Thika → Begin trip
3. **Rider:** Log in as Amina Wanjiru → Tap Quick Trip → Type "Thika" → Select Thika Town → Tap the matatu card → Tap "Flag Matatu"
4. **Driver:** See the orange dot appear on the map and the rider card in the feed → Tap Accept
5. **Rider:** See "Driver accepted" toast → Wait for matatu to reach your stop → "I'm On Board" button appears → Tap it
6. **Driver:** Rider card clears, seat count decrements

### Testing a booking journey

1. **Driver:** Start a trip and check "Schedule for later" → pick a future time → Schedule trip
2. **Rider:** Tap Schedule Ride → search for a destination → tap the blue "Scheduled" trip card → Confirm Booking
3. **Driver:** See the booking appear in "Today's bookings" on the home screen (refreshes every 10s)
4. **Driver:** Tap "Start now" on the scheduled trip → trip goes active
5. **Rider:** Booking moves to Active in My Trips → monitoring flow begins

### Resetting the database

```bash
curl -X POST http://localhost:5000/rider/api/dev/reset
```

This wipes all trips and pickups and reseeds the original test accounts.

---

## 🔧 Configuration

| Variable | Default | Description |
|---|---|---|
| `MAPBOX_TOKEN` | — | Mapbox public token for map rendering |
| `SECRET_KEY` | — | Flask session signing key |
| `DATABASE_PATH` | `sema.db` | SQLite file path |
| `FLASK_ENV` | `development` | Set to `production` to disable dev endpoints |
| `SIMULATOR_STEP_INTERVAL_SECONDS` | `30` | Seconds between each matatu position advance. Lower = faster movement. Use `5` for demos. |

---

## 📊 Database Schema (summary)

| Table | Purpose |
|---|---|
| `RIDER` | Registered riders |
| `DRIVER` | Registered drivers |
| `TRIP` | Active, paused, scheduled, and ended trips |
| `TRIP_STOPS` | Which stops a driver is serving on a given trip |
| `PICKUP` | All pickup requests — flagging, pickup spot, and reservations |
| `SAVED_TRIP` | Driver's saved trip templates for quick reuse |

---

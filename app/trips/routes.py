"""
app/trips/routes.py — Trip endpoints.
Covers create, list, get, GPS poll, pause, resume, end, and history.
"""

import logging

from flask import Blueprint, request, session, jsonify

import database
import gps
from app.simulator.engine import start_simulator, stop_simulator

logger = logging.getLogger(__name__)
trips_bp = Blueprint("trips", __name__)


# ─── Auth guard ──────────────────────────────────────────────────────────────

def _require_driver():
    """Return (driver_id, None) or (None, error_response)."""
    if "user_id" not in session:
        return None, (jsonify({"error": "unauthorized"}), 401)
    if session.get("role") != "driver":
        return None, (jsonify({"error": "forbidden"}), 403)
    return session["user_id"], None


def _require_session():
    """Return (user_id, None) or (None, error_response). Any role."""
    if "user_id" not in session:
        return None, (jsonify({"error": "unauthorized"}), 401)
    return session["user_id"], None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _active_stops_for_trip(conn, trip_id):
    """Return list of stop dicts for a trip, enriched from gps config."""
    rows = conn.execute(
        "SELECT stop_id FROM TRIP_STOPS WHERE trip_id = ?", (trip_id,)
    ).fetchall()
    trip_row = conn.execute("SELECT route_id FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
    if not trip_row:
        return []
    stops = []
    for row in rows:
        try:
            stop = gps.get_stop(trip_row["route_id"], row["stop_id"])
            stops.append(stop)
        except KeyError:
            pass
    return stops


def _seats_available_at_stop(conn, trip_id, stop_id, trip_seats_available):
    """
    Compute available seats at a specific stop.
    = trip.seats_available minus seats_requested of pending/accepted pickups at that stop.
    """
    held = conn.execute(
        """SELECT COALESCE(SUM(seats_requested), 0) as held
           FROM PICKUP
           WHERE trip_id = ? AND stop_id = ? AND status IN ('pending', 'accepted')""",
        (trip_id, stop_id),
    ).fetchone()["held"]
    return max(0, trip_seats_available - held)


def _build_trip_response(conn, row):
    """Build the full trip dict from a TRIP row, joining driver and stops."""
    driver = conn.execute(
        "SELECT name, plate, sacco FROM DRIVER WHERE id = ?", (row["driver_id"],)
    ).fetchone()

    stops = _active_stops_for_trip(conn, row["id"])
    stops_with_seats = []
    for stop in stops:
        stops_with_seats.append({
            **stop,
            "seats_available_at_stop": _seats_available_at_stop(
                conn, row["id"], stop["id"], row["seats_available"]
            ),
        })

    try:
        route = gps.get_route(row["route_id"])
        route_name = route["name"]
    except KeyError:
        route_name = row["route_id"]

    return {
        "id": row["id"],
        "driver_id": row["driver_id"],
        "driver_name": driver["name"] if driver else "",
        "plate": driver["plate"] if driver else "",
        "sacco": driver["sacco"] if driver else "",
        "route_id": row["route_id"],
        "route_name": route_name,
        "status": row["status"],
        "seats_total": row["seats_total"],
        "seats_available": row["seats_available"],
        "fare": row["fare"],
        "current_lat": row["current_lat"],
        "current_lng": row["current_lng"],
        "current_step": row["current_step"],
        "scheduled_departure": row["scheduled_departure"],
        "active_stops": stops_with_seats,
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
    }


# ─── POST /api/trips ──────────────────────────────────────────────────────────

@trips_bp.route("", methods=["POST"])
def create_trip():
    """
    Create a new trip. If scheduled_departure is provided, status = 'scheduled'
    and simulator does not start yet. Otherwise status = 'active' and simulator starts.
    Optional save_trip=true saves the config as a SAVED_TRIP template.
    """
    driver_id, err = _require_driver()
    if err:
        return err

    body = request.get_json(silent=True) or {}
    route_id = body.get("route_id", "")
    active_stop_ids = body.get("active_stop_ids", [])
    seats_total = body.get("seats_total")
    fare = body.get("fare")
    scheduled_departure = body.get("scheduled_departure")  # ISO datetime string or None
    save_trip = body.get("save_trip", False)
    trip_name = body.get("trip_name", "")

    try:
        route = gps.get_route(route_id)
    except KeyError:
        return jsonify({"error": "invalid route_id"}), 400

    if not active_stop_ids:
        return jsonify({"error": "no active stops selected"}), 400
    if not isinstance(seats_total, int) or not (1 <= seats_total <= 30):
        return jsonify({"error": "seats_total must be between 1 and 30"}), 400
    if not isinstance(fare, (int, float)) or fare <= 0:
        return jsonify({"error": "fare must be a positive number"}), 400

    first_coord = route["coordinates"][0]
    start_lat, start_lng = first_coord[1], first_coord[0]
    status = "scheduled" if scheduled_departure else "active"

    conn = database.get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM TRIP WHERE driver_id = ? AND status IN ('active', 'paused')",
            (driver_id,),
        ).fetchone()
        if existing:
            return jsonify({"error": "driver already has an active trip"}), 409

        cursor = conn.execute(
            """INSERT INTO TRIP
               (driver_id, route_id, status, seats_total, seats_available,
                fare, current_lat, current_lng, current_step, scheduled_departure)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (driver_id, route_id, status, seats_total, seats_total,
             int(fare), start_lat, start_lng, scheduled_departure),
        )
        trip_id = cursor.lastrowid

        for stop_id in active_stop_ids:
            conn.execute(
                "INSERT INTO TRIP_STOPS (trip_id, stop_id) VALUES (?, ?)",
                (trip_id, stop_id),
            )

        if save_trip:
            import json
            conn.execute(
                """INSERT INTO SAVED_TRIP (driver_id, route_id, stop_ids, fare, name)
                   VALUES (?, ?, ?, ?, ?)""",
                (driver_id, route_id, json.dumps(active_stop_ids), int(fare), trip_name),
            )

        conn.commit()
        trip_row = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        trip_data = _build_trip_response(conn, trip_row)
    finally:
        conn.close()

    if status == "active":
        start_simulator(trip_id, route_id)

    logger.info({"event": "trip_created", "trip_id": trip_id, "status": status, "driver_id": driver_id})
    return jsonify({"trip": trip_data}), 201


# ─── GET /api/trips ───────────────────────────────────────────────────────────

@trips_bp.route("", methods=["GET"])
def list_trips():
    """
    Return active/paused trips for a route (rider discovery) or for the
    logged-in driver (page-load restoration via ?driver_id=me).
    """
    _, err = _require_session()
    if err:
        return err

    route_id = request.args.get("route_id")
    driver_active = request.args.get("driver_active")

    conn = database.get_db()
    try:
        if driver_active:
            # Driver page-load restoration: return this driver's active/paused trip
            driver_id = session["user_id"]
            rows = conn.execute(
                "SELECT * FROM TRIP WHERE driver_id = ? AND status IN ('active', 'paused')",
                (driver_id,),
            ).fetchall()
        elif route_id:
            try:
                gps.get_route(route_id)
            except KeyError:
                return jsonify({"error": "invalid route_id"}), 400

            from_stop_id = request.args.get("from_stop_id")
            from_step = None
            if from_stop_id:
                try:
                    from_step = gps.get_stop(route_id, from_stop_id)["step"]
                except KeyError:
                    return jsonify({"error": "invalid from_stop_id"}), 400

            rows = conn.execute(
                "SELECT * FROM TRIP WHERE route_id = ? AND status IN ('active', 'paused', 'scheduled')",
                (route_id,),
            ).fetchall()

            # Exclude active/paused matatus that have already passed the rider's from stop
            if from_step is not None:
                rows = [r for r in rows if r["status"] == "scheduled" or r["current_step"] <= from_step]
        else:
            return jsonify({"error": "route_id is required"}), 400

        trips = [_build_trip_response(conn, row) for row in rows]
        # Attach ETA per stop for each trip
        interval = _get_simulator_interval()
        for trip in trips:
            trip["stop_etas"] = _compute_stop_etas(trip, interval)
    finally:
        conn.close()

    return jsonify({"trips": trips}), 200


# ─── GET /api/trips/history ───────────────────────────────────────────────────

@trips_bp.route("/history", methods=["GET"])
def trip_history():
    """Return all ended trips for the logged-in driver, newest first."""
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        rows = conn.execute(
            """SELECT t.*, COUNT(p.id) as total_pickups
               FROM TRIP t
               LEFT JOIN PICKUP p ON p.trip_id = t.id AND p.status = 'completed'
               WHERE t.driver_id = ? AND t.status = 'ended'
               GROUP BY t.id
               ORDER BY t.started_at DESC""",
            (driver_id,),
        ).fetchall()

        trips = []
        for row in rows:
            try:
                route_name = gps.get_route(row["route_id"])["name"]
            except KeyError:
                route_name = row["route_id"]
            trips.append({
                "id": row["id"],
                "route_name": route_name,
                "status": row["status"],
                "seats_total": row["seats_total"],
                "fare": row["fare"],
                "total_pickups": row["total_pickups"],
                "started_at": row["started_at"],
                "ended_at": row["ended_at"],
            })
    finally:
        conn.close()

    return jsonify({"trips": trips}), 200


# ─── GET /api/trips/:trip_id ──────────────────────────────────────────────────

@trips_bp.route("/<int:trip_id>", methods=["GET"])
def get_trip(trip_id):
    """Return full detail for one trip."""
    _, err = _require_session()
    if err:
        return err

    conn = database.get_db()
    try:
        row = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        if not row:
            return jsonify({"error": "trip not found"}), 404
        trip_data = _build_trip_response(conn, row)
    finally:
        conn.close()

    return jsonify({"trip": trip_data}), 200


# ─── GET /api/trips/:trip_id/gps ─────────────────────────────────────────────

@trips_bp.route("/<int:trip_id>/gps", methods=["GET"])
def get_trip_gps(trip_id):
    """Lightweight GPS poll endpoint. Returns current position and status only."""
    _, err = _require_session()
    if err:
        return err

    conn = database.get_db()
    try:
        row = conn.execute(
            "SELECT status, current_lat, current_lng, current_step FROM TRIP WHERE id = ?",
            (trip_id,),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return jsonify({"error": "trip not found"}), 404

    return jsonify({
        "trip_id": trip_id,
        "status": row["status"],
        "current_lat": row["current_lat"],
        "current_lng": row["current_lng"],
        "current_step": row["current_step"],
    }), 200


# ─── GET /api/trips/:trip_id/riders ──────────────────────────────────────────

@trips_bp.route("/<int:trip_id>/riders", methods=["GET"])
def get_trip_riders(trip_id):
    """
    Return all pending/accepted pickups on this trip for the driver feed.
    Runs the no-show check before responding.
    """
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        trip = conn.execute(
            "SELECT driver_id FROM TRIP WHERE id = ?", (trip_id,)
        ).fetchone()
        if not trip:
            return jsonify({"error": "trip not found"}), 404
        if trip["driver_id"] != driver_id:
            return jsonify({"error": "not your trip"}), 403

        _run_noshow_check(conn, trip_id)

        rows = conn.execute(
            """SELECT p.*, r.name as rider_name
               FROM PICKUP p
               JOIN RIDER r ON r.id = p.rider_id
               WHERE p.trip_id = ? AND p.status IN ('pending', 'accepted')""",
            (trip_id,),
        ).fetchall()

        riders = [_build_rider_dict(row) for row in rows]
    finally:
        conn.close()

    return jsonify({"riders": riders}), 200


def _build_rider_dict(row):
    return {
        "pickup_id": row["id"],
        "rider_id": row["rider_id"],
        "rider_name": row["rider_name"],
        "pickup_type": row["pickup_type"],
        "status": row["status"],
        "spotted": bool(row["spotted"]),
        "stop_id": row["stop_id"],
        "stop_name": _stop_name(row["stop_id"]),
        "pickup_lat": row["pickup_lat"],
        "pickup_lng": row["pickup_lng"],
        "seats_requested": row["seats_requested"],
        "alert_level": row["alert_level"],
        "pickup_window_start": row["pickup_window_start"],
        "pickup_window_end": row["pickup_window_end"],
    }


def _stop_name(stop_id):
    """Best-effort stop name lookup across all routes."""
    for route in gps.ROUTES.values():
        for stop in route["stops"]:
            if stop["id"] == stop_id:
                return stop["name"]
    return stop_id


def _run_noshow_check(conn, trip_id):
    """
    Set status = no_show for any reservation pickup whose window has expired
    and is still pending or accepted.
    """
    conn.execute(
        """UPDATE PICKUP
           SET status = 'no_show', updated_at = CURRENT_TIMESTAMP
           WHERE trip_id = ?
             AND pickup_type = 'reservation'
             AND status IN ('pending', 'accepted')
             AND pickup_window_end IS NOT NULL
             AND pickup_window_end < CURRENT_TIMESTAMP""",
        (trip_id,),
    )
    conn.commit()


# ─── PATCH /api/trips/:trip_id/pause ─────────────────────────────────────────

@trips_bp.route("/<int:trip_id>/pause", methods=["PATCH"])
def pause_trip(trip_id):
    """Pause an active trip. Simulator keeps running but skips advancement."""
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        trip = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        if not trip:
            return jsonify({"error": "trip not found"}), 404
        if trip["driver_id"] != driver_id:
            return jsonify({"error": "not your trip"}), 403
        if trip["status"] != "active":
            return jsonify({"error": "trip is not active"}), 409

        conn.execute(
            "UPDATE TRIP SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (trip_id,),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        trip_data = _build_trip_response(conn, updated)
    finally:
        conn.close()

    logger.info({"event": "trip_paused", "trip_id": trip_id})
    return jsonify({"trip": trip_data}), 200


# ─── PATCH /api/trips/:trip_id/resume ────────────────────────────────────────

@trips_bp.route("/<int:trip_id>/resume", methods=["PATCH"])
def resume_trip(trip_id):
    """Resume a paused trip."""
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        trip = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        if not trip:
            return jsonify({"error": "trip not found"}), 404
        if trip["driver_id"] != driver_id:
            return jsonify({"error": "not your trip"}), 403
        if trip["status"] != "paused":
            return jsonify({"error": "trip is not paused"}), 409

        conn.execute(
            "UPDATE TRIP SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (trip_id,),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        trip_data = _build_trip_response(conn, updated)
    finally:
        conn.close()

    logger.info({"event": "trip_resumed", "trip_id": trip_id})
    return jsonify({"trip": trip_data}), 200


# ─── PATCH /api/trips/:trip_id/end ───────────────────────────────────────────

@trips_bp.route("/<int:trip_id>/end", methods=["PATCH"])
def end_trip(trip_id):
    """
    End a trip. Cancels all pending/accepted pickups.
    Stops the simulator thread.
    """
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        trip = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        if not trip:
            return jsonify({"error": "trip not found"}), 404
        if trip["driver_id"] != driver_id:
            return jsonify({"error": "not your trip"}), 403
        if trip["status"] == "ended":
            return jsonify({"error": "trip is already ended"}), 409

        conn.execute(
            """UPDATE TRIP
               SET status = 'ended', ended_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (trip_id,),
        )
        conn.execute(
            """UPDATE PICKUP
               SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
               WHERE trip_id = ? AND status IN ('pending', 'accepted')""",
            (trip_id,),
        )
        conn.commit()

        total_pickups = conn.execute(
            "SELECT COUNT(*) as c FROM PICKUP WHERE trip_id = ? AND status = 'completed'",
            (trip_id,),
        ).fetchone()["c"]

        try:
            route_name = gps.get_route(trip["route_id"])["name"]
        except KeyError:
            route_name = trip["route_id"]

        summary = {
            "id": trip_id,
            "status": "ended",
            "ended_at": conn.execute(
                "SELECT ended_at FROM TRIP WHERE id = ?", (trip_id,)
            ).fetchone()["ended_at"],
            "total_pickups": total_pickups,
            "seats_total": trip["seats_total"],
            "fare": trip["fare"],
            "route_name": route_name,
            "started_at": trip["started_at"],
        }
    finally:
        conn.close()

    stop_simulator(trip_id)
    logger.info({"event": "trip_ended_by_driver", "trip_id": trip_id})
    return jsonify({"trip": summary}), 200


# ─── ETA helpers ─────────────────────────────────────────────────────────────

def _get_simulator_interval():
    """Return simulator step interval in seconds from config."""
    import config as app_config
    return app_config.SIMULATOR_STEP_INTERVAL_SECONDS


def _compute_stop_etas(trip, interval_seconds):
    """
    Compute estimated arrival time at each active stop.
    ETA = steps_remaining × interval_seconds from now.
    For scheduled trips, ETA is relative to scheduled_departure.
    Returns dict: {stop_id: eta_iso_string}
    """
    from datetime import datetime, timedelta, timezone

    current_step = trip.get("current_step", 0)
    scheduled_departure = trip.get("scheduled_departure")
    status = trip.get("status")

    if status == "scheduled" and scheduled_departure:
        try:
            base_time = datetime.fromisoformat(scheduled_departure)
        except ValueError:
            base_time = datetime.now(timezone.utc)
    else:
        base_time = datetime.now(timezone.utc)

    etas = {}
    for stop in trip.get("active_stops", []):
        steps_to_stop = max(0, stop["step"] - current_step)
        eta = base_time + timedelta(seconds=steps_to_stop * interval_seconds)
        etas[stop["id"]] = eta.isoformat()
    return etas


# ─── PATCH /api/trips/:trip_id/start ─────────────────────────────────────────

@trips_bp.route("/<int:trip_id>/start", methods=["PATCH"])
def start_scheduled_trip(trip_id):
    """
    Start a scheduled trip now. Transitions status from 'scheduled' to 'active'
    and spawns the simulator thread.
    """
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        trip = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        if not trip:
            return jsonify({"error": "trip not found"}), 404
        if trip["driver_id"] != driver_id:
            return jsonify({"error": "not your trip"}), 403
        if trip["status"] != "scheduled":
            return jsonify({"error": "trip is not scheduled"}), 409

        conn.execute(
            """UPDATE TRIP SET status = 'active', started_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (trip_id,)
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        trip_data = _build_trip_response(conn, updated)
    finally:
        conn.close()

    start_simulator(trip_id, trip["route_id"])
    logger.info({"event": "scheduled_trip_started", "trip_id": trip_id})
    return jsonify({"trip": trip_data}), 200


# ─── GET /api/trips/scheduled ────────────────────────────────────────────────

@trips_bp.route("/scheduled", methods=["GET"])
def get_scheduled_trips():
    """
    Return all scheduled trips for the logged-in driver.
    Also returns trips scheduled within the next 10 minutes for notification.
    """
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM TRIP WHERE driver_id = ? AND status = 'scheduled' ORDER BY scheduled_departure ASC",
            (driver_id,)
        ).fetchall()
        trips = [_build_trip_response(conn, row) for row in rows]
    finally:
        conn.close()

    return jsonify({"trips": trips}), 200


# ─── Saved trips ─────────────────────────────────────────────────────────────

@trips_bp.route("/saved", methods=["GET"])
def get_saved_trips():
    """Return all saved trip templates for the logged-in driver."""
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM SAVED_TRIP WHERE driver_id = ? ORDER BY created_at DESC",
            (driver_id,)
        ).fetchall()
        import json
        saved = []
        for row in rows:
            try:
                route_name = gps.get_route(row["route_id"])["name"]
            except KeyError:
                route_name = row["route_id"]
            saved.append({
                "id": row["id"],
                "route_id": row["route_id"],
                "route_name": route_name,
                "stop_ids": json.loads(row["stop_ids"]),
                "fare": row["fare"],
                "name": row["name"],
            })
    finally:
        conn.close()

    return jsonify({"saved_trips": saved}), 200


@trips_bp.route("/saved/<int:saved_id>", methods=["DELETE"])
def delete_saved_trip(saved_id):
    """Delete a saved trip template."""
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        row = conn.execute("SELECT driver_id FROM SAVED_TRIP WHERE id = ?", (saved_id,)).fetchone()
        if not row:
            return jsonify({"error": "not found"}), 404
        if row["driver_id"] != driver_id:
            return jsonify({"error": "not your saved trip"}), 403
        conn.execute("DELETE FROM SAVED_TRIP WHERE id = ?", (saved_id,))
        conn.commit()
    finally:
        conn.close()

    return jsonify({"message": "deleted"}), 200

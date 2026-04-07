"""
app/pickups/routes.py — Pickup endpoints (Phase 6).
Covers create, active poll, accept, reject, spot, board, cancel, history.
"""

import logging

from flask import Blueprint, request, session, jsonify

import database
import gps

logger = logging.getLogger(__name__)
pickups_bp = Blueprint("pickups", __name__)

# Statuses that can still transition
ACTIVE_STATUSES = ("pending", "accepted")
TERMINAL_STATUSES = ("completed", "rejected", "cancelled", "no_show")


# ─── Auth guards ─────────────────────────────────────────────────────────────

def _require_session():
    if "user_id" not in session:
        return None, (jsonify({"error": "unauthorized"}), 401)
    return session["user_id"], None


def _require_rider():
    uid, err = _require_session()
    if err:
        return None, err
    if session.get("role") != "rider":
        return None, (jsonify({"error": "forbidden"}), 403)
    return uid, None


def _require_driver():
    uid, err = _require_session()
    if err:
        return None, err
    if session.get("role") != "driver":
        return None, (jsonify({"error": "forbidden"}), 403)
    return uid, None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _run_noshow_check(conn, trip_id=None):
    """
    Set status=no_show for any reservation pickup whose window has expired
    and is still pending or accepted. Scoped to trip_id if provided.
    """
    query = """
        UPDATE PICKUP
        SET status = 'no_show', updated_at = CURRENT_TIMESTAMP
        WHERE pickup_type = 'reservation'
          AND status IN ('pending', 'accepted')
          AND pickup_window_end IS NOT NULL
          AND pickup_window_end < CURRENT_TIMESTAMP
    """
    params = ()
    if trip_id:
        query += " AND trip_id = ?"
        params = (trip_id,)
    conn.execute(query, params)
    conn.commit()


def _build_pickup_response(conn, row):
    """Build full pickup dict from a PICKUP row, including trip context."""
    trip = conn.execute(
        "SELECT status, current_lat, current_lng FROM TRIP WHERE id = ?",
        (row["trip_id"],)
    ).fetchone()

    # Best-effort stop name
    stop_name = row["stop_id"]
    for route in gps.ROUTES.values():
        for stop in route["stops"]:
            if stop["id"] == row["stop_id"]:
                stop_name = stop["name"]
                break

    return {
        "id": row["id"],
        "trip_id": row["trip_id"],
        "pickup_type": row["pickup_type"],
        "status": row["status"],
        "spotted": bool(row["spotted"]),
        "stop_id": row["stop_id"],
        "stop_name": stop_name,
        "pickup_lat": row["pickup_lat"],
        "pickup_lng": row["pickup_lng"],
        "seats_requested": row["seats_requested"],
        "alert_level": row["alert_level"],
        "pickup_window_start": row["pickup_window_start"],
        "pickup_window_end": row["pickup_window_end"],
        "boarded_at": row["boarded_at"],
        "current_lat": trip["current_lat"] if trip else None,
        "current_lng": trip["current_lng"] if trip else None,
        "trip_status": trip["status"] if trip else "ended",
    }


# ─── POST /api/pickups ────────────────────────────────────────────────────────

@pickups_bp.route("", methods=["POST"])
def create_pickup():
    """
    Create a new pickup request (flagging or reservation).
    Sets pickup_lat/lng from the stop's coordinates in gps config.
    """
    rider_id, err = _require_rider()
    if err:
        return err

    body = request.get_json(silent=True) or {}
    trip_id = body.get("trip_id")
    pickup_type = body.get("pickup_type", "flagging")
    stop_id = body.get("stop_id")
    seats_requested = body.get("seats_requested", 1)
    pickup_window_start = body.get("pickup_window_start")
    pickup_window_end = body.get("pickup_window_end")

    if not isinstance(seats_requested, int) or not (1 <= seats_requested <= 3):
        return jsonify({"error": "seats_requested must be between 1 and 3"}), 400

    conn = database.get_db()
    try:
        trip = conn.execute("SELECT * FROM TRIP WHERE id = ?", (trip_id,)).fetchone()
        if not trip:
            return jsonify({"error": "trip not found"}), 404
        if trip["status"] not in ("active", "scheduled"):
            return jsonify({"error": "trip is not active"}), 409

        # Verify stop is active on this trip
        active_stop = conn.execute(
            "SELECT stop_id FROM TRIP_STOPS WHERE trip_id = ? AND stop_id = ?",
            (trip_id, stop_id)
        ).fetchone()
        if not active_stop:
            return jsonify({"error": "stop is not active on this trip"}), 400

        # Get stop coordinates from config
        try:
            stop = gps.get_stop(trip["route_id"], stop_id)
        except KeyError:
            return jsonify({"error": "stop not found in route config"}), 400

        # Check seats available at this stop
        held = conn.execute(
            """SELECT COALESCE(SUM(seats_requested), 0) as held FROM PICKUP
               WHERE trip_id = ? AND stop_id = ? AND status IN ('pending', 'accepted')""",
            (trip_id, stop_id)
        ).fetchone()["held"]
        if trip["seats_available"] - held < seats_requested:
            return jsonify({"error": "not enough seats available"}), 409

        # Guard: rider can only have one active pickup per trip
        existing = conn.execute(
            "SELECT id FROM PICKUP WHERE trip_id = ? AND rider_id = ? AND status IN ('pending','accepted')",
            (trip_id, rider_id)
        ).fetchone()
        if existing:
            return jsonify({"error": "rider already has an active pickup on this trip"}), 409

        cursor = conn.execute(
            """INSERT INTO PICKUP
               (trip_id, rider_id, pickup_type, status, stop_id,
                pickup_lat, pickup_lng, seats_requested,
                pickup_window_start, pickup_window_end)
               VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)""",
            (trip_id, rider_id, pickup_type, stop_id,
             stop["lat"], stop["lng"], seats_requested,
             pickup_window_start, pickup_window_end)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (cursor.lastrowid,)).fetchone()
        pickup_data = _build_pickup_response(conn, row)
    finally:
        conn.close()

    logger.info({"event": "pickup_created", "pickup_id": row["id"], "rider_id": rider_id})
    return jsonify({"pickup": pickup_data}), 201


# ─── GET /api/pickups/active ──────────────────────────────────────────────────

@pickups_bp.route("/active", methods=["GET"])
def get_active_pickup():
    """
    Return the rider's current active pickup (pending or accepted).
    Runs no-show check before responding.
    Returns {pickup: null} if none exists.
    """
    rider_id, err = _require_rider()
    if err:
        return err

    conn = database.get_db()
    try:
        # Run no-show check for this rider's active pickup
        conn.execute(
            """UPDATE PICKUP
               SET status = 'no_show', updated_at = CURRENT_TIMESTAMP
               WHERE rider_id = ? AND pickup_type = 'reservation'
                 AND status IN ('pending', 'accepted')
                 AND pickup_window_end IS NOT NULL
                 AND pickup_window_end < CURRENT_TIMESTAMP""",
            (rider_id,)
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM PICKUP WHERE rider_id = ? AND status IN ('pending', 'accepted') ORDER BY created_at DESC LIMIT 1",
            (rider_id,)
        ).fetchone()

        pickup_data = _build_pickup_response(conn, row) if row else None
    finally:
        conn.close()

    return jsonify({"pickup": pickup_data}), 200


# ─── GET /api/pickups/history ─────────────────────────────────────────────────

@pickups_bp.route("/history", methods=["GET"])
def pickup_history():
    """Return all pickups for the logged-in rider, newest first."""
    rider_id, err = _require_rider()
    if err:
        return err

    conn = database.get_db()
    try:
        rows = conn.execute(
            """SELECT p.*, t.route_id, t.fare, t.started_at, t.ended_at,
                      d.name as driver_name, d.plate, d.sacco
               FROM PICKUP p
               JOIN TRIP t ON t.id = p.trip_id
               JOIN DRIVER d ON d.id = t.driver_id
               WHERE p.rider_id = ?
               ORDER BY p.created_at DESC""",
            (rider_id,)
        ).fetchall()

        pickups = []
        for row in rows:
            try:
                route_name = gps.get_route(row["route_id"])["name"]
            except KeyError:
                route_name = row["route_id"]
            pickups.append({
                "pickup_id": row["id"],
                "pickup_type": row["pickup_type"],
                "status": row["status"],
                "seats_requested": row["seats_requested"],
                "boarded_at": row["boarded_at"],
                "stop_name": row["stop_id"],
                "trip": {
                    "id": row["trip_id"],
                    "route_name": route_name,
                    "fare": row["fare"],
                    "plate": row["plate"],
                    "sacco": row["sacco"],
                    "started_at": row["started_at"],
                    "ended_at": row["ended_at"],
                },
            })
    finally:
        conn.close()

    return jsonify({"pickups": pickups}), 200


# ─── PATCH /api/pickups/:id/spot ──────────────────────────────────────────────

@pickups_bp.route("/<int:pickup_id>/spot", methods=["PATCH"])
def spot_pickup(pickup_id):
    """
    Rider signals they can see the matatu (Pick Me Up).
    Sets spotted=true, spotted_at=now. Idempotent — 409 if already spotted.
    """
    rider_id, err = _require_rider()
    if err:
        return err

    conn = database.get_db()
    try:
        row = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        if not row:
            return jsonify({"error": "pickup not found"}), 404
        if row["rider_id"] != rider_id:
            return jsonify({"error": "not your pickup"}), 403
        if row["spotted"]:
            return jsonify({"error": "already spotted"}), 409
        if row["status"] not in ACTIVE_STATUSES:
            return jsonify({"error": "pickup is not active"}), 409

        conn.execute(
            """UPDATE PICKUP
               SET spotted = 1, spotted_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (pickup_id,)
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        pickup_data = _build_pickup_response(conn, updated)
    finally:
        conn.close()

    logger.info({"event": "pickup_spotted", "pickup_id": pickup_id})
    return jsonify({"pickup": pickup_data}), 200


# ─── PATCH /api/pickups/:id/accept ───────────────────────────────────────────

@pickups_bp.route("/<int:pickup_id>/accept", methods=["PATCH"])
def accept_pickup(pickup_id):
    """Driver accepts a pending pickup."""
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        row = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        if not row:
            return jsonify({"error": "pickup not found"}), 404

        trip = conn.execute("SELECT driver_id, seats_available FROM TRIP WHERE id = ?", (row["trip_id"],)).fetchone()
        if not trip or trip["driver_id"] != driver_id:
            return jsonify({"error": "not your trip"}), 403
        if row["status"] != "pending":
            return jsonify({"error": "pickup is not pending"}), 409
        if trip["seats_available"] < row["seats_requested"]:
            return jsonify({"error": "not enough seats available"}), 409

        conn.execute(
            "UPDATE PICKUP SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (pickup_id,)
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        pickup_data = _build_pickup_response(conn, updated)
    finally:
        conn.close()

    logger.info({"event": "pickup_accepted", "pickup_id": pickup_id, "driver_id": driver_id})
    return jsonify({"pickup": pickup_data}), 200


# ─── PATCH /api/pickups/:id/reject ───────────────────────────────────────────

@pickups_bp.route("/<int:pickup_id>/reject", methods=["PATCH"])
def reject_pickup(pickup_id):
    """Driver rejects a pending or accepted pickup."""
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        row = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        if not row:
            return jsonify({"error": "pickup not found"}), 404

        trip = conn.execute("SELECT driver_id FROM TRIP WHERE id = ?", (row["trip_id"],)).fetchone()
        if not trip or trip["driver_id"] != driver_id:
            return jsonify({"error": "not your trip"}), 403
        if row["status"] in TERMINAL_STATUSES:
            return jsonify({"error": "pickup cannot be rejected in its current status"}), 409

        conn.execute(
            "UPDATE PICKUP SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (pickup_id,)
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        pickup_data = _build_pickup_response(conn, updated)
    finally:
        conn.close()

    logger.info({"event": "pickup_rejected", "pickup_id": pickup_id, "driver_id": driver_id})
    return jsonify({"pickup": pickup_data}), 200


# ─── PATCH /api/pickups/:id/board ────────────────────────────────────────────

@pickups_bp.route("/<int:pickup_id>/board", methods=["PATCH"])
def board_pickup(pickup_id):
    """
    Rider confirms boarding. Decrements trip seats.
    If seats reach 0, pauses the trip.
    """
    rider_id, err = _require_rider()
    if err:
        return err

    conn = database.get_db()
    try:
        row = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        if not row:
            return jsonify({"error": "pickup not found"}), 404
        if row["rider_id"] != rider_id:
            return jsonify({"error": "not your pickup"}), 403
        if row["status"] != "accepted":
            return jsonify({"error": "pickup is not accepted"}), 409

        trip = conn.execute("SELECT * FROM TRIP WHERE id = ?", (row["trip_id"],)).fetchone()
        if trip["seats_available"] < row["seats_requested"]:
            return jsonify({"error": "not enough seats available"}), 409

        new_seats = trip["seats_available"] - row["seats_requested"]
        conn.execute(
            "UPDATE PICKUP SET status = 'completed', boarded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (pickup_id,)
        )
        conn.execute(
            "UPDATE TRIP SET seats_available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_seats, row["trip_id"])
        )
        if new_seats == 0:
            conn.execute(
                "UPDATE TRIP SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (row["trip_id"],)
            )
        conn.commit()
        updated = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        pickup_data = _build_pickup_response(conn, updated)
    finally:
        conn.close()

    logger.info({"event": "pickup_boarded", "pickup_id": pickup_id, "seats_remaining": new_seats})
    return jsonify({"pickup": pickup_data}), 200


# ─── PATCH /api/pickups/:id/cancel ───────────────────────────────────────────

@pickups_bp.route("/<int:pickup_id>/cancel", methods=["PATCH"])
def cancel_pickup(pickup_id):
    """Rider cancels their pickup before boarding."""
    rider_id, err = _require_rider()
    if err:
        return err

    conn = database.get_db()
    try:
        row = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        if not row:
            return jsonify({"error": "pickup not found"}), 404
        if row["rider_id"] != rider_id:
            return jsonify({"error": "not your pickup"}), 403
        if row["status"] in ("completed", "no_show"):
            return jsonify({"error": "pickup cannot be cancelled in its current status"}), 409

        conn.execute(
            "UPDATE PICKUP SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (pickup_id,)
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        pickup_data = _build_pickup_response(conn, updated)
    finally:
        conn.close()

    logger.info({"event": "pickup_cancelled", "pickup_id": pickup_id})
    return jsonify({"pickup": pickup_data}), 200


# ─── PATCH /api/pickups/:id/noshow ───────────────────────────────────────────

@pickups_bp.route("/<int:pickup_id>/noshow", methods=["PATCH"])
def noshow_pickup(pickup_id):
    """
    Driver marks a rider as no-show. Sets status = no_show and decrements
    seats_available (seat was held for a booking).
    """
    driver_id, err = _require_driver()
    if err:
        return err

    conn = database.get_db()
    try:
        row = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        if not row:
            return jsonify({"error": "pickup not found"}), 404

        trip = conn.execute("SELECT driver_id, seats_available FROM TRIP WHERE id = ?", (row["trip_id"],)).fetchone()
        if not trip or trip["driver_id"] != driver_id:
            return jsonify({"error": "not your trip"}), 403
        if row["status"] in TERMINAL_STATUSES:
            return jsonify({"error": "pickup cannot be marked no-show in its current status"}), 409

        conn.execute(
            "UPDATE PICKUP SET status = 'no_show', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (pickup_id,)
        )
        # Decrement seats — seat was held for this booking
        new_seats = max(0, trip["seats_available"] - row["seats_requested"])
        conn.execute(
            "UPDATE TRIP SET seats_available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_seats, row["trip_id"])
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM PICKUP WHERE id = ?", (pickup_id,)).fetchone()
        pickup_data = _build_pickup_response(conn, updated)
    finally:
        conn.close()

    logger.info({"event": "pickup_noshow", "pickup_id": pickup_id, "driver_id": driver_id})
    return jsonify({"pickup": pickup_data}), 200

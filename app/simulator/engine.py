"""
app/simulator/engine.py — Simulator thread management.

Each active trip gets one daemon thread that advances the matatu position
every SIMULATOR_STEP_INTERVAL_SECONDS seconds, writes proximity alert levels
to active pickups, and marks the trip ended when the route is complete.

Public API:
  start_simulator(trip_id, route_id)  — spawn thread for a trip
  stop_simulator(trip_id)             — signal a specific thread to exit
  stop_all_simulators()               — signal all threads (used by dev reset)
"""

import threading
import traceback
import logging

import config
import database
import gps

logger = logging.getLogger(__name__)

# trip_id → threading.Event (set = stop requested)
_stop_events: dict[int, threading.Event] = {}
_registry_lock = threading.Lock()


# ─── Public API ──────────────────────────────────────────────────────────────

def start_simulator(trip_id: int, route_id: str) -> None:
    """
    Spawn a daemon thread that simulates position advancement for trip_id.
    No-op if a thread for this trip is already registered.

    Args:
        trip_id:  Database id of the trip to simulate.
        route_id: Route identifier used to look up coordinate sequence.
    """
    with _registry_lock:
        if trip_id in _stop_events:
            logger.warning({"event": "simulator_already_running", "trip_id": trip_id})
            return
        stop_event = threading.Event()
        _stop_events[trip_id] = stop_event

    thread = threading.Thread(
        target=_run_simulator,
        args=(trip_id, route_id, stop_event),
        daemon=True,
        name=f"simulator-trip-{trip_id}",
    )
    thread.start()
    logger.info({"event": "simulator_started", "trip_id": trip_id, "route_id": route_id})


def stop_simulator(trip_id: int) -> None:
    """
    Signal the simulator thread for trip_id to exit on its next cycle.

    Args:
        trip_id: Trip whose simulator should be stopped.
    """
    with _registry_lock:
        stop_event = _stop_events.get(trip_id)
    if stop_event:
        stop_event.set()
        logger.info({"event": "simulator_stop_requested", "trip_id": trip_id})


def stop_all_simulators() -> None:
    """Signal every active simulator thread to exit. Used by dev reset."""
    with _registry_lock:
        trip_ids = list(_stop_events.keys())
    for trip_id in trip_ids:
        stop_simulator(trip_id)
    logger.info({"event": "all_simulators_stopped", "count": len(trip_ids)})


# ─── Thread body ─────────────────────────────────────────────────────────────

def _run_simulator(trip_id: int, route_id: str, stop_event: threading.Event) -> None:
    """
    Main loop for one simulator thread.
    Advances position, writes proximity alert levels, ends trip at final coordinate.
    Wraps everything in try/except — any crash results in a controlled trip end.
    """
    try:
        _simulator_loop(trip_id, route_id, stop_event)
    except Exception:
        logger.error({
            "event": "simulator_crashed",
            "trip_id": trip_id,
            "traceback": traceback.format_exc(),
        })
        _end_trip_and_cancel_pickups(trip_id)
    finally:
        with _registry_lock:
            _stop_events.pop(trip_id, None)
        logger.info({"event": "simulator_thread_exited", "trip_id": trip_id})


def _simulator_loop(trip_id: int, route_id: str, stop_event: threading.Event) -> None:
    """
    Core advancement loop. Runs until stop_event is set, trip is ended,
    or the final coordinate is reached.
    """
    interval = config.SIMULATOR_STEP_INTERVAL_SECONDS

    while not stop_event.wait(timeout=interval):
        conn = database.get_db()
        try:
            trip = conn.execute(
                "SELECT status, current_step FROM TRIP WHERE id = ?", (trip_id,)
            ).fetchone()

            if trip is None:
                logger.warning({"event": "simulator_trip_missing", "trip_id": trip_id})
                return

            if trip["status"] == "ended":
                return

            if trip["status"] == "paused":
                # Skip advancement this cycle; keep looping
                continue

            # Advance one step
            position = gps.get_next_position(route_id, trip["current_step"])

            conn.execute(
                """UPDATE TRIP
                   SET current_lat = ?, current_lng = ?, current_step = ?,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (position["lat"], position["lng"], position["next_step"], trip_id),
            )
            conn.commit()

            logger.info({
                "event": "simulator_step",
                "trip_id": trip_id,
                "step": position["next_step"],
                "is_final": position["is_final"],
            })

            _update_pickup_alert_levels(conn, trip_id, position["lat"], position["lng"])

            if position["is_final"]:
                _end_trip_and_cancel_pickups(trip_id)
                return

        finally:
            conn.close()


def _update_pickup_alert_levels(conn, trip_id: int, trip_lat: float, trip_lng: float) -> None:
    """
    Recompute and write alert_level for every pending/accepted pickup on this trip.

    Args:
        conn:     Open database connection (caller owns it).
        trip_id:  Trip whose pickups to update.
        trip_lat: Current matatu latitude.
        trip_lng: Current matatu longitude.
    """
    pickups = conn.execute(
        """SELECT id, pickup_lat, pickup_lng
           FROM PICKUP
           WHERE trip_id = ? AND status IN ('pending', 'accepted')""",
        (trip_id,),
    ).fetchall()

    for pickup in pickups:
        distance = gps.compute_distance(trip_lat, trip_lng, pickup["pickup_lat"], pickup["pickup_lng"])
        alert_level = gps.compute_alert_level(distance)
        conn.execute(
            "UPDATE PICKUP SET alert_level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (alert_level, pickup["id"]),
        )
    if pickups:
        conn.commit()


def _end_trip_and_cancel_pickups(trip_id: int) -> None:
    """
    Mark the trip as ended and cancel all pending/accepted pickups.
    Opens its own connection — safe to call from the crash handler.

    Args:
        trip_id: Trip to end.
    """
    conn = database.get_db()
    try:
        conn.execute(
            """UPDATE TRIP
               SET status = 'ended', ended_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND status != 'ended'""",
            (trip_id,),
        )
        conn.execute(
            """UPDATE PICKUP
               SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
               WHERE trip_id = ? AND status IN ('pending', 'accepted')""",
            (trip_id,),
        )
        conn.commit()
        logger.info({"event": "trip_ended_by_simulator", "trip_id": trip_id})
    finally:
        conn.close()

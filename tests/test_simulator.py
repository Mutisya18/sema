"""tests/test_simulator.py — Simulator engine tests."""
import time
import os
import importlib

# Must be set before config is imported by the simulator
os.environ["SIMULATOR_STEP_INTERVAL_SECONDS"] = "1"

import config
importlib.reload(config)  # pick up the env var change

import database
import gps
from app.simulator.engine import (
    start_simulator, stop_simulator, stop_all_simulators,
)

ROUTE_ID = "cbd_thika"


def _get_driver_id(app):
    with app.app_context():
        conn = database.get_db()
        return conn.execute("SELECT id FROM DRIVER LIMIT 1").fetchone()["id"]


def _insert_trip(app, driver_id=None):
    """Insert a minimal active trip row and return its id."""
    with app.app_context():
        if driver_id is None:
            conn = database.get_db()
            driver_id = conn.execute("SELECT id FROM DRIVER LIMIT 1").fetchone()["id"]
        conn = database.get_db()
        cursor = conn.execute(
            """INSERT INTO TRIP
               (driver_id, route_id, status, seats_total, seats_available,
                fare, current_lat, current_lng, current_step)
               VALUES (?, ?, 'active', 14, 14, 80, -1.2921, 36.8219, 0)""",
            (driver_id, ROUTE_ID),
        )
        conn.commit()
        return cursor.lastrowid


def _get_step(app, trip_id):
    with app.app_context():
        conn = database.get_db()
        return conn.execute(
            "SELECT current_step FROM TRIP WHERE id = ?", (trip_id,)
        ).fetchone()["current_step"]


def _get_status(app, trip_id):
    with app.app_context():
        conn = database.get_db()
        return conn.execute(
            "SELECT status FROM TRIP WHERE id = ?", (trip_id,)
        ).fetchone()["status"]


def test_simulator_advances_position(app, seeded_db):
    trip_id = _insert_trip(app)
    start_simulator(trip_id, ROUTE_ID)
    time.sleep(2.5)
    stop_simulator(trip_id)
    time.sleep(0.5)
    assert _get_step(app, trip_id) >= 1


def test_simulator_writes_correct_lat_lng(app, seeded_db):
    trip_id = _insert_trip(app)
    start_simulator(trip_id, ROUTE_ID)
    time.sleep(2.5)
    stop_simulator(trip_id)
    time.sleep(0.5)

    with app.app_context():
        conn = database.get_db()
        row = conn.execute(
            "SELECT current_lat, current_lng, current_step FROM TRIP WHERE id = ?",
            (trip_id,),
        ).fetchone()

    expected = gps.ROUTES[ROUTE_ID]["coordinates"][row["current_step"]]
    assert abs(row["current_lat"] - expected[1]) < 0.0001
    assert abs(row["current_lng"] - expected[0]) < 0.0001


def test_simulator_skips_when_paused(app, seeded_db):
    trip_id = _insert_trip(app)
    with app.app_context():
        conn = database.get_db()
        conn.execute("UPDATE TRIP SET status = 'paused' WHERE id = ?", (trip_id,))
        conn.commit()

    start_simulator(trip_id, ROUTE_ID)
    time.sleep(2.5)
    stop_simulator(trip_id)
    time.sleep(0.5)
    assert _get_step(app, trip_id) == 0


def test_simulator_ends_trip_at_final_coordinate(app, seeded_db):
    trip_id = _insert_trip(app)
    final_step = len(gps.ROUTES[ROUTE_ID]["coordinates"]) - 2
    with app.app_context():
        conn = database.get_db()
        conn.execute(
            "UPDATE TRIP SET current_step = ? WHERE id = ?", (final_step, trip_id)
        )
        conn.commit()

    start_simulator(trip_id, ROUTE_ID)
    time.sleep(2.5)

    assert _get_status(app, trip_id) == "ended"


def test_simulator_updates_alert_level_on_pickups(app, seeded_db):
    trip_id = _insert_trip(app)
    with app.app_context():
        conn = database.get_db()
        rider_id = conn.execute("SELECT id FROM RIDER LIMIT 1").fetchone()["id"]
        conn.execute(
            """INSERT INTO PICKUP
               (trip_id, rider_id, pickup_type, status, stop_id,
                pickup_lat, pickup_lng, seats_requested, alert_level)
               VALUES (?, ?, 'flagging', 'pending', 'cbd', -1.2700, 36.8350, 1, 'none')""",
            (trip_id, rider_id),
        )
        conn.commit()

    start_simulator(trip_id, ROUTE_ID)
    time.sleep(2.5)
    stop_simulator(trip_id)
    time.sleep(0.5)

    with app.app_context():
        conn = database.get_db()
        pickup = conn.execute(
            "SELECT alert_level FROM PICKUP WHERE trip_id = ?", (trip_id,)
        ).fetchone()
    assert pickup["alert_level"] in ("none", "approaching", "near")


def test_stop_simulator_stops_thread(app, seeded_db):
    trip_id = _insert_trip(app)
    start_simulator(trip_id, ROUTE_ID)
    time.sleep(0.2)
    stop_simulator(trip_id)
    time.sleep(1.5)
    step_after_stop = _get_step(app, trip_id)
    time.sleep(1.5)
    assert _get_step(app, trip_id) == step_after_stop


def test_stop_all_simulators_stops_all_threads(app, seeded_db):
    with app.app_context():
        conn = database.get_db()
        drivers = conn.execute("SELECT id FROM DRIVER LIMIT 2").fetchall()

    trip_id_1 = _insert_trip(app, driver_id=drivers[0]["id"])
    trip_id_2 = _insert_trip(app, driver_id=drivers[1]["id"])

    start_simulator(trip_id_1, ROUTE_ID)
    start_simulator(trip_id_2, ROUTE_ID)
    time.sleep(0.2)
    stop_all_simulators()
    time.sleep(1.5)

    s1 = _get_step(app, trip_id_1)
    s2 = _get_step(app, trip_id_2)
    time.sleep(1.5)
    assert _get_step(app, trip_id_1) == s1
    assert _get_step(app, trip_id_2) == s2

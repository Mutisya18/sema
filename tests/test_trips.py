"""tests/test_trips.py — Trip endpoint tests."""
import pytest


# ─── Helpers ─────────────────────────────────────────────────────────────────

VALID_TRIP = {
    "route_id": "cbd_thika",
    "active_stop_ids": ["cbd", "githurai", "thika"],
    "seats_total": 14,
    "fare": 80,
}


def _create_trip(client):
    return client.post("/driver/api/trips", json=VALID_TRIP)


# ─── Create trip ─────────────────────────────────────────────────────────────

def test_create_trip_valid(driver_session):
    r = _create_trip(driver_session)
    assert r.status_code == 201
    trip = r.get_json()["trip"]
    assert trip["route_id"] == "cbd_thika"
    assert trip["seats_total"] == 14
    assert trip["seats_available"] == 14
    assert trip["status"] == "active"
    assert trip["current_step"] == 0


def test_create_trip_invalid_route(driver_session):
    r = driver_session.post("/driver/api/trips", json={**VALID_TRIP, "route_id": "bad_route"})
    assert r.status_code == 400
    assert "invalid route_id" in r.get_json()["error"]


def test_create_trip_already_active(driver_session):
    _create_trip(driver_session)
    r = _create_trip(driver_session)
    assert r.status_code == 409
    assert "already has an active trip" in r.get_json()["error"]


def test_create_trip_invalid_seats(driver_session):
    r = driver_session.post("/driver/api/trips", json={**VALID_TRIP, "seats_total": 0})
    assert r.status_code == 400


def test_create_trip_invalid_fare(driver_session):
    r = driver_session.post("/driver/api/trips", json={**VALID_TRIP, "fare": -10})
    assert r.status_code == 400


# ─── List trips ──────────────────────────────────────────────────────────────

def test_list_trips_by_route(client, seeded_db):
    client.post("/driver/api/auth/login", json={"phone": "+254722100001", "role": "driver"})
    _create_trip(client)
    client.post("/rider/api/auth/login", json={"phone": "+254712345001", "role": "rider"})
    r = client.get("/rider/api/trips?route_id=cbd_thika")
    assert r.status_code == 200
    trips = r.get_json()["trips"]
    assert len(trips) == 1
    assert trips[0]["route_id"] == "cbd_thika"


def test_list_trips_requires_route_id(rider_session):
    r = rider_session.get("/rider/api/trips")
    assert r.status_code == 400


def test_list_trips_driver_active_filter(driver_session):
    _create_trip(driver_session)
    r = driver_session.get("/driver/api/trips?driver_active=1")
    assert r.status_code == 200
    assert len(r.get_json()["trips"]) == 1


# ─── Get single trip ─────────────────────────────────────────────────────────

def test_get_single_trip(client, seeded_db):
    client.post("/driver/api/auth/login", json={"phone": "+254722100001", "role": "driver"})
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    client.post("/rider/api/auth/login", json={"phone": "+254712345001", "role": "rider"})
    r = client.get(f"/rider/api/trips/{trip_id}")
    assert r.status_code == 200
    assert r.get_json()["trip"]["id"] == trip_id


def test_get_trip_not_found(rider_session):
    r = rider_session.get("/rider/api/trips/99999")
    assert r.status_code == 404


# ─── GPS endpoint ────────────────────────────────────────────────────────────

def test_gps_endpoint_returns_position(driver_session):
    trip_id = _create_trip(driver_session).get_json()["trip"]["id"]
    r = driver_session.get(f"/driver/api/trips/{trip_id}/gps")
    assert r.status_code == 200
    data = r.get_json()
    assert "current_lat" in data
    assert "current_lng" in data
    assert data["status"] == "active"


# ─── Pause / Resume ──────────────────────────────────────────────────────────

def test_pause_active_trip(driver_session):
    trip_id = _create_trip(driver_session).get_json()["trip"]["id"]
    r = driver_session.patch(f"/driver/api/trips/{trip_id}/pause")
    assert r.status_code == 200
    assert r.get_json()["trip"]["status"] == "paused"


def test_resume_paused_trip(driver_session):
    trip_id = _create_trip(driver_session).get_json()["trip"]["id"]
    driver_session.patch(f"/driver/api/trips/{trip_id}/pause")
    r = driver_session.patch(f"/driver/api/trips/{trip_id}/resume")
    assert r.status_code == 200
    assert r.get_json()["trip"]["status"] == "active"


def test_pause_already_paused_returns_409(driver_session):
    trip_id = _create_trip(driver_session).get_json()["trip"]["id"]
    driver_session.patch(f"/driver/api/trips/{trip_id}/pause")
    r = driver_session.patch(f"/driver/api/trips/{trip_id}/pause")
    assert r.status_code == 409


# ─── End trip ────────────────────────────────────────────────────────────────

def test_end_active_trip(driver_session):
    trip_id = _create_trip(driver_session).get_json()["trip"]["id"]
    r = driver_session.patch(f"/driver/api/trips/{trip_id}/end")
    assert r.status_code == 200
    assert r.get_json()["trip"]["status"] == "ended"


def test_end_trip_cancels_pending_pickups(driver_session, app):
    trip_id = _create_trip(driver_session).get_json()["trip"]["id"]

    # Get the seeded rider id
    import database
    with app.app_context():
        conn = database.get_db()
        rider_id = conn.execute("SELECT id FROM RIDER LIMIT 1").fetchone()["id"]
        conn.execute(
            """INSERT INTO PICKUP
               (trip_id, rider_id, pickup_type, status, stop_id, pickup_lat, pickup_lng, seats_requested)
               VALUES (?, ?, 'flagging', 'pending', 'githurai', -1.18, 36.9, 1)""",
            (trip_id, rider_id),
        )
        conn.commit()

    driver_session.patch(f"/driver/api/trips/{trip_id}/end")

    with app.app_context():
        conn = database.get_db()
        pickup = conn.execute(
            "SELECT status FROM PICKUP WHERE trip_id = ?", (trip_id,)
        ).fetchone()
    assert pickup["status"] == "cancelled"


def test_end_already_ended_returns_409(driver_session):
    trip_id = _create_trip(driver_session).get_json()["trip"]["id"]
    driver_session.patch(f"/driver/api/trips/{trip_id}/end")
    r = driver_session.patch(f"/driver/api/trips/{trip_id}/end")
    assert r.status_code == 409


# ─── History ─────────────────────────────────────────────────────────────────

def test_history_returns_ended_trips(driver_session):
    trip_id = _create_trip(driver_session).get_json()["trip"]["id"]
    driver_session.patch(f"/driver/api/trips/{trip_id}/end")
    r = driver_session.get("/driver/api/trips/history")
    assert r.status_code == 200
    trips = r.get_json()["trips"]
    assert any(t["id"] == trip_id for t in trips)


# ─── Riders endpoint (stub — full test in Phase 6) ───────────────────────────

def test_riders_endpoint_returns_active_pickups(driver_session):
    trip_id = _create_trip(driver_session).get_json()["trip"]["id"]
    r = driver_session.get(f"/driver/api/trips/{trip_id}/riders")
    assert r.status_code == 200
    assert r.get_json()["riders"] == []


@pytest.mark.skip(reason="No-show check requires reservation pickups — tested in Phase 8")
def test_riders_endpoint_triggers_noshow_check(driver_session):
    pass

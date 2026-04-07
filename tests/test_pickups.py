"""tests/test_pickups.py — Pickup endpoint tests."""
import pytest

VALID_TRIP = {
    "route_id": "cbd_thika",
    "active_stop_ids": ["cbd", "githurai", "thika"],
    "seats_total": 14,
    "fare": 80,
}

VALID_PICKUP = {
    "pickup_type": "flagging",
    "stop_id": "githurai",
    "seats_requested": 1,
}


def _create_trip(client):
    return client.post("/driver/api/trips", json=VALID_TRIP)


def _create_pickup(client, trip_id, overrides=None):
    body = {**VALID_PICKUP, "trip_id": trip_id, **(overrides or {})}
    return client.post("/rider/api/pickups", json=body)


def _login_driver(client):
    client.post("/driver/api/auth/login", json={"phone": "+254722100001", "role": "driver"})


def _login_rider(client):
    client.post("/rider/api/auth/login", json={"phone": "+254712345001", "role": "rider"})


# ─── Create pickup ────────────────────────────────────────────────────────────

def test_create_flagging_pickup(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    r = _create_pickup(client, trip_id)
    assert r.status_code == 201
    p = r.get_json()["pickup"]
    assert p["status"] == "pending"
    assert p["pickup_type"] == "flagging"
    assert p["stop_id"] == "githurai"


def test_create_pickup_inactive_stop(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    r = _create_pickup(client, trip_id, {"stop_id": "ruiru"})  # not in active_stop_ids
    assert r.status_code == 400


def test_create_pickup_insufficient_seats(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    r = _create_pickup(client, trip_id, {"seats_requested": 99})
    assert r.status_code == 400


def test_create_reservation_pickup(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    r = _create_pickup(client, trip_id, {
        "pickup_type": "reservation",
        "pickup_window_start": "2026-04-06T07:28:00",
        "pickup_window_end": "2026-04-06T07:38:00",
    })
    assert r.status_code == 201
    assert r.get_json()["pickup"]["pickup_type"] == "reservation"


# ─── Active pickup ────────────────────────────────────────────────────────────

def test_active_pickup_returns_null_when_none(client, seeded_db):
    _login_rider(client)
    r = client.get("/rider/api/pickups/active")
    assert r.status_code == 200
    assert r.get_json()["pickup"] is None


def test_active_pickup_returns_pending(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    _create_pickup(client, trip_id)
    r = client.get("/rider/api/pickups/active")
    assert r.status_code == 200
    assert r.get_json()["pickup"]["status"] == "pending"


# ─── Spot ─────────────────────────────────────────────────────────────────────

def test_spot_pickup(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    pickup_id = _create_pickup(client, trip_id).get_json()["pickup"]["id"]
    r = client.patch(f"/rider/api/pickups/{pickup_id}/spot")
    assert r.status_code == 200
    assert r.get_json()["pickup"]["spotted"] is True


def test_spot_pickup_idempotent(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    pickup_id = _create_pickup(client, trip_id).get_json()["pickup"]["id"]
    client.patch(f"/rider/api/pickups/{pickup_id}/spot")
    r = client.patch(f"/rider/api/pickups/{pickup_id}/spot")
    assert r.status_code == 409


# ─── Accept ───────────────────────────────────────────────────────────────────

def test_accept_pending_pickup(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    pickup_id = _create_pickup(client, trip_id).get_json()["pickup"]["id"]
    _login_driver(client)
    r = client.patch(f"/driver/api/pickups/{pickup_id}/accept")
    assert r.status_code == 200
    assert r.get_json()["pickup"]["status"] == "accepted"


# ─── Reject ───────────────────────────────────────────────────────────────────

def test_reject_pending_pickup(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    pickup_id = _create_pickup(client, trip_id).get_json()["pickup"]["id"]
    _login_driver(client)
    r = client.patch(f"/driver/api/pickups/{pickup_id}/reject")
    assert r.status_code == 200
    assert r.get_json()["pickup"]["status"] == "rejected"


# ─── Board ────────────────────────────────────────────────────────────────────

def test_board_accepted_pickup_decrements_seats(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    pickup_id = _create_pickup(client, trip_id).get_json()["pickup"]["id"]
    _login_driver(client)
    client.patch(f"/driver/api/pickups/{pickup_id}/accept")
    _login_rider(client)
    r = client.patch(f"/rider/api/pickups/{pickup_id}/board")
    assert r.status_code == 200
    # Verify seats decremented
    trip = client.get(f"/rider/api/trips/{trip_id}").get_json()["trip"]
    assert trip["seats_available"] == 13


def test_board_pauses_trip_when_seats_reach_zero(client, seeded_db, app):
    _login_driver(client)
    # Create trip with 1 seat
    trip_id = client.post("/driver/api/trips", json={**VALID_TRIP, "seats_total": 1}).get_json()["trip"]["id"]
    _login_rider(client)
    pickup_id = _create_pickup(client, trip_id).get_json()["pickup"]["id"]
    _login_driver(client)
    client.patch(f"/driver/api/pickups/{pickup_id}/accept")
    _login_rider(client)
    client.patch(f"/rider/api/pickups/{pickup_id}/board")
    trip = client.get(f"/rider/api/trips/{trip_id}").get_json()["trip"]
    assert trip["status"] == "paused"


# ─── Cancel ───────────────────────────────────────────────────────────────────

def test_cancel_pending_pickup(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    pickup_id = _create_pickup(client, trip_id).get_json()["pickup"]["id"]
    r = client.patch(f"/rider/api/pickups/{pickup_id}/cancel")
    assert r.status_code == 200
    assert r.get_json()["pickup"]["status"] == "cancelled"


def test_cancel_accepted_pickup(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    pickup_id = _create_pickup(client, trip_id).get_json()["pickup"]["id"]
    _login_driver(client)
    client.patch(f"/driver/api/pickups/{pickup_id}/accept")
    _login_rider(client)
    r = client.patch(f"/rider/api/pickups/{pickup_id}/cancel")
    assert r.status_code == 200
    assert r.get_json()["pickup"]["status"] == "cancelled"


# ─── History ─────────────────────────────────────────────────────────────────

def test_history_returns_all_rider_pickups(client, seeded_db):
    _login_driver(client)
    trip_id = _create_trip(client).get_json()["trip"]["id"]
    _login_rider(client)
    _create_pickup(client, trip_id)
    r = client.get("/rider/api/pickups/history")
    assert r.status_code == 200
    assert len(r.get_json()["pickups"]) == 1

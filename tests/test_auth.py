"""tests/test_auth.py — Auth endpoint tests."""


def test_rider_login_valid(client, seeded_db):
    r = client.post("/rider/api/auth/login", json={"phone": "+254712345001", "role": "rider"})
    assert r.status_code == 200
    data = r.get_json()
    assert data["user"]["name"] == "Amina Wanjiru"
    assert data["user"]["role"] == "rider"


def test_driver_login_valid(client, seeded_db):
    r = client.post("/rider/api/auth/login", json={"phone": "+254722100001", "role": "driver"})
    assert r.status_code == 200
    data = r.get_json()
    assert data["user"]["plate"] == "KJA 001A"
    assert data["user"]["sacco"] == "Super Metro"


def test_login_unknown_phone(client, seeded_db):
    r = client.post("/rider/api/auth/login", json={"phone": "+254000000000", "role": "rider"})
    assert r.status_code == 404
    assert r.get_json()["error"] == "user not found"


def test_login_wrong_role(client, seeded_db):
    r = client.post("/rider/api/auth/login", json={"phone": "+254712345001", "role": "admin"})
    assert r.status_code == 400


def test_logout_clears_session(client, seeded_db):
    client.post("/rider/api/auth/login", json={"phone": "+254712345001", "role": "rider"})
    r = client.post("/rider/api/auth/logout")
    assert r.status_code == 200
    # Session should now be gone
    r = client.get("/rider/api/auth/session")
    assert r.status_code == 401


def test_session_returns_current_user(client, seeded_db):
    client.post("/rider/api/auth/login", json={"phone": "+254712345001", "role": "rider"})
    r = client.get("/rider/api/auth/session")
    assert r.status_code == 200
    assert r.get_json()["user"]["phone"] == "+254712345001"


def test_session_returns_401_when_not_logged_in(client, seeded_db):
    r = client.get("/rider/api/auth/session")
    assert r.status_code == 401

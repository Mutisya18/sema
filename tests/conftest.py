"""
tests/conftest.py — Shared pytest fixtures.
Uses a temporary file-based SQLite database so all fixtures share the same data.
"""

import os
import tempfile
import pytest

# Use a temp file DB so all connections see the same data
_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)

os.environ["DATABASE_PATH"] = _db_path
os.environ["SECRET_KEY"] = "test-secret"
os.environ["FLASK_ENV"] = "development"
os.environ["MAPBOX_TOKEN"] = "test-token"

import database  # noqa: E402
import seed      # noqa: E402
from app import create_app  # noqa: E402


@pytest.fixture(scope="session")
def app():
    flask_app = create_app()
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def seeded_db(app):
    """Reset and reseed the database before each test."""
    with app.app_context():
        conn = database.get_db()
        conn.execute("DELETE FROM PICKUP")
        conn.execute("DELETE FROM TRIP_STOPS")
        conn.execute("DELETE FROM TRIP")
        conn.execute("DELETE FROM DRIVER")
        conn.execute("DELETE FROM RIDER")
        conn.commit()
    seed.seed()


@pytest.fixture()
def rider_session(client, seeded_db):
    client.post("/rider/api/auth/login", json={"phone": "+254712345001", "role": "rider"})
    return client


@pytest.fixture()
def driver_session(client, seeded_db):
    client.post("/driver/api/auth/login", json={"phone": "+254722100001", "role": "driver"})
    return client

"""
database.py — SQLite connection management and schema initialisation.
Uses Flask's g object to provide a per-request connection that is closed on teardown.
get_db() returns the same connection within a request context.
Outside a request context (seed, tests), returns a direct connection.
"""

import sqlite3
import logging

import config

logger = logging.getLogger(__name__)


def get_db():
    """
    Return a SQLite connection.
    Inside a Flask request context: returns a per-request connection stored in g.
    Outside a request context: returns a direct connection (seed, tests).
    """
    try:
        from flask import g
        if not hasattr(g, "_db"):
            g._db = _open_connection()
        return g._db
    except RuntimeError:
        # No application context — return a direct connection
        return _open_connection()


def _open_connection():
    """Open and configure a SQLite connection."""
    connection = sqlite3.connect(config.DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _safe_add_column(conn, table, column, col_type):
    """Add a column to a table if it doesn't already exist."""
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
        conn.commit()
    except Exception:
        pass  # Column already exists


def close_db(error=None):
    """Close the per-request database connection. Registered as a teardown handler."""
    try:
        from flask import g
        db = g.pop("_db", None)
        if db is not None:
            db.close()
    except RuntimeError:
        pass


def init_db():
    """
    Create all tables if they do not already exist.
    Safe to call multiple times — uses CREATE TABLE IF NOT EXISTS.
    """
    connection = get_db()
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS RIDER (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            phone      TEXT    NOT NULL UNIQUE,
            email      TEXT    NOT NULL UNIQUE,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS DRIVER (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            phone      TEXT    NOT NULL UNIQUE,
            plate      TEXT    NOT NULL UNIQUE,
            sacco      TEXT    NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS TRIP (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id            INTEGER NOT NULL REFERENCES DRIVER(id),
            route_id             TEXT    NOT NULL,
            status               TEXT    NOT NULL DEFAULT 'active',
            seats_total          INTEGER NOT NULL,
            seats_available      INTEGER NOT NULL,
            fare                 INTEGER NOT NULL,
            current_lat          REAL    NOT NULL,
            current_lng          REAL    NOT NULL,
            current_step         INTEGER NOT NULL DEFAULT 0,
            scheduled_departure  DATETIME,
            started_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ended_at             DATETIME,
            created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS SAVED_TRIP (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id  INTEGER NOT NULL REFERENCES DRIVER(id),
            route_id   TEXT    NOT NULL,
            stop_ids   TEXT    NOT NULL,
            fare       INTEGER NOT NULL,
            name       TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS TRIP_STOPS (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id    INTEGER NOT NULL REFERENCES TRIP(id),
            stop_id    TEXT    NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(trip_id, stop_id)
        );

        CREATE TABLE IF NOT EXISTS PICKUP (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id              INTEGER NOT NULL REFERENCES TRIP(id),
            rider_id             INTEGER NOT NULL REFERENCES RIDER(id),
            pickup_type          TEXT    NOT NULL,
            status               TEXT    NOT NULL DEFAULT 'pending',
            spotted              INTEGER NOT NULL DEFAULT 0,
            stop_id              TEXT    NOT NULL,
            pickup_lat           REAL    NOT NULL,
            pickup_lng           REAL    NOT NULL,
            seats_requested      INTEGER NOT NULL DEFAULT 1,
            alert_level          TEXT    NOT NULL DEFAULT 'none',
            pickup_window_start  DATETIME,
            pickup_window_end    DATETIME,
            boarded_at           DATETIME,
            spotted_at           DATETIME,
            created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(trip_id, rider_id)
        );

        CREATE INDEX IF NOT EXISTS idx_trip_driver_id   ON TRIP(driver_id);
        CREATE INDEX IF NOT EXISTS idx_trip_status      ON TRIP(status);
        CREATE INDEX IF NOT EXISTS idx_trip_route_id    ON TRIP(route_id);
        CREATE INDEX IF NOT EXISTS idx_trip_scheduled   ON TRIP(scheduled_departure);
        CREATE INDEX IF NOT EXISTS idx_saved_trip_driver ON SAVED_TRIP(driver_id);
        CREATE INDEX IF NOT EXISTS idx_trip_stops_trip  ON TRIP_STOPS(trip_id);
        CREATE INDEX IF NOT EXISTS idx_trip_stops_stop  ON TRIP_STOPS(stop_id);
        CREATE INDEX IF NOT EXISTS idx_pickup_trip_id   ON PICKUP(trip_id);
        CREATE INDEX IF NOT EXISTS idx_pickup_rider_id  ON PICKUP(rider_id);
        CREATE INDEX IF NOT EXISTS idx_pickup_status    ON PICKUP(status);
        CREATE INDEX IF NOT EXISTS idx_pickup_spotted   ON PICKUP(spotted);
    """)
    connection.commit()
    # Add columns that may not exist in older databases (safe migrations)
    _safe_add_column(connection, "TRIP", "scheduled_departure", "DATETIME")
    logger.info({"event": "db_initialised", "message": "Schema created or verified"})

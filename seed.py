"""
seed.py — Inserts seed riders and drivers if they do not already exist.
Safe to run multiple times; checks by phone number before inserting.
"""

import logging

import database

logger = logging.getLogger(__name__)

SEED_RIDERS = [
    {"name": "Amina Wanjiru", "phone": "+254712345001", "email": "amina@sema.test"},
    {"name": "Brian Otieno",  "phone": "+254712345002", "email": "brian@sema.test"},
    {"name": "Peter Kamau",   "phone": "+254712345003", "email": "peter@sema.test"},
]

SEED_DRIVERS = [
    {"name": "James Mwangi",  "phone": "+254722100001", "plate": "KJA 001A", "sacco": "Super Metro"},
    {"name": "Susan Njoki",   "phone": "+254722100002", "plate": "KBZ 445K", "sacco": "OMA Sacco"},
    {"name": "Kevin Ochieng", "phone": "+254722100003", "plate": "KDA 223B", "sacco": "City Shuttle"},
]


def seed():
    """Insert seed data into the database if not already present."""
    # Always use a fresh direct connection — safe to call from any context
    connection = database._open_connection()
    database.init_db()  # ensure schema exists
    _seed_riders(connection)
    _seed_drivers(connection)
    connection.commit()
    connection.close()
    logger.info({"event": "seed_completed", "message": "Seed data verified"})
    print("Seed complete.")


def _seed_riders(connection):
    """Insert seed riders that do not already exist (checked by phone)."""
    for rider in SEED_RIDERS:
        existing = connection.execute(
            "SELECT id FROM RIDER WHERE phone = ?", (rider["phone"],)
        ).fetchone()
        if not existing:
            connection.execute(
                "INSERT INTO RIDER (name, phone, email) VALUES (?, ?, ?)",
                (rider["name"], rider["phone"], rider["email"]),
            )
            logger.info({"event": "rider_seeded", "phone": rider["phone"]})


def _seed_drivers(connection):
    """Insert seed drivers that do not already exist (checked by phone)."""
    for driver in SEED_DRIVERS:
        existing = connection.execute(
            "SELECT id FROM DRIVER WHERE phone = ?", (driver["phone"],)
        ).fetchone()
        if not existing:
            connection.execute(
                "INSERT INTO DRIVER (name, phone, plate, sacco) VALUES (?, ?, ?, ?)",
                (driver["name"], driver["phone"], driver["plate"], driver["sacco"]),
            )
            logger.info({"event": "driver_seeded", "phone": driver["phone"]})


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    from dotenv import load_dotenv
    load_dotenv()
    seed()

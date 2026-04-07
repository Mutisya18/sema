"""
config.py — Reads environment variables and exposes them as a config object.
All other modules import from here; none read os.environ directly.
"""

import os

MAPBOX_TOKEN = os.environ.get("MAPBOX_TOKEN", "")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret")
DATABASE_PATH = os.environ.get("DATABASE_PATH", "sema.db")
FLASK_ENV = os.environ.get("FLASK_ENV", "development")
DEBUG = FLASK_ENV == "development"

# Seconds between each simulator position advancement.
# Default gives ~5 min trip duration across 8 placeholder coordinates (60s × 8 = ~8 min).
# Set lower in tests, higher for longer trips.
SIMULATOR_STEP_INTERVAL_SECONDS = int(os.environ.get("SIMULATOR_STEP_INTERVAL_SECONDS", "60"))

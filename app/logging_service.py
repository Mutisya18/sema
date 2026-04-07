"""
app/logging_service.py — Session-based structured logging for backend and frontend logs.

Provides:
- Unified backend log file per app run (all sessions appended to same file)
- Frontend log batches written to unified file
- Each log entry includes session_id for filtering
- File named with app startup timestamp
"""

import json
import logging
import os
from datetime import datetime
from pathlib import Path

import config


LOGS_DIR = Path(config.DATABASE_PATH).parent / "logs"
BACKEND_LOGS_DIR = LOGS_DIR / "backend"
FRONTEND_LOGS_DIR = LOGS_DIR / "frontend"

# Global reference to backend logger (created once per app)
_app_logger = None
_app_start_time = datetime.utcnow().strftime("%Y-%m-%d-%H-%M-%S")


def ensure_log_directories():
    """Create logs/{backend,frontend} directories if they do not exist."""
    BACKEND_LOGS_DIR.mkdir(parents=True, exist_ok=True)
    FRONTEND_LOGS_DIR.mkdir(parents=True, exist_ok=True)


def get_backend_log_path():
    """Return the unified backend log file path for this app run."""
    return BACKEND_LOGS_DIR / f"backend-{_app_start_time}.log"


def get_frontend_log_path():
    """Return the unified frontend log file path for this app run."""
    return FRONTEND_LOGS_DIR / f"frontend-{_app_start_time}.log"


def get_app_logger():
    """
    Get or create the unified app logger (single logger for all sessions).

    Returns:
        logging.Logger configured to write to the app-wide log file.
    """
    global _app_logger

    if _app_logger is not None:
        return _app_logger

    ensure_log_directories()

    _app_logger = logging.getLogger("app")
    _app_logger.setLevel(logging.DEBUG)
    _app_logger.propagate = False

    # Remove existing handlers to avoid duplicates
    for handler in _app_logger.handlers[:]:
        _app_logger.removeHandler(handler)

    log_file = get_backend_log_path()
    handler = logging.FileHandler(log_file)
    handler.setLevel(logging.DEBUG)

    formatter = logging.Formatter(
        "%(asctime)s - %(levelname)s - %(message)s"
    )
    handler.setFormatter(formatter)
    _app_logger.addHandler(handler)

    return _app_logger


def log_event(session_id, event_name, status="success", **metadata):
    """
    Log a structured event to the unified backend log file.

    Args:
        session_id: Session identifier (for filtering/correlation)
        event_name: Name of the event (e.g., 'login_success', 'api_call')
        status: 'success', 'failure', or custom status
        **metadata: Additional context (user_id, endpoint, error, etc.)
    """
    logger = get_app_logger()

    event = {
        "timestamp": datetime.utcnow().isoformat(),
        "session_id": session_id,
        "event": event_name,
        "status": status,
        "metadata": metadata,
    }
    logger.info(json.dumps(event))


def write_frontend_logs(session_id, logs):
    """
    Write a batch of frontend logs to the unified frontend log file.

    Args:
        session_id: Session identifier (for filtering/correlation)
        logs: List of log objects from the frontend
    """
    ensure_log_directories()

    log_file = get_frontend_log_path()

    with open(log_file, "a") as f:
        for log_entry in logs:
            # Inject session_id into each frontend log entry
            log_entry["session_id"] = session_id
            f.write(json.dumps(log_entry) + "\n")

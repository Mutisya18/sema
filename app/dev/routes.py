"""
app/dev/routes.py — Developer-only endpoints.
Only registered when FLASK_ENV=development.
POST /api/dev/reset wipes all runtime data and reseeds the database.
POST /api/dev/logs accepts frontend logs and writes them to session log files.
"""

import logging

from flask import Blueprint, request, session, jsonify

import database
import seed
from app.simulator.engine import stop_all_simulators
from app.logging_service import write_frontend_logs

logger = logging.getLogger(__name__)
dev_bp = Blueprint("dev", __name__)


@dev_bp.route("/reset", methods=["POST"])
def reset():
    """
    Wipe all runtime data and reseed the database to its initial state.
    Stops all active simulator threads before clearing data.

    Returns:
        200: {message: 'database reset and reseeded'}
    """
    stop_all_simulators()

    connection = database.get_db()
    connection.execute("DELETE FROM PICKUP")
    connection.execute("DELETE FROM TRIP_STOPS")
    connection.execute("DELETE FROM TRIP")
    connection.execute("DELETE FROM SAVED_TRIP")
    connection.execute("DELETE FROM DRIVER")
    connection.execute("DELETE FROM RIDER")
    connection.commit()

    seed.seed()

    logger.info({"event": "dev_reset_completed", "message": "Database reset and reseeded"})
    return {"message": "database reset and reseeded"}, 200


@dev_bp.route("/logs", methods=["POST"])
def submit_frontend_logs():
    """
    Receive frontend logs from the browser and write them to the session log file.

    Request body: {logs: [...]}
    Returns 200 on success, 400 if session_id is missing.
    """
    session_id = session.get("session_id")
    if not session_id:
        return jsonify({"error": "no active session"}), 400

    body = request.get_json(silent=True) or {}
    logs = body.get("logs", [])

    if logs:
        try:
            write_frontend_logs(session_id, logs)
        except Exception as err:
            logger.error({"event": "frontend_logs_write_failed", "error": str(err)})
            return jsonify({"error": "failed to write logs"}), 500

    return jsonify({"message": "logs received"}), 200

"""
app/auth/routes.py — Authentication endpoints.
Handles login, logout, and session check for both riders and drivers.
All authentication events are logged to the unified app log file.
"""

import uuid

from flask import Blueprint, request, session, jsonify

import database
from app.logging_service import log_event
auth_bp = Blueprint("auth", __name__)

VALID_ROLES = {"rider", "driver"}


def normalize_phone(phone):
    phone = (phone or "").strip()
    digits = "".join(ch for ch in phone if ch.isdigit())
    if not digits:
        return ""
    if digits.startswith("0"):
        digits = "254" + digits[1:]
    if digits.startswith("254"):
        return "+" + digits
    return "+" + digits


@auth_bp.route("/login", methods=["POST"])
def login():
    """
    Authenticate a seeded user by phone and role. Creates a Flask session.

    Request body: {phone, role}
    Returns 200 with user object on success, 404 if not found, 400 if invalid role.
    """
    body = request.get_json(silent=True) or {}
    phone = normalize_phone(body.get("phone", ""))
    role = body.get("role", "").strip()

    if role not in VALID_ROLES:
        return jsonify({"error": "role must be rider or driver"}), 400

    table = "RIDER" if role == "rider" else "DRIVER"
    conn = database.get_db()
    try:
        row = conn.execute(f"SELECT * FROM {table} WHERE phone = ?", (phone,)).fetchone()
    finally:
        conn.close()

    if not row:
        log_event("", "login_failed", status="failed", role=role, reason="user_not_found")
        return jsonify({"error": "user not found"}), 404

    session_id = str(uuid.uuid4())
    session.clear()
    session["session_id"] = session_id
    session["user_id"] = row["id"]
    session["role"] = role
    session["user_name"] = row["name"]
    session["user_phone"] = row["phone"]

    log_event(
        session_id,
        "login_success",
        status="success",
        user_id=row["id"],
        user_name=row["name"],
        phone=row["phone"],
        role=role,
    )

    user = {"id": row["id"], "name": row["name"], "phone": row["phone"], "role": role}

    if role == "driver":
        session["plate"] = row["plate"]
        session["sacco"] = row["sacco"]
        user["plate"] = row["plate"]
        user["sacco"] = row["sacco"]

    return jsonify({"user": user, "session_id": session_id}), 200


@auth_bp.route("/logout", methods=["POST"])
def logout():
    """Destroy the current session and log the logout event."""
    session_id = session.get("session_id")
    user_id = session.get("user_id")

    if session_id:
        log_event(session_id, "logout", status="success", user_id=user_id)

    session.clear()
    return jsonify({"message": "logged out"}), 200


@auth_bp.route("/session", methods=["GET"])
def get_session():
    """
    Return the current session user or 401 if not logged in.
    Used by both frontends on page load to restore state and reinitialize logging.
    """
    if "user_id" not in session:
        return jsonify({"error": "unauthorized"}), 401

    user = {
        "id": session["user_id"],
        "name": session["user_name"],
        "phone": session["user_phone"],
        "role": session["role"],
    }
    if session["role"] == "driver":
        user["plate"] = session.get("plate")
        user["sacco"] = session.get("sacco")

    return jsonify({"user": user, "session_id": session.get("session_id")}), 200

"""
app/config/routes.py — Route config endpoint.
Serves all route definitions from gps.py to both frontends on page load.
"""

from flask import Blueprint, jsonify

import gps

config_bp = Blueprint("config", __name__)


@config_bp.route("/routes", methods=["GET"])
def get_routes():
    """
    Return all route definitions including stops and coordinate arrays.
    Called once on page load by both frontends; result stored in memory.

    Returns:
        200: {routes: [...]}
    """
    routes = [
        {
            "id": route["id"],
            "name": route["name"],
            "coordinates": route["coordinates"],
            "stops": route["stops"],
        }
        for route in gps.ROUTES.values()
    ]
    return jsonify({"routes": routes}), 200

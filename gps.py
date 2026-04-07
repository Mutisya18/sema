"""
gps.py — Single source of truth for route definitions and simulation logic.

Exposes:
  ROUTES            — dict of all route definitions
  get_route()       — fetch a route by id
  get_stop()        — fetch a stop within a route
  get_next_position() — abstraction boundary: returns next simulator position
  compute_distance()  — Haversine distance in metres
  compute_alert_level() — maps distance to alert level string
"""

import math
import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Route definitions
# Coordinate arrays are placeholder stubs (5–10 points each).
# Real coordinates will be pasted in during Phase 5.
# Each stop's `step` is the index of its coordinate in the array.
# ---------------------------------------------------------------------------

ROUTES = {
    "cbd_thika": {
        "id": "cbd_thika",
        "name": "CBD → Thika Town",
        "coordinates": [
            [36.81654511339093, -1.2808328158798616],
            [36.82787806324754, -1.2720057371279978],
            [36.8396654293104,  -1.26242157129019],
            [36.866188942389016,-1.2452926483952353],
            [36.891502053626056,-1.2197714194386435],
            [36.91667409788431, -1.203980507002683],
            [36.96344784618981, -1.1479282596892944],
            [37.019352003794154,-1.1040135411604552],
            [37.06367490652238, -1.0374688621399883],
        ],
        "stops": [
            {"id": "cbd",       "name": "CBD",            "lat": -1.2808328158798616, "lng": 36.81654511339093,  "step": 0},
            {"id": "ngara",     "name": "Ngara",           "lat": -1.2720057371279978, "lng": 36.82787806324754,  "step": 1},
            {"id": "muthaiga",  "name": "Muthaiga Stage",  "lat": -1.26242157129019,   "lng": 36.8396654293104,   "step": 2},
            {"id": "allsops",   "name": "Allsops",         "lat": -1.2452926483952353, "lng": 36.866188942389016, "step": 3},
            {"id": "kasarani",  "name": "Kasarani",        "lat": -1.2197714194386435, "lng": 36.891502053626056, "step": 4},
            {"id": "githurai",  "name": "Githurai Stage",  "lat": -1.203980507002683,  "lng": 36.91667409788431,  "step": 5},
            {"id": "ruiru",     "name": "Ruiru Stage",     "lat": -1.1479282596892944, "lng": 36.96344784618981,  "step": 6},
            {"id": "juja",      "name": "Juja",            "lat": -1.1040135411604552, "lng": 37.019352003794154, "step": 7},
            {"id": "thika",     "name": "Thika Town",      "lat": -1.0374688621399883, "lng": 37.06367490652238,  "step": 8},
        ],
    },
    "cbd_ruaka": {
        "id": "cbd_ruaka",
        "name": "CBD → Ruaka",
        "coordinates": [
            [36.821405502323444, -1.2776361095159956],
            [36.8411941523992,   -1.2621391094470766],
            [36.84607942939064,  -1.2511866055447456],
            [36.83892684954748,  -1.2249367396394746],
            [36.83507993355525,  -1.215331504338394],
            [36.80813078465283,  -1.213147232366083],
            [36.780338310226114, -1.204989205118224],
        ],
        "stops": [
            {"id": "cbd",              "name": "CBD",               "lat": -1.2776361095159956, "lng": 36.821405502323444, "step": 0},
            {"id": "mathare",          "name": "Mathare",           "lat": -1.2621391094470766, "lng": 36.8411941523992,   "step": 1},
            {"id": "karura",           "name": "Karura",            "lat": -1.2511866055447456, "lng": 36.84607942939064,  "step": 2},
            {"id": "ridgeways",        "name": "Ridgeways",         "lat": -1.2249367396394746, "lng": 36.83892684954748,  "step": 3},
            {"id": "fourways_junction","name": "Fourways Junction", "lat": -1.215331504338394,  "lng": 36.83507993355525,  "step": 4},
            {"id": "runda",            "name": "Runda",             "lat": -1.213147232366083,  "lng": 36.80813078465283,  "step": 5},
            {"id": "ruaka",            "name": "Ruaka",             "lat": -1.204989205118224,  "lng": 36.780338310226114, "step": 6},
        ],
    },
    "cbd_pipeline": {
        "id": "cbd_pipeline",
        "name": "CBD → Pipeline",
        "coordinates": [
            [36.81492969878809,  -1.2816338696283651],
            [36.8219833422915,   -1.2952137402764947],
            [36.82632371466312,  -1.3049873929177949],
            [36.87841420594262,  -1.3283373214253231],
            [36.889908130975726, -1.3303444638498831],
            [36.90008674189784,  -1.3238030971735242],
        ],
        "stops": [
            {"id": "cbd",          "name": "CBD",          "lat": -1.2816338696283651, "lng": 36.81492969878809,  "step": 0},
            {"id": "railways",     "name": "Railways",     "lat": -1.2952137402764947, "lng": 36.8219833422915,   "step": 1},
            {"id": "nyayo",        "name": "Nyayo",        "lat": -1.3049873929177949, "lng": 36.82632371466312,  "step": 2},
            {"id": "imaara_daima", "name": "Imaara Daima", "lat": -1.3283373214253231, "lng": 36.87841420594262,  "step": 3},
            {"id": "utawala",      "name": "Utawala",      "lat": -1.3303444638498831, "lng": 36.889908130975726, "step": 4},
            {"id": "pipeline",     "name": "Pipeline",     "lat": -1.3238030971735242, "lng": 36.90008674189784,  "step": 5},
        ],
    },
}

# ---------------------------------------------------------------------------
# Alert level thresholds (metres)
# ---------------------------------------------------------------------------
ALERT_NEAR_THRESHOLD_METRES = 500
ALERT_APPROACHING_THRESHOLD_METRES = 1500


def get_route(route_id):
    """
    Return the route definition for the given route_id.

    Args:
        route_id (str): Route identifier, e.g. 'cbd_thika'.

    Returns:
        dict: Route definition including coordinates and stops.

    Raises:
        KeyError: If route_id is not found in ROUTES.
    """
    if route_id not in ROUTES:
        raise KeyError(f"Route not found: {route_id}")
    return ROUTES[route_id]


def get_stop(route_id, stop_id):
    """
    Return a specific stop definition within a route.

    Args:
        route_id (str): Route identifier.
        stop_id  (str): Stop identifier within that route.

    Returns:
        dict: Stop definition with id, name, lat, lng, step.

    Raises:
        KeyError: If route or stop is not found.
    """
    route = get_route(route_id)
    for stop in route["stops"]:
        if stop["id"] == stop_id:
            return stop
    raise KeyError(f"Stop '{stop_id}' not found in route '{route_id}'")


def get_next_position(route_id, current_step):
    """
    Abstraction boundary for simulation vs live GPS.
    Returns the next position along the route from current_step.

    Args:
        route_id     (str): Route identifier.
        current_step (int): Current index in the coordinate array.

    Returns:
        dict: {lat, lng, next_step, is_final}
    """
    route = get_route(route_id)
    coordinates = route["coordinates"]
    next_step = current_step + 1

    if next_step >= len(coordinates):
        # Already at or past the final coordinate — stay at last position
        last = coordinates[-1]
        return {
            "lat": last[1],
            "lng": last[0],
            "next_step": current_step,
            "is_final": True,
        }

    coord = coordinates[next_step]
    is_final = next_step >= len(coordinates) - 1

    return {
        "lat": coord[1],
        "lng": coord[0],
        "next_step": next_step,
        "is_final": is_final,
    }


def compute_distance(lat1, lng1, lat2, lng2):
    """
    Compute straight-line distance between two coordinates using Haversine.

    Args:
        lat1, lng1 (float): First coordinate.
        lat2, lng2 (float): Second coordinate.

    Returns:
        float: Distance in metres.
    """
    earth_radius_metres = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_metres * c


def compute_alert_level(distance_metres):
    """
    Map a distance in metres to a proximity alert level string.

    Args:
        distance_metres (float): Distance between matatu and pickup location.

    Returns:
        str: 'near', 'approaching', or 'none'.
    """
    if distance_metres <= ALERT_NEAR_THRESHOLD_METRES:
        return "near"
    if distance_metres <= ALERT_APPROACHING_THRESHOLD_METRES:
        return "approaching"
    return "none"

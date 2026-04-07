"""
app/__init__.py — Single Flask app with role-isolated sessions.

Rider sessions use cookie 'sema_rider_session' (path=/rider).
Driver sessions use cookie 'sema_driver_session' (path=/driver).
This prevents session bleed when testing both roles in the same browser.
"""

import logging
from datetime import timedelta

from flask import Flask, redirect, url_for, render_template, request, session
from werkzeug.middleware.dispatcher import DispatcherMiddleware

import config as app_config
import database

logger = logging.getLogger(__name__)


def create_app():
    app = Flask(
        __name__,
        template_folder="../templates",
        static_folder="../static",
    )

    logging.basicConfig(
        level=logging.DEBUG if app_config.DEBUG else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    database.init_db()
    app.teardown_appcontext(database.close_db)

    _register_blueprints(app)
    _register_template_routes(app)
    _inject_mapbox_token(app)
    _configure_role_sessions(app)
    _restart_active_simulators()

    return app


def _configure_role_sessions(app):
    """
    Use a different session cookie depending on which path the request comes from.
    /rider/* → sema_rider_session
    /driver/* → sema_driver_session
    This isolates the two roles even in the same browser.
    """
    from flask.sessions import SecureCookieSessionInterface

    class RoleAwareSessionInterface(SecureCookieSessionInterface):
        def _get_cookie_name(self, app, request):
            if request.path.startswith('/driver'):
                return 'sema_driver_session'
            return 'sema_rider_session'

        def get_cookie_name(self, app):
            # Called during open_session and save_session
            return self._get_cookie_name(app, request)

        def get_cookie_path(self, app):
            return '/'

    app.session_interface = RoleAwareSessionInterface()
    app.config['SESSION_PERMANENT'] = True
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=365)
    app.secret_key = app_config.SECRET_KEY


def _register_blueprints(app):
    from app.auth.routes import auth_bp
    from app.trips.routes import trips_bp
    from app.pickups.routes import pickups_bp
    from app.config.routes import config_bp
    from app.dev.routes import dev_bp

    for role in ("rider", "driver"):
        app.register_blueprint(auth_bp,    url_prefix=f"/{role}/api/auth",    name=f"auth_{role}")
        app.register_blueprint(trips_bp,   url_prefix=f"/{role}/api/trips",   name=f"trips_{role}")
        app.register_blueprint(pickups_bp, url_prefix=f"/{role}/api/pickups", name=f"pickups_{role}")
        app.register_blueprint(config_bp,  url_prefix=f"/{role}/api/config",  name=f"config_{role}")
        if app_config.FLASK_ENV == "development":
            app.register_blueprint(dev_bp, url_prefix=f"/{role}/api/dev",     name=f"dev_{role}")


def _register_template_routes(app):
    @app.route("/rider")
    def rider():
        return render_template("rider.html", mapbox_token=app_config.MAPBOX_TOKEN)

    @app.route("/driver")
    def driver():
        return render_template("driver.html", mapbox_token=app_config.MAPBOX_TOKEN)

    @app.route("/")
    def index():
        return redirect(url_for("rider"))


def _inject_mapbox_token(app):
    @app.context_processor
    def inject_token():
        return {"mapbox_token": app_config.MAPBOX_TOKEN}


def _restart_active_simulators():
    """Restart simulator threads for trips still active/paused after a server restart."""
    from app.simulator.engine import start_simulator
    conn = database.get_db()
    try:
        rows = conn.execute(
            "SELECT id, route_id FROM TRIP WHERE status IN ('active', 'paused')"
        ).fetchall()
        for row in rows:
            start_simulator(row["id"], row["route_id"])
            logger.info({"event": "simulator_restarted_on_boot", "trip_id": row["id"]})
    finally:
        conn.close()

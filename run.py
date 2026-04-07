"""
run.py — Application entry point.
Loads environment variables and starts the Flask development server.
"""

from dotenv import load_dotenv
load_dotenv()

from app import create_app  # noqa: E402 — must come after load_dotenv
import config as app_config  # noqa: E402

app = create_app()

if __name__ == "__main__":
    app.run(debug=app_config.DEBUG, host="0.0.0.0", port=5000)

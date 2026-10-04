# ── Stage 1: build deps ───────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# Install dependencies into a prefix we can copy cleanly
COPY requirements.txt .
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY . .

# SQLite DB lives in a named volume mounted at /data
# DATABASE_PATH should be set to /data/sema.db in production
RUN mkdir -p /data

# Non-root user for security
RUN adduser --disabled-password --gecos "" sema \
    && chown -R sema:sema /app /data
USER sema

EXPOSE 5000

# Use gunicorn for production; Flask dev server is not safe for production
CMD ["python", "-m", "gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "60", "run:app"]

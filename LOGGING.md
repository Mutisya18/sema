# Logging Implementation Guide

## Overview

The Sema application now has a comprehensive, session-based logging system for both backend and frontend.

**Key Features:**
- Session-scoped log files in `logs/backend/` and `logs/frontend/`
- Structured JSON logging for all events
- **Persistent session IDs across page refreshes** (survives until logout or server restart)
- Frontend batch submission to avoid overwhelming the server
- Session lifetime = Flask session lifetime (ends on logout or server shutdown)

---

## Architecture

### Session Lifecycle

The session ID is created on login and persists through:
1. ✅ Page refreshes (same session_id returned from `/api/auth/session`)
2. ✅ Browser navigation (stored in Flask session/cookies)
3. ✅ Multiple concurrent requests

The session ends on:
1. User logout
2. Flask server shutdown/restart
3. Session expiration (if configured)

### Backend Logging

**File:** `app/logging_service.py`

**Session-Based Flow:**
1. User logs in → backend generates unique `session_id`
2. `create_session_logger(session_id)` creates a logger bound to that session
3. All events logged to `logs/backend/{session_id}.log`
4. Session persists across page refreshes via Flask session cookies
5. When user logs out or server restarts → session ends and new session created on next login

**Key Functions:**

- `create_session_logger(session_id)` — Creates a file handler for the session
- `log_event(logger, event_name, status, **metadata)` — Logs a structured event
- `write_frontend_logs(session_id, logs)` — Writes frontend batch logs to `logs/frontend/{session_id}.log`

**Example Backend Log:**
```json
{
  "timestamp": "2026-04-06T09:00:00.000Z",
  "event": "login_success",
  "status": "success",
  "metadata": {
    "user_id": 1,
    "phone": "+254712345001",
    "role": "rider"
  }
}
```

---

### Frontend Logging

**File:** `static/js/logging.js`

**Queue & Batch System:**
1. Frontend creates `logger` singleton on page load
2. On login, `logger.init(session_id)` activates the queue and interval timer
3. On page refresh, `logger.init(session_id)` reinitializes with the same session_id from `/api/auth/session`
4. Events queued in memory via `logger.log(event, status, metadata)`
5. Every 5 seconds, queued logs batch-submitted to `POST /api/dev/logs`
6. On logout, `logger.flushLogs()` and `logger.destroy()`

**Key Methods:**

- `init(sessionId)` — Initialize with session ID and start batch interval
- `log(event, status, metadata)` — Queue a log event
- `flushLogs()` — Send pending logs immediately
- `destroy()` — Stop interval and cleanup

**Example Frontend Log:**
```json
{
  "timestamp": "2026-04-06T09:00:01.000Z",
  "event": "screen_navigated",
  "status": "success",
  "metadata": {
    "from_screen": "login",
    "to_screen": "home"
  }
}
```

---

## Integration Points

### Backend Auth Routes

**File:** `app/auth/routes.py`

The login endpoint now:
1. Generates `session_id = str(uuid.uuid4())`
2. Stores in Flask `session["session_id"]`
3. Returns `session_id` in the login response
4. Logs the event via `log_event(session_logger, ...)`

The `/api/auth/session` endpoint also:
1. Returns the stored `session_id` if user is logged in
2. Allows frontend to reinitialize logger on page refresh with same session_id

**Example:**
```python
session_logger = create_session_logger(session_id)
log_event(
    session_logger,
    "login_success",
    status="success",
    user_id=row["id"],
    phone=row["phone"],
    role=role,
)
```

### Frontend Login

**File:** `static/js/rider.js`, `static/js/driver.js`

On successful login:
```javascript
const res = await apiPost('/api/auth/login', { phone, role: 'rider' });
const data = await res.json();
if (res.ok) {
  RiderState.user = data.user;
  logger.init(data.session_id);  // ← Initialize logger with session ID
  logger.log('login_success', 'success', { user_id: data.user.id });
  showScreen('screen-home');
}
```

On page refresh (in `init()` function):
```javascript
if (sessionRes.ok) {
  const data = await sessionRes.json();
  RiderState.user = data.user;
  
  // Restore logger session with same session_id
  if (data.session_id) {
    logger.init(data.session_id);
    logger.log('page_loaded', 'success', { action: 'session_restored' });
  }
}
```

On logout:
```javascript
logger.log('logout_initiated', 'success', { user_id: RiderState.user?.id });
logger.flushLogs();              // ← Send pending logs before cleanup
await apiPost('/api/auth/logout', {});
logger.destroy();                // ← Stop the batch timer
```

---

## Frontend Log Submission Endpoint

**Route:** `POST /api/dev/logs`

**Request Body:**
```json
{
  "logs": [
    {
      "timestamp": "ISO-8601",
      "event": "event_name",
      "status": "success|failure",
      "metadata": {}
    }
  ]
}
```

**Response:**
- `200` — Logs received and written
- `400` — No active session
- `500` — Failed to write logs

**File Location:**
- Session ID extracted from Flask session
- Logs written to `logs/frontend/{session_id}.log`

---

## Log File Structure

### Backend Logs

Location: `logs/backend/{session_id}.log`

Format (one per line):
```
2026-04-06 09:00:00,000 - INFO - session_{session_id} - {"timestamp": "...", "event": "...", ...}
```

**Lifecycle:**
- Created on first login
- All events during session logged to same file
- Persists after logout for audit trail
- New file created on next server restart (new session)

### Frontend Logs

Location: `logs/frontend/{session_id}.log`

Format (one per line):
```json
{"timestamp": "...", "event": "...", "status": "success", "metadata": {...}}
```

**Lifecycle:**
- Created when frontend first submits logs in a session
- All frontend events during session logged to same file
- Persists after logout for audit trail
- New file created on next server restart (new session)

---

## Session ID Persistence

### What Persists Across Page Refreshes

✅ Same session_id (stored in Flask session cookies)
✅ Same log file (logs/backend/{session_id}.log)
✅ Same frontend queue target (logs/frontend/{session_id}.log)
✅ User authentication state

### Example Timeline

```
1. User logs in
   → session_id = "abc123"
   → logs/backend/abc123.log created with login_success event

2. User navigates app
   → logs accumulate in abc123.log

3. User refreshes page
   → Flask session persists (cookies)
   → GET /api/auth/session returns same session_id "abc123"
   → Frontend logger reinitializes with same session_id
   → Logging continues to same abc123.log file

4. User logs out
   → Logout event logged to abc123.log
   → Session cleared
   → Log file abc123.log persists (not deleted)

5. Server restarts
   → All sessions lost
   → User must log in again
   → New session_id generated
   → New log file created
```

---

## Event Types to Log

### Backend Events

- `login_success` — User authenticated
- `login_failed` — Invalid credentials
- `logout` — User logged out
- `api_error` — API endpoint failure (per implementation)
- `database_error` — Database operation failed

### Frontend Events

- `login_success` — User logged in successfully
- `login_failed` — Login attempt rejected
- `logout_initiated` — User clicked logout
- `screen_navigated` — User navigated to a screen
- `api_call` — Made an API request (optional, for request/response tracking)
- `error` — Caught exception or error

---

## Cleanup

Logs are stored in `logs/` which is excluded from git via `.gitignore`.

To clean up old logs:
```bash
rm -rf logs/backend/* logs/frontend/*
```

---

## Best Practices

1. **Always initialize logger on login** — Call `logger.init(session_id)` immediately after successful authentication

2. **Reinitialize logger on page load** — In the `init()` function, check if session is restored and call `logger.init(session_id)` with the returned session_id
   ```javascript
   if (data.session_id) {
     logger.init(data.session_id);
   }
   ```

3. **Flush before logout** — Call `logger.flushLogs()` before clearing state to ensure all pending logs are submitted

4. **Log meaningful events only** — Avoid logging every keystroke or poll

5. **Use consistent metadata keys** — e.g., always use `user_id`, `phone`, `endpoint`

6. **Don't log sensitive data** — Avoid logging full request bodies or passwords

7. **Check session_id is present** — Frontend logs endpoint returns 400 if session_id is missing

8. **Session persists across refreshes** — Same session_id returned from `/api/auth/session`, so logs continue to same file

9. **Session ends on logout or server restart** — Each new login creates a new session_id and new log file

---

## Example: Logging a Feature Event

**Backend:**
```python
from app.logging_service import create_session_logger, log_event

session_id = session.get("session_id")
session_logger = create_session_logger(session_id)
log_event(
    session_logger,
    "trip_started",
    status="success",
    trip_id=trip.id,
    route_id=trip.route_id,
    user_id=session["user_id"],
)
```

**Frontend:**
```javascript
logger.log('pickup_requested', 'success', {
  trip_id: tripId,
  seats_requested: seatsRequested,
  pickup_location: location,
});
```

---

## Testing Logs

Use the test script to verify logging:
```bash
python - <<'PY'
from app import create_app
from seed import seed
seed()
app = create_app()

with app.test_client() as client:
    rv = client.post('/api/auth/login', json={'phone': '+254712345001', 'role': 'rider'})
    session_id = rv.get_json()['session_id']
    print(f"Session: {session_id}")

import os
with open(f'logs/backend/{session_id}.log') as f:
    print(f.read())
PY
```

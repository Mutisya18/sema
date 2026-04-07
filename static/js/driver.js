// driver.js — Driver frontend (Phase 1 + 2 + 3)
'use strict';

// ─── Auth Storage (localStorage) ──────────────────────────────────────────────
// Each role maintains separate auth state in localStorage to prevent
// session sharing between driver and rider tabs/windows.

const AUTH_STORAGE_KEY = 'driver_auth';

function saveAuthToStorage(user, sessionId) {
  const authData = { user, sessionId, savedAt: Date.now() };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));
  console.log('[AUTH] Saved auth to localStorage for driver');
}

function loadAuthFromStorage() {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const authData = JSON.parse(stored);
      console.log('[AUTH] Loaded auth from localStorage for driver');
      return authData;
    }
  } catch (err) {
    console.error('[AUTH] Failed to load auth from storage:', err);
  }
  return null;
}

function clearAuthFromStorage() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  console.log('[AUTH] Cleared auth from localStorage for driver');
}

// ─── State ───────────────────────────────────────────────────────────────────

const DriverState = {
  user: null,
  activeTrip: null,
  riders: [],
  lastRidersSnapshot: [],
  map: null,
  driverMarker: null,
  riderMarkers: {},
  gpsPollInterval: null,
  ridersPollInterval: null,
  currentScreen: null,
  errorBannerActive: false,
  // Interpolation state for driver dot
  _animFrame: null,
  _prevPos: null,
  _targetPos: null,
  _animStart: null,
};

let ROUTES = [];

// ─── Navigation ──────────────────────────────────────────────────────────────

const ON_EXIT = {};
const ON_ENTER = {};

// ─── Global error handlers — nothing fails silently ──────────────────────────

window.onerror = (msg, src, line, col, err) => {
  console.error('[DRIVER UNCAUGHT]', msg, 'at', src, line + ':' + col, err);
  showToast('Unexpected error — check console', 'error');
};

window.addEventListener('unhandledrejection', (e) => {
  console.error('[DRIVER UNHANDLED PROMISE]', e.reason);
  showToast('Unexpected error — check console', 'error');
});

function showScreen(screenId) {
  console.log('[SCREEN] Transitioning to:', screenId, 'from:', DriverState.currentScreen);
  
  const previous = DriverState.currentScreen;
  try { 
    if (previous && ON_EXIT[previous]) {
      console.log('[SCREEN] Running ON_EXIT handler for:', previous);
      ON_EXIT[previous]();
      console.log('[SCREEN] ON_EXIT completed for:', previous);
    }
  }
  catch (err) { 
    console.error('[SCREEN] ON_EXIT error for', previous, err);
  }

  const allScreens = document.querySelectorAll('.screen');
  console.log('[SCREEN] Found', allScreens.length, 'screen elements');
  
  allScreens.forEach(s => s.classList.remove('active'));
  
  const target = document.getElementById(screenId);
  if (!target) { 
    console.error('[SCREEN] ERROR: no element with id:', screenId);
    console.log('[SCREEN] Available elements:', Array.from(document.querySelectorAll('[id*="screen"]')).map(e => e.id));
    return;
  }
  
  console.log('[SCREEN] Found target element:', screenId);
  target.classList.add('active');
  target.scrollTop = 0;
  console.log('[SCREEN] Added active class and reset scroll');

  DriverState.currentScreen = screenId;
  console.log('[SCREEN] DriverState.currentScreen set to:', screenId);
  
  try { 
    if (ON_ENTER[screenId]) {
      console.log('[SCREEN] Running ON_ENTER handler for:', screenId);
      ON_ENTER[screenId]();
      console.log('[SCREEN] ON_ENTER completed for:', screenId);
    } else {
      console.warn('[SCREEN] No ON_ENTER handler for:', screenId);
    }
  }
  catch (err) { 
    console.error('[SCREEN] ON_ENTER error for', screenId, err);
    console.error('[SCREEN] Stack:', err.stack);
    showToast('Screen error — check console', 'error');
  }
  
  console.log('[SCREEN] Transition complete to:', screenId);
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiPost(path, body) {
  return fetch('/driver' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function apiGet(path) { return fetch('/driver' + path); }
async function apiPatch(path) {
  return fetch('/driver' + path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
}

function normalizePhone(input) {
  const digits = [...(input || '')].filter((ch) => /\d/.test(ch)).join('');
  if (!digits) return '';
  if (digits.startsWith('0')) {
    return '+254' + digits.slice(1);
  }
  if (digits.startsWith('254')) {
    return '+' + digits;
  }
  return '+' + digits;
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(message, type = 'default') {
  const colours = { default: '#111', success: '#0d7a3e', warning: '#d06000', error: '#ff3b30' };
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
      color: '#fff', padding: '12px 20px', borderRadius: '10px',
      fontSize: '13px', fontWeight: '500', zIndex: '9999',
      whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,.2)', transition: 'opacity .3s',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.background = colours[type] || colours.default;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

function initials(name) {
  const parts = (name || '').trim().split(' ');
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

// ─── Screen: Login ───────────────────────────────────────────────────────────

function buildLoginScreen() {
  const el = document.getElementById('screen-login');
  el.innerHTML = `
    <div class="login-icon">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="4" y="12" width="32" height="18" rx="4" fill="#0d7a3e" opacity=".9"/>
        <rect x="8" y="16" width="10" height="8" rx="2" fill="#fff" opacity=".8"/>
        <rect x="22" y="16" width="10" height="8" rx="2" fill="#fff" opacity=".8"/>
        <circle cx="10" cy="32" r="4" fill="#0d7a3e" stroke="#fff" stroke-width="2"/>
        <circle cx="30" cy="32" r="4" fill="#0d7a3e" stroke="#fff" stroke-width="2"/>
      </svg>
    </div>
    <p class="login-title">Sema</p>
    <p class="login-tagline">Driver portal</p>
    <span class="login-sub">For matatu operators</span>
    <form class="login-form" id="login-form">
      <input class="login-input" id="login-phone" type="tel" placeholder="+254 7XX XXX XXX" autocomplete="tel" />
      <p class="login-error" id="login-error"></p>
      <button class="login-btn" type="submit">Sign in →</button>
    </form>
  `;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('[LOGIN] Form submitted');
    const phoneInput = document.getElementById('login-phone').value;
    console.log('[LOGIN] Phone input:', phoneInput);
    
    const phone = normalizePhone(phoneInput);
    console.log('[LOGIN] Normalized phone:', phone);
    
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    if (!phone) {
      errorEl.textContent = 'Please enter your phone number';
      console.log('[LOGIN] ERROR: Empty phone after normalization');
      return;
    }
    try {
      console.log('[LOGIN] Sending request to /api/auth/login with phone:', phone, 'role: driver');
      const res = await apiPost('/api/auth/login', { phone, role: 'driver' });
      console.log('[LOGIN] Response status:', res.status, res.ok);
      
      const data = await res.json();
      console.log('[LOGIN] Response data:', data);
      
      if (res.ok) {
        console.log('[LOGIN] Login successful, user:', data.user.name);
        DriverState.user = data.user;
        console.log('[LOGIN] DriverState.user set to:', DriverState.user);
        
        // Save auth to localStorage to prevent session sharing with rider
        saveAuthToStorage(data.user, data.session_id);
        
        console.log('[LOGIN] Initializing logger with session_id:', data.session_id?.substring(0, 8) + '...');
        logger.init(data.session_id);
        console.log('[LOGIN] Logger initialized');
        
        logger.log('login_success', 'success', { user_id: data.user.id, phone: data.user.phone });
        console.log('[LOGIN] Logged login_success event');
        
        console.log('[LOGIN] Calling showScreen("screen-home")');
        showScreen('screen-home');
        console.log('[LOGIN] showScreen completed');
      }
      else if (res.status === 404) {
        console.log('[LOGIN] ERROR: User not found (404)');
        errorEl.textContent = 'Phone number not found';
      }
      else {
        console.log('[LOGIN] ERROR: Unexpected status', res.status, data);
        errorEl.textContent = data.error || 'Something went wrong — try again';
      }
    } catch (err) {
      console.error('[LOGIN] EXCEPTION:', err);
      console.error('[LOGIN] Stack:', err.stack);
      errorEl.textContent = 'Unable to reach the server — check your connection';
    }
  });
}

// ─── Screen: Home ────────────────────────────────────────────────────────────

async function buildHomeScreen() {
  const el = document.getElementById('screen-home');
  const user = DriverState.user;

  // Fetch scheduled trips
  let scheduledTrips = [];
  try {
    const res = await apiGet('/api/trips/scheduled');
    if (res.ok) scheduledTrips = (await res.json()).trips || [];
  } catch (e) { /* non-fatal */ }

  const scheduledSection = scheduledTrips.length ? `
    <div>
      <p style="font-size:14px;font-weight:700;margin-bottom:10px">Scheduled trips</p>
      ${scheduledTrips.map(t => `
        <div style="border:1.5px solid #c0d0ff;border-radius:12px;padding:12px;background:#f7f9ff;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <p style="font-size:14px;font-weight:700">${t.route_name}</p>
              <p style="font-size:12px;color:#888">${t.scheduled_departure ? new Date(t.scheduled_departure).toLocaleString() : ''} · KSh ${t.fare}</p>
            </div>
            <button class="btn-start-now" data-trip-id="${t.id}"
              style="padding:6px 12px;border-radius:8px;border:none;background:#0d7a3e;color:#fff;font-size:12px;font-weight:600;cursor:pointer">
              Start now
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  el.innerHTML = `
    <div class="home-header">
      <div>
        <p class="home-greeting-sub">Good morning,</p>
        <p class="home-greeting-name">${user?.name || ''} 👋</p>
      </div>
      <div class="avatar">${initials(user?.name || '')}</div>
    </div>
    <div class="home-content">
      ${DriverState.activeTrip ? `
        <div style="padding:12px 16px;border-radius:10px;background:#e6f6ee;border:1px solid #90d4b0">
          <p style="font-size:13px;font-weight:700;color:#0d7a3e">You have an active trip</p>
          <p style="font-size:12px;color:#0d7a3e;opacity:.8;margin-top:2px">
            <span id="back-to-trip" style="cursor:pointer;text-decoration:underline">Back to trip →</span>
          </p>
        </div>
      ` : ''}
      <button class="start-trip-btn" id="btn-start-trip">Start a trip 🚍</button>
      ${scheduledSection}
      <div>
        <p style="font-size:14px;font-weight:700;margin-bottom:10px">Today's bookings</p>
        <p style="font-size:13px;color:#888">No bookings for today</p>
      </div>
    </div>
    ${buildBottomNav('home')}
  `;

  document.getElementById('btn-start-trip').addEventListener('click', () => showScreen('screen-start-trip'));
  document.getElementById('back-to-trip')?.addEventListener('click', () => showScreen('screen-active-trip'));

  // Start now buttons for scheduled trips
  el.querySelectorAll('.btn-start-now').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tripId = btn.dataset.tripId;
      const res = await apiPatch(`/api/trips/${tripId}/start`);
      if (res.ok) {
        const data = await res.json();
        DriverState.activeTrip = data.trip;
        showScreen('screen-active-trip');
        startGpsPoll(data.trip.id);
        startRidersPoll(data.trip.id);
      } else {
        showToast('Could not start trip', 'error');
      }
    });
  });

  wireBottomNav();
}

ON_ENTER['screen-home'] = () => {
  if (!DriverState.user) { showScreen('screen-login'); return; }
  buildHomeScreen();
  _checkScheduledTripNotifications();
};

// ─── Screen: Start Trip Form ──────────────────────────────────────────────────

async function buildStartTripScreen(prefill = null) {
  const el = document.getElementById('screen-start-trip');
  const routeOptions = ROUTES.map(r => `<option value="${r.id}">${r.name}</option>`).join('');

  // Load saved trips
  let savedTrips = [];
  try {
    const res = await apiGet('/api/trips/saved');
    if (res.ok) savedTrips = (await res.json()).saved_trips || [];
  } catch (e) { /* non-fatal */ }

  const savedChips = savedTrips.length ? `
    <div>
      <p style="font-size:12px;color:#888;margin-bottom:8px">Saved trips</p>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">
        ${savedTrips.map(s => `
          <div class="saved-chip" data-saved='${JSON.stringify(s)}'
            style="padding:8px 14px;border-radius:20px;border:1.5px solid #e0e0e0;background:#fff;font-size:13px;cursor:pointer;white-space:nowrap;flex-shrink:0">
            ${s.name || s.route_name} · KSh ${s.fare}
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="screen-header">
      <button class="back-btn" id="start-back">←</button>
      <span class="screen-title">Set up trip</span>
      <span></span>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:16px;padding-bottom:32px">
      ${savedChips}
      <div>
        <p style="font-size:12px;color:#888;margin-bottom:6px">Route</p>
        <select id="route-select" style="width:100%;padding:12px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:15px;font-family:inherit;outline:none;background:#fff">
          <option value="">Select a route</option>${routeOptions}
        </select>
      </div>
      <div id="stops-section" style="display:none">
        <p style="font-size:12px;color:#888;margin-bottom:6px">Active stops</p>
        <div id="stops-list"></div>
      </div>
      <div>
        <p style="font-size:12px;color:#888;margin-bottom:6px">Fare (KSh)</p>
        <input id="fare-input" type="number" min="1" placeholder="e.g. 80"
          style="width:100%;padding:12px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:15px;font-family:inherit;outline:none" />
      </div>
      <div>
        <p style="font-size:12px;color:#888;margin-bottom:6px">Available seats</p>
        <div style="display:flex;align-items:center;gap:16px">
          <button id="seats-minus" style="width:40px;height:40px;border-radius:8px;border:1.5px solid #e0e0e0;background:#f8f8f8;font-size:20px;font-weight:700;cursor:pointer">−</button>
          <span id="seats-count" style="font-size:20px;font-weight:800;min-width:24px;text-align:center">14</span>
          <button id="seats-plus" style="width:40px;height:40px;border-radius:8px;border:1.5px solid #e0e0e0;background:#f8f8f8;font-size:20px;font-weight:700;cursor:pointer">+</button>
        </div>
      </div>
      <div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="schedule-toggle" style="width:16px;height:16px" />
          <span style="font-size:14px;color:#333">Schedule for later</span>
        </label>
        <div id="schedule-section" style="display:none;margin-top:10px">
          <input type="datetime-local" id="schedule-time"
            style="width:100%;padding:12px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:15px;font-family:inherit;outline:none" />
        </div>
      </div>
      <div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="save-toggle" style="width:16px;height:16px" />
          <span style="font-size:14px;color:#333">Save this trip</span>
        </label>
        <div id="save-name-section" style="display:none;margin-top:10px">
          <input type="text" id="trip-name-input" placeholder="Trip name (e.g. Morning CBD→Thika)"
            style="width:100%;padding:12px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;font-family:inherit;outline:none" />
        </div>
      </div>
      <p id="form-error" style="font-size:12px;color:#d00;min-height:16px"></p>
      <button id="begin-trip-btn" style="width:100%;padding:16px;background:#0d7a3e;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer">Begin trip 🚍</button>
    </div>
  `;

  document.getElementById('start-back').addEventListener('click', () => showScreen('screen-home'));

  // Schedule toggle
  document.getElementById('schedule-toggle').addEventListener('change', (e) => {
    document.getElementById('schedule-section').style.display = e.target.checked ? 'block' : 'none';
    document.getElementById('begin-trip-btn').textContent = e.target.checked ? 'Schedule trip 📅' : 'Begin trip 🚍';
  });

  // Save toggle
  document.getElementById('save-toggle').addEventListener('change', (e) => {
    document.getElementById('save-name-section').style.display = e.target.checked ? 'block' : 'none';
  });

  // Seats stepper
  let seats = 14;
  document.getElementById('seats-minus').addEventListener('click', () => {
    if (seats > 1) { seats--; document.getElementById('seats-count').textContent = seats; }
  });
  document.getElementById('seats-plus').addEventListener('click', () => {
    if (seats < 30) { seats++; document.getElementById('seats-count').textContent = seats; }
  });

  // Route selector
  const routeSelect = document.getElementById('route-select');
  routeSelect.addEventListener('change', (e) => {
    _populateStops(e.target.value);
  });

  // Saved trip chips — pre-fill form
  el.querySelectorAll('.saved-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const saved = JSON.parse(chip.dataset.saved);
      routeSelect.value = saved.route_id;
      _populateStops(saved.route_id, saved.stop_ids);
      document.getElementById('fare-input').value = saved.fare;
    });
  });

  // Pre-fill if coming from a saved trip
  if (prefill) {
    routeSelect.value = prefill.route_id;
    _populateStops(prefill.route_id, prefill.stop_ids);
    document.getElementById('fare-input').value = prefill.fare;
  }

  // Begin / Schedule trip
  document.getElementById('begin-trip-btn').addEventListener('click', async () => {
    const routeId = routeSelect.value;
    const fare = parseInt(document.getElementById('fare-input').value);
    const errorEl = document.getElementById('form-error');
    const isScheduled = document.getElementById('schedule-toggle').checked;
    const scheduleTime = document.getElementById('schedule-time').value;
    const saveTrip = document.getElementById('save-toggle').checked;
    const tripName = document.getElementById('trip-name-input')?.value?.trim() || '';
    errorEl.textContent = '';

    if (!routeId) { errorEl.textContent = 'Please select a route'; return; }
    if (!fare || fare <= 0) { errorEl.textContent = 'Fare must be a positive number'; return; }
    if (isScheduled && !scheduleTime) { errorEl.textContent = 'Please select a departure time'; return; }

    const checkedStops = [...document.querySelectorAll('#stops-list input[type=checkbox]:checked')].map(c => c.value);
    if (checkedStops.length === 0) { errorEl.textContent = 'Please select at least one stop'; return; }

    const body = {
      route_id: routeId,
      active_stop_ids: checkedStops,
      seats_total: seats,
      fare,
      save_trip: saveTrip,
      trip_name: tripName,
    };
    if (isScheduled) body.scheduled_departure = new Date(scheduleTime).toISOString();

    const res = await apiPost('/api/trips', body);
    const data = await res.json();

    if (res.status === 201) {
      DriverState.activeTrip = data.trip;
      if (data.trip.status === 'scheduled') {
        showToast(`Trip scheduled for ${new Date(scheduleTime).toLocaleTimeString()}`, 'success');
        showScreen('screen-home');
      } else {
        showScreen('screen-active-trip');
      }
    } else if (res.status === 409) {
      showToast('You already have an active trip', 'warning');
      showScreen('screen-active-trip');
    } else {
      errorEl.textContent = data.error || 'Something went wrong';
    }
  });
}

function _populateStops(routeId, preselectedIds = null) {
  const stopsSection = document.getElementById('stops-section');
  const stopsList = document.getElementById('stops-list');
  if (!routeId) { stopsSection.style.display = 'none'; return; }
  const route = ROUTES.find(r => r.id === routeId);
  if (!route) return;
  stopsSection.style.display = 'block';
  stopsList.innerHTML = route.stops.map(s => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0;cursor:pointer">
      <input type="checkbox" value="${s.id}" ${!preselectedIds || preselectedIds.includes(s.id) ? 'checked' : ''} style="width:16px;height:16px" />
      <span style="font-size:14px">${s.name}</span>
    </label>
  `).join('');
}

ON_ENTER['screen-start-trip'] = () => buildStartTripScreen();

async function _checkScheduledTripNotifications() {
  try {
    const res = await apiGet('/api/trips/scheduled');
    if (!res.ok) return;
    const data = await res.json();
    const now = Date.now();
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    for (const trip of data.trips || []) {
      if (!trip.scheduled_departure) continue;
      const depTime = new Date(trip.scheduled_departure).getTime();
      const diff = depTime - now;
      if (diff > 0 && diff <= TEN_MINUTES_MS) {
        const mins = Math.round(diff / 60000);
        showToast(`Your ${trip.route_name} trip starts in ${mins} min`, 'warning');
        break;
      }
    }
  } catch (e) { /* non-fatal */ }
}

// ─── Map helpers ─────────────────────────────────────────────────────────────

function initDriverMap(lat, lng) {
  mapboxgl.accessToken = MAPBOX_TOKEN;
  const map = new mapboxgl.Map({
    container: 'driver-map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [lng, lat],
    zoom: 13,
  });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.on('error', () => {
    const c = document.getElementById('driver-map');
    if (!c) return;
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;top:8px;left:8px;right:8px;background:#ffe8e8;color:#d00;padding:8px 12px;border-radius:8px;font-size:12px;z-index:10';
    b.textContent = 'Map unavailable — check your connection';
    c.style.position = 'relative';
    c.appendChild(b);
  });
  map.on('load', () => {
    _addRouteLayer(map);
    // Place dot once map is ready
    if (DriverState.activeTrip) {
      placeOrMoveDriverDot(DriverState.activeTrip.current_lat, DriverState.activeTrip.current_lng);
    }
  });
  DriverState.map = map;
}

function _addRouteLayer(map) {
  const trip = DriverState.activeTrip;
  if (!trip) return;
  const route = ROUTES.find(r => r.id === trip.route_id);
  if (!route) return;

  if (map.getLayer('route-line-layer')) map.removeLayer('route-line-layer');
  if (map.getSource('route-line')) map.removeSource('route-line');

  map.addSource('route-line', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: route.coordinates } },
  });
  map.addLayer({
    id: 'route-line-layer', type: 'line', source: 'route-line',
    paint: { 'line-color': '#0d7a3e', 'line-width': 3 },
  });

  // Stop markers
  route.stops.forEach(stop => {
    const el = document.createElement('div');
    el.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#0d7a3e;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)';
    new mapboxgl.Marker({ element: el })
      .setLngLat([stop.lng, stop.lat])
      .setPopup(new mapboxgl.Popup({ offset: 8 }).setText(stop.name))
      .addTo(map);
  });

  // Fit bounds
  const coords = route.coordinates;
  const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(bounds, { padding: 60, duration: 500 });
}

function placeOrMoveDriverDot(lat, lng) {
  const map = DriverState.map;
  if (!map) return;
  if (!DriverState.driverMarker) {
    const el = document.createElement('div');
    el.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#0d7a3e;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)';
    DriverState.driverMarker = new mapboxgl.Marker({ element: el })
      .setLngLat([lng, lat])
      .addTo(map);
    DriverState._prevPos = { lat, lng };
    DriverState._targetPos = { lat, lng };
    return;
  }
  _startInterpolation(lat, lng);
}

function _startInterpolation(targetLat, targetLng) {
  if (DriverState._animFrame) cancelAnimationFrame(DriverState._animFrame);
  const prev = DriverState.driverMarker.getLngLat();
  DriverState._prevPos = { lat: prev.lat, lng: prev.lng };
  DriverState._targetPos = { lat: targetLat, lng: targetLng };
  DriverState._animStart = Date.now();
  const DURATION = 5000;

  function step() {
    if (!DriverState.driverMarker) return; // Guard against marker removal during screen transitions
    const progress = Math.min((Date.now() - DriverState._animStart) / DURATION, 1);
    const lat = DriverState._prevPos.lat + (DriverState._targetPos.lat - DriverState._prevPos.lat) * progress;
    const lng = DriverState._prevPos.lng + (DriverState._targetPos.lng - DriverState._prevPos.lng) * progress;
    DriverState.driverMarker.setLngLat([lng, lat]);
    if (progress < 1) DriverState._animFrame = requestAnimationFrame(step);
  }
  DriverState._animFrame = requestAnimationFrame(step);
}

function stopDotAnimation() {
  if (DriverState._animFrame) { cancelAnimationFrame(DriverState._animFrame); DriverState._animFrame = null; }
}

function cleanupMap() {
  stopDotAnimation();
  if (DriverState.driverMarker) { DriverState.driverMarker.remove(); DriverState.driverMarker = null; }
  Object.values(DriverState.riderMarkers).forEach(m => m.remove());
  DriverState.riderMarkers = {};
  const map = DriverState.map;
  if (map) {
    if (map.getLayer('route-line-layer')) map.removeLayer('route-line-layer');
    if (map.getSource('route-line')) map.removeSource('route-line');
  }
}

// ─── Poll 1 — GPS ─────────────────────────────────────────────────────────────

function startGpsPoll(tripId) {
  if (DriverState.gpsPollInterval) return;
  DriverState.gpsPollInterval = setInterval(() => _pollGps(tripId), 5000);
}

function stopGpsPoll() {
  if (DriverState.gpsPollInterval) { clearInterval(DriverState.gpsPollInterval); DriverState.gpsPollInterval = null; }
}

// ─── Poll 3 — Rider list ──────────────────────────────────────────────────────

function startRidersPoll(tripId) {
  stopRidersPoll();
  DriverState.ridersPollInterval = setInterval(() => _pollRiders(tripId), 5000);
}

function stopRidersPoll() {
  if (DriverState.ridersPollInterval) { clearInterval(DriverState.ridersPollInterval); DriverState.ridersPollInterval = null; }
}

async function _pollRiders(tripId) {
  let res;
  try { res = await apiGet(`/api/trips/${tripId}/riders`); }
  catch { return; }
  if (!res.ok) return;

  const data = await res.json();
  const newRiders = data.riders || [];
  _applyRidersDiff(newRiders);
  DriverState.lastRidersSnapshot = newRiders;
}

function _applyRidersDiff(newRiders) {
  const prev = DriverState.lastRidersSnapshot;
  const prevMap = Object.fromEntries(prev.map(r => [r.pickup_id, r]));
  const newMap = Object.fromEntries(newRiders.map(r => [r.pickup_id, r]));

  // Removed riders (in prev but not in new)
  for (const id of Object.keys(prevMap)) {
    if (!newMap[id]) {
      _removeRiderDot(parseInt(id));
      _removeRiderCard(parseInt(id));
    }
  }

  // New or changed riders
  for (const rider of newRiders) {
    const old = prevMap[rider.pickup_id];
    if (!old) {
      // Brand new
      _addRiderDot(rider);
      _addRiderCard(rider);
    } else if (old.status !== rider.status || old.spotted !== rider.spotted) {
      // Status changed
      _updateRiderDot(rider);
      _updateRiderCard(rider, old);
    }
  }

  // Update feed empty state
  const feed = document.getElementById('rider-feed');
  if (feed && newRiders.length === 0 && prev.length > 0) {
    feed.innerHTML = '<p style="font-size:13px;color:#888">No riders yet</p>';
  }
}

// ─── Rider dots ───────────────────────────────────────────────────────────────

function _addRiderDot(rider) {
  const map = DriverState.map;
  if (!map) return;
  const el = document.createElement('div');
  el.style.cssText = _riderDotStyle(rider);
  const marker = new mapboxgl.Marker({ element: el })
    .setLngLat([rider.pickup_lng, rider.pickup_lat])
    .addTo(map);
  DriverState.riderMarkers[rider.pickup_id] = marker;
}

function _updateRiderDot(rider) {
  const marker = DriverState.riderMarkers[rider.pickup_id];
  if (!marker) { _addRiderDot(rider); return; }
  if (rider.status === 'completed' || rider.status === 'rejected' || rider.status === 'cancelled' || rider.status === 'no_show') {
    _removeRiderDot(rider.pickup_id);
  } else {
    marker.getElement().style.cssText = _riderDotStyle(rider);
  }
}

function _removeRiderDot(pickupId) {
  const marker = DriverState.riderMarkers[pickupId];
  if (marker) { marker.remove(); delete DriverState.riderMarkers[pickupId]; }
}

function _riderDotStyle(rider) {
  if (rider.spotted) {
    const ring = rider.pickup_type === 'reservation' ? '#1a5cff' : rider.pickup_type === 'pickup' ? '#5533ff' : '#d06000';
    return `width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid ${ring};box-shadow:0 2px 6px rgba(0,0,0,.4)`;
  }
  const bg = rider.pickup_type === 'reservation' ? '#1a5cff' : rider.pickup_type === 'pickup' ? '#5533ff' : '#d06000';
  return `width:14px;height:14px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)`;
}

// ─── Rider cards ──────────────────────────────────────────────────────────────

function _addRiderCard(rider) {
  const feed = document.getElementById('rider-feed');
  if (!feed) return;
  // Remove empty state
  if (feed.querySelector('p')) feed.innerHTML = '';

  const card = document.createElement('div');
  card.id = `rider-card-${rider.pickup_id}`;
  card.innerHTML = _buildRiderCardHTML(rider);
  // Spotted cards go to top
  if (rider.spotted) feed.prepend(card);
  else feed.appendChild(card);
  _wireRiderCardButtons(card, rider);
}

function _updateRiderCard(rider, old) {
  const card = document.getElementById(`rider-card-${rider.pickup_id}`);
  if (!card) { _addRiderCard(rider); return; }

  if (rider.status === 'completed') {
    card.innerHTML = `<div style="padding:12px;border-radius:12px;background:#e6f6ee;border:1.5px solid #0d7a3e;margin-bottom:8px;font-size:13px;color:#0d7a3e;font-weight:600">✓ ${rider.rider_name} boarded</div>`;
    setTimeout(() => card.remove(), 3000);
    return;
  }
  if (rider.status === 'rejected' || rider.status === 'cancelled') {
    if (rider.status === 'cancelled') showToast(`${rider.rider_name} cancelled`, 'default');
    card.remove();
    return;
  }
  if (rider.status === 'no_show') {
    card.innerHTML = `<div style="padding:12px;border-radius:12px;background:#ffe8e8;border:1.5px solid #ffb0b0;margin-bottom:8px;font-size:13px;color:#d00;font-weight:600">✗ ${rider.rider_name} — no-show</div>`;
    setTimeout(() => card.remove(), 3000);
    return;
  }

  // Re-render card (status or spotted changed)
  card.innerHTML = _buildRiderCardHTML(rider);
  _wireRiderCardButtons(card, rider);

  // Move spotted card to top
  if (rider.spotted && !old.spotted) {
    const feed = document.getElementById('rider-feed');
    if (feed) feed.prepend(card);
  }
}

function _removeRiderCard(pickupId) {
  document.getElementById(`rider-card-${pickupId}`)?.remove();
}

function _buildRiderCardHTML(rider) {
  const isSpotted = rider.spotted;
  const border = isSpotted ? '1.5px solid #0d7a3e' : rider.pickup_type === 'reservation' ? '1.5px solid #a8c0ff' : '1.5px solid #f0f0f0';
  const bg = isSpotted ? '#f0faf4' : rider.pickup_type === 'reservation' ? '#f7f9ff' : '#fff';
  const badge = isSpotted
    ? '<span style="padding:3px 8px;border-radius:20px;background:#e6f6ee;color:#0a7a3e;font-size:11px;font-weight:700">Spotted ✓</span>'
    : rider.pickup_type === 'reservation'
      ? '<span style="padding:3px 8px;border-radius:20px;background:#e8f0ff;color:#1a5cff;font-size:11px;font-weight:700">Booking ★</span>'
      : rider.pickup_type === 'pickup'
        ? '<span style="padding:3px 8px;border-radius:20px;background:#f0f0ff;color:#5533ff;font-size:11px;font-weight:700">Pickup 📍</span>'
        : '<span style="padding:3px 8px;border-radius:20px;background:#fff3e0;color:#d06000;font-size:11px;font-weight:700">Flagging 🚩</span>';

  const actionBtns = rider.status === 'accepted'
    ? '<span style="font-size:12px;color:#0d7a3e;font-weight:600">Accepted ✓</span>'
    : `<button class="btn-accept" data-id="${rider.pickup_id}" style="flex:1;padding:8px 0;border-radius:8px;border:none;background:#e6f6ee;color:#0d7a3e;font-size:13px;font-weight:700;cursor:pointer">Accept</button>
       <button class="btn-reject" data-id="${rider.pickup_id}" style="flex:1;padding:8px 0;border-radius:8px;border:none;background:#ffe8e8;color:#c00;font-size:13px;font-weight:700;cursor:pointer">Reject</button>`;

  return `
    <div style="border:${border};border-radius:12px;padding:12px;background:${bg};margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <p style="font-size:14px;font-weight:700;color:#111">${rider.rider_name}</p>
          <p style="font-size:12px;color:#888">→ ${rider.stop_name} · ${rider.seats_requested} seat${rider.seats_requested !== 1 ? 's' : ''}</p>
        </div>
        ${badge}
      </div>
      <div style="display:flex;gap:8px">${actionBtns}</div>
    </div>
  `;
}

function _wireRiderCardButtons(card, rider) {
  card.querySelector('.btn-accept')?.addEventListener('click', async () => {
    const res = await apiPatch(`/api/pickups/${rider.pickup_id}/accept`);
    if (res.status === 409) {
      const data = await res.json();
      showToast(data.error === 'not enough seats available' ? 'Not enough seats for this rider' : 'Seat already taken', 'warning');
    }
  });
  card.querySelector('.btn-reject')?.addEventListener('click', async () => {
    const res = await apiPatch(`/api/pickups/${rider.pickup_id}/reject`);
    if (res.ok) {
      const data = await res.json();
      showToast(`${rider.rider_name} rejected`, 'default');
    }
  });
}

async function _pollGps(tripId) {
  let res;
  try { res = await apiGet(`/api/trips/${tripId}/gps`); }
  catch { _showErrorBanner('Connection issue — retrying'); return; }

  if (res.status === 401) { stopAllPolls(); showScreen('screen-login'); return; }
  if (res.status === 404) { _showErrorBanner('This trip no longer exists'); stopGpsPoll(); setTimeout(() => showScreen('screen-home'), 2000); return; }
  if (!res.ok) { _showErrorBanner('Something went wrong — retrying'); return; }

  _clearErrorBanner();
  const data = await res.json();

  if (data.status === 'ended') {
    stopAllPolls();
    // Fetch summary then navigate
    const summaryRes = await apiGet(`/api/trips/${tripId}`);
    if (summaryRes.ok) {
      const sd = await summaryRes.json();
      DriverState.activeTrip = sd.trip;
    }
    showScreen('screen-end-summary');
    return;
  }

  if (data.status === 'paused') {
    stopDotAnimation();
    _showBanner('paused-banner', '⏸ You are paused — riders cannot see your matatu', 'warning');
  } else {
    _clearBanner('paused-banner');
    placeOrMoveDriverDot(data.current_lat, data.current_lng);
  }

  if (DriverState.activeTrip) {
    DriverState.activeTrip.current_lat = data.current_lat;
    DriverState.activeTrip.current_lng = data.current_lng;
    DriverState.activeTrip.current_step = data.current_step;
    DriverState.activeTrip.status = data.status;
  }

  // Update seat counter display
  const seatsEl = document.getElementById('seats-remaining');
  if (seatsEl && DriverState.activeTrip) seatsEl.textContent = DriverState.activeTrip.seats_available;
}

// ─── Screen: Active Trip (D-04) ───────────────────────────────────────────────

ON_ENTER['screen-active-trip'] = () => {
  const trip = DriverState.activeTrip;
  if (!trip) { showScreen('screen-home'); return; }

  const el = document.getElementById('screen-active-trip');
  const route = ROUTES.find(r => r.id === trip.route_id);
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#fff;border-bottom:1px solid #f0f0f0">
      <div>
        <p style="font-size:12px;color:#888">${route?.name || trip.route_id}</p>
        <p style="font-size:16px;font-weight:700">Active trip</p>
      </div>
      <div style="text-align:right">
        <p style="font-size:10px;color:#888">Seats</p>
        <p id="seats-remaining" style="font-size:24px;font-weight:800;color:#0d7a3e">${trip.seats_available}</p>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button id="btn-pause" style="padding:6px 12px;border-radius:8px;border:1.5px solid #e0e0e0;background:#f8f8f8;font-size:12px;font-weight:600;cursor:pointer">Pause trip</button>
          <button id="btn-end" style="padding:6px 12px;border-radius:8px;border:none;background:#ff3b30;color:#fff;font-size:12px;font-weight:600;cursor:pointer">End trip</button>
        </div>
      </div>
    </div>
    <div id="paused-banner" style="display:none"></div>
    <div id="error-banner" style="display:none"></div>
    <div id="driver-map" style="height:300px;background:#e6f6ee"></div>
    <div style="padding:12px 16px">
      <p style="font-size:13px;font-weight:700;color:#111;margin-bottom:8px">Incoming requests</p>
      <div id="rider-feed"><p style="font-size:13px;color:#888">No riders yet</p></div>
    </div>
    ${buildBottomNav('trip')}
  `;

  document.getElementById('btn-pause').addEventListener('click', () => _pauseTrip(trip.id));
  document.getElementById('btn-end').addEventListener('click', () => _confirmEndTrip(trip.id));

  if (DriverState.map) { DriverState.map.remove(); DriverState.map = null; DriverState.driverMarker = null; }
  initDriverMap(trip.current_lat, trip.current_lng);

  stopGpsPoll();
  startGpsPoll(trip.id);
  startRidersPoll(trip.id);
  wireBottomNav();
};

ON_EXIT['screen-active-trip'] = () => {
  // Polls keep running when navigating to paused screen; stop only on explicit end
};

async function _pauseTrip(tripId) {
  const res = await apiPatch(`/api/trips/${tripId}/pause`);
  if (res.ok) {
    const data = await res.json();
    DriverState.activeTrip = data.trip;
    showScreen('screen-paused-trip');
  } else {
    showToast('Could not pause trip', 'error');
  }
}

async function _confirmEndTrip(tripId) {
  // Check for pending/accepted riders
  const pendingRiders = DriverState.riders.filter(r => r.status === 'pending' || r.status === 'accepted');
  if (pendingRiders.length > 0) {
    const confirmed = confirm(`You have ${pendingRiders.length} rider(s) who haven't boarded. End trip anyway?`);
    if (!confirmed) return;
  }
  await _endTrip(tripId);
}

async function _endTrip(tripId) {
  const res = await apiPatch(`/api/trips/${tripId}/end`);
  if (res.ok) {
    const data = await res.json();
    stopAllPolls();
    DriverState.activeTrip = { ...DriverState.activeTrip, ...data.trip };
    showScreen('screen-end-summary');
  } else {
    showToast('Could not end trip', 'error');
  }
}

// ─── Screen: Paused Trip (D-05) ───────────────────────────────────────────────

ON_ENTER['screen-paused-trip'] = () => {
  const trip = DriverState.activeTrip;
  if (!trip) { showScreen('screen-home'); return; }

  const el = document.getElementById('screen-paused-trip');
  const route = ROUTES.find(r => r.id === trip.route_id);
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#fff;border-bottom:1px solid #f0f0f0">
      <div>
        <p style="font-size:12px;color:#888">${route?.name || trip.route_id}</p>
        <p style="font-size:16px;font-weight:700">Paused trip</p>
      </div>
      <div style="display:flex;gap:6px">
        <button id="btn-resume" style="padding:8px 14px;border-radius:8px;border:none;background:#0d7a3e;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Resume trip</button>
        <button id="btn-end-paused" style="padding:8px 14px;border-radius:8px;border:none;background:#ff3b30;color:#fff;font-size:13px;font-weight:600;cursor:pointer">End trip</button>
      </div>
    </div>
    <div id="error-banner" style="display:none"></div>
    <div style="padding:12px 16px;background:#fff3e0;border-bottom:1px solid #ffd080">
      <p style="font-size:13px;font-weight:700;color:#d06000">⏸ You are paused — riders cannot see your matatu. Tap Resume to continue.</p>
    </div>
    <div id="driver-map" style="height:260px;background:#f8f8f8"></div>
    ${buildBottomNav('trip')}
  `;

  document.getElementById('btn-resume').addEventListener('click', () => _resumeTrip(trip.id));
  document.getElementById('btn-end-paused').addEventListener('click', () => _confirmEndTrip(trip.id));

  // Rebuild map into the new container
  if (DriverState.map) { DriverState.map.remove(); DriverState.map = null; DriverState.driverMarker = null; }
  initDriverMap(trip.current_lat, trip.current_lng);
  wireBottomNav();
};

async function _resumeTrip(tripId) {
  const res = await apiPatch(`/api/trips/${tripId}/resume`);
  if (res.ok) {
    const data = await res.json();
    DriverState.activeTrip = data.trip;
    showScreen('screen-active-trip');
  } else {
    showToast('Could not resume trip', 'error');
  }
}

// ─── Screen: End Trip Summary (D-07) ─────────────────────────────────────────

ON_ENTER['screen-end-summary'] = () => {
  const trip = DriverState.activeTrip;
  const el = document.getElementById('screen-end-summary');

  const duration = trip?.started_at && trip?.ended_at
    ? Math.round((new Date(trip.ended_at) - new Date(trip.started_at)) / 60000) + ' min'
    : '—';

  el.innerHTML = `
    <div style="padding:24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px">
      <div style="width:72px;height:72px;border-radius:50%;background:#e6f6ee;display:flex;align-items:center;justify-content:center;font-size:32px">🏁</div>
      <p style="font-size:20px;font-weight:700">Trip complete!</p>
      <p style="font-size:14px;color:#888">${trip?.route_name || ''}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;margin-top:8px">
        ${[['Total pickups', trip?.total_pickups ?? 0], ['Duration', duration]].map(([l, v]) => `
          <div style="background:#f8f8f8;border-radius:12px;padding:12px;text-align:center">
            <p style="font-size:22px;font-weight:800;color:#111">${v}</p>
            <p style="font-size:11px;color:#888;margin-top:2px">${l}</p>
          </div>
        `).join('')}
      </div>
      <button id="btn-back-home" style="width:100%;padding:14px;background:#0d7a3e;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px">Back to home</button>
      <button id="btn-start-another" style="width:100%;padding:14px;background:#f2f2f2;color:#333;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Start another trip</button>
    </div>
  `;

  cleanupMap();
  DriverState.activeTrip = null;
  DriverState.riders = [];
  DriverState.lastRidersSnapshot = [];

  document.getElementById('btn-back-home').addEventListener('click', () => showScreen('screen-home'));
  document.getElementById('btn-start-another').addEventListener('click', () => showScreen('screen-start-trip'));
};

// ─── Screen: History (D-08) ───────────────────────────────────────────────────

ON_ENTER['screen-history'] = async () => {
  const el = document.getElementById('screen-history');
  el.innerHTML = `
    <div class="screen-header"><span></span><span class="screen-title">Trip History</span><span></span></div>
    <div id="history-list" style="padding:16px">
      <p style="font-size:13px;color:#888">Loading...</p>
    </div>
    ${buildBottomNav('history')}
  `;
  wireBottomNav();

  const res = await apiGet('/api/trips/history');
  const listEl = document.getElementById('history-list');
  if (!listEl) return;

  if (!res.ok) { listEl.innerHTML = '<p style="font-size:13px;color:#888">Could not load history</p>'; return; }
  const data = await res.json();
  const trips = data.trips || [];

  if (trips.length === 0) { listEl.innerHTML = '<p style="font-size:13px;color:#888">No trips yet</p>'; return; }

  listEl.innerHTML = trips.map(t => `
    <div style="border:1.5px solid #f0f0f0;border-radius:14px;padding:14px;background:#fff;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <p style="font-size:14px;font-weight:700">${t.route_name}</p>
          <p style="font-size:12px;color:#888">${t.started_at ? new Date(t.started_at).toLocaleDateString() : ''}</p>
        </div>
        <span style="padding:3px 10px;border-radius:20px;background:#e6f6ee;color:#0a7a3e;font-size:11px;font-weight:700">Completed</span>
      </div>
      <p style="font-size:12px;color:#888;margin-top:6px">${t.total_pickups} pickup${t.total_pickups !== 1 ? 's' : ''} · KSh ${t.fare}</p>
    </div>
  `).join('');
};

// ─── Placeholder screens ──────────────────────────────────────────────────────

['screen-cluster-view', 'screen-reject-rider'].forEach(id => {
  ON_ENTER[id] = () => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `
      <div class="screen-header">
        <button class="back-btn" onclick="showScreen('screen-active-trip')">←</button>
        <span class="screen-title">${id.replace('screen-','').replace(/-/g,' ')}</span>
        <span></span>
      </div>
      <div class="placeholder">Coming soon</div>
    `;
  };
});

ON_ENTER['screen-profile'] = () => {
  const el = document.getElementById('screen-profile');
  const user = DriverState.user;
  el.innerHTML = `
    <div class="screen-header"><span></span><span class="screen-title">Profile</span><span></span></div>
    <div style="padding:24px;text-align:center">
      <div class="avatar" style="width:72px;height:72px;font-size:24px;margin:0 auto 12px">${initials(user?.name||'')}</div>
      <p style="font-size:18px;font-weight:700">${user?.name||''}</p>
      <p style="font-size:13px;color:#888;margin-top:4px">${user?.phone||''}</p>
      <p style="margin-top:8px">
        <span style="padding:3px 10px;border-radius:20px;background:#f2f2f2;color:#666;font-size:11px;font-weight:700">${user?.plate||''}</span>
        <span style="padding:3px 10px;border-radius:20px;background:#f2f2f2;color:#666;font-size:11px;font-weight:700;margin-left:6px">${user?.sacco||''}</span>
      </p>
      <button id="sign-out-btn" style="margin-top:32px;width:100%;padding:14px;background:#f2f2f2;color:#333;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Sign out</button>
    </div>
    ${buildBottomNav('profile')}
  `;
  document.getElementById('sign-out-btn').addEventListener('click', signOut);
  wireBottomNav();
};

// ─── Banner helpers ───────────────────────────────────────────────────────────

function _showBanner(id, text, type) {
  const colours = { warning: { bg: '#fff3e0', border: '#ffd080', fg: '#d06000' }, error: { bg: '#ffe8e8', border: '#ffb0b0', fg: '#d00' } };
  const c = colours[type] || colours.warning;
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'block';
  el.style.cssText = `display:block;padding:12px 16px;background:${c.bg};border-bottom:1px solid ${c.border}`;
  el.innerHTML = `<p style="font-size:13px;font-weight:700;color:${c.fg}">${text}</p>`;
}

function _clearBanner(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function _showErrorBanner(text) {
  DriverState.errorBannerActive = true;
  _showBanner('error-banner', text, 'error');
}

function _clearErrorBanner() {
  if (!DriverState.errorBannerActive) return;
  DriverState.errorBannerActive = false;
  _clearBanner('error-banner');
}

// ─── Bottom nav ───────────────────────────────────────────────────────────────

function buildBottomNav(activeTab) {
  const tabs = [
    { id: 'home',    label: 'Home',      screen: 'screen-home' },
    { id: 'trip',    label: 'Live Trip', screen: 'screen-active-trip' },
    { id: 'history', label: 'History',   screen: 'screen-history' },
    { id: 'profile', label: 'Profile',   screen: 'screen-profile' },
  ];
  return `
    <nav class="bottom-nav">
      ${tabs.map(t => `
        <button class="nav-tab ${t.id === activeTab ? 'active' : ''}" data-screen="${t.screen}">
          <div class="nav-tab-icon">
            <div class="dot"></div>
            ${t.id === 'trip' && DriverState.activeTrip ? '<span class="nav-badge"></span>' : ''}
          </div>
          <span class="nav-tab-label">${t.label}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

function wireBottomNav() {
  document.querySelectorAll('.nav-tab[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function signOut() {
  logger.flushLogs();
  await apiPost('/api/auth/logout', {});
  logger.destroy();
  stopAllPolls();
  cleanupMap();
  DriverState.user = null;
  DriverState.activeTrip = null;
  DriverState.riders = [];
  clearAuthFromStorage();
  showScreen('screen-login');
}

function stopAllPolls() {
  stopGpsPoll();
  stopRidersPoll();
}

// ─── Route config ─────────────────────────────────────────────────────────────

async function fetchRoutes() {
  try {
    console.log('[ROUTES] Fetching routes from /api/config/routes...');
    const res = await apiGet('/api/config/routes');
    console.log('[ROUTES] Response status:', res.status, 'ok:', res.ok);
    
    if (!res.ok) {
      console.error('[ROUTES] Failed to fetch routes - status', res.status);
      return;
    }
    
    const data = await res.json();
    console.log('[ROUTES] Fetched', data.routes?.length || 0, 'routes');
    ROUTES = data.routes || [];
    console.log('[ROUTES] ROUTES array now has', ROUTES.length, 'items');
    
    if (ROUTES.length > 0) {
      console.log('[ROUTES] First route:', ROUTES[0].name);
    }
  } catch (err) {
    console.error('[ROUTES] Exception while fetching routes:', err);
  }
}

// ─── Page load ────────────────────────────────────────────────────────────────

async function init() {
  console.log('[INIT] Starting page initialization...');
  
  buildLoginScreen();
  console.log('[INIT] Login screen built');

  // Check localStorage first for cached auth state
  const cachedAuth = loadAuthFromStorage();
  if (cachedAuth && cachedAuth.user && cachedAuth.user.role === 'driver') {
    console.log('[INIT] Found cached driver auth in localStorage');
    
    // Verify the server session is still valid before using cached auth
    console.log('[INIT] Validating server session...');
    const sessionValidRes = await apiGet('/api/auth/session');
    
    if (sessionValidRes.ok) {
      const sessionData = await sessionValidRes.json();
      
      // Verify the session matches the cached user
      if (sessionData.user?.role === 'driver' && sessionData.user?.id === cachedAuth.user.id) {
        console.log('[INIT] Server session is valid and matches cached auth');
        DriverState.user = cachedAuth.user;
        
        // Update sessionId from server response in case it changed
        if (sessionData.session_id) {
          saveAuthToStorage(cachedAuth.user, sessionData.session_id);
        }
        
        // Restore logger and proceed with loading app
        if (cachedAuth.sessionId) {
          console.log('[INIT] Restoring logger with cached session_id:', cachedAuth.sessionId.substring(0, 8) + '...');
          logger.init(cachedAuth.sessionId);
          logger.log('page_loaded', 'success', { action: 'cached_session_restored' });
          console.log('[INIT] Logger initialized with cached session');
        }
        
        // Fetch routes in background
        await fetchRoutes();
        
        // Fetch and restore active trip state
        console.log('[INIT] Fetching active trips...');
        const tripsRes = await apiGet('/api/trips?driver_active=1');
        if (tripsRes.ok) {
          const tripsData = await tripsRes.json();
          const active = (tripsData.trips || []).find(t => t.status === 'active' || t.status === 'paused');
          if (active) {
            console.log('[INIT] Active trip found:', active.id, 'status:', active.status);
            DriverState.activeTrip = active;
            showScreen(active.status === 'paused' ? 'screen-paused-trip' : 'screen-active-trip');
            startGpsPoll(active.id);
            console.log('[INIT] Init complete - active trip screen shown');
            return;
          } else {
            console.log('[INIT] No active trips found');
          }
        } else {
          console.warn('[INIT] Could not fetch active trips:', tripsRes.status);
        }
        
        console.log('[INIT] Showing home screen');
        showScreen('screen-home');
        console.log('[INIT] Init complete - home screen shown');
        return;
      } else {
        console.log('[INIT] Session role mismatch or user mismatch, clearing cache');
        clearAuthFromStorage();
        showScreen('screen-login');
        return;
      }
    } else {
      console.log('[INIT] Server session invalid or expired (', sessionValidRes.status, '), clearing cache and showing login');
      clearAuthFromStorage();
      showScreen('screen-login');
      return;
    }
  }

  // No cached auth, check server session
  console.log('[INIT] No cached driver auth, fetching session and routes in parallel...');
  const [sessionRes] = await Promise.all([apiGet('/api/auth/session'), fetchRoutes()]);
  console.log('[INIT] Fetch completed, sessionRes.ok:', sessionRes.ok);

  if (!sessionRes.ok) { 
    console.log('[INIT] User not logged in (401), showing login screen');
    showScreen('screen-login');
    console.log('[INIT] Init complete - login screen shown');
    return;
  }

  console.log('[INIT] User is logged in (session exists)');
  const data = await sessionRes.json();
  console.log('[INIT] Session data:', { user_id: data.user?.id, name: data.user?.name, role: data.user?.role });
  
  // Verify the session is for driver role, not rider
  if (data.user?.role !== 'driver') {
    console.log('[INIT] Session role mismatch:', data.user?.role, '!== driver, clearing and showing login');
    clearAuthFromStorage();
    showScreen('screen-login');
    return;
  }
  
  DriverState.user = data.user;
  console.log('[INIT] DriverState.user set');
  
  // Save to localStorage for faster future loads
  if (data.session_id) {
    saveAuthToStorage(data.user, data.session_id);
  }

  // Restore logger with session ID from server
  if (data.session_id) {
    console.log('[INIT] Session ID found, initializing logger:', data.session_id.substring(0, 8) + '...');
    logger.init(data.session_id);
    logger.log('page_loaded', 'success', { action: 'session_restored' });
    console.log('[INIT] Logger initialized and page_loaded logged');
  } else {
    console.warn('[INIT] WARNING: Session exists but no session_id returned');
  }

  // Restore active trip if one exists
  console.log('[INIT] Fetching active trips...');
  const tripsRes = await apiGet('/api/trips?driver_active=1');
  if (tripsRes.ok) {
    const tripsData = await tripsRes.json();
    const active = (tripsData.trips || []).find(t => t.status === 'active' || t.status === 'paused');
    if (active) {
      console.log('[INIT] Active trip found:', active.id, 'status:', active.status);
      DriverState.activeTrip = active;
      showScreen(active.status === 'paused' ? 'screen-paused-trip' : 'screen-active-trip');
      startGpsPoll(active.id);
      startRidersPoll(active.id);
      console.log('[INIT] Init complete - active trip screen shown');
      return;
    } else {
      console.log('[INIT] No active trips found');
    }
  } else {
    console.warn('[INIT] Could not fetch active trips:', tripsRes.status);
  }
  
  console.log('[INIT] Showing home screen');
  showScreen('screen-home');
  console.log('[INIT] Init complete - home screen shown');
}

document.addEventListener('DOMContentLoaded', init);

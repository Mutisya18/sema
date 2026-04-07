// rider.js — Rider frontend (Phase 1 + 2 + 4)
'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

const RiderState = {
  user: null,
  selectedRouteId: null,
  selectedTripId: null,
  selectedTrip: null,
  activePickup: null,
  map: null,
  matutuMarker: null,
  pickupMarker: null,
  gpsPollInterval: null,
  pickupPollInterval: null,
  currentScreen: null,
  lastAlertLevel: null,
  errorBannerActive: false,
  // interpolation
  _animFrame: null,
  _prevPos: null,
  _targetPos: null,
  _animStart: null,
  // journey mode: 'flagging' | 'pickup'
  journeyMode: null,
};

let ROUTES = [];

// ─── Navigation ──────────────────────────────────────────────────────────────

const ON_EXIT = {};
const ON_ENTER = {};

window.onerror = (msg, src, line, col, err) => {
  console.error('[RIDER UNCAUGHT]', msg, 'at', src, line + ':' + col, err);
};
window.addEventListener('unhandledrejection', (e) => {
  console.error('[RIDER UNHANDLED PROMISE]', e.reason);
});

function showScreen(screenId) {
  const previous = RiderState.currentScreen;
  try { if (previous && ON_EXIT[previous]) ON_EXIT[previous](); }
  catch (err) { console.error('[showScreen onExit]', previous, err); }

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (!target) { console.error('[showScreen] no element:', screenId); return; }
  target.classList.add('active');
  target.scrollTop = 0;
  RiderState.currentScreen = screenId;

  try { if (ON_ENTER[screenId]) ON_ENTER[screenId](); }
  catch (err) { console.error('[showScreen onEnter]', screenId, err); showToast('Screen error — check console', 'error'); }
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiPost(path, body) {
  return fetch('/rider' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function apiGet(path) { return fetch('/rider' + path); }
async function apiPatch(path) {
  return fetch('/rider' + path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
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

function normalizePhone(input) {
  const digits = [...(input || '')].filter(ch => /\d/.test(ch)).join('');
  if (!digits) return '';
  if (digits.startsWith('0')) return '+254' + digits.slice(1);
  if (digits.startsWith('254')) return '+' + digits;
  return '+' + digits;
}

// ─── Screen: Login ───────────────────────────────────────────────────────────

function buildLoginScreen() {
  const el = document.getElementById('screen-login');
  el.innerHTML = `
    <div class="login-icon">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="4" y="12" width="32" height="18" rx="4" fill="#1a5cff" opacity=".9"/>
        <rect x="8" y="16" width="10" height="8" rx="2" fill="#fff" opacity=".8"/>
        <rect x="22" y="16" width="10" height="8" rx="2" fill="#fff" opacity=".8"/>
        <circle cx="10" cy="32" r="4" fill="#1a5cff" stroke="#fff" stroke-width="2"/>
        <circle cx="30" cy="32" r="4" fill="#1a5cff" stroke="#fff" stroke-width="2"/>
      </svg>
    </div>
    <p class="login-title">Sema</p>
    <p class="login-tagline">Matatu hailing, reimagined</p>
    <form class="login-form" id="login-form">
      <input class="login-input" id="login-phone" type="tel" placeholder="+254 7XX XXX XXX" autocomplete="tel" />
      <p class="login-error" id="login-error"></p>
      <button class="login-btn" type="submit">Sign in →</button>
    </form>
  `;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = normalizePhone(document.getElementById('login-phone').value);
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    if (!phone) { errorEl.textContent = 'Please enter your phone number'; return; }
    try {
      const res = await apiPost('/api/auth/login', { phone, role: 'rider' });
      const data = await res.json();
      if (res.ok) { RiderState.user = data.user; showScreen('screen-home'); }
      else if (res.status === 404) { errorEl.textContent = 'Phone number not found'; }
      else { errorEl.textContent = data.error || 'Something went wrong — try again'; }
    } catch (err) {
      console.error('[login]', err);
      errorEl.textContent = 'Unable to reach the server — check your connection';
    }
  });
}

// ─── Screen: Home ────────────────────────────────────────────────────────────

ON_ENTER['screen-home'] = () => {
  if (!RiderState.user) { showScreen('screen-login'); return; }
  const el = document.getElementById('screen-home');
  const user = RiderState.user;
  el.innerHTML = `
    <div class="home-header">
      <div>
        <p class="home-greeting-sub">Good morning,</p>
        <p class="home-greeting-name">${user.name} 👋</p>
      </div>
      <div class="avatar">${initials(user.name)}</div>
    </div>
    <div class="home-content">
      <input class="search-bar" id="home-search" placeholder="Where are you going?" readonly />
      <div class="quick-actions">
        <div class="quick-card primary" id="btn-quick-trip">
          <div class="quick-card-emoji">🚍</div>
          <div class="quick-card-label">Quick Trip</div>
          <div class="quick-card-sub">Flag a matatu now</div>
        </div>
        <div class="quick-card secondary" id="btn-schedule">
          <div class="quick-card-emoji">📅</div>
          <div class="quick-card-label">Schedule Ride</div>
          <div class="quick-card-sub">Reserve a seat</div>
        </div>
      </div>
    </div>
    ${buildBottomNav('home')}
  `;
  document.getElementById('home-search').addEventListener('click', () => {
    RiderState.journeyMode = 'pickup';
    showScreen('screen-search');
  });
  document.getElementById('btn-quick-trip').addEventListener('click', () => {
    RiderState.journeyMode = 'flagging';
    showScreen('screen-search');
  });
  document.getElementById('btn-schedule').addEventListener('click', () => {
    RiderState.journeyMode = 'pickup';
    showScreen('screen-search');
  });
  wireBottomNav();
};

// ─── Screen: Search (S-02) ───────────────────────────────────────────────────

ON_ENTER['screen-search'] = () => {
  const el = document.getElementById('screen-search');
  const isFlagging = RiderState.journeyMode === 'flagging';

  // For flagging: from is locked to CBD (route origin). For pickup: both editable.
  const flaggingOrigin = isFlagging ? (ROUTES[0]?.stops[0]?.name || 'CBD') : null;

  el.innerHTML = `
    <div class="screen-header" style="flex-direction:column;align-items:stretch;gap:8px;padding:12px 16px">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="back-btn" id="search-back">←</button>
        <span class="screen-title">Find a matatu</span>
      </div>
      <div style="border:1.5px solid #e0e0e0;border-radius:12px;overflow:hidden">
        <div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid #f0f0f0;gap:10px">
          <div style="width:8px;height:8px;border-radius:50%;background:#1a5cff;flex-shrink:0"></div>
          <input id="from-input" style="border:none;outline:none;font-size:14px;font-family:inherit;flex:1;background:${isFlagging ? '#f8f8f8' : '#fff'};color:${isFlagging ? '#888' : '#111'}"
            placeholder="From where?" value="${isFlagging ? flaggingOrigin : ''}" ${isFlagging ? 'readonly' : ''} />
        </div>
        <div style="display:flex;align-items:center;padding:10px 14px;gap:10px">
          <div style="width:8px;height:8px;border-radius:2px;background:#111;flex-shrink:0"></div>
          <input id="to-input" style="border:none;outline:none;font-size:14px;font-family:inherit;flex:1" placeholder="Where to?" />
        </div>
      </div>
      <div id="stop-suggestions" style="display:none;background:#fff;border:1.5px solid #e0e0e0;border-radius:10px;max-height:200px;overflow-y:auto;position:relative;z-index:50"></div>
    </div>
    <div id="search-map" style="height:160px;background:#e8f0ff"></div>
    <div style="padding:12px 16px">
      <p style="font-size:13px;color:#888;margin-bottom:10px" id="trip-count">Enter your destination to see matatus</p>
      <div id="trip-list"></div>
    </div>
  `;

  document.getElementById('search-back').addEventListener('click', () => showScreen('screen-home'));

  // Reset selections
  RiderState._toStop = null;
  RiderState._fromStop = null;

  // For flagging, pre-set from stop to route origin
  if (isFlagging && ROUTES.length > 0) {
    const origin = ROUTES[0].stops[0];
    RiderState._fromStop = { ...origin, route_id: ROUTES[0].id };
  }

  let _activeInputId = null;

  function renderSuggestions(query) {
    const suggestionsEl = document.getElementById('stop-suggestions');
    const seen = new Set();
    const matches = [];
    ROUTES.forEach(route => {
      route.stops.forEach(stop => {
        const key = stop.name + '|' + route.id;
        if (!seen.has(key) && (!query || stop.name.toLowerCase().includes(query.toLowerCase()))) {
          seen.add(key);
          matches.push({ ...stop, route_id: route.id, route_name: route.name });
        }
      });
    });
    if (matches.length === 0) { suggestionsEl.style.display = 'none'; return; }
    suggestionsEl.style.display = 'block';
    suggestionsEl.innerHTML = matches.map(s => `
      <div class="stop-suggestion" data-stop='${JSON.stringify(s)}'
        style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600">${s.name}</span>
        <span style="font-size:11px;color:#aaa">${s.route_name}</span>
      </div>
    `).join('');
    suggestionsEl.querySelectorAll('.stop-suggestion').forEach(row => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const stop = JSON.parse(row.dataset.stop);
        suggestionsEl.style.display = 'none';
        if (_activeInputId === 'to-input') {
          RiderState._toStop = stop;
          document.getElementById('to-input').value = stop.name;
        } else {
          RiderState._fromStop = stop;
          document.getElementById('from-input').value = stop.name;
        }
        _tryLoadTrips();
      });
    });
  }

  const toInput = document.getElementById('to-input');
  toInput.addEventListener('focus', () => { _activeInputId = 'to-input'; renderSuggestions(toInput.value); });
  toInput.addEventListener('input', () => renderSuggestions(toInput.value));
  toInput.addEventListener('blur', () => setTimeout(() => { const s = document.getElementById('stop-suggestions'); if (s) s.style.display = 'none'; }, 150));

  if (!isFlagging) {
    const fromInput = document.getElementById('from-input');
    fromInput.addEventListener('focus', () => { _activeInputId = 'from-input'; renderSuggestions(fromInput.value); });
    fromInput.addEventListener('input', () => renderSuggestions(fromInput.value));
    fromInput.addEventListener('blur', () => setTimeout(() => { const s = document.getElementById('stop-suggestions'); if (s) s.style.display = 'none'; }, 150));
  }

  if (RiderState.map) RiderState.map.resize();
  else _initSearchMap();
};

ON_EXIT['screen-search'] = () => {
  // Keep map instance alive for reuse on detail screen
};

function _tryLoadTrips() {
  const toStop = RiderState._toStop;
  const fromStop = RiderState._fromStop;
  const isFlagging = RiderState.journeyMode === 'flagging';

  if (!toStop) return;

  let routeId, fromStopId;
  if (isFlagging) {
    // Use the toStop's route; from is already pre-set to origin
    routeId = toStop.route_id;
    fromStopId = fromStop?.id;
    // Update from-input label to show the correct origin for this route
    const route = ROUTES.find(r => r.id === routeId);
    const origin = route?.stops[0];
    if (origin && (!fromStop || fromStop.route_id !== routeId)) {
      RiderState._fromStop = { ...origin, route_id: routeId };
      const fromEl = document.getElementById('from-input');
      if (fromEl) fromEl.value = origin.name;
      fromStopId = origin.id;
    }
  } else {
    if (!fromStop) return;
    routeId = fromStop.route_id;
    fromStopId = fromStop.id;
  }

  RiderState.selectedRouteId = routeId;
  _renderRouteOnMap(routeId);
  _fetchAndRenderTrips(routeId, fromStopId);
}

async function _fetchAndRenderTrips(routeId, fromStopId) {
  const countEl = document.getElementById('trip-count');
  const listEl = document.getElementById('trip-list');
  if (!countEl || !listEl) return;

  countEl.textContent = 'Loading...';
  const url = `/api/trips?route_id=${routeId}${fromStopId ? `&from_stop_id=${fromStopId}` : ''}`;
  let res;
  try { res = await apiGet(url); }
  catch { countEl.textContent = 'Connection error — try again'; return; }

  if (!res.ok) { countEl.textContent = 'Could not load matatus'; return; }

  const data = await res.json();
  const trips = data.trips || [];
  const route = ROUTES.find(r => r.id === routeId);
  countEl.textContent = `${trips.length} matatu${trips.length !== 1 ? 's' : ''} found · ${route?.name || ''}`;

  if (trips.length === 0) {
    listEl.innerHTML = '<p style="font-size:13px;color:#888;padding:8px 0">No matatus available on this route right now</p>';
    return;
  }

  listEl.innerHTML = trips.map(t => _buildTripCard(t)).join('');
  listEl.querySelectorAll('.trip-card').forEach(card => {
    card.addEventListener('click', () => {
      const trip = trips.find(t => t.id === parseInt(card.dataset.tripId));
      RiderState.selectedTripId = trip.id;
      RiderState.selectedTrip = trip;
      if (trip.status === 'scheduled') {
        showScreen('screen-booking-confirm');
      } else {
        showScreen('screen-matatu-detail');
      }
    });
  });

  // Add matatu dots to map
  _addTripDotsToMap(trips);
}

function _buildTripCard(trip) {
  const seats = trip.seats_available;
  const seatColour = seats >= 6 ? '#0a7a3e' : seats >= 2 ? '#d06000' : '#d00';
  const seatBg = seats >= 6 ? '#e6f6ee' : seats >= 2 ? '#fff3e0' : '#ffe8e8';
  const isScheduled = trip.status === 'scheduled';
  const border = isScheduled ? '1.5px solid #a8c0ff' : '1.5px solid #f0f0f0';
  const bg = isScheduled ? '#f7f9ff' : '#fff';
  const statusBadge = isScheduled
    ? '<span style="padding:3px 8px;border-radius:20px;background:#e8f0ff;color:#1a5cff;font-size:11px;font-weight:700">Scheduled 📅</span>'
    : '';

  // ETA to rider's from stop
  let etaText = '';
  if (trip.stop_etas && RiderState._fromStop) {
    const eta = trip.stop_etas[RiderState._fromStop.id];
    if (eta) {
      const etaDate = new Date(eta);
      etaText = etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  return `
    <div class="trip-card" data-trip-id="${trip.id}"
      style="border:${border};border-radius:14px;padding:14px;background:${bg};margin-bottom:10px;cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <p style="font-size:16px;font-weight:700;color:#111">${trip.plate}</p>
          <p style="font-size:12px;color:#888">${trip.sacco}</p>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span style="padding:3px 10px;border-radius:20px;background:${seatBg};color:${seatColour};font-size:11px;font-weight:700">${seats} seat${seats !== 1 ? 's' : ''}</span>
          ${statusBadge}
        </div>
      </div>
      <div style="display:flex;gap:16px">
        <div><p style="font-size:14px;font-weight:600;color:#111">KSh ${trip.fare}</p><p style="font-size:10px;color:#aaa">Fare</p></div>
        ${etaText ? `<div><p style="font-size:14px;font-weight:600;color:#111">${etaText}</p><p style="font-size:10px;color:#aaa">ETA to your stop</p></div>` : ''}
      </div>
    </div>
  `;
}

// ─── Map: Search screen ───────────────────────────────────────────────────────

let _tripDotMarkers = [];
let _stopMarkers = [];

function _initSearchMap() {
  mapboxgl.accessToken = MAPBOX_TOKEN;
  const map = new mapboxgl.Map({
    container: 'search-map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [36.8219, -1.2921],
    zoom: 11,
  });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.on('error', () => {
    const c = document.getElementById('search-map');
    if (!c) return;
    c.style.position = 'relative';
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;top:8px;left:8px;right:8px;background:#ffe8e8;color:#d00;padding:8px 12px;border-radius:8px;font-size:12px;z-index:10';
    b.textContent = 'Map unavailable — check your connection';
    c.appendChild(b);
  });
  RiderState.map = map;
}

function _renderRouteOnMap(routeId) {
  const map = RiderState.map;
  if (!map) return;
  const route = ROUTES.find(r => r.id === routeId);
  if (!route) return;

  const apply = () => {
    if (map.getLayer('route-line-layer')) map.removeLayer('route-line-layer');
    if (map.getSource('route-line')) map.removeSource('route-line');
    _stopMarkers.forEach(m => m.remove()); _stopMarkers = [];

    map.addSource('route-line', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: route.coordinates } },
    });
    map.addLayer({ id: 'route-line-layer', type: 'line', source: 'route-line', paint: { 'line-color': '#1a5cff', 'line-width': 3 } });

    route.stops.forEach(stop => {
      const el = document.createElement('div');
      el.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#1a5cff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)';
      const m = new mapboxgl.Marker({ element: el })
        .setLngLat([stop.lng, stop.lat])
        .setPopup(new mapboxgl.Popup({ offset: 8 }).setText(stop.name))
        .addTo(map);
      _stopMarkers.push(m);
    });

    const coords = route.coordinates;
    const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: 40, duration: 500 });
  };

  if (map.isStyleLoaded()) apply();
  else map.once('load', apply);
}

function _addTripDotsToMap(trips) {
  const map = RiderState.map;
  if (!map) return;
  _tripDotMarkers.forEach(m => m.remove()); _tripDotMarkers = [];
  trips.forEach(trip => {
    const el = document.createElement('div');
    el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#0d7a3e;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer';
    const m = new mapboxgl.Marker({ element: el })
      .setLngLat([trip.current_lng, trip.current_lat])
      .setPopup(new mapboxgl.Popup({ offset: 8 }).setHTML(`<b>${trip.plate}</b><br>${trip.sacco}`))
      .addTo(map);
    _tripDotMarkers.push(m);
  });
}

// ─── Map: Tracking (detail + waiting + live) ─────────────────────────────────

function _initTrackingMap(containerId, lat, lng) {
  // Destroy previous instance if container changed
  if (RiderState.map) { RiderState.map.remove(); RiderState.map = null; RiderState.matutuMarker = null; }
  mapboxgl.accessToken = MAPBOX_TOKEN;
  const map = new mapboxgl.Map({
    container: containerId,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [lng, lat],
    zoom: 14,
  });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.on('load', () => {
    const trip = RiderState.selectedTrip;
    if (!trip) return;
    const route = ROUTES.find(r => r.id === trip.route_id);
    if (!route) return;
    if (map.getLayer('route-line-layer')) map.removeLayer('route-line-layer');
    if (map.getSource('route-line')) map.removeSource('route-line');
    map.addSource('route-line', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: route.coordinates } },
    });
    map.addLayer({ id: 'route-line-layer', type: 'line', source: 'route-line', paint: { 'line-color': '#1a5cff', 'line-width': 3 } });
    route.stops.forEach(stop => {
      const el = document.createElement('div');
      el.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#1a5cff;border:2px solid #fff';
      new mapboxgl.Marker({ element: el }).setLngLat([stop.lng, stop.lat])
        .setPopup(new mapboxgl.Popup({ offset: 6 }).setText(stop.name)).addTo(map);
    });
    // Place matatu dot
    _placeOrMoveDot(trip.current_lat, trip.current_lng);
  });
  RiderState.map = map;
}

function _placeOrMoveDot(lat, lng) {
  const map = RiderState.map;
  if (!map) return;
  if (!RiderState.matutuMarker) {
    const el = document.createElement('div');
    el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#0d7a3e;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)';
    RiderState.matutuMarker = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    RiderState._prevPos = { lat, lng };
    return;
  }
  _startDotInterpolation(lat, lng);
}

function _startDotInterpolation(targetLat, targetLng) {
  if (RiderState._animFrame) cancelAnimationFrame(RiderState._animFrame);
  const prev = RiderState.matutuMarker.getLngLat();
  RiderState._prevPos = { lat: prev.lat, lng: prev.lng };
  RiderState._targetPos = { lat: targetLat, lng: targetLng };
  RiderState._animStart = Date.now();
  const DURATION = 5000;
  function step() {
    const p = Math.min((Date.now() - RiderState._animStart) / DURATION, 1);
    const lat = RiderState._prevPos.lat + (RiderState._targetPos.lat - RiderState._prevPos.lat) * p;
    const lng = RiderState._prevPos.lng + (RiderState._targetPos.lng - RiderState._prevPos.lng) * p;
    RiderState.matutuMarker.setLngLat([lng, lat]);
    if (p < 1) RiderState._animFrame = requestAnimationFrame(step);
  }
  RiderState._animFrame = requestAnimationFrame(step);
}

function _stopDotAnimation() {
  if (RiderState._animFrame) { cancelAnimationFrame(RiderState._animFrame); RiderState._animFrame = null; }
}

// ─── Poll 1 — GPS (rider side) ────────────────────────────────────────────────

function startGpsPoll(tripId) {
  stopGpsPoll();
  RiderState.gpsPollInterval = setInterval(() => _pollGps(tripId), 5000);
}

function stopGpsPoll() {
  if (RiderState.gpsPollInterval) { clearInterval(RiderState.gpsPollInterval); RiderState.gpsPollInterval = null; }
}

async function _pollGps(tripId) {
  let res;
  try { res = await apiGet(`/api/trips/${tripId}/gps`); }
  catch { _showRiderBanner('error-banner', 'Connection issue — retrying', 'error'); return; }

  if (res.status === 401) { stopAllPolls(); showScreen('screen-login'); return; }
  if (res.status === 404) { stopGpsPoll(); showToast('This trip no longer exists', 'warning'); showScreen('screen-home'); return; }
  if (!res.ok) { _showRiderBanner('error-banner', 'Something went wrong — retrying', 'error'); return; }

  _clearRiderBanner('error-banner');
  const data = await res.json();

  if (data.status === 'ended') { stopGpsPoll(); showToast('This trip has ended', 'warning'); showScreen('screen-home'); return; }
  if (data.status === 'paused') {
    _stopDotAnimation();
    _showRiderBanner('status-banner', 'Matatu is temporarily unavailable — the driver may resume shortly', 'warning');
  } else {
    _clearRiderBanner('status-banner');
    _placeOrMoveDot(data.current_lat, data.current_lng);
  }

  if (RiderState.selectedTrip) {
    RiderState.selectedTrip.current_lat = data.current_lat;
    RiderState.selectedTrip.current_lng = data.current_lng;
    RiderState.selectedTrip.current_step = data.current_step;
  }

  // Re-evaluate board button visibility on every GPS tick
  _checkAndRevealBoardButton();
}

// ─── Screen: Matatu Detail (S-04) ─────────────────────────────────────────────

ON_ENTER['screen-matatu-detail'] = () => {
  const trip = RiderState.selectedTrip;
  if (!trip) { showScreen('screen-search'); return; }

  const isFlagging = RiderState.journeyMode === 'flagging';
  const seats = trip.seats_available;
  const seatColour = seats >= 6 ? '#0a7a3e' : seats >= 2 ? '#d06000' : '#d00';
  const seatBg = seats >= 6 ? '#e6f6ee' : seats >= 2 ? '#fff3e0' : '#ffe8e8';

  const el = document.getElementById('screen-matatu-detail');
  el.innerHTML = `
    <div class="screen-header">
      <button class="back-btn" id="detail-back">←</button>
      <span class="screen-title" style="font-size:16px;font-weight:700">${trip.plate}</span>
      <span style="padding:3px 10px;border-radius:20px;background:${seatBg};color:${seatColour};font-size:11px;font-weight:700">${seats} seat${seats !== 1 ? 's' : ''}</span>
    </div>
    <div id="detail-map" style="height:180px;background:#e8f0ff"></div>
    <div id="status-banner" style="display:none"></div>
    <div id="error-banner" style="display:none"></div>
    <div style="padding:14px;display:flex;flex-direction:column;gap:12px">
      <!-- Route summary -->
      <div style="background:#f8f8f8;border-radius:12px;padding:12px">
        <p style="font-size:11px;color:#888;margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Route</p>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${(trip.active_stops || []).map((s, i, arr) => `
            <span style="font-size:12px;padding:3px 8px;border-radius:20px;background:#e8f0ff;color:#1a5cff;font-weight:600">${s.name}</span>
            ${i < arr.length - 1 ? '<span style="color:#aaa;font-size:12px">→</span>' : ''}
          `).join('')}
        </div>
      </div>
      <!-- Stats grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${[['KSh ' + trip.fare, 'Fare'], [trip.sacco, 'Sacco'], [seats + ' seats', 'Available'], [trip.route_name, 'Route']].map(([v, l]) => `
          <div style="background:#f8f8f8;border-radius:12px;padding:12px">
            <p style="font-size:14px;font-weight:600;color:#111">${v}</p>
            <p style="font-size:10px;color:#aaa;margin-top:2px">${l}</p>
          </div>
        `).join('')}
      </div>
      <!-- Driver row -->
      <div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f8f8f8;border-radius:12px">
        <div style="width:40px;height:40px;border-radius:50%;background:#e8f0ff;color:#1a5cff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${initials(trip.driver_name || '')}
        </div>
        <div>
          <p style="font-size:14px;font-weight:600;color:#111">${trip.driver_name || ''}</p>
          <p style="font-size:12px;color:#888">${trip.plate} · ${trip.sacco}</p>
        </div>
      </div>
      <!-- Action button -->
      <button id="btn-action" style="width:100%;padding:14px;background:#1a5cff;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">
        ${isFlagging ? 'Flag Matatu' : 'Set as Pickup Matatu'}
      </button>
    </div>
  `;

  document.getElementById('detail-back').addEventListener('click', () => {
    stopGpsPoll();
    showScreen('screen-search');
  });

  document.getElementById('btn-action').addEventListener('click', async () => {
    const fromStop = RiderState._fromStop;
    if (!fromStop) { showToast('Please select a pickup stop first', 'warning'); return; }

    const btn = document.getElementById('btn-action');
    btn.disabled = true;
    btn.textContent = 'Requesting...';

    const res = await apiPost('/api/pickups', {
      trip_id: trip.id,
      pickup_type: RiderState.journeyMode === 'flagging' ? 'flagging' : 'pickup',
      stop_id: fromStop.id,
      seats_requested: 1,
    });
    const data = await res.json();

    if (res.status === 201) {
      RiderState.activePickup = data.pickup;
      RiderState.lastAlertLevel = null;
      const waitScreen = isFlagging ? 'screen-flagging-waiting' : 'screen-pickup-waiting';
      showScreen(waitScreen);
    } else if (res.status === 409 && data.error === 'trip is not active') {
      showToast('This matatu is no longer available', 'warning');
      showScreen('screen-search');
    } else {
      showToast(data.error || 'No seats available at this stop', 'warning');
      btn.disabled = false;
      btn.textContent = isFlagging ? 'Flag Matatu' : 'Set as Pickup Matatu';
    }
  });

  // Init tracking map
  _initTrackingMap('detail-map', trip.current_lat, trip.current_lng);
  startGpsPoll(trip.id);
};

ON_EXIT['screen-matatu-detail'] = () => {
  stopGpsPoll();
};

// ─── Banner helpers ───────────────────────────────────────────────────────────

function _showRiderBanner(id, text, type) {
  const colours = { warning: { bg: '#fff3e0', border: '#ffd080', fg: '#d06000' }, error: { bg: '#ffe8e8', border: '#ffb0b0', fg: '#d00' }, info: { bg: '#e8f0ff', border: '#a8c0ff', fg: '#1a5cff' } };
  const c = colours[type] || colours.info;
  const el = document.getElementById(id);
  if (!el) return;
  el.style.cssText = `display:block;padding:12px 16px;background:${c.bg};border-bottom:1px solid ${c.border}`;
  el.innerHTML = `<p style="font-size:13px;font-weight:700;color:${c.fg}">${text}</p>`;
}

function _clearRiderBanner(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ─── Poll 2 — Pickup status ───────────────────────────────────────────────────

function startPickupPoll() {
  stopPickupPoll();
  RiderState.pickupPollInterval = setInterval(_pollPickup, 5000);
}

function stopPickupPoll() {
  if (RiderState.pickupPollInterval) { clearInterval(RiderState.pickupPollInterval); RiderState.pickupPollInterval = null; }
}

async function _pollPickup() {
  let res;
  try { res = await apiGet('/api/pickups/active'); }
  catch { _showRiderBanner('error-banner', 'Connection issue — retrying', 'error'); return; }

  if (res.status === 401) { stopAllPolls(); showScreen('screen-login'); return; }
  if (!res.ok) { _showRiderBanner('error-banner', 'Something went wrong — retrying', 'error'); return; }

  _clearRiderBanner('error-banner');
  const data = await res.json();
  const pickup = data.pickup;
  if (!pickup) return;

  RiderState.activePickup = pickup;

  // Update matatu dot position
  if (pickup.current_lat) _placeOrMoveDot(pickup.current_lat, pickup.current_lng);

  // Handle proximity banners
  if (pickup.alert_level !== RiderState.lastAlertLevel) {
    RiderState.lastAlertLevel = pickup.alert_level;
    _updateProximityBanner(pickup.alert_level);
  }

  // Handle status transitions
  const previousStatus = RiderState.activePickup?._lastKnownStatus;

  if (pickup.status === 'accepted') {
    if (previousStatus !== 'accepted') {
      showToast('Driver accepted — head to your stop!', 'success');
    }
    RiderState.activePickup._lastKnownStatus = 'accepted';
    // Show "I'm On Board" only once matatu has reached or passed the rider's stop
    _checkAndRevealBoardButton();
    return;
  }
  if (pickup.status === 'completed') { stopPickupPoll(); showScreen('screen-live-trip'); return; }
  if (pickup.status === 'rejected') {
    stopPickupPoll();
    showToast('Driver could not pick you up', 'warning');
    _returnToSearch();
    return;
  }
  if (pickup.status === 'cancelled') { stopPickupPoll(); _returnToSearch(); return; }
  if (pickup.status === 'no_show') {
    stopPickupPoll();
    showToast('You missed your pickup window', 'warning');
    _returnToSearch();
    return;
  }
  if (pickup.trip_status === 'ended') {
    stopPickupPoll();
    showToast('This trip has ended', 'warning');
    showScreen('screen-home');
    return;
  }
}

function _checkAndRevealBoardButton() {
  const pickup = RiderState.activePickup;
  if (!pickup || pickup.status !== 'accepted') return;

  const fromStop = RiderState._fromStop;
  const currentStep = RiderState.selectedTrip?.current_step;

  // Reveal once matatu has reached or passed the rider's stop
  const mataturReached = fromStop && currentStep !== undefined && currentStep >= fromStop.step;

  const statusLine = document.getElementById('pickup-status-line');
  const boardBtn = document.getElementById('btn-on-board');

  if (mataturReached) {
    if (statusLine) statusLine.textContent = 'Matatu is at your stop — board now!';
    if (boardBtn) boardBtn.style.display = 'block';
  } else {
    if (statusLine) statusLine.textContent = 'Driver accepted — matatu is on its way ✓';
    if (boardBtn) boardBtn.style.display = 'none';
  }
}

function _updateProximityBanner(alertLevel) {
  const bannerId = 'proximity-banner';
  if (alertLevel === 'none') { _clearRiderBanner(bannerId); return; }
  if (alertLevel === 'approaching') {
    _showRiderBanner(bannerId, '📍 Matatu 1.5 km away — start making your way to the road', 'warning');
    return;
  }
  if (alertLevel === 'near') {
    _showRiderBanner(bannerId, '🚨 Matatu 500m away — be at your stop now', 'error');
    _startCountdown();
    // Show Pick Me Up button if not already spotted
    const btn = document.getElementById('btn-pick-me-up');
    if (btn) btn.style.display = 'block';
  }
}

function _startCountdown() {
  const el = document.getElementById('countdown');
  if (!el || el.dataset.started) return;
  el.dataset.started = '1';
  let seconds = 120;
  el.textContent = '2:00';
  const timer = setInterval(() => {
    seconds--;
    if (seconds <= 0) { clearInterval(timer); el.textContent = '0:00'; return; }
    el.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }, 1000);
}

function _returnToSearch() {
  RiderState.activePickup = null;
  RiderState.lastAlertLevel = null;
  showScreen('screen-search');
}

// ─── Screen: Waiting (unified S-06/S-07) ─────────────────────────────────────

ON_ENTER['screen-flagging-waiting'] = _buildWaitingScreen;
ON_ENTER['screen-pickup-waiting'] = _buildWaitingScreen;

function _buildWaitingScreen() {
  const trip = RiderState.selectedTrip;
  const pickup = RiderState.activePickup;
  if (!trip || !pickup) { showScreen('screen-search'); return; }

  const screenId = RiderState.currentScreen;
  const el = document.getElementById(screenId);
  el.innerHTML = `
    <div class="screen-header">
      <button class="back-btn" id="waiting-back">←</button>
      <span class="screen-title">Waiting for pickup</span>
      <span style="padding:3px 8px;border-radius:20px;background:#fff3e0;color:#d06000;font-size:11px;font-weight:700">● Live</span>
    </div>
    <div id="waiting-map" style="height:240px;background:#e8f0ff"></div>
    <div id="proximity-banner" style="display:none"></div>
    <div id="error-banner" style="display:none"></div>
    <div style="padding:12px 16px;display:flex;flex-direction:column;gap:10px">
      <div style="background:#f8f8f8;border-radius:12px;padding:12px">
        <p style="font-size:16px;font-weight:700;color:#111">${trip.plate}</p>
        <p style="font-size:12px;color:#888">${trip.sacco} · ${pickup.stop_name}</p>
        <p id="pickup-status-line" style="font-size:12px;color:#888;margin-top:4px">You're visible to the driver</p>
      </div>
      <div id="countdown-row" style="display:none;align-items:center;justify-content:space-between;padding:8px 12px;background:#ffe8e8;border-radius:10px">
        <p style="font-size:12px;color:#d00">Pickup window closes in</p>
        <span id="countdown" style="font-size:24px;font-weight:800;color:#d00">2:00</span>
      </div>
      <button id="btn-on-board" style="display:none;width:100%;padding:14px;background:#0d7a3e;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">I'm On Board ✓</button>
      <button id="btn-pick-me-up" style="display:none;width:100%;padding:14px;background:#1a5cff;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Pick Me Up! 🙋</button>
      <button id="btn-cancel-pickup" style="width:100%;padding:14px;background:#f2f2f2;color:#333;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Cancel request</button>
    </div>
  `;

  // Flagging: Pick Me Up visible immediately. Pickup: only at alert_level=near.
  const isFlagging = RiderState.journeyMode === 'flagging';
  if (isFlagging) document.getElementById('btn-pick-me-up').style.display = 'block';

  document.getElementById('waiting-back').addEventListener('click', async () => {
    await _cancelPickup();
    stopPickupPoll();
    stopGpsPoll();
    showScreen('screen-search');
  });

  document.getElementById('btn-on-board').addEventListener('click', async () => {
    const res = await apiPatch(`/api/pickups/${pickup.id}/board`);
    if (res.ok) {
      stopPickupPoll();
      showScreen('screen-live-trip');
    } else {
      showToast('Boarding could not be confirmed — try again', 'error');
    }
  });

  document.getElementById('btn-pick-me-up').addEventListener('click', async () => {
    const btn = document.getElementById('btn-pick-me-up');
    btn.disabled = true;
    btn.textContent = 'Signalled ✓';
    btn.style.background = '#e8f0ff';
    btn.style.color = '#1a5cff';
    const res = await apiPatch(`/api/pickups/${pickup.id}/spot`);
    if (!res.ok && res.status !== 409) {
      btn.disabled = false;
      btn.textContent = 'Pick Me Up! 🙋';
      btn.style.background = '#1a5cff';
      btn.style.color = '#fff';
    }
  });

  document.getElementById('btn-cancel-pickup').addEventListener('click', async () => {
    await _cancelPickup();
    stopPickupPoll();
    stopGpsPoll();
    showScreen('screen-search');
  });

  // Show countdown row when near
  if (pickup.alert_level === 'near') {
    document.getElementById('countdown-row').style.display = 'flex';
    _startCountdown();
  }

  // Init map
  _initTrackingMap('waiting-map', trip.current_lat, trip.current_lng);
  startGpsPoll(trip.id);
  startPickupPoll();
}

ON_EXIT['screen-flagging-waiting'] = () => { stopPickupPoll(); stopGpsPoll(); };
ON_EXIT['screen-pickup-waiting'] = () => { stopPickupPoll(); stopGpsPoll(); };

async function _cancelPickup() {
  if (!RiderState.activePickup) return;
  try {
    await apiPatch(`/api/pickups/${RiderState.activePickup.id}/cancel`);
  } catch (e) { console.error('[cancelPickup]', e); }
  RiderState.activePickup = null;
  RiderState.lastAlertLevel = null;
}

// ─── Screen: Boarding Confirm (S-09) ─────────────────────────────────────────

ON_ENTER['screen-boarding-confirm'] = () => {
  const trip = RiderState.selectedTrip;
  const pickup = RiderState.activePickup;
  if (!trip || !pickup) { showScreen('screen-search'); return; }

  const el = document.getElementById('screen-boarding-confirm');
  el.innerHTML = `
    <div style="padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center">
      <div style="width:72px;height:72px;border-radius:50%;background:#e8f0ff;display:flex;align-items:center;justify-content:center;font-size:32px">🚍</div>
      <p style="font-size:20px;font-weight:700">Driver accepted!</p>
      <p style="font-size:14px;color:#888">${trip.plate} is stopping for you. Board and confirm.</p>
      <div style="width:100%;padding:12px 16px;background:#e6f6ee;border-radius:10px;border:1px solid #90d4b0">
        <p style="font-size:13px;font-weight:700;color:#0d7a3e">✓ Driver confirmed your request</p>
      </div>
      <div style="width:100%;background:#f8f8f8;border-radius:12px;padding:12px;text-align:left">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:#888">Matatu</span>
          <span style="font-size:13px;font-weight:600">${trip.plate}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:#888">Stop</span>
          <span style="font-size:13px;font-weight:600">${pickup.stop_name}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:12px;color:#888">Fare</span>
          <span style="font-size:13px;font-weight:600">KSh ${trip.fare}</span>
        </div>
      </div>
      <p id="boarding-timer" style="font-size:12px;color:#888">Boarding window: <span id="boarding-countdown">3:00</span></p>
      <button id="btn-on-board" style="width:100%;padding:14px;background:#1a5cff;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">I'm On Board ✓</button>
      <button id="btn-not-mine" style="width:100%;padding:14px;background:#ff3b30;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Not my matatu</button>
    </div>
  `;

  // 3-minute boarding timer
  let boardingSeconds = 180;
  const countdownEl = document.getElementById('boarding-countdown');
  const boardingTimer = setInterval(() => {
    boardingSeconds--;
    if (countdownEl) countdownEl.textContent = `${Math.floor(boardingSeconds / 60)}:${String(boardingSeconds % 60).padStart(2, '0')}`;
    if (boardingSeconds <= 0) {
      clearInterval(boardingTimer);
      _cancelPickup().then(() => {
        stopPickupPoll();
        showToast('Boarding window expired', 'warning');
        showScreen('screen-search');
      });
    }
  }, 1000);

  document.getElementById('btn-on-board').addEventListener('click', async () => {
    clearInterval(boardingTimer);
    const res = await apiPatch(`/api/pickups/${pickup.id}/board`);
    if (res.ok) {
      stopPickupPoll();
      showScreen('screen-live-trip');
    } else {
      showToast('Boarding could not be confirmed — try again', 'error');
    }
  });

  document.getElementById('btn-not-mine').addEventListener('click', async () => {
    clearInterval(boardingTimer);
    await _cancelPickup();
    stopPickupPoll();
    const waitScreen = RiderState.journeyMode === 'flagging' ? 'screen-flagging-waiting' : 'screen-pickup-waiting';
    showScreen(waitScreen);
  });

  startPickupPoll();
};

ON_EXIT['screen-boarding-confirm'] = () => { stopPickupPoll(); };

// ─── Screen: Live Trip (S-10) ─────────────────────────────────────────────────

ON_ENTER['screen-live-trip'] = () => {
  const trip = RiderState.selectedTrip;
  if (!trip) { showScreen('screen-home'); return; }

  const el = document.getElementById('screen-live-trip');
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#fff;border-bottom:1px solid #f0f0f0">
      <div>
        <p style="font-size:12px;color:#888">En route to</p>
        <p style="font-size:17px;font-weight:700">${RiderState._toStop?.name || 'Destination'}</p>
      </div>
      <span style="padding:3px 8px;border-radius:20px;background:#e6f6ee;color:#0a7a3e;font-size:11px;font-weight:700">● Live</span>
    </div>
    <div id="live-map" style="height:300px;background:#e8f0ff"></div>
    <div id="error-banner" style="display:none"></div>
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;gap:1px">
        ${[['KSh ' + trip.fare, 'Fare'], [trip.sacco, 'Sacco']].map(([v, l]) => `
          <div style="flex:1;padding:12px;background:#f8f8f8;text-align:center">
            <p style="font-size:14px;font-weight:600">${v}</p>
            <p style="font-size:10px;color:#aaa">${l}</p>
          </div>
        `).join('')}
      </div>
      <button id="btn-arrived" style="width:100%;padding:14px;background:#ff3b30;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">End trip / I've arrived</button>
    </div>
  `;

  document.getElementById('btn-arrived').addEventListener('click', () => {
    stopGpsPoll();
    showScreen('screen-trip-ended');
  });

  _initTrackingMap('live-map', trip.current_lat, trip.current_lng);
  startGpsPoll(trip.id);
};

ON_EXIT['screen-live-trip'] = () => { stopGpsPoll(); };

// ─── Screen: Trip Ended (S-11) ────────────────────────────────────────────────

ON_ENTER['screen-trip-ended'] = () => {
  const trip = RiderState.selectedTrip;
  const el = document.getElementById('screen-trip-ended');
  el.innerHTML = `
    <div style="padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center">
      <div style="width:72px;height:72px;border-radius:50%;background:#e6f6ee;display:flex;align-items:center;justify-content:center;font-size:32px">🏁</div>
      <p style="font-size:20px;font-weight:700">You've arrived!</p>
      <p style="font-size:14px;color:#888">${RiderState._toStop?.name || 'Destination'}</p>
      <div style="width:100%;background:#f8f8f8;border-radius:12px;padding:12px;text-align:left">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:#888">Route</span>
          <span style="font-size:13px;font-weight:600">${trip?.route_name || ''}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:#888">Matatu</span>
          <span style="font-size:13px;font-weight:600">${trip?.plate || ''}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:12px;color:#888">Fare paid</span>
          <span style="font-size:13px;font-weight:600;color:#1a5cff">KSh ${trip?.fare || ''}</span>
        </div>
      </div>
      <button id="btn-back-home" style="width:100%;padding:14px;background:#1a5cff;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Back to home</button>
    </div>
  `;

  stopAllPolls();
  RiderState.activePickup = null;
  RiderState.selectedTrip = null;
  RiderState.selectedTripId = null;
  RiderState.lastAlertLevel = null;

  document.getElementById('btn-back-home').addEventListener('click', () => showScreen('screen-home'));
};
// ─── Placeholder screens ──────────────────────────────────────────────────────

['screen-booking-destination',
 'screen-booking-from','screen-booking-datetime','screen-booking-seats'].forEach(id => {
  ON_ENTER[id] = () => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `
      <div class="screen-header">
        <button class="back-btn" onclick="showScreen('screen-home')">←</button>
        <span class="screen-title">${id.replace('screen-','').replace(/-/g,' ')}</span>
        <span></span>
      </div>
      <div class="placeholder">Coming soon</div>
    `;
  };
});

ON_ENTER['screen-booking-confirm'] = () => {
  const trip = RiderState.selectedTrip;
  const fromStop = RiderState._fromStop;
  if (!trip || !fromStop) { showScreen('screen-search'); return; }

  const eta = trip.stop_etas?.[fromStop.id];
  const etaStr = eta ? new Date(eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

  const el = document.getElementById('screen-booking-confirm');
  el.innerHTML = `
    <div class="screen-header">
      <button class="back-btn" id="booking-back">←</button>
      <span class="screen-title">Confirm booking</span>
      <span></span>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
      <div style="border:1.5px solid #c0d0ff;border-radius:14px;padding:16px;background:#f7f9ff">
        <p style="font-size:11px;color:#888;margin-bottom:4px">Booking summary</p>
        <p style="font-size:15px;font-weight:700;color:#111;margin-bottom:12px">${trip.route_name}</p>
        <div style="height:1px;background:#e0e8ff;margin-bottom:12px"></div>
        ${[
          ['Matatu', trip.plate],
          ['Sacco', trip.sacco],
          ['Pickup stop', fromStop.name],
          ['ETA to your stop', etaStr],
          ['Fare', 'KSh ' + trip.fare],
        ].map(([k, v]) => `
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:12px;color:#888">${k}</span>
            <span style="font-size:13px;font-weight:600;color:#111">${v}</span>
          </div>
        `).join('')}
      </div>
      <div style="padding:12px 16px;background:#e8f0ff;border-radius:10px;border:1px solid #a8c0ff">
        <p style="font-size:13px;color:#1a5cff">You'll be notified when the matatu starts and when it's approaching your stop.</p>
      </div>
      <p id="booking-error" style="font-size:12px;color:#d00;min-height:16px"></p>
      <button id="btn-confirm-booking" style="width:100%;padding:14px;background:#1a5cff;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Confirm Booking ✓</button>
      <button id="btn-edit-booking" style="width:100%;padding:14px;background:#f2f2f2;color:#333;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Edit</button>
    </div>
  `;

  document.getElementById('booking-back').addEventListener('click', () => showScreen('screen-search'));
  document.getElementById('btn-edit-booking').addEventListener('click', () => showScreen('screen-search'));
  document.getElementById('btn-confirm-booking').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirm-booking');
    btn.disabled = true; btn.textContent = 'Confirming...';
    const res = await apiPost('/api/pickups', {
      trip_id: trip.id, pickup_type: 'reservation',
      stop_id: fromStop.id, seats_requested: 1,
    });
    const data = await res.json();
    if (res.status === 201) {
      RiderState.activePickup = data.pickup;
      showScreen('screen-booking-success');
    } else {
      document.getElementById('booking-error').textContent = data.error || 'Could not confirm booking';
      btn.disabled = false; btn.textContent = 'Confirm Booking ✓';
    }
  });
};

ON_ENTER['screen-booking-success'] = () => {
  const trip = RiderState.selectedTrip;
  const pickup = RiderState.activePickup;
  const el = document.getElementById('screen-booking-success');
  el.innerHTML = `
    <div style="padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center">
      <div style="width:72px;height:72px;border-radius:50%;background:#e6f6ee;display:flex;align-items:center;justify-content:center;font-size:32px">✓</div>
      <p style="font-size:20px;font-weight:700">Booking confirmed!</p>
      <p style="font-size:14px;color:#888">Head to My Trips to monitor your ride.</p>
      <div style="width:100%;border:1.5px solid #c0d0ff;border-radius:14px;padding:16px;background:#f7f9ff;text-align:left">
        <p style="font-size:22px;font-weight:800;color:#1a5cff;text-align:center;margin-bottom:12px">#BKG-${pickup?.id || ''}</p>
        ${[
          ['Matatu', trip?.plate || ''],
          ['Pickup stop', pickup?.stop_name || ''],
          ['Fare', 'KSh ' + (trip?.fare || '')],
        ].map(([k, v]) => `
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:12px;color:#888">${k}</span>
            <span style="font-size:13px;font-weight:600">${v}</span>
          </div>
        `).join('')}
      </div>
      <button id="btn-booking-home" style="width:100%;padding:14px;background:#1a5cff;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Back to home</button>
      <button id="btn-view-trips" style="width:100%;padding:14px;background:#f2f2f2;color:#333;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">View my trips</button>
    </div>
  `;
  document.getElementById('btn-booking-home').addEventListener('click', () => showScreen('screen-home'));
  document.getElementById('btn-view-trips').addEventListener('click', () => showScreen('screen-my-trips'));
};

ON_ENTER['screen-my-trips'] = async () => {
  const el = document.getElementById('screen-my-trips');
  el.innerHTML = `
    <div class="screen-header"><span></span><span class="screen-title">My Trips</span><span></span></div>
    <div id="trips-content" style="padding:16px">
      <p style="font-size:13px;color:#888">Loading...</p>
    </div>
    ${buildBottomNav('trips')}
  `;
  wireBottomNav();

  let pickups = [];
  try {
    const res = await apiGet('/api/pickups/history');
    if (res.ok) pickups = (await res.json()).pickups || [];
  } catch (e) { /* non-fatal */ }

  const content = document.getElementById('trips-content');
  if (!content) return;

  if (pickups.length === 0) {
    content.innerHTML = '<p style="font-size:13px;color:#888;text-align:center;padding:32px 0">No trips yet</p>';
    return;
  }

  const active = pickups.filter(p => p.status === 'pending' || p.status === 'accepted');
  const upcoming = pickups.filter(p => p.status === 'pending' && p.trip?.status === 'scheduled');
  const past = pickups.filter(p => ['completed','cancelled','rejected','no_show'].includes(p.status));

  const statusColour = { completed: '#0a7a3e', cancelled: '#666', rejected: '#d00', no_show: '#d06000' };
  const statusBg = { completed: '#e6f6ee', cancelled: '#f2f2f2', rejected: '#ffe8e8', no_show: '#fff3e0' };
  const statusLabel = { completed: 'Completed', cancelled: 'Cancelled', rejected: 'Rejected', no_show: 'No-show' };

  function renderCard(p, isActive) {
    const col = statusColour[p.status] || '#888';
    const bg = statusBg[p.status] || '#f2f2f2';
    const label = statusLabel[p.status] || p.status;
    return `
      <div style="border:1.5px solid ${isActive ? '#c0d0ff' : '#f0f0f0'};border-radius:14px;padding:14px;background:${isActive ? '#f7f9ff' : '#fff'};margin-bottom:10px;${isActive ? 'cursor:pointer' : ''}" ${isActive ? `data-pickup-id="${p.pickup_id}"` : ''}>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div>
            <p style="font-size:14px;font-weight:700">${p.trip?.route_name || ''}</p>
            <p style="font-size:12px;color:#888">${p.trip?.plate || ''} · ${p.stop_name}</p>
          </div>
          ${isActive
            ? '<span style="padding:3px 8px;border-radius:20px;background:#e8f0ff;color:#1a5cff;font-size:11px;font-weight:700">Active</span>'
            : `<span style="padding:3px 8px;border-radius:20px;background:${bg};color:${col};font-size:11px;font-weight:700">${label}</span>`
          }
        </div>
        <p style="font-size:12px;color:#888">KSh ${p.trip?.fare || ''} · ${p.trip?.started_at ? new Date(p.trip.started_at).toLocaleDateString() : ''}</p>
      </div>
    `;
  }

  let html = '';
  if (active.length) {
    html += `<p style="font-size:12px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Active</p>`;
    html += active.map(p => renderCard(p, true)).join('');
  }
  if (upcoming.length) {
    html += `<p style="font-size:12px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 8px">Upcoming</p>`;
    html += upcoming.map(p => renderCard(p, false)).join('');
  }
  if (past.length) {
    html += `<p style="font-size:12px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 8px">Past</p>`;
    html += past.map(p => renderCard(p, false)).join('');
  }

  content.innerHTML = html;

  // Tapping an active card re-enters the monitoring flow
  content.querySelectorAll('[data-pickup-id]').forEach(card => {
    card.addEventListener('click', async () => {
      const pickupId = parseInt(card.dataset.pickupId);
      const pickup = active.find(p => p.pickup_id === pickupId);
      if (!pickup) return;

      // Fetch full trip details
      const tripRes = await apiGet(`/api/trips/${pickup.trip.id}`);
      if (!tripRes.ok) { showToast('Could not load trip details', 'error'); return; }
      const tripData = (await tripRes.json()).trip;

      RiderState.selectedTripId = tripData.id;
      RiderState.selectedTrip = tripData;
      RiderState.activePickup = { ...pickup, id: pickup.pickup_id, stop_name: pickup.stop_name };
      RiderState.journeyMode = pickup.pickup_type === 'reservation' ? 'pickup' : pickup.pickup_type;
      RiderState.lastAlertLevel = null;

      // Restore _fromStop from active stops
      const fromStop = tripData.active_stops?.find(s => s.id === pickup.stop_name) ||
                       tripData.active_stops?.[0];
      if (fromStop) RiderState._fromStop = fromStop;

      showScreen('screen-pickup-waiting');
    });
  });
};

ON_ENTER['screen-profile'] = () => {
  const user = RiderState.user;
  const el = document.getElementById('screen-profile');
  el.innerHTML = `
    <div class="screen-header"><span></span><span class="screen-title">Profile</span><span></span></div>
    <div style="padding:24px;text-align:center">
      <div class="avatar" style="width:72px;height:72px;font-size:24px;margin:0 auto 12px">${initials(user?.name||'')}</div>
      <p style="font-size:18px;font-weight:700">${user?.name||''}</p>
      <p style="font-size:13px;color:#888;margin-top:4px">${user?.phone||''}</p>
      <button id="sign-out-btn" style="margin-top:32px;width:100%;padding:14px;background:#f2f2f2;color:#333;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer">Sign out</button>
    </div>
    ${buildBottomNav('profile')}
  `;
  document.getElementById('sign-out-btn').addEventListener('click', signOut);
  wireBottomNav();
};

// ─── Bottom nav ───────────────────────────────────────────────────────────────

// ─── SVG icons ────────────────────────────────────────────────────────────────

const NAV_ICONS = {
  home: (active, color) => `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <path d="M3 10.5L11 3L19 10.5V19H14V14H8V19H3V10.5Z"
      fill="${active ? color : 'none'}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
    <rect x="9" y="14" width="4" height="5" rx="0.5" fill="${active ? 'white' : 'none'}" stroke="${active ? color : 'none'}" stroke-width="0"/>
  </svg>`,
  trips: (active, color) => `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <rect x="3" y="5" width="16" height="12" rx="2"
      fill="${active ? color : 'none'}" stroke="${color}" stroke-width="1.6"/>
    <circle cx="6.5" cy="11" r="1.5" fill="${active ? 'white' : color}"/>
    <line x1="9.5" y1="9" x2="16" y2="9" stroke="${active ? 'white' : color}" stroke-width="1.4" stroke-linecap="round"/>
    <line x1="9.5" y1="13" x2="14" y2="13" stroke="${active ? 'white' : color}" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`,
  profile: (active, color) => `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="8" r="3.5"
      fill="${active ? color : 'none'}" stroke="${color}" stroke-width="1.6"/>
    <path d="M4 19c0-3.866 3.134-7 7-7h0c3.866 0 7 3.134 7 7"
      stroke="${color}" stroke-width="1.6" stroke-linecap="round"
      fill="${active ? color : 'none'}"/>
  </svg>`,
  history: (active, color) => `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="8"
      fill="${active ? color : 'none'}" stroke="${color}" stroke-width="1.6"/>
    <path d="M11 7V11L14 13" stroke="${active ? 'white' : color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

// ─── Bottom nav ───────────────────────────────────────────────────────────────

function buildBottomNav(activeTab) {
  const color = '#1a5cff';
  const inactive = '#bbb';
  const tabs = [
    { id: 'home',    label: 'Home',    screen: 'screen-home',     icon: 'home' },
    { id: 'trips',   label: 'Trips',   screen: 'screen-my-trips', icon: 'trips' },
    { id: 'profile', label: 'Profile', screen: 'screen-profile',  icon: 'profile' },
  ];
  return `
    <nav class="bottom-nav">
      ${tabs.map(t => {
        const isActive = t.id === activeTab;
        return `
          <button class="nav-tab ${isActive ? 'active' : ''}" data-screen="${t.screen}">
            ${NAV_ICONS[t.icon](isActive, isActive ? color : inactive)}
            <span class="nav-tab-label">${t.label}</span>
          </button>
        `;
      }).join('')}
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
  await apiPost('/api/auth/logout', {});
  stopAllPolls();
  RiderState.user = null;
  RiderState.activePickup = null;
  RiderState.selectedTripId = null;
  RiderState.selectedTrip = null;
  showScreen('screen-login');
}

function stopAllPolls() {
  stopGpsPoll();
  if (RiderState.pickupPollInterval) { clearInterval(RiderState.pickupPollInterval); RiderState.pickupPollInterval = null; }
}

// ─── Route config ─────────────────────────────────────────────────────────────

async function fetchRoutes() {
  try {
    const res = await apiGet('/api/config/routes');
    if (!res.ok) return;
    const data = await res.json();
    ROUTES = data.routes || [];
  } catch (err) {
    console.error('[fetchRoutes]', err);
  }
}

// ─── Page load ────────────────────────────────────────────────────────────────

async function init() {
  try {
    buildLoginScreen();
    const [sessionRes] = await Promise.all([apiGet('/api/auth/session'), fetchRoutes()]);

    if (!sessionRes.ok) { showScreen('screen-login'); return; }

    const data = await sessionRes.json();
    RiderState.user = data.user;

    const pickupRes = await apiGet('/api/pickups/active');
    if (pickupRes.ok) {
      const pd = await pickupRes.json();
      if (pd.pickup) {
        RiderState.activePickup = pd.pickup;
        RiderState.selectedTripId = pd.pickup.trip_id;

        // Restore full trip and navigate to waiting screen
        const tripRes = await apiGet(`/api/trips/${pd.pickup.trip_id}`);
        if (tripRes.ok) {
          RiderState.selectedTrip = (await tripRes.json()).trip;
          // Restore from stop
          const stop = RiderState.selectedTrip.active_stops?.find(s => s.id === pd.pickup.stop_id);
          if (stop) RiderState._fromStop = { ...stop, route_id: RiderState.selectedTrip.route_id };
          RiderState.journeyMode = pd.pickup.pickup_type === 'reservation' ? 'pickup' : pd.pickup.pickup_type;
          showScreen('screen-pickup-waiting');
          return;
        }
      }
    }
    showScreen('screen-home');
  } catch (err) {
    console.error('[init]', err);
    showToast('Failed to load — check console', 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);

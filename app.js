(() => {
'use strict';

const NS = 'http://www.w3.org/2000/svg', CX = 488, CY = 405, R = 355;
const $ = id => document.getElementById(id);
const app = $('app'), spdEl = $('spd'), needle = $('needle'), avgEl = $('avg'), wEl = $('w'),
      cn = $('cn'), limG = $('limit'), limT = $('limtxt'), turnG = $('turn'), turnPos = $('turnpos'),
      msg = $('msg');

/* ---------- Cadran : 10 km/h = 9h, 25 = midi, 40 = 3h (60° par 10 km/h) ---------- */
const pt = (r, s) => {
  const t = (240 - 6 * s) * Math.PI / 180;
  return [CX + r * Math.cos(t), CY - r * Math.sin(t)];
};
const el = (n, a, p) => {
  const e = document.createElementNS(NS, n);
  for (const k in a) e.setAttribute(k, a[k]);
  p.appendChild(e);
  return e;
};
for (let s = 5; s <= 50; s += 2.5) {
  const long = s % 5 === 0, red = s >= 40;
  const [x1, y1] = pt(R * (long ? .88 : .93), s), [x2, y2] = pt(R * .985, s);
  el('line', {
    x1, y1, x2, y2, 'stroke-width': long ? 5 : 4,
    stroke: red ? (long ? '#ff1a1a' : '#a01414') : (long ? '#fff' : '#9a9a9a')
  }, $('ticks'));
}
[1, 2, 3, 4].forEach(n => {
  const [x, y] = pt(R * .78, n * 10);
  el('text', {
    x, y, class: 'lab glow' + (n === 4 ? ' red' : ''),
    'text-anchor': 'middle', 'dominant-baseline': 'central'
  }, $('labels')).textContent = n;
});

/* ---------- État ---------- */
let target = 0, shown = 0, mode = 'eco', distM = 0, moveS = 0, last = null, sm = 0;

function setMode(v) {
  let m = mode;
  if (m === 'eco' && v > 10.4) m = 'cruise';
  else if (m === 'cruise') { if (v < 9.6) m = 'eco'; else if (v > 25.4) m = 'sprint'; }
  else if (m === 'sprint' && v < 24.6) m = 'cruise';
  if (m !== mode) { mode = m; app.dataset.mode = m; }
}
function setSpeed(v) {
  target = Math.max(0, v);
  spdEl.textContent = Math.round(target);
  setMode(target);
  wEl.textContent = '≈' + Math.round(target * 1.15 / 5) * 5; // estimation générale et imprécise
}
const setAvg = v => { avgEl.textContent = v.toFixed(1); };
const setHeading = h => cn.setAttribute('transform', `rotate(${-h})`);
function setLimit(v) {
  limG.style.display = v ? '' : 'none';
  if (v) { limT.textContent = v; limT.style.fontSize = v > 99 ? '22px' : '28px'; }
}
/* kind : 'left' | 'right' | 'straight' | null */
function setTurn(kind) {
  turnG.style.display = kind ? '' : 'none';
  if (!kind) return;
  turnPos.querySelector('.t-turn').style.display = kind === 'straight' ? 'none' : '';
  turnPos.querySelector('.t-straight').style.display = kind === 'straight' ? '' : 'none';
  turnPos.setAttribute('transform', kind === 'left' ? 'translate(947,25) scale(-1,1)' : 'translate(867,25)');
}
window.RIDE = { setSpeed, setAvg, setHeading, setLimit, setTurn };

/* ---------- Aiguille animée ---------- */
(function frame() {
  shown += (target - shown) * .14;
  if (Math.abs(target - shown) < .02) shown = target;
  needle.setAttribute('transform', `rotate(${6 * Math.min(50, shown) - 60} ${CX} ${CY})`);
  requestAnimationFrame(frame);
})();

/* ---------- Limitation de vitesse (OpenStreetMap / Overpass) ---------- */
const dist = (a, b, c, d) => {
  const r = Math.PI / 180;
  return 6371000 * Math.hypot((c - a) * r, (d - b) * r * Math.cos((a + c) / 2 * r));
};
const parseMax = s => {
  if (!s) return null;
  const m = /^(\d+)\s*(mph)?/.exec(s);
  if (m) return Math.round(+m[1] * (m[2] ? 1.609 : 1));
  return { 'FR:urban': 50, 'FR:rural': 80, 'FR:motorway': 130 }[s] || null;
};
let lim = { t: 0, lat: 0, lon: 0, busy: false };
async function fetchLimit(lat, lon) {
  const now = Date.now();
  if (lim.busy || now - lim.t < 12000 || dist(lim.lat, lim.lon, lat, lon) < 40) return;
  lim = { t: now, lat, lon, busy: true };
  try {
    const q = `[out:json][timeout:8];way(around:20,${lat},${lon})[highway][maxspeed];out tags;`;
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
    const j = await r.json();
    const v = (j.elements || []).map(e => parseMax(e.tags.maxspeed)).find(Boolean);
    setLimit(v || null);
  } catch (e) { /* hors-ligne : on garde la dernière valeur */ }
  lim.busy = false;
}

/* ---------- GPS ---------- */
function onPos(p) {
  msg.textContent = '';
  const c = p.coords, t = p.timestamp;
  let v = c.speed != null && !isNaN(c.speed) ? c.speed * 3.6 : null, dd = 0, dt = 0;
  if (last) { dt = (t - last.t) / 1000; dd = dist(last.lat, last.lon, c.latitude, c.longitude); }
  if (v === null) v = dt > 0 ? dd / dt * 3.6 : 0;
  v = v < 1.5 ? 0 : v;
  sm = v === 0 ? 0 : (sm ? sm * .4 + v * .6 : v);
  if (last && v > 0 && dt > 0 && dt < 10) { distM += dd; moveS += dt; }
  setSpeed(sm);
  setAvg(moveS ? distM / moveS * 3.6 : 0);
  if (c.heading != null && !isNaN(c.heading) && v > 3) setHeading(c.heading);
  last = { lat: c.latitude, lon: c.longitude, t };
  fetchLimit(c.latitude, c.longitude);
}
function onErr() { msg.textContent = 'GPS indisponible : autorise la localisation'; }

/* ---------- Démo : ?demo (animée) ou ?demo=9 / ?demo=18 / ?demo=26 (vitesse fixe) ---------- */
const demo = new URLSearchParams(location.search).get('demo');
if (demo !== null) {
  setLimit(30); setTurn('right');
  const fixed = demo !== '' && !isNaN(+demo) ? +demo : null;
  const tick = () => {
    const v = fixed ?? 15 - 15 * Math.cos(Date.now() / 5000) + 0;
    setSpeed(v); setAvg(v * .93); setHeading(Date.now() / 200 % 360);
  };
  tick();
  if (fixed === null) setInterval(tick, 100);
} else if ('geolocation' in navigator) {
  msg.textContent = 'En attente du GPS…';
  navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
} else onErr();

setSpeed(demo !== null && demo !== '' && !isNaN(+demo) ? +demo : 0);

/* ---------- Écran toujours allumé, plein écran, PWA ---------- */
let wl;
const keepAwake = async () => { try { wl = await navigator.wakeLock.request('screen'); } catch (e) {} };
keepAwake();
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
document.addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();

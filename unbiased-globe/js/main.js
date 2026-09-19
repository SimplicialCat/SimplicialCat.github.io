'use strict';

const DEG = Math.PI / 180;
const R_EARTH = 6371;

const svg = document.getElementById('globe-svg');
const defs = document.getElementById('defs');
const oceanEl = document.getElementById('ocean');
const landEl = document.getElementById('land');
const nightEl = document.getElementById('night');
const horizonEl = document.getElementById('horizon');
const arcsFrontG = document.getElementById('arcs-front');
const citiesG = document.getElementById('cities');
const selectionG = document.getElementById('selection');

const btnGeodesic = document.getElementById('btn-geodesic');
const btnClear = document.getElementById('btn-clear');
const btnReset = document.getElementById('btn-reset');
const nightToggle = document.getElementById('night-toggle');
const sunDateInput = document.getElementById('sun-date');
const sunTimeInput = document.getElementById('sun-time');
const btnNow = document.getElementById('btn-now');
const sunInfo = document.getElementById('sun-info');
const btnSunToggle = document.getElementById('btn-sun-toggle');
const sunControls = document.getElementById('sun-controls');

/* ---------------- quaternion ---------------- */

function qIdentity() {
  return { w: 1, x: 0, y: 0, z: 0 };
}

function qMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  };
}

function qFromAxisAngle(ax, ay, az, angle) {
  const s = Math.sin(angle / 2);
  return { w: Math.cos(angle / 2), x: ax * s, y: ay * s, z: az * s };
}

function qNormalize(q) {
  const m = Math.hypot(q.w, q.x, q.y, q.z) || 1;
  return { w: q.w / m, x: q.x / m, y: q.y / m, z: q.z / m };
}

function qConjugate(q) {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

/* rotate 3-vector v by quaternion q, writing result into out */
function qRotVec(q, vx, vy, vz, out) {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

function qInverseRotVec(q, vx, vy, vz, out) {
  return qRotVec(qConjugate(q), vx, vy, vz, out);
}

/* ---------------- spherical helpers ---------------- */

function llToVec(lon, lat, out) {
  const la = lat * DEG, lo = lon * DEG;
  const c = Math.cos(la);
  out[0] = c * Math.cos(lo);
  out[1] = c * Math.sin(lo);
  out[2] = Math.sin(la);
  return out;
}

function vLen(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function vNormalize(v) {
  const m = vLen(v) || 1;
  v[0] /= m; v[1] /= m; v[2] /= m;
  return v;
}

function vDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vAngle(a, b) {
  return Math.acos(Math.max(-1, Math.min(1, vDot(a, b))));
}

function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

/* Winding number test for a spherical polygon. */
function sphInsideRing(ring, point) {
  let angleSum = 0;
  for (let index = 0; index < ring.length; index++) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const startX = start[0] - point[0];
    const startY = start[1] - point[1];
    const startZ = start[2] - point[2];
    const endX = end[0] - point[0];
    const endY = end[1] - point[1];
    const endZ = end[2] - point[2];
    const numerator =
      (startY * endZ - startZ * endY) * point[0] +
      (startZ * endX - startX * endZ) * point[1] +
      (startX * endY - startY * endX) * point[2];
    const denominator = startX * endX + startY * endY + startZ * endZ;
    angleSum += Math.atan2(numerator, denominator);
  }
  return Math.abs(angleSum / (2 * Math.PI)) > 0.5;
}

/* slerp between unit vectors a and b */
function slerp(a, b, t, out) {
  const omega = vAngle(a, b);
  const so = Math.sin(omega);
  if (so < 1e-9) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
    return out;
  }
  const ka = Math.sin((1 - t) * omega) / so;
  const kb = Math.sin(t * omega) / so;
  out[0] = ka * a[0] + kb * b[0];
  out[1] = ka * a[1] + kb * b[1];
  out[2] = ka * a[2] + kb * b[2];
  return out;
}

/* minimal rotation quaternion taking unit vector a onto unit vector b */
function rotationBetween(a, b) {
  const dot = vDot(a, b);
  if (dot > 0.999999) return qIdentity();
  if (dot < -0.999999) {
    // 180° about any perpendicular axis
    let ax = 1, ay = 0, az = 0;
    if (Math.abs(a[0]) > 0.9) { ax = 0; ay = 1; }
    return qFromAxisAngle(ax, ay, az, Math.PI);
  }
  // axis = a × b, angle = acos(dot)
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const m = Math.hypot(cx, cy, cz) || 1;
  return qFromAxisAngle(cx / m, cy / m, cz / m, Math.acos(dot));
}

/* ---------------- state ---------------- */

const state = {
  q: qIdentity(),
  zoom: 1,
  panX: 0,
  panY: 0,
  mode: 'rotate',
  tempPoint: null,
  arcs: [],
  night: true,
  sunDate: null,
  sun: null
};

let W = 0, H = 0, cx = 0, cy = 0, R = 0;
let dirty = true;
const inertia = { ax: 0, ay: 0, az: 0, speed: 0 };

/* initial view centered near 105E 30N (East Asia) */
const initV = [0, 0, 0];
llToVec(105, 30, initV);
state.q = rotationBetween(initV, [0, 1, 0]);

/* ---------------- land ring preprocessing ---------------- */

/* Great-circle densification of coastline rings on the sphere */
function densifyRing(ring) {
  const out = [];
  const a = [0, 0, 0], b = [0, 0, 0], p = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
    vNormalize(llToVec(p1[0], p1[1], a));
    vNormalize(llToVec(p2[0], p2[1], b));
    const angle = vAngle(a, b);
    const steps = Math.max(1, Math.ceil(angle / DEG / 0.35));
    for (let s = 0; s < steps; s++) {
      slerp(a, b, s / steps, p);
      out.push([p[0], p[1], p[2]]);
    }
  }
  return out;
}

const landRings = LAND.map(densifyRing);

/* ---------------- sun position & night hemisphere ---------------- */

function solarSubpoint(date) {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - yearStart) / 86400000) + 1;
  const utcHours = date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3600000;
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + (utcHours - 12) / 24);
  const eqTime = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  );
  const declination = 180 / Math.PI * (
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.001480 * Math.sin(3 * gamma)
  );
  const longitude = ((15 * (12 - utcHours - eqTime / 60) + 540) % 360) - 180;
  return { lat: declination, lon: longitude };
}

function formatLatitude(value) {
  return Math.abs(value).toFixed(1) + '°' + (value >= 0 ? 'N' : 'S');
}

function formatLongitude(value) {
  return Math.abs(value).toFixed(1) + '°' + (value >= 0 ? 'E' : 'W');
}

function syncSunInputs(date) {
  const pad = value => String(value).padStart(2, '0');
  sunDateInput.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  sunTimeInput.value = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function applySunInputs() {
  const dateParts = sunDateInput.value.split('-').map(Number);
  const timeParts = sunTimeInput.value.split(':').map(Number);
  if (dateParts.length !== 3 || timeParts.length < 2 || dateParts.some(isNaN) || timeParts.some(isNaN)) return;
  setSunDate(new Date(
    dateParts[0],
    dateParts[1] - 1,
    dateParts[2],
    timeParts[0],
    timeParts[1],
    timeParts[2] || 0,
    0
  ));
}

function setSunDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return;
  state.sunDate = date;
  const point = solarSubpoint(date);
  const sun = [0, 0, 0];
  llToVec(point.lon, point.lat, sun);
  state.sun = sun;
  sunInfo.textContent = '直射点：' + formatLatitude(point.lat) + ', ' + formatLongitude(point.lon);
  dirty = true;
}

/* ---------------- SVG defs / gradients ---------------- */

function buildDefs() {
  defs.innerHTML =
    '<radialGradient id="oceanGrad" cx="38%" cy="32%" r="75%">' +
      '<stop offset="0%" stop-color="#2f7ec4"/>' +
      '<stop offset="55%" stop-color="#1a5493"/>' +
      '<stop offset="100%" stop-color="#0b2f57"/>' +
    '</radialGradient>' +
    '<radialGradient id="landGrad" cx="38%" cy="32%" r="80%">' +
      '<stop offset="0%" stop-color="#a3c98a"/>' +
      '<stop offset="60%" stop-color="#79a869"/>' +
      '<stop offset="100%" stop-color="#4f7d4e"/>' +
    '</radialGradient>' +
    '</radialGradient>';
}

/* ---------------- cities ---------------- */

const cityEls = CITIES.map(c => {
  const v = [0, 0, 0];
  llToVec(c[2], c[1], v);
  vNormalize(v);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  circle.setAttribute('r', c[3] === 1 ? 2.4 : 2);
  circle.setAttribute('fill', '#fff');
  circle.setAttribute('stroke', 'rgba(0,0,0,0.45)');
  circle.setAttribute('stroke-width', '0.6');
  text.textContent = c[0];
  text.setAttribute('x', 6);
  text.setAttribute('y', 3.5);
  text.setAttribute('font-size', c[3] === 1 ? 11 : 10);
  text.setAttribute('fill', '#f0f4fa');
  text.setAttribute('paint-order', 'stroke');
  text.setAttribute('stroke', 'rgba(0,0,0,0.65)');
  text.setAttribute('stroke-width', '2.5');
  text.setAttribute('stroke-linejoin', 'round');
  g.appendChild(circle);
  g.appendChild(text);
  g.style.display = 'none';
  citiesG.appendChild(g);
  return { v, el: g, tier: c[3], name: c[0] };
});

/* ---------------- arcs (geodesics) ---------------- */

function fmtDistance(km) {
  return Math.round(km).toLocaleString('en-US') + ' km';
}

function addArc(a, b) {
  const km = vAngle(a, b) * R_EARTH;
  const front = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  front.setAttribute('fill', 'none');
  front.setAttribute('stroke', '#ffb347');
  front.setAttribute('stroke-width', '2.5');
  front.setAttribute('stroke-linecap', 'round');
  front.setAttribute('stroke-linejoin', 'round');
  const m1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  m1.setAttribute('r', 3.5);
  m1.setAttribute('fill', 'none');
  m1.setAttribute('stroke', '#ffb347');
  m1.setAttribute('stroke-width', '1.6');
  const m2 = m1.cloneNode();
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('font-size', 11);
  label.setAttribute('fill', '#ffd166');
  label.setAttribute('paint-order', 'stroke');
  label.setAttribute('stroke', 'rgba(0,0,0,0.7)');
  label.setAttribute('stroke-width', '3');
  label.setAttribute('stroke-linejoin', 'round');
  label.setAttribute('text-anchor', 'middle');
  label.textContent = fmtDistance(km);
  arcsFrontG.appendChild(front);
  arcsFrontG.appendChild(m1);
  arcsFrontG.appendChild(m2);
  arcsFrontG.appendChild(label);
  state.arcs.push({ a, b, front, m1, m2, label });
  return km;
}

function clearArcs() {
  arcsFrontG.innerHTML = '';
  state.arcs = [];
}

/* ---------------- projection & clipping ---------------- */

/* project rotated point -> screen [sx, sy, depth] */
function projectRot(v) {
  return [cx - v[0] * R, cy - v[2] * R, v[1]];
}

function angleContainsExclusive(start, delta, angle) {
  const eps = 1e-6;
  const target = ((angle - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const span = ((delta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return target > eps && target < span - eps;
}

function limbArcPath(a, b, boundaryAngles, ring) {
  const angle = v => Math.atan2(v[2], v[0]);
  const angleA = angle(a), angleB = angle(b);
  const norm2pi = value => ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const candidates = [
    { delta: norm2pi(angleB - angleA) },
    { delta: norm2pi(angleB - angleA) - 2 * Math.PI }
  ];
  const available = candidates.filter(c =>
    !boundaryAngles.some(angle =>
      angle !== angleA && angle !== angleB && angleContainsExclusive(angleA, c.delta, angle)
    )
  );
  let selected = null;
  for (const candidate of available) {
    const inset = 0.00005;
    const radial = Math.sqrt(Math.max(0, 1 - inset * inset));
    const mid = angleA + candidate.delta / 2;
    const testPoint = [Math.cos(mid) * radial, inset, Math.sin(mid) * radial];
    if (sphInsideRing(ring, testPoint)) {
      selected = candidate;
      break;
    }
  }
  if (!selected) {
    selected = (available.length ? available : candidates)
      .slice()
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
  }
  const steps = Math.max(2, Math.ceil(Math.abs(selected.delta) / DEG / 2));
  let d = '';
  for (let i = 1; i <= steps; i++) {
    const limbAngle = angleA + selected.delta * i / steps;
    const v = [Math.cos(limbAngle), 0, Math.sin(limbAngle)];
    d += 'L' + (cx - v[0] * R).toFixed(1) + ',' + (cy - v[2] * R).toFixed(1);
  }
  return d;
}

function renderRingSphere(ring, q) {
  const rotated = ring.map(p => {
    const v = [0, 0, 0];
    qRotVec(q, p[0], p[1], p[2], v);
    return v;
  });
  if (!rotated.some(p => p[1] >= 0)) return '';
  if (!rotated.some(p => p[1] < 0)) {
    return 'M' + rotated.map(p => (cx - p[0] * R).toFixed(1) + ',' + (cy - p[2] * R).toFixed(1)).join('L') + 'Z';
  }

  const outside = rotated.findIndex(p => p[1] < 0);
  const ordered = rotated.slice(outside).concat(rotated.slice(0, outside));
  const loops = [];
  let current = null;
  const point = v => ({ sx: cx - v[0] * R, sy: cy - v[2] * R, depth: v[1], boundary: false, v });
  const boundary = (a, b) => {
    const t = a[1] / (a[1] - b[1]);
    const v = vNormalize([
      a[0] + (b[0] - a[0]) * t,
      0,
      a[2] + (b[2] - a[2]) * t
    ]);
    return { sx: cx - v[0] * R, sy: cy - v[2] * R, depth: 0, boundary: true, v };
  };

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i], b = ordered[(i + 1) % ordered.length];
    const ain = a[1] >= 0, bin = b[1] >= 0;
    if (ain && bin) {
      if (current && current[current.length - 1].v !== a) current.push(point(a));
    } else if (!ain && bin) {
      current = [boundary(a, b), point(b)];
    } else if (ain && !bin) {
      if (current) {
        if (current[current.length - 1].v !== a) current.push(point(a));
        current.push(boundary(a, b));
        loops.push(current);
        current = null;
      }
    }
  }
  if (!loops.length) return '';

  const boundaryAngles = loops.flatMap(loop =>
    loop.filter(p => p.boundary).map(p => Math.atan2(p.v[2], p.v[0]))
  );
  let d = '';
  for (const loop of loops) {
    d += 'M' + loop[0].sx.toFixed(1) + ',' + loop[0].sy.toFixed(1);
    for (let i = 1; i < loop.length; i++) {
      d += 'L' + loop[i].sx.toFixed(1) + ',' + loop[i].sy.toFixed(1);
    }
    d += limbArcPath(loop[loop.length - 1].v, loop[0].v, boundaryAngles, rotated);
    d += 'Z';
  }
  return d;
}

/* ---------------- rendering ---------------- */

function renderLand(q) {
  let d = '';
  for (let ringIndex = 0; ringIndex < landRings.length; ringIndex++) {
    d += renderRingSphere(landRings[ringIndex], q);
  }
  landEl.setAttribute('d', d);
}

function renderNight(q) {
  if (!state.night || !state.sun) {
    nightEl.setAttribute('d', '');
    return;
  }

  const sun = [0, 0, 0];
  qRotVec(q, state.sun[0], state.sun[1], state.sun[2], sun);
  if (sun[1] >= 0.999999) {
    nightEl.setAttribute('d', '');
    return;
  }
  if (sun[1] <= -0.999999) {
    nightEl.setAttribute('d', `M${(cx - R).toFixed(1)},${cy.toFixed(1)}a${R.toFixed(1)},${R.toFixed(1)} 0 1,0 ${(2 * R).toFixed(1)},0a${R.toFixed(1)},${R.toFixed(1)} 0 1,0 ${(-2 * R).toFixed(1)},0Z`);
    return;
  }

  const reference = Math.abs(sun[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const axis1 = vNormalize(vCross(sun, reference));
  const axis2 = vNormalize(vCross(sun, axis1));
  const terminatorPoint = angle => {
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    return [
      axis1[0] * cosine + axis2[0] * sine,
      axis1[1] * cosine + axis2[1] * sine,
      axis1[2] * cosine + axis2[2] * sine
    ];
  };
  const screenPoint = point => (cx - point[0] * R).toFixed(1) + ',' + (cy - point[2] * R).toFixed(1);
  const phase = Math.atan2(axis2[1], axis1[1]);
  const startAngle = phase - Math.PI / 2;
  const endAngle = phase + Math.PI / 2;
  const terminatorSteps = Math.max(2, Math.ceil(Math.PI / DEG));
  const startVector = terminatorPoint(startAngle);
  const endVector = terminatorPoint(endAngle);

  let d = 'M' + screenPoint(startVector);
  for (let index = 1; index <= terminatorSteps; index++) {
    d += 'L' + screenPoint(terminatorPoint(startAngle + (endAngle - startAngle) * index / terminatorSteps));
  }

  const angleA = Math.atan2(endVector[2], endVector[0]);
  const angleB = Math.atan2(startVector[2], startVector[0]);
  const normalize = value => ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccwDelta = normalize(angleB - angleA);
  const candidates = [ccwDelta, ccwDelta - 2 * Math.PI];
  const limbMidDot = delta => {
    const angle = angleA + delta / 2;
    return vDot([Math.cos(angle), 0, Math.sin(angle)], sun);
  };
  const limbDelta = candidates.reduce((best, candidate) =>
    limbMidDot(candidate) < limbMidDot(best) ? candidate : best
  );
  const limbSteps = Math.max(2, Math.ceil(Math.abs(limbDelta) / DEG / 2));
  for (let index = 1; index <= limbSteps; index++) {
    const angle = angleA + limbDelta * index / limbSteps;
    d += 'L' + screenPoint([Math.cos(angle), 0, Math.sin(angle)]);
  }
  nightEl.setAttribute('d', d + 'Z');
}

function renderArcs(q) {
  const v = [0, 0, 0];
  for (const arc of state.arcs) {
    const steps = 200;
    let frontD = '';
    let prev = null;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      slerp(arc.a, arc.b, t, v);
      qRotVec(q, v[0], v[1], v[2], v);
      const pt = projectRot(v);
      if (prev) {
        const pin = prev[2] >= 0, cin = pt[2] >= 0;
        if (pin && cin) {
          frontD += 'L' + pt[0].toFixed(1) + ',' + pt[1].toFixed(1);
        } else {
          // crossing horizon: intersect 3D chord with depth=0 plane
          const p0 = prev, p1 = pt;
          const t2 = p0[2] / (p0[2] - p1[2]);
          const ix = p0[0] + (p1[0] - p0[0]) * t2;
          const iy = p0[1] + (p1[1] - p0[1]) * t2;
          const cross = 'L' + ix.toFixed(1) + ',' + iy.toFixed(1);
          if (p0[2] < 0) {
            frontD += 'M' + cross.slice(1);
          } else {
            frontD += cross;
          }
        }
      } else {
        if (pt[2] >= 0) frontD = 'M' + pt[0].toFixed(1) + ',' + pt[1].toFixed(1);
      }
      prev = pt;
    }
    arc.front.setAttribute('d', frontD);
    // endpoint markers
    slerp(arc.a, arc.b, 0, v);
    qRotVec(q, v[0], v[1], v[2], v);
    const pa = projectRot(v);
    slerp(arc.a, arc.b, 1, v);
    qRotVec(q, v[0], v[1], v[2], v);
    const pb = projectRot(v);
    arc.m1.setAttribute('cx', pa[0]); arc.m1.setAttribute('cy', pa[1]);
    arc.m1.style.display = pa[2] >= -0.05 ? '' : 'none';
    arc.m2.setAttribute('cx', pb[0]); arc.m2.setAttribute('cy', pb[1]);
    arc.m2.style.display = pb[2] >= -0.05 ? '' : 'none';
    // midpoint label
    slerp(arc.a, arc.b, 0.5, v);
    qRotVec(q, v[0], v[1], v[2], v);
    const pm = projectRot(v);
    if (pm[2] > 0.1) {
      arc.label.style.display = '';
      arc.label.setAttribute('x', pm[0]);
      arc.label.setAttribute('y', pm[1] - 8);
    } else {
      arc.label.style.display = 'none';
    }
  }
}

function renderCities(q) {
  const maxTier = state.zoom < 1.6 ? 1 : state.zoom < 3 ? 2 : 3;
  const v = [0, 0, 0];
  for (const city of cityEls) {
    if (city.tier > maxTier) { city.el.style.display = 'none'; continue; }
    qRotVec(q, city.v[0], city.v[1], city.v[2], v);
    const sx = cx - v[0] * R, sy = cy - v[2] * R, depth = v[1];
    if (depth <= 0) { city.el.style.display = 'none'; continue; }
    const showLabel = depth > 0.12;
    city.el.style.display = '';
    city.el.setAttribute('transform', `translate(${sx.toFixed(1)},${sy.toFixed(1)})`);
    city.el.children[1].style.opacity = showLabel ? '' : '0';
  }
}

function renderSelection() {
  selectionG.innerHTML = '';
  if (!state.tempPoint) return;
  const v = [0, 0, 0];
  qRotVec(state.q, state.tempPoint[0], state.tempPoint[1], state.tempPoint[2], v);
  const p = projectRot(v);
  if (p[2] < 0) return;
  const c1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c1.setAttribute('cx', p[0]); c1.setAttribute('cy', p[1]);
  c1.setAttribute('r', 3);
  c1.setAttribute('fill', '#fff');
  c1.setAttribute('stroke', '#ffb347');
  c1.setAttribute('stroke-width', 1.6);
  selectionG.appendChild(c1);
}

function draw() {
  const q = state.q;
  oceanEl.setAttribute('cx', cx); oceanEl.setAttribute('cy', cy); oceanEl.setAttribute('r', R);
  horizonEl.setAttribute('cx', cx); horizonEl.setAttribute('cy', cy); horizonEl.setAttribute('r', R);
  horizonEl.setAttribute('stroke', 'rgba(140,190,255,0.35)');
  horizonEl.setAttribute('stroke-width', '1.2');
  renderLand(q);
  renderNight(q);
  renderArcs(q);
  renderCities(q);
  renderSelection();
}

/* ---------------- interaction ---------------- */

let drag = null;

function rotateBy(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (!len) return;
  const ang = len / R;
  const ax = -dy / len, ay = 0, az = dx / len;
  state.q = qNormalize(qMul(qFromAxisAngle(ax, ay, az, ang), state.q));
  dirty = true;
}

function pickPoint(e) {
  const rect = svg.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const rx = -(sx - cx) / R, ry = -(sy - cy) / R;
  const d2 = rx * rx + ry * ry;
  if (d2 > 1.1) return null;
  // snap to nearest visible city within 14 px
  let best = null, bestD = 14 * 14;
  for (const city of cityEls) {
    const v = [0, 0, 0];
    qRotVec(state.q, city.v[0], city.v[1], city.v[2], v);
    if (v[1] <= 0) continue;
    const px = cx - v[0] * R, py = cy - v[2] * R;
    const dd = (px - sx) * (px - sx) + (py - sy) * (py - sy);
    if (dd < bestD) { bestD = dd; best = city.v; }
  }
  if (best) return best.slice();
  if (d2 > 1) {
    const s = Math.sqrt(d2);
    return null; // outside sphere, ignore
  }
  const r = [rx, Math.sqrt(1 - d2), ry];
  const out = [0, 0, 0];
  qInverseRotVec(state.q, r[0], r[1], r[2], out);
  return vNormalize(out).slice();
}

svg.addEventListener('pointerdown', e => {
  drag = {
    button: e.button,
    lastX: e.clientX, lastY: e.clientY,
    lastDx: 0, lastDy: 0,
    startX: e.clientX, startY: e.clientY,
    moved: false
  };
  svg.setPointerCapture(e.pointerId);
  inertia.speed = 0;
});

svg.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
  drag.lastX = e.clientX, drag.lastY = e.clientY;
  drag.lastDx = dx; drag.lastDy = dy;
  if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
  if (drag.button === 2 || drag.button === 1) {
    state.panX += dx; state.panY += dy; dirty = true;
  } else if (drag.moved) {
    rotateBy(dx, dy);
  }
});

svg.addEventListener('pointerup', e => {
  if (!drag) return;
  const wasClick = !drag.moved && drag.button === 0;
  if (drag.moved && drag.button === 0) {
    const len = Math.hypot(drag.lastDx, drag.lastDy);
    if (len > 2) {
      inertia.ax = -drag.lastDy / len;
      inertia.ay = 0;
      inertia.az = drag.lastDx / len;
      inertia.speed = Math.min(len / R, 0.12);
    }
  }
  drag = null;
  if (wasClick && state.mode === 'geodesic') {
    const p = pickPoint(e);
    if (p) {
      if (!state.tempPoint) {
        state.tempPoint = p;
      } else {
        const km = addArc(state.tempPoint, p);
        state.tempPoint = null;
      }
      dirty = true;
    }
  }
});

svg.addEventListener('contextmenu', e => e.preventDefault());

svg.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = svg.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const oldR = R;
  state.zoom = Math.max(0.5, Math.min(15, state.zoom * Math.exp(-e.deltaY * 0.0012)));
  R = 0.42 * Math.min(W, H) * state.zoom;
  // keep cursor-anchored: pan so that sphere-relative position stays
  const cX = W / 2 + state.panX, cY = H / 2 + state.panY;
  state.panX = mx - (mx - cX) * (R / oldR) - W / 2;
  state.panY = my - (my - cY) * (R / oldR) - H / 2;
  dirty = true;
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') setMode('rotate');
});

/* ---------------- buttons ---------------- */

function setMode(m) {
  state.mode = m;
  document.body.classList.toggle('mode-geodesic', m === 'geodesic');
  btnGeodesic.classList.toggle('active', m === 'geodesic');
  if (m !== 'geodesic') {
    state.tempPoint = null;
  }
  dirty = true;
}

btnGeodesic.addEventListener('click', () => {
  setMode(state.mode === 'geodesic' ? 'rotate' : 'geodesic');
});

btnClear.addEventListener('click', () => {
  clearArcs();
  state.tempPoint = null;
  dirty = true;
});

btnReset.addEventListener('click', () => {
  state.q = rotationBetween(initV, [0, 1, 0]);
  state.zoom = 1;
  state.panX = 0; state.panY = 0;
  inertia.speed = 0;
  dirty = true;
});

nightToggle.addEventListener('change', () => {
  state.night = nightToggle.checked;
  dirty = true;
});

sunDateInput.addEventListener('input', applySunInputs);
sunTimeInput.addEventListener('input', applySunInputs);

btnNow.addEventListener('click', () => {
  const now = new Date();
  syncSunInputs(now);
  setSunDate(now);
});

btnSunToggle.addEventListener('click', () => {
  const expanded = sunControls.hasAttribute('hidden');
  if (expanded) {
    sunControls.removeAttribute('hidden');
  } else {
    sunControls.setAttribute('hidden', '');
  }
  btnSunToggle.setAttribute('aria-expanded', String(expanded));
  btnSunToggle.textContent = expanded ? '折叠设置' : '展开设置';
});

/* ---------------- demo params via location.hash ---------------- */

const cityByName = new Map(CITIES.map((c, i) => [c[0], cityEls[i].v]));

function applyHash() {
  if (!location.hash || location.hash.length < 2) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const lon = parseFloat(p.get('lon')), lat = parseFloat(p.get('lat'));
  if (isFinite(lon) && isFinite(lat)) {
    const v = [0, 0, 0];
    llToVec(lon, lat, v);
    state.q = rotationBetween(v, [0, 1, 0]);
  }
  const z = parseFloat(p.get('zoom'));
  if (isFinite(z) && z > 0) state.zoom = z;
  const sunTime = p.get('sunTime');
  if (sunTime) {
    const date = new Date(sunTime);
    if (!isNaN(date.getTime())) {
      syncSunInputs(date);
      setSunDate(date);
    }
  }
  const arc = p.get('arc');
  if (arc) {
    const names = arc.split(',');
    const a = cityByName.get(names[0]), b = cityByName.get(names[1]);
    if (a && b) addArc(a, b);
  }
}

/* ---------------- resize & loop ---------------- */

function resize() {
  W = window.innerWidth; H = window.innerHeight;
  cx = W / 2 + state.panX; cy = H / 2 + state.panY;
  R = 0.42 * Math.min(W, H) * state.zoom;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  dirty = true;
}

window.addEventListener('resize', () => { resize(); });

function frame() {
  if (inertia.speed > 0.00005 && !drag) {
    state.q = qNormalize(qMul(qFromAxisAngle(inertia.ax, inertia.ay, inertia.az, inertia.speed), state.q));
    inertia.speed *= 0.94;
    dirty = true;
  }
  if (dirty) {
    cx = W / 2 + state.panX; cy = H / 2 + state.panY;
    R = 0.42 * Math.min(W, H) * state.zoom;
    draw();
    dirty = false;
  }
  requestAnimationFrame(frame);
}

buildDefs();
syncSunInputs(new Date());
setSunDate(new Date());
applyHash();
resize();
draw();
requestAnimationFrame(frame);

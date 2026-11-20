import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { L, TR_IN, TR_OUT, R0, H0, DL, RL, DU, RU, GAP, frame, P, profile, roofAt, SEG, S0, bearingToScene, mulberry32 } from './model.js';

const rand = mulberry32(4242);
const col = (h) => new THREE.Color(h);

/* ------------------------------------------------------------------ bowl */
const C = {
  wall: col(0x8e8a83), tread: col(0xc9c5bc), riser: col(0xaaa59c), walk: col(0xb9b5ac),
  glass: col(0x22303d), parapet: col(0xe4e1da), facade: col(0x7d858f), cap: col(0xb3aea5),
};
function sectionPoly(pr) {
  const pts = []; const push = (d, y, c) => pts.push({ d, y, c });
  push(R0, 0, C.wall);
  for (let i = 0; i < pr.nL; i++) {
    const d = R0 + i * DL, y = H0 + i * RL;
    push(d, y, C.tread); push(d + DL, y, C.riser);
  }
  push(pr.lowerBack, pr.lowerTop, C.walk);
  if (pr.nU) {
    push(pr.upStart, pr.lowerTop, C.glass);
    for (let j = 0; j < pr.nU; j++) {
      const d = pr.upStart + j * DU, y = pr.upY0 + j * RU;
      push(d, y, C.tread); push(d + DU, y, C.riser);
    }
  }
  push(pr.back, pr.top, C.parapet);
  push(pr.back, pr.top + 1.1, C.parapet);
  push(pr.back + 0.5, pr.top + 1.1, C.facade);
  push(pr.back + 0.5, 0, null);
  return pts;
}
const samePr = (a, b) => a && b && a.nL === b.nL && a.nU === b.nU && a.band === b.band;

export function buildBowl(scene) {
  const N = 760, pos = [], cols = [];
  const tri = (a, b, c, cl) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) cols.push(cl.r, cl.g, cl.b); };
  const quad = (a, b, c, d, cl) => { tri(a, b, c, cl); tri(a, c, d, cl); };
  const prof = []; for (let k = 0; k < N; k++) prof.push(profile((k + 0.5) / N));
  const cap = (t, poly) => {
    const contour = poly.map(p => new THREE.Vector2(p.d, p.y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [a, b, c] of tris) tri(P(t, poly[a].d, poly[a].y), P(t, poly[b].d, poly[b].y), P(t, poly[c].d, poly[c].y), C.cap);
  };
  for (let k = 0; k < N; k++) {
    const t0 = k / N, t1 = (k + 1) / N, pr = prof[k], poly = sectionPoly(pr);
    for (let e = 0; e < poly.length - 1; e++) {
      const a = poly[e], b = poly[e + 1]; if (!a.c) continue;
      quad(P(t0, a.d, a.y), P(t1, a.d, a.y), P(t1, b.d, b.y), P(t0, b.d, b.y), a.c);
    }
    if (!samePr(prof[(k - 1 + N) % N], pr)) cap(t0, poly);
    if (!samePr(prof[(k + 1) % N], pr)) cap(t1, poly);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.castShadow = m.receiveShadow = true; scene.add(m);

  // 46 radial white concrete frames on the facade (as built in 1958)
  const finGeo = new THREE.BoxGeometry(0.9, 1, 3.2); finGeo.translate(0, 0.5, 1.6);
  const fins = new THREE.InstancedMesh(finGeo, new THREE.MeshLambertMaterial({ color: 0xf1efe9 }), 46);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 46; i++) {
    const t = (i + 0.5) / 46, pr = profile(t, true), f = frame(t), p = P(t, pr.back + 0.5, 0);
    q.setFromAxisAngle(up, Math.atan2(f.nx, f.nz));
    m4.compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, pr.top + 4.6, 1));
    fins.setMatrixAt(i, m4);
  }
  fins.castShadow = true; fins.receiveShadow = true; scene.add(fins);
  return m;
}

/* ------------------------------------------------------------------ roof */
function roofTexture() {
  const W = 8192, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#34383e'; g.fillRect(0, 0, W, H);
  // subtle panel seams + radial ribs
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 2;
  for (let y = 16; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = 'rgba(230,230,225,0.55)'; g.lineWidth = 5;
  for (let i = 0; i < 46; i++) { const x = (i + 0.5) / 46 * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  // painted lettering, readable from outside (front edge = canvas top)
  const label = (t, text, size, y, spacing) => {
    g.save(); g.fillStyle = '#f2f0ea'; g.font = `800 ${size}px "Arial Black", Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (g.letterSpacing !== undefined) g.letterSpacing = spacing + 'px';
    g.fillText(text, t * W, y); g.restore();
  };
  const tSW = S0[0] + SEG[0] / 2, tNE = S0[2] + SEG[2] / 2, tSE = S0[1] + SEG[1] / 2, tNW = S0[3] + SEG[3] / 2;
  label(tSW, 'ULLEVI', 132, 110, 22); label(tSW, 'GÖTEBORG', 54, 196, 18);
  label(tNE, 'GÖTEBORG', 60, 150, 16);
  label(tSE, 'ULLEVI', 70, 150, 14); label(tNW, 'GÖTEBORG', 56, 150, 14);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
export function buildRoof(scene) {
  const N = 520, top = [], uvs = [], under = [], fascia = [];
  for (let k = 0; k < N; k++) {
    const t0 = k / N, t1 = (k + 1) / N, r0 = roofAt(t0), r1 = roofAt(t1);
    const f0 = P(t0, r0.front, r0.yFront), f1 = P(t1, r1.front, r1.yFront);
    const b0 = P(t0, r0.backEdge, r0.yBack), b1 = P(t1, r1.backEdge, r1.yBack);
    top.push(...f0, ...b0, ...b1, ...f0, ...b1, ...f1);
    uvs.push(t0, 1, t0, 0, t1, 0, t0, 1, t1, 0, t1, 1);
    const dn = (p) => [p[0], p[1] - 0.9, p[2]];
    under.push(...dn(f0), ...dn(b1), ...dn(b0), ...dn(f0), ...dn(f1), ...dn(b1));
    // front & back fascia (white edge beams)
    fascia.push(...f0, ...f1, ...dn(f1), ...f0, ...dn(f1), ...dn(f0));
    fascia.push(...b0, ...dn(b1), ...b1, ...b0, ...dn(b0), ...dn(b1));
  }
  const mk = (arr, mat, uv) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
  };
  const mats = {
    top: new THREE.MeshLambertMaterial({ map: roofTexture(), side: THREE.DoubleSide, transparent: true }),
    under: new THREE.MeshLambertMaterial({ color: 0xb9bcbf, side: THREE.DoubleSide, transparent: true }),
    fascia: new THREE.MeshLambertMaterial({ color: 0xf3f1ec, side: THREE.DoubleSide, transparent: true }),
  };
  const group = new THREE.Group();
  group.add(mk(top, mats.top, uvs), mk(under, mats.under), mk(fascia, mats.fascia));
  group.renderOrder = 3; scene.add(group);
  group.userData.mats = Object.values(mats);
  return group;
}

/* ------------------------------------------------------- pylons & lights */
export function buildPylons(scene) {
  const out = { lamps: [] };
  const white = new THREE.MeshLambertMaterial({ color: 0xeeece6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff6e0, emissiveIntensity: 0 });
  out.lampMat = lampMat;
  const cables = [];
  const swBack = profile(S0[0] + SEG[0] / 2).back;
  for (const x of [-46, 46]) {
    const z = swBack + 6, h = 53;
    const g = new THREE.Group();
    // hollow box-section pylon, 3.5 × 5.5 m at its widest, tapering
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 2.3, h, 4, 1), white);
    shaft.rotation.y = Math.PI / 4; shaft.scale.set(1.35, 1, 0.85); shaft.position.y = h / 2;
    shaft.castShadow = true; g.add(shaft);
    const head = new THREE.Mesh(new THREE.BoxGeometry(9, 4.2, 1.2), new THREE.MeshLambertMaterial({ color: 0x9a9fa6 }));
    head.position.set(0, h + 1.2, -1.4); head.rotation.x = -0.35; g.add(head);
    const lamps = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.4, 0.3), lampMat);
    lamps.position.set(0, h + 1.2, -2.05); lamps.rotation.x = -0.35; g.add(lamps); out.lamps.push(lamps);
    g.position.set(x, 0, z); scene.add(g);
    // suspension cables: pylon top → roof front edge of the main stand; back-stays → ground anchors
    for (let i = -4; i <= 4; i++) {
      const xx = x + i * 7.5;
      if (Math.abs(xx) > L + 8) continue;
      const t = S0[0] + (xx + L) / (2 * L) * SEG[0];
      const r = roofAt(t), fp = P(t, r.front + 1, r.yFront);
      cables.push(x, h - 1, z, ...fp);
    }
    for (const dx of [-8, 0, 8]) cables.push(x, h - 2, z, x + dx, 0, z + 34);
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
  scene.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x3a3e44, transparent: true, opacity: 0.75 })));
  // two floodlight masts on the NE corners
  for (const t of [S0[2] + 0.012, S0[3] - 0.012]) {
    const pr = profile(t, true), pp = P(t, pr.back + 7, 0);
    const pos = new THREE.Vector3(pp[0], 0, pp[2]);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 46, 8), white);
    mast.position.set(pos.x, 23, pos.z); mast.castShadow = true; scene.add(mast);
    const lh = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.4), lampMat);
    lh.position.set(pos.x, 46.5, pos.z); lh.lookAt(0, 0, 0); scene.add(lh); out.lamps.push(lh);
  }
  return out;
}

/* ---------------------------------------------------------- bowl floor */
function racetrack(g, r, sx, ox, oz) { // path in canvas coords
  g.beginPath();
  g.moveTo(ox + (-L) * sx, oz + r * sx); g.lineTo(ox + L * sx, oz + r * sx);
  g.arc(ox + L * sx, oz, r * sx, Math.PI / 2, -Math.PI / 2, true);
  g.lineTo(ox - L * sx, oz - r * sx);
  g.arc(ox - L * sx, oz, r * sx, -Math.PI / 2, Math.PI / 2, true);
  g.closePath();
}
export function floorTexture(concert) {
  const S = 10, W = 2000, H = 1140, ox = W / 2, oz = H / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#4c8c84'; g.fillRect(0, 0, W, H);                 // teal apron (as seen on satellite)
  racetrack(g, TR_OUT, S, ox, oz); g.fillStyle = '#b4523d'; g.fill(); // track
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.2;
  for (let i = 0; i <= 8; i++) { racetrack(g, TR_IN + i * 1.22, S, ox, oz); g.stroke(); }
  racetrack(g, TR_IN, S, ox, oz); g.fillStyle = '#a24e3b'; g.fill();   // D areas
  // grass area 116 × 76 with mowing stripes
  const gw = 116 * S, gh = 76 * S;
  if (!concert) {
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#3f8c37' : '#4b9a40'; g.fillRect(ox - gw / 2 + i * gw / 16, oz - gh / 2, gw / 16 + 1, gh); }
    g.strokeStyle = '#f3f3ec'; g.lineWidth = 1.3;
    const pw = 105 * S, ph = 68 * S, x0 = ox - pw / 2, y0 = oz - ph / 2;
    g.strokeRect(x0, y0, pw, ph);
    g.beginPath(); g.moveTo(ox, y0); g.lineTo(ox, y0 + ph); g.stroke();
    g.beginPath(); g.arc(ox, oz, 9.15 * S, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f3f3ec'; g.beginPath(); g.arc(ox, oz, 3, 0, 7); g.fill();
    for (const s of [-1, 1]) {
      const gx = s < 0 ? x0 : x0 + pw;
      g.strokeRect(s < 0 ? gx : gx - 16.5 * S, oz - 20.16 * S, 16.5 * S, 40.32 * S);
      g.strokeRect(s < 0 ? gx : gx - 5.5 * S, oz - 9.16 * S, 5.5 * S, 18.32 * S);
      const px = gx - s * 11 * S; g.beginPath(); g.arc(px, oz, 3, 0, 7); g.fill();
      const a = Math.acos(5.5 / 9.15); g.beginPath();
      if (s < 0) g.arc(px, oz, 9.15 * S, -a, a); else g.arc(px, oz, 9.15 * S, Math.PI - a, Math.PI + a);
      g.stroke();
      for (const sy of [-1, 1]) { g.beginPath(); g.arc(gx, oz + sy * ph / 2, 1 * S, 0, Math.PI * 2); g.stroke(); }
    }
  } else {
    g.fillStyle = '#3a3c40'; g.fillRect(ox - gw / 2, oz - gh / 2, gw, gh);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 2;
    for (let x = 0; x <= gw; x += 2 * S) { g.beginPath(); g.moveTo(ox - gw / 2 + x, oz - gh / 2); g.lineTo(ox - gw / 2 + x, oz + gh / 2); g.stroke(); }
    for (let y = 0; y <= gh; y += 2 * S) { g.beginPath(); g.moveTo(ox - gw / 2, oz - gh / 2 + y); g.lineTo(ox + gw / 2, oz - gh / 2 + y); g.stroke(); }
    // crowd barrier lines (front-of-stage pit)
    g.strokeStyle = 'rgba(255,214,90,0.55)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(ox - 52 * S, oz - 26 * S); g.lineTo(ox - 52 * S, oz + 26 * S); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export function buildFloor(scene) {
  const tex = { football: floorTexture(false), concert: floorTexture(true) };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(200, 114), new THREE.MeshLambertMaterial({ map: tex.football, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.receiveShadow = true; scene.add(m);
  return { mesh: m, tex };
}

/* ----------------------------------------------------- city & ground */
// Traced from Google Earth (scene metres): roads, canals and landmarks around Ullevi.
export const ROADS = [
  { name: 'Ullevigatan', w: 30, tram: false, pts: [[170, -520], [2, -281], [-189, 0], [-481, 326], [-660, 530]] },
  { name: 'Skånegatan', w: 28, tram: true, pts: [[-420, -150], [-200, 34], [205, 371], [430, 560]] },
  { name: 'Levgrensvägen', w: 14, pts: [[60, 330], [150, 160], [250, 60], [340, -40]] },
  { name: '', w: 20, pts: [[-110, -205], [40, -128], [270, -58], [490, 42], [811, 238], [900, 300]] },
  { name: 'E6', w: 46, e6: true, pts: [[230, -700], [362, -303], [600, -110], [811, 67], [980, 210]] },
];
export const CANALS = [
  { w: 22, pts: [[-120, -250], [13, -150], [261, -84], [485, 15], [811, 215], [930, 300]] },
  { w: 16, pts: [[-120, -250], [-205, -101], [-262, 67], [-405, 326], [-520, 520]] },
];
export const LANDMARKS = [
  { name: 'Ullevi Norra', sub: 'Tram stop', p: [-168, 0, 60], tram: true },
  { name: 'Ullevi Södra', sub: 'Tram stop', p: [-14, 0, 200], tram: true },
  { name: 'Gamla Ullevi', sub: 'Football stadium', p: [-301, 20, 275] },
  { name: 'Valhalla IP', sub: 'Sports ground', p: [430, 0, 160] },
];
const NORTH = bearingToScene(0), EAST = bearingToScene(90);
function distToPolyline(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - ax - u * dx, z - az - u * dz));
  }
  return best;
}
const GAMLA = { x: -301, z: 275, len: 150, wid: 116 };
const VALHALLA = { x: 300, z: 62, len: 190, wid: 92, rot: Math.atan2(101, 224) };
const VALHALLA_IP = { x: 430, z: 160, len: 105, wid: 70, rot: Math.atan2(101, 224) };
function inRot(x, z, r, pad = 0) { // r: {x,z,len,wid,rot}
  const c = Math.cos(-(r.rot || 0)), s = Math.sin(-(r.rot || 0));
  const dx = x - r.x, dz = z - r.z, u = dx * c - dz * s, v = dx * s + dz * c;
  return Math.abs(u) < r.len / 2 + pad && Math.abs(v) < r.wid / 2 + pad;
}
const gamlaRot = Math.atan2(NORTH.z, NORTH.x);
export function buildGround(scene) {
  const W = 2048, H = 2048, SIZE = 2000, k = W / SIZE; // 1 px ≈ 0.98 m
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const X = (x) => (x + SIZE / 2) * k, Z = (z) => (z + SIZE / 2) * k;
  g.fillStyle = '#d4d0c7'; g.fillRect(0, 0, W, H);
  // parks / greenery
  g.fillStyle = '#a7b593';
  const blob = (x, z, rx, rz, rot = 0) => { g.beginPath(); g.ellipse(X(x), Z(z), rx * k, rz * k, rot, 0, Math.PI * 2); g.fill(); };
  blob(170, 150, 120, 80, 0.5); blob(60, -200, 70, 40, 0.3); blob(-60, 210, 60, 35, 0.6); blob(600, 380, 160, 90, 0.4); blob(-330, -120, 60, 50, 0);
  // railway yard
  g.save(); g.translate(X(-640), Z(-380)); g.rotate(-0.95); g.fillStyle = '#b9b2a6'; g.fillRect(-60 * k, -420 * k, 150 * k, 840 * k);
  g.strokeStyle = 'rgba(90,80,70,0.55)'; g.lineWidth = 1;
  for (let i = 0; i < 24; i++) { g.beginPath(); g.moveTo((-55 + i * 6) * k, -420 * k); g.lineTo((-55 + i * 6) * k, 420 * k); g.stroke(); }
  g.restore();
  // canals
  for (const cn of CANALS) {
    g.strokeStyle = '#7fa5b5'; g.lineWidth = cn.w * k; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); cn.pts.forEach(([x, z], i) => i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))); g.stroke();
    g.strokeStyle = '#6b95a7'; g.lineWidth = (cn.w - 6) * k; g.stroke();
  }
  // roads
  for (const r of ROADS) {
    const path = () => { g.beginPath(); r.pts.forEach(([x, z], i) => i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))); };
    g.lineCap = 'round'; g.lineJoin = 'round';
    path(); g.strokeStyle = '#bdb9b1'; g.lineWidth = (r.w + 8) * k; g.stroke();   // sidewalks
    path(); g.strokeStyle = r.e6 ? '#8d9196' : '#9ea2a7'; g.lineWidth = r.w * k; g.stroke();
    if (r.tram) { path(); g.strokeStyle = '#8fa67f'; g.lineWidth = 7 * k; g.stroke(); }
    path(); g.setLineDash([6 * k, 6 * k]); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.8; g.stroke(); g.setLineDash([]);
  }
  // stadium plaza
  g.save(); g.translate(X(0), Z(0));
  const plaza = (r) => { g.beginPath(); g.moveTo(-L * k, r * k); g.lineTo(L * k, r * k); g.arc(L * k, 0, r * k, Math.PI / 2, -Math.PI / 2, true); g.lineTo(-L * k, -r * k); g.arc(-L * k, 0, r * k, -Math.PI / 2, Math.PI / 2, true); g.closePath(); };
  plaza(R0 + 82); g.fillStyle = '#c9c4ba'; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
  for (let r = R0 + 56; r < R0 + 82; r += 6) { plaza(r); g.stroke(); }
  g.restore();
  // Valhalla warm-up track & Valhalla IP pitch
  const rotRect = (r, fill, cb) => { g.save(); g.translate(X(r.x), Z(r.z)); g.rotate(r.rot || 0); g.fillStyle = fill; g.fillRect(-r.len / 2 * k, -r.wid / 2 * k, r.len * k, r.wid * k); if (cb) cb(); g.restore(); };
  rotRect(VALHALLA, '#b9b5ad', () => {
    g.strokeStyle = '#b06a55'; g.lineWidth = 9 * k;
    g.beginPath(); g.ellipse(0, 0, 80 * k, 34 * k, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#9fb48b'; g.beginPath(); g.ellipse(0, 0, 70 * k, 26 * k, 0, 0, Math.PI * 2); g.fill();
  });
  rotRect(VALHALLA_IP, '#7fa868', () => { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.strokeRect(-48 * k, -30 * k, 96 * k, 60 * k); });
  rotRect({ ...GAMLA, rot: gamlaRot }, '#a9a59d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshLambertMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; scene.add(m);
  // outer ground beyond the map tile
  const far = new THREE.Mesh(new THREE.RingGeometry(SIZE * 0.69, 9000, 64), new THREE.MeshLambertMaterial({ color: 0xcfcbc2 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.05; scene.add(far);
  return [m.material, far.material];
}

export function buildCity(scene) {
  const blocked = (x, z, pad) => {
    if (Math.hypot(x / 1.25, z) < 150 + pad) return true; // stadium + plaza
    for (const r of ROADS) if (distToPolyline(x, z, r.pts) < r.w / 2 + 9 + pad) return true;
    for (const cn of CANALS) if (distToPolyline(x, z, cn.pts) < cn.w / 2 + 8 + pad) return true;
    if (inRot(x, z, VALHALLA, 10 + pad) || inRot(x, z, VALHALLA_IP, 10 + pad) || inRot(x, z, { ...GAMLA, rot: gamlaRot }, 6 + pad)) return true;
    if (Math.hypot(x - 170, z - 150) < 110) return true; // park south of the arena
    // railway yard
    const u = (x + 640) * Math.cos(0.95) - (z + 380) * Math.sin(0.95);
    if (Math.abs(u) < 110 && Math.hypot(x + 640, z + 380) < 470) return true;
    return false;
  };
  const boxes = [];
  const S = 82, B = 64, D = 13;
  for (let i = -11; i <= 11; i++) for (let j = -11; j <= 11; j++) {
    const cx = EAST.x * i * S + NORTH.x * j * S + 20, cz = EAST.z * i * S + NORTH.z * j * S + 14;
    if (Math.hypot(cx, cz) > 900) continue;
    if (blocked(cx, cz, 18)) continue;
    const kind = rand();
    const hBase = 13 + rand() * 11;
    if (kind < 0.22) { // single office slab
      boxes.push({ x: cx, z: cz, w: B * (0.6 + rand() * 0.35), d: B * (0.4 + rand() * 0.3), h: hBase + 8 + rand() * 16 });
    } else { // classic Gothenburg perimeter block with courtyard
      for (const [ox, oz, w, d] of [[0, -(B - D) / 2, B, D], [0, (B - D) / 2, B, D], [-(B - D) / 2, 0, D, B - 2 * D], [(B - D) / 2, 0, D, B - 2 * D]]) {
        if (rand() < 0.12) continue;
        const px = cx + EAST.x * ox + NORTH.x * oz, pz = cz + EAST.z * ox + NORTH.z * oz;
        if (blocked(px, pz, 0)) continue;
        boxes.push({ x: px, z: pz, w, d, h: hBase + (rand() - 0.5) * 3 });
      }
    }
  }
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  // lit windows (only on walls, only at night)
  const wc = document.createElement('canvas'); wc.width = 128; wc.height = 128; const wg = wc.getContext('2d');
  wg.fillStyle = '#000'; wg.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { if (rand() < 0.42) { const w = 0.55 + rand() * 0.45; wg.fillStyle = `rgba(255,${190 + Math.floor(rand() * 40)},${120 + Math.floor(rand() * 60)},${w})`; wg.fillRect(x * 16 + 4, y * 16 + 4, 8, 9); } }
  const winTex = new THREE.CanvasTexture(wc); winTex.colorSpace = THREE.SRGBColorSpace;
  const cityMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveMap: winTex, emissiveIntensity: 0 });
  cityMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUpN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvUpN = abs(normal.y);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vUpN;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= (1.0 - vUpN);');
  };
  const im = new THREE.InstancedMesh(geo, cityMat, boxes.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(EAST.z, EAST.x)), c = new THREE.Color();
  boxes.forEach((b, i) => {
    m4.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
    im.setMatrixAt(i, m4); im.setColorAt(i, c.setHSL(0.09, 0.10 + rand() * 0.08, 0.84 + rand() * 0.08));
  });
  im.castShadow = true; im.receiveShadow = true; scene.add(im);

  // Gamla Ullevi (simplified massing)
  const ga = new THREE.Group(); ga.position.set(GAMLA.x, 0, GAMLA.z); ga.rotation.y = -gamlaRot;
  const stMat = new THREE.MeshLambertMaterial({ color: 0xe9e6df });
  const pitchM = new THREE.Mesh(new THREE.PlaneGeometry(112, 76), new THREE.MeshLambertMaterial({ color: 0x4f9440 }));
  pitchM.rotation.x = -Math.PI / 2; pitchM.position.y = 0.3; ga.add(pitchM);
  for (const [x, z, w, d] of [[0, 46, 120, 16], [0, -46, 120, 16], [66, 0, 16, 108], [-66, 0, 16, 108]]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, 19, d), stMat); s.position.set(x, 9.5, z); s.castShadow = s.receiveShadow = true; ga.add(s);
  }
  scene.add(ga);

  // trees
  const treeGeo = (() => { const cn = new THREE.IcosahedronGeometry(3.4, 0); cn.translate(0, 6, 0); const tr = new THREE.CylinderGeometry(0.25, 0.35, 3.5, 5).toNonIndexed(); tr.translate(0, 1.75, 0); return mergeGeometries([cn, tr]); })();
  const trees = [];
  const tryTree = (x, z) => { if (!blocked(x, z, -6) || Math.hypot(x - 170, z - 150) < 110) trees.push([x, z]); };
  for (let i = 0; i < 260; i++) { const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 105; tryTree(170 + Math.cos(a) * r * 1.2, 150 + Math.sin(a) * r * 0.75); }
  for (const r of ROADS.slice(0, 3)) for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let s = 0; s < len; s += 13) for (const side of [-1, 1]) {
      const x = ax + (bx - ax) * s / len + nx * side * (r.w / 2 + 6), z = az + (bz - az) * s / len + nz * side * (r.w / 2 + 6);
      if (Math.hypot(x / 1.25, z) > 150 && Math.hypot(x, z) < 850) trees.push([x, z]);
    }
  }
  for (const cn of CANALS) for (let i = 0; i < cn.pts.length - 1; i++) {
    const [ax, az] = cn.pts[i], [bx, bz] = cn.pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let s = 0; s < len; s += 11) for (const side of [-1, 1]) trees.push([ax + (bx - ax) * s / len + nx * side * (cn.w / 2 + 4), az + (bz - az) * s / len + nz * side * (cn.w / 2 + 4)]);
  }
  const tm = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
  trees.forEach(([x, z], i) => {
    const s = 0.8 + rand() * 0.6;
    m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s * (0.9 + rand() * 0.3), s));
    tm.setMatrixAt(i, m4); tm.setColorAt(i, c.setHSL(0.24 + rand() * 0.06, 0.28, 0.42 + rand() * 0.1));
  });
  tm.castShadow = true; tm.receiveShadow = true; scene.add(tm);
  // street lights along the roads and around the stadium plaza (warm lamps + light pools on the ground)
  const lamps = [];
  for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let d = 0; d < len; d += 22) for (const side of [-1, 1]) {
      const x = ax + (bx - ax) * d / len + nx * side * (r.w / 2 + 2), z = az + (bz - az) * d / len + nz * side * (r.w / 2 + 2);
      if (Math.hypot(x, z) < 900 && Math.hypot(x / 1.25, z) > 140) lamps.push([x, z, r.e6 ? 10 : 7]);
    }
  }
  for (let k = 0; k < 64; k++) { const a = k / 64 * Math.PI * 2; lamps.push([Math.cos(a) * 165, Math.sin(a) * 132, 6]); }
  const lp = new Float32Array(lamps.length * 3); lamps.forEach(([x, z, h], i) => lp.set([x, h, z], i * 3));
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const bulbMat = new THREE.PointsMaterial({ color: 0xffd08a, size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const bulbs = new THREE.Points(lg, bulbMat); scene.add(bulbs);
  const pc = document.createElement('canvas'); pc.width = pc.height = 64; const pg = pc.getContext('2d');
  const grd = pg.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,200,130,1)'); grd.addColorStop(1, 'rgba(255,200,130,0)');
  pg.fillStyle = grd; pg.fillRect(0, 0, 64, 64);
  const poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2), poolMat, lamps.length);
  lamps.forEach(([x, z], i) => { m4.makeTranslation(x, 0.15, z); pools.setMatrixAt(i, m4); }); scene.add(pools);
  buildCity.night = (k) => { cityMat.emissiveIntensity = 1.1 * k; bulbMat.opacity = k; poolMat.opacity = 0.42 * k; bulbs.visible = pools.visible = k > 0.02; };
  return [im.material, tm.material, ga.children[0].material, stMat];
}

/* ------------------------------------------------------------ events */
export const STAGE = { back: -82, front: -64, w: 62, deck: 2.6 };
export function buildFootball(scene) {
  const grp = new THREE.Group(); scene.add(grp);
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const post = new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8);
    for (const z of [-3.66, 3.66]) { const p = new THREE.Mesh(post, white); p.position.set(0, 1.22, z); p.castShadow = true; g.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), white); bar.rotation.x = Math.PI / 2; bar.position.y = 2.44; g.add(bar);
    const net = new THREE.Mesh(new THREE.BoxGeometry(2, 2.44, 7.32), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
    net.position.set(s * 1, 1.22, 0); g.add(net);
    g.position.x = s * 52.5; grp.add(g);
  }
  const kitA = new THREE.MeshLambertMaterial({ color: 0x1f5fb0 }), kitB = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), skin = new THREE.MeshLambertMaterial({ color: 0xd9a77f });
  const body = new THREE.CapsuleGeometry(0.28, 1.05, 3, 8); body.translate(0, 0.85, 0);
  const head = new THREE.SphereGeometry(0.13, 10, 8); head.translate(0, 1.72, 0);
  const team = [[-48, 0], [-34, -14], [-36, 2], [-35, 15], [-22, -24], [-20, -6], [-18, 9], [-21, 24], [-6, -10], [-4, 8], [2, -1]];
  team.forEach(([x, z], i) => {
    for (const [mat, sx, dz] of [[kitA, 1, 0], [kitB, -1, i % 2 ? 3 : -3]]) {
      const p = new THREE.Group(); const b = new THREE.Mesh(body, mat); b.castShadow = true; p.add(b, new THREE.Mesh(head, skin));
      p.position.set(sx * x + (sx < 0 ? 4 : 0), 0, z + dz); grp.add(p);
    }
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), white); ball.position.set(3.2, 0.11, 0.5); grp.add(ball);
  return grp;
}
function screenTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#1b2135'); gr.addColorStop(0.55, '#8a1f5c'); gr.addColorStop(1, '#ff5a36'); // Utsikt: Läktare → Scen → Skymning
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 7; i++) { // stage light rays on the screen
    const x = 120 + i * 130; const rg = g.createLinearGradient(x, 0, 512, 400);
    rg.addColorStop(0, 'rgba(255,235,200,0.0)'); rg.addColorStop(1, 'rgba(255,235,200,0.18)');
    g.fillStyle = rg; g.beginPath(); g.moveTo(x - 20, 0); g.lineTo(x + 20, 0); g.lineTo(530, 400); g.lineTo(494, 400); g.fill();
  }
  g.fillStyle = 'rgba(16,10,28,0.92)'; // performer close-up silhouette
  g.beginPath(); g.ellipse(512, 210, 58, 70, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(370, 512); g.quadraticCurveTo(390, 300, 512, 285); g.quadraticCurveTo(634, 300, 654, 512); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < 512; y += 4) g.fillRect(0, y, 1024, 1);
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '700 34px Inter, Arial, sans-serif'; g.textAlign = 'left'; g.fillText('LIVE · ULLEVI', 40, 476);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function buildConcert(scene) {
  const grp = new THREE.Group(); scene.add(grp);
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1c21 }), truss = new THREE.MeshLambertMaterial({ color: 0x5b5e66 });
  const { back, front, w, deck } = STAGE, cx = (back + front) / 2, depth = front - back;
  const add = (geo, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; grp.add(m); return m; };
  add(new THREE.BoxGeometry(depth, deck, w), dark, cx, deck / 2, 0);
  add(new THREE.BoxGeometry(24, deck, 7), dark, front + 12, deck / 2, 0);                 // catwalk
  add(new THREE.CylinderGeometry(5, 5, deck, 24), dark, front + 26, deck / 2, 0);          // B-stage
  for (const x of [back + 2, front - 2]) for (const z of [-w / 2 + 2, w / 2 - 2]) add(new THREE.BoxGeometry(1.6, 27, 1.6), truss, x, 13.5, z);
  add(new THREE.BoxGeometry(depth + 2, 2.6, w + 2), truss, cx, 27.3, 0);
  const scrMat = new THREE.MeshBasicMaterial({ map: screenTexture(), color: 0xd6d6d6 });
  const main = add(new THREE.PlaneGeometry(46, 20), scrMat, back + 3, deck + 12, 0, false); main.rotation.y = Math.PI / 2;
  for (const z of [-w / 2 - 9, w / 2 + 9]) {
    const s = add(new THREE.PlaneGeometry(15, 8.5), scrMat, front - 4, 15, z, false); s.rotation.y = Math.PI / 2;
    add(new THREE.BoxGeometry(0.6, 9.4, 16), dark, front - 4.4, 15, z);
    add(new THREE.BoxGeometry(1, 15, 1), truss, front - 4.6, 5.5, z);
  }
  for (const z of [-22, 22]) add(new THREE.BoxGeometry(2, 10, 2.6), dark, front + 1, 19, z);    // PA hangs
  add(new THREE.BoxGeometry(8, 3, 10), dark, 18, 1.5, 0);                                     // FOH mixing desk
  const perf = add(new THREE.CapsuleGeometry(0.3, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe7c4, emissiveIntensity: 0.6 }), front - 1.5, deck + 0.9, 0);
  // light beams (visible after sunset)
  const beams = new THREE.Group(); grp.add(beams);
  const beamGeo = new THREE.ConeGeometry(3.2, 60, 24, 1, true); beamGeo.translate(0, -30, 0);
  const beamCols = [0x34e0ff, 0xff2e8a, 0x9b6bff, 0xe6eeff]; // Utsikt: Laser, Scen, violet, Strålkastare
  for (let i = 0; i < 10; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: beamCols[i % 4], transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const b = new THREE.Mesh(beamGeo, mat); b.position.set(cx + 4, 26, -w / 2 + 3 + i * (w - 6) / 9); b.userData.phase = i * 0.7; beams.add(b);
  }
  // standing floor ("Planen")
  const spots = []; const fr = mulberry32(77);
  while (spots.length < 16000) {
    const x = front + 2 + fr() * 118, z = (fr() * 2 - 1) * 33;
    if (x > 56) continue;
    if (Math.abs(z) < 4.5 && x < front + 25) continue;               // catwalk
    if (Math.hypot(x - (front + 26), z) < 6.5) continue;             // B-stage
    if (Math.abs(x - 18) < 7 && Math.abs(z) < 8) continue;           // FOH
    const dens = 1 - Math.max(0, x - front) / 150; if (fr() > dens) continue;
    spots.push([x, z]);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const people = [];
  spots.forEach(([x, z]) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2 + (fr() - 0.5) * 0.9);
    const sc = 0.92 + fr() * 0.16;
    m4.compose(new THREE.Vector3(x, 0.02, z), q, new THREE.Vector3(sc, sc, sc));
    people.push({ matrix: m4.clone(), pos: new THREE.Vector3(x, 1, z), phi: Math.atan2(z, x), standing: true, x, z });
  });
  return { group: grp, beams, perf, floorCrowd: { people }, target: new THREE.Vector3(front, 5, 0) };
}

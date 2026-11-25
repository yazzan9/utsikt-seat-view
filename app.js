import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { R0, L, frame, profile, roofAt, P, SECTIONS, sunPosition, localDate, sunTimes, bearingToScene, sceneToBearing } from './model.js';
import { buildBowl, buildRoof, buildPylons, buildFloor, buildGround, buildCity, buildFootball, buildConcert, STAGE, LANDMARKS } from './world.js';
import { buildSeats } from './seats.js';
import { parseQuery, suggest } from './search.js';
import { crowdUniforms, makeCrowd, makeLightShow, makeFlags, STYLES } from './crowd.js';
import { GATES, TRAMS, recommendGate, sectionsForGate, buildRoute, makeRouteLayer } from './gates.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const fmtTime = (h) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tick = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

/* ================================================================ setup */
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.25, 6000);
camera.position.set(260, 520, 760);

const skyCanvas = document.createElement('canvas'); skyCanvas.width = 2; skyCanvas.height = 512;
const skyTex = new THREE.CanvasTexture(skyCanvas); skyTex.colorSpace = THREE.SRGBColorSpace; scene.background = skyTex;
scene.fog = new THREE.Fog(0xdde6ee, 700, 2600);
const hemi = new THREE.HemisphereLight(0xe8f0fb, 0x6b6253, 1.2); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -190, right: 190, top: 190, bottom: -190, near: 50, far: 900 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);
const flood = new THREE.DirectionalLight(0xe9f1ff, 0); flood.position.set(0, 300, 0); scene.add(flood);
const flood2 = new THREE.DirectionalLight(0xe9f1ff, 0); flood2.position.set(0, 120, 220); scene.add(flood2);

/* ================================================================ glow + quality */
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
// guard: remove any NaN/Inf pixels before the glow pass, otherwise one bad pixel can black out the screen
composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); bvec4 bad = bvec4(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b), false); if (any(bad)) c.rgb = vec3(0.0); gl_FragColor = vec4(clamp(c.rgb, 0.0, 16.0), 1.0); }' }));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.85, 0.45, 0.88);
composer.addPass(bloom); composer.addPass(new OutputPass());
const QUALITY = [
  { name: 'Saver', pr: 1, near: [9, 600], bloom: false, fps: 30 },
  { name: 'Balanced', pr: 1.25, near: [16, 1800], bloom: true, fps: 60 },
  { name: 'High', pr: Math.min(devicePixelRatio, 1.75), near: [24, 3500], bloom: true, fps: 60 },
];
const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 860;
const Q = { mode: 'auto', level: isMobile ? 1 : 2, samples: [], settleUntil: 0, last: 0 };
function applyQuality() {
  const q = QUALITY[Q.level];
  renderer.setPixelRatio(q.pr); composer.setPixelRatio(q.pr); composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  if (W.crowdSys) W.crowdSys.setRange(q.near[0], q.near[1]);
  document.querySelectorAll('#qual button').forEach(b => b.classList.toggle('on', b.dataset.q === Q.mode));
  const qn = $('#qnote'); if (qn) qn.textContent = Q.mode === 'auto' ? `Auto · running ${q.name}` : q.name;
  updateLightUniforms();
}
function setQualityMode(m) { Q.mode = m; Q.level = m === 'high' ? 2 : m === 'saver' ? 0 : (isMobile ? 1 : 2); Q.samples = []; Q.settleUntil = performance.now() + 1500; applyQuality(); }
function monitorFps(now) {
  const dt = now - Q.last; Q.last = now;
  if (Q.mode !== 'auto' || flight || now < Q.settleUntil || dt > 400) return;
  Q.samples.push(dt);
  if (Q.samples.length >= 90) {
    const avg = Q.samples.reduce((a, b) => a + b, 0) / Q.samples.length; Q.samples = [];
    if (avg > 26 && Q.level > 0) { Q.level--; Q.settleUntil = now + 2000; applyQuality(); toast(`Switched to ${QUALITY[Q.level].name} quality to keep things smooth.`); }
  }
}
function lightMode() {
  if (st.lights === 'off') return 0;
  if (st.lights === 'bands') return 1;
  if (st.lights === 'phones') return 2;
  if (st.lights === 'both') return 3;
  return st.mode === 'concert' ? 3 : 2; // auto: full light show at concerts, phone lights at football
}
function updateLightUniforms() {
  const nk = st.nightK || 0, mode = lightMode();
  W.show && (W.show.uniforms.uShowMode.value = mode);
  crowdUniforms.uShow.value = mode ? nk : 0;
  crowdUniforms.uPhoneUp.value = (mode === 2 || mode === 3) ? nk * (st.mode === 'concert' ? 1 : 0.6) : 0;
  crowdUniforms.uTintK.value = st.mode === 'concert' ? nk : 0;
  st.bloomOn = QUALITY[Q.level].bloom && nk > 0.25;
}
function applyNight() {
  // light that falls on the cut-out (far) crowd, matched to the 3D people
  const L = 0.42 * hemi.intensity + 0.26 * sun.intensity + 0.45 * flood.intensity;
  crowdUniforms.uLight.value.setRGB(L, L * 0.98, L * 0.95);
  updateLightUniforms();
  document.querySelectorAll('#lights button').forEach(b => b.classList.toggle('on', b.dataset.l === (st.lights || 'auto')));
}

/* ================================================================ build */
const ui = { msg: (m) => { const el = $('#ldmsg'); if (el) el.textContent = m; } };
let W = {}; // world references

async function build() {
  ui.msg('Pouring 46 concrete frames…'); await tick();
  W.bowl = buildBowl(scene);
  ui.msg('Hanging the roof from two 53 m pylons…'); await tick();
  W.roof = buildRoof(scene); W.pylons = buildPylons(scene);
  W.floor = buildFloor(scene);
  ui.msg('Laying out Heden, the canals and Gamla Ullevi…'); await tick();
  const gr = buildGround(scene), city = buildCity(scene); W.dimmable = [...gr, ...city];
  ui.msg('Installing 40 000 seats…'); await tick();
  const S = buildSeats(scene); Object.assign(W, S);
  W.football = buildFootball(scene);
  ui.msg('Seating 30 000 fans…'); await tick();
  W.concert = buildConcert(scene);
  const crand = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  W.crowdSys = makeCrowd(scene, [...S.crowd.people, ...W.concert.floorCrowd.people], crand);
  W.show = makeLightShow(scene, W.crowdSys);
  buildCrowdExtras();
  W.route = makeRouteLayer(scene);
  W.floorPick = new THREE.Mesh(new THREE.PlaneGeometry(122, 70), new THREE.MeshBasicMaterial({ visible: false }));
  W.floorPick.rotation.x = -Math.PI / 2; W.floorPick.position.set(-3, 0.1, 0); scene.add(W.floorPick);
  ui.msg('Computing sightlines…'); await tick();
  buildOccluders();
}

/* ================================================================ state */
const EVENTS = {
  football: { label: 'Football', title: 'Allsvenskan match', month: 9, day: 12, hour: 15, target: new THREE.Vector3(0, 0, 0) },
  concert: { label: 'Concert', title: 'Stadium concert · end stage', month: 8, day: 22, hour: 22, target: null },
};
const PRICES = { football: [495, 395, 295, 225], concert: [1295, 1095, 895, 695], floor: 995 };
const st = {
  mode: 'concert', month: 8, day: 22, hour: 22, heat: 'off', state: 'intro',
  hoverBlock: null, activeBlock: null, hoverSeat: null, sel: null, crowdOn: true,
  lights: 'auto', nightK: 0, sunAlt: 30, sunAz: 200, night: false, sunCalc: null, ticket: false, secLabels: false, crowdStyle: 'sweden', gateOverride: null, routeInfo: null,
};
const isTaken = (s) => st.ticket && !!s.taken;

/* ================================================================ scoring */
function eyeOf(sel) { return sel.floor ? sel.pos.clone().setY(1.66) : sel.pos.clone().setY(sel.pos.y + 1.2); }
function target() { return st.mode === 'football' ? EVENTS.football.target : W.concert.target; }
function scoreSeat(s) {
  const eye = eyeOf(s), T = target(), d = eye.distanceTo(T);
  const hd = Math.hypot(eye.x - T.x, eye.z - T.z), elev = Math.atan2(eye.y - T.y, hd) * 180 / Math.PI;
  const se = 1 - clamp((Math.abs(elev - 22) - 6) / 24);
  if (st.mode === 'football') {
    const sd = clamp(1 - (d - 45) / 100), ss = 0.35 + 0.65 * Math.abs(s.n ? s.n.y : 1);
    return { score: clamp(10 * (0.38 * sd + 0.30 * ss + 0.32 * se), 1, 9.9), dist: d, elev, theta: 0, blocked: false, restricted: false };
  }
  const vx = eye.x - T.x, vz = eye.z - T.z, theta = Math.acos(vx / Math.hypot(vx, vz)) * 180 / Math.PI;
  const blocked = !s.floor && theta > 100, restricted = !s.floor && theta > 75 && !blocked;
  const sd = clamp(1 - (d - 35) / 130), sa = clamp(1 - Math.max(0, theta - 35) / 70);
  let score = 10 * (0.55 * sd + 0.35 * sa + 0.10 * se);
  if (s.floor) score = 10 * (0.85 * clamp(1 - (d - 8) / 110) + 0.12);
  if (restricted) score *= 0.8;
  return { score: clamp(score, 0.5, 9.9), dist: d, elev, theta, blocked, restricted };
}
function computeScores() {
  for (const s of W.seats) { const r = scoreSeat(s); s.score = r.score; s.blocked = r.blocked; s.restricted = r.restricted; }
  const avgs = [];
  for (const b of W.blocks) {
    const ok = b.seats.filter(s => !s.blocked);
    b.blocked = ok.length === 0;
    b.avg = ok.length ? ok.reduce((a, s) => a + s.score, 0) / ok.length : 0;
    b.free = ok.filter(s => !s.taken).length;
    if (!b.blocked) avgs.push(b.avg);
  }
  const all = W.seats.filter(s => !s.blocked).map(s => s.score).sort((a, b) => a - b);
  VR = [all[Math.floor(all.length * 0.03)], all[Math.floor(all.length * 0.97)]];
  avgs.sort((a, b) => b - a);
  const q = (p) => avgs[Math.min(avgs.length - 1, Math.floor(p * avgs.length))];
  const c1 = q(0.2), c2 = q(0.5), c3 = q(0.8);
  for (const b of W.blocks) {
    b.cat = b.blocked ? 0 : b.avg >= c1 ? 1 : b.avg >= c2 ? 2 : b.avg >= c3 ? 3 : 4;
    b.price = b.cat ? PRICES[st.mode][b.cat - 1] : 0;
  }
}
const label = (v) => v >= 8 ? 'Excellent' : v >= 6.5 ? 'Great' : v >= 5 ? 'Good' : v >= 3.5 ? 'Fair' : 'Limited';

/* ================================================================ sun & shade */
// Coarse occluder set (roof + stand hull) for shade ray tests.
let OCC = null;
function buildOccluders() {
  const tris = [];
  const N = 220;
  for (let k = 0; k < N; k++) {
    const t0 = k / N, t1 = (k + 1) / N, r0 = roofAt(t0), r1 = roofAt(t1);
    const a = P(t0, r0.front, r0.yFront), b = P(t0, r0.backEdge, r0.yBack), c = P(t1, r1.backEdge, r1.yBack), d = P(t1, r1.front, r1.yFront);
    tris.push([a, b, c], [a, c, d]);
    const p0 = profile((k + 0.5) / N);
    const quad = (d0, y0, d1, y1) => { const A = P(t0, d0, y0), B = P(t1, d0, y0), Cc = P(t1, d1, y1), D = P(t0, d1, y1); tris.push([A, B, Cc], [A, Cc, D]); };
    quad(R0, 1.3, p0.lowerBack, p0.lowerTop);
    if (p0.nU) { quad(p0.upStart, p0.lowerTop, p0.upStart, p0.upY0); quad(p0.upStart, p0.upY0, p0.back, p0.top); }
    quad(p0.back, p0.top + 1.1, p0.back, 0);
  }
  OCC = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => { OCC.set([...t[0], ...t[1], ...t[2]], i * 9); });
}
function sunVec() {
  const a = st.sunAlt * Math.PI / 180, h = bearingToScene(st.sunAz);
  return new THREE.Vector3(h.x * Math.cos(a), Math.sin(a), h.z * Math.cos(a)).normalize();
}
function inShadeList(ox, oy, oz, dx, dy, dz, list) {
  const T = OCC;
  for (let li = 0; li < list.length; li++) {
    const i = list[li];
    const e1x = T[i + 3] - T[i], e1y = T[i + 4] - T[i + 1], e1z = T[i + 5] - T[i + 2];
    const e2x = T[i + 6] - T[i], e2y = T[i + 7] - T[i + 1], e2z = T[i + 8] - T[i + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-7 && det < 1e-7) continue;
    const inv = 1 / det, tx = ox - T[i], ty = oy - T[i + 1], tz = oz - T[i + 2];
    const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0.05) return true;
  }
  return false;
}
// Acceleration: project occluders onto the plane perpendicular to the sun and bin them in a 2D grid,
// so each seat only tests the few triangles its shadow ray can actually cross.
let GRID = null;
function sunGrid(v) {
  const key = v.x.toFixed(4) + v.y.toFixed(4) + v.z.toFixed(4);
  if (GRID && GRID.key === key) return GRID;
  const up = Math.abs(v.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const U = new THREE.Vector3().crossVectors(up, v).normalize(), V = new THREE.Vector3().crossVectors(v, U);
  const CS = 3, cells = new Map(), T = OCC;
  const pu = (i) => T[i] * U.x + T[i + 1] * U.y + T[i + 2] * U.z, pv = (i) => T[i] * V.x + T[i + 1] * V.y + T[i + 2] * V.z;
  for (let i = 0; i < T.length; i += 9) {
    const us = [pu(i), pu(i + 3), pu(i + 6)], vs = [pv(i), pv(i + 3), pv(i + 6)];
    const u0 = Math.floor(Math.min(...us) / CS), u1 = Math.floor(Math.max(...us) / CS), v0 = Math.floor(Math.min(...vs) / CS), v1 = Math.floor(Math.max(...vs) / CS);
    for (let a = u0; a <= u1; a++) for (let c = v0; c <= v1; c++) { const k = a * 100003 + c; let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(i); }
  }
  GRID = { key, U, V, CS, cells };
  return GRID;
}
function shadeTest(ex, ey, ez, v) {
  const G = sunGrid(v), u = ex * G.U.x + ey * G.U.y + ez * G.U.z, w = ex * G.V.x + ey * G.V.y + ez * G.V.z;
  const list = G.cells.get(Math.floor(u / G.CS) * 100003 + Math.floor(w / G.CS));
  if (!list) return false;
  const ox = ex + v.x * 0.3, oy = ey + v.y * 0.3, oz = ez + v.z * 0.3;
  return inShadeList(ox, oy, oz, v.x, v.y, v.z, list);
}
function seatSun(s) {
  if (st.sunAlt <= 0) return 'night';
  const v = sunVec(), e = eyeOf(s);
  return shadeTest(e.x, e.y, e.z, v) ? 'shade' : 'sun';
}
function computeSunSync() {
  const v = sunVec(), night = st.sunAlt <= 0;
  for (const s of W.seats) s.sun = night ? 'night' : (shadeTest(s.pos.x, s.pos.y + 1.2, s.pos.z, v) ? 'shade' : 'sun');
  st.sunKey = st.month + ':' + st.hour;
}
let sunJob = 0;
async function computeSunMap() {
  const job = ++sunJob; st.sunCalc = { done: 0 };
  const v = sunVec(), night = st.sunAlt <= 0;
  const seats = W.seats, CH = 1e9;
  for (let i = 0; i < seats.length; i += CH) {
    if (job !== sunJob) return;
    for (let k = i; k < Math.min(seats.length, i + CH); k++) {
      const s = seats[k];
      if (night) { s.sun = 'night'; continue; }
      s.sun = shadeTest(s.pos.x, s.pos.y + 1.2, s.pos.z, v) ? 'shade' : 'sun';
    }
    st.sunCalc.done = Math.min(1, (i + CH) / seats.length);
    $('#heatnote').textContent = `Calculating sun & shade… ${Math.round(st.sunCalc.done * 100)}%`;
    await tick();
  }
  if (job !== sunJob) return;
  st.sunCalc = { ready: true };
  updateHeatNote(); paintAll(); updatePlanColors();
}

const SKY = {
  day: ['#4f86c6', '#9ec2e6', '#e6eef5'], golden: ['#5d79b0', '#e7a974', '#ffd9a3'], dusk: ['#1c2a52', '#6a4d7d', '#e2875f'], night: ['#05070f', '#0b1530', '#1a2647'],
};
function paintSky(c3) {
  const g = skyCanvas.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, c3[0]); gr.addColorStop(0.55, c3[1]); gr.addColorStop(1, c3[2]);
  g.fillStyle = gr; g.fillRect(0, 0, 2, 512); skyTex.needsUpdate = true;
}
const mixHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
function updateSun() {
  const date = localDate(2026, st.month, st.day, st.hour);
  const p = sunPosition(date); st.sunAlt = p.alt; st.sunAz = p.az;
  const alt = p.alt, v = sunVec();
  sun.position.copy(v).multiplyScalar(500); sun.target.position.set(0, 0, 0);
  const dayK = clamp(alt / 25), lowK = clamp((alt + 4) / 10);
  sun.intensity = 2.6 * clamp(alt / 6) ; sun.color.set(mixHex('#ff9a55', '#fff3e0', dayK));
  hemi.intensity = 0.5 + 0.75 * lowK; hemi.color.set(mixHex('#6a7cb0', '#e8f0fb', lowK));
  let sky;
  if (alt > 12) sky = SKY.day.map((c, i) => mixHex(SKY.golden[i], c, clamp((alt - 12) / 12)));
  else if (alt > 0) sky = SKY.golden.map((c, i) => mixHex(SKY.dusk[i], c, alt / 12));
  else sky = SKY.dusk.map((c, i) => mixHex(SKY.night[i], c, clamp((alt + 8) / 8)));
  paintSky(sky); scene.fog.color.set(sky[2]);
  st.night = alt < 1;
  const nightK = clamp((1 - alt) / 6);
  flood.intensity = (st.mode === 'concert' ? 0.7 : 1.5) * nightK; flood2.intensity = (st.mode === 'concert' ? 0.35 : 0.6) * nightK;
  W.pylons.lampMat.emissiveIntensity = (st.mode === 'concert' ? 0.35 : 3.5) * nightK; st.nightK = nightK; applyNight();
  W.concert.beams.visible = st.mode === 'concert' && nightK > 0.2;
  renderer.toneMappingExposure = 1.05 + 0.25 * nightK;
  document.body.classList.toggle('night', alt < -2);
  const dim = new THREE.Color(0xffffff).lerp(new THREE.Color(0x5a6684), clamp((2 - alt) / 8)); buildCity.night && buildCity.night(nightK);
  for (const m of W.dimmable) m.color.copy(dim);
  renderer.shadowMap.needsUpdate = true;
  const tms = sunTimes(2026, st.month, st.day); st.rise = tms.rise; st.set = tms.set;
  if (st.heat === 'sun') { clearTimeout(updateSun.t); updateSun.t = setTimeout(computeSunMap, 40); }
  else st.sunCalc = null;
  renderConditions();
  renderPanel();
}

/* ================================================================ colours */
const COL = {
  dry: new THREE.Color(0x0072b2), wet: new THREE.Color(0xe69f00),
  hover: new THREE.Color(0xf3efe4), avail: new THREE.Color(0x3fb8ff), sel: new THREE.Color(0xa8e6a0), hov: new THREE.Color(0xffc233), // Utsikt: Kalk, light green = you, Solsida
  blocked: new THREE.Color(0x17191d), sun: new THREE.Color(0xffc531), shade: new THREE.Color(0x3d5a99), night: new THREE.Color(0x2a3350),
  cat: [null, new THREE.Color(0xcc79a7), new THREE.Color(0x0072b2), new THREE.Color(0x009e73), new THREE.Color(0xe69f00)], // Okabe-Ito
};
const VIEW_STOPS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'].map(c => new THREE.Color(c)); // viridis: colour-blind safe
let VR = [2, 9.5];
function viewColor(v, out) { const x = clamp((v - VR[0]) / (VR[1] - VR[0])) * 4, i = Math.min(3, Math.floor(x)); return out.copy(VIEW_STOPS[i]).lerp(VIEW_STOPS[i + 1], x - i); }
const tmp = new THREE.Color();
function heatColor(s, out) {
  if (st.heat === 'view') return viewColor(s.score, out);
  if (st.heat === 'price') return out.copy(COL.cat[s.block.cat] || COL.blocked);
  if (st.heat === 'roof') return out.copy(s.covered ? COL.dry : COL.wet);
  if (st.heat === 'sun') return out.copy(!st.sunCalc || !st.sunCalc.ready || !s.sun ? s.base : s.sun === 'sun' ? COL.sun : s.sun === 'shade' ? COL.shade : COL.night);
  return out.copy(s.base);
}
function paintBlock(b) {
  const im = b.mesh, c = new THREE.Color();
  for (const s of b.seats) {
    if (s.blocked) c.copy(COL.blocked);
    else {
      heatColor(s, c);
      if (s === st.sel) c.copy(COL.sel);
      else if (st.rowHint && st.rowHint.block === b && s.row === st.rowHint.row) c.copy(COL.hov);
      else if (s === st.hoverSeat) c.copy(COL.hov);
      else if (st.state === 'block' || st.state === 'pov') {
        if (b === st.activeBlock) { if (isTaken(s)) c.copy(COL.taken); else if (st.heat === 'off') c.copy(COL.avail); }
        else if (b === st.hoverBlock) c.lerp(COL.hover, 0.55);
        else c.multiplyScalar(0.55);
      } else if (b === st.hoverBlock) c.lerp(COL.hover, 0.6);
    }
    im.setColorAt(s.local, c);
  }
  im.instanceColor.needsUpdate = true;
}
const paintAll = () => W.blocks.forEach(paintBlock);
const ZERO = new THREE.Vector3(0, 0, 0);
function buildCrowdExtras() {
  const rnd = (() => { let a = 99; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const D = W.crowdSys.data, mounts = [];
  for (const s of W.crowd.seats) {
    if (rnd() > 0.006) continue;
    D.misc[s.person.idx * 4 + 1] = 0; // flag bearers keep arms down
    mounts.push({ pos: s.pos.clone().add(new THREE.Vector3(0, 1.05, 0)).addScaledVector(new THREE.Vector3(s.n.x, 0, s.n.y), -0.15), yaw: Math.atan2(-s.n.x, -s.n.y), phase: rnd(), seat: s });
  }
  W.flags = makeFlags(scene, mounts); W.flagMounts = mounts;
}
function applyStyle() {
  const style = st.mode === 'concert' ? 'concert' : st.crowdStyle;
  W.crowdSys.style(style); W.show.refresh();
  const fk = STYLES[style].flag;
  W.flagsOn = st.mode === 'football' && !!fk; if (fk) W.flags.setKind(fk);
  crowdUniforms.uConcert.value = st.mode === 'concert' ? 1 : 0;
  crowdUniforms.uCheer.value = st.mode === 'concert' ? 0.6 : 0.4;
}
function applyCrowd() {
  const C = W.crowdSys;
  for (const s of W.crowd.seats) C.setVisible(s.person.idx, !(s.blocked || (st.state === 'pov' && s === st.sel) || (st.ticket && !s.taken)));
  const floorOn = st.mode === 'concert';
  for (const p of W.concert.floorCrowd.people) C.setVisible(p.idx, floorOn && !p.hidden);
  C.commit(); C.setEnabled(st.crowdOn);
  W.flags.visible = st.crowdOn && W.flagsOn && !st.ticket;
  W.show.points.visible = st.crowdOn;
  C.update(camera.position, true); W.show.refresh();
}
let hiddenFloor = [];
function hideFloorPeopleNear(pos) {
  restoreFloorPeople();
  if (!pos) return;
  for (const p of W.concert.floorCrowd.people) if (Math.hypot(p.x - pos.x, p.z - pos.z) < 0.9) { p.hidden = true; hiddenFloor.push(p); }
  applyCrowd();
}
function restoreFloorPeople() {
  for (const p of hiddenFloor) p.hidden = false;
  hiddenFloor = [];
}

/* ================================================================ entrances & route */
function currentGate() {
  if (!st.sel) return null;
  if (st.gateOverride) return GATES.find(g => g.id === st.gateOverride) || recommendGate(st.sel);
  return recommendGate(st.sel);
}
function updateRoute() {
  const sel = st.sel;
  if (!sel || (sel.floor && st.mode !== 'concert')) { st.routeInfo = null; W.route.show(null); W.route.highlight(null); drawPlanRoute(null); return; }
  const gate = currentGate(), rec = recommendGate(sel);
  st.routeInfo = { gate, rec, ...buildRoute(sel, gate, eyeOf(sel)) };
  W.route.show(st.routeView ? st.routeInfo : null);
  W.route.highlight(gate); drawPlanRoute(st.routeInfo);
}
function showWayIn() {
  if (!st.routeInfo) return;
  const r = st.routeInfo, pts = [...r.outside, ...r.inside];
  const box = new THREE.Box3().setFromPoints(pts), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 80);
  if (st.state === 'pov') { setState('block'); applyCrowd(); }
  st.routeView = true; W.route.show(r); renderNav();
  const sp = Math.max(span * 1.3, 230); flyTo(c.clone().add(new THREE.Vector3(sp * 0.3, sp * 0.95, sp * 0.5)), c.setY(0), 42, 1700, () => { controls.enabled = true; });
  renderPanel();
}

/* ================================================================ 2D plan */
const SVGNS = 'http://www.w3.org/2000/svg';
function buildPlan() {
  const svg = $('#plan');
  svg.setAttribute('viewBox', '-128 -122 256 244');
  const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  const ring = (r) => `M ${-L} ${r} L ${L} ${r} A ${r} ${r} 0 0 0 ${L} ${-r} L ${-L} ${-r} A ${r} ${r} 0 0 0 ${-L} ${r} Z`;
  // roof outline
  let d = ''; for (let k = 0; k <= 200; k++) { const t = k / 200, r = roofAt(t), p = P(t, r.backEdge, 0); d += (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[2].toFixed(1); }
  el('path', { d: d + 'Z', class: 'p-roof' });
  el('path', { d: ring(46.3), class: 'p-track' });
  el('path', { d: ring(36.5), class: 'p-infield' });
  el('rect', { x: -52.5, y: -34, width: 105, height: 68, class: 'p-pitch', id: 'p-pitch' });
  const stage = el('g', { id: 'p-stage' });
  el('rect', { x: STAGE.back, y: -STAGE.w / 2, width: STAGE.front - STAGE.back, height: STAGE.w, class: 'p-stagebox' }, stage);
  el('text', { x: (STAGE.back + STAGE.front) / 2, y: 2, class: 'p-stagetxt', transform: `rotate(-90 ${(STAGE.back + STAGE.front) / 2} 0)` }, stage).textContent = 'STAGE';
  const floorG = el('g', { id: 'p-floor' });
  el('rect', { x: STAGE.front + 2, y: -32, width: 54 - STAGE.front, height: 64, class: 'p-floor' }, floorG);
  el('text', { x: 10, y: 3, class: 'p-floortxt' }, floorG).textContent = 'PLANEN · standing';
  const g = el('g', { id: 'p-blocks' });
  for (const b of W.blocks) {
    const dd = b.poly.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('') + 'Z';
    b.svg = el('path', { d: dd, class: 'p-block' + (b.unofficial ? ' p-unoff' : ''), 'data-id': b.id }, g);
  }
  const lg = el('g', { id: 'p-labels' });
  for (const b of W.blocks) {
    const c = b.poly.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map(v => v / b.poly.length);
    const t = el('text', { x: c[0].toFixed(1), y: (c[1] + 2).toFixed(1), class: 'p-lbl' + (b.unofficial ? ' p-lbl-u' : '') }, lg);
    t.textContent = b.unofficial ? b.name.replace(/[A-ZÄÖ]+/, '') : b.name;
  }
  el('path', { id: 'p-route', class: 'p-route', d: '' });
  el('path', { id: 'p-route-in', class: 'p-route-in', d: '' });
  const tg = el('g', { id: 'p-tram', class: 'p-tram' }); el('rect', { x: -5, y: -5, width: 10, height: 10, rx: 2.5 }, tg); el('text', { x: 0, y: 2.6 }, tg).textContent = 'T';
  const gg = el('g', { id: 'p-gates' });
  for (const g of GATES) {
    const c = el('g', { class: 'p-gate' + (g.vip ? ' vip' : '') + (g.floor ? ' fl' : ''), transform: `translate(${g.out.x.toFixed(1)} ${g.out.z.toFixed(1)})`, 'data-gate': g.id }, gg);
    el('circle', { r: g.id.length > 2 ? 5.6 : 4.4 }, c);
    el('text', { x: 0, y: g.id.length > 2 ? 1.6 : 1.9, class: g.id.length > 3 ? 'sm' : '' }, c).textContent = g.id === 'PARAD' ? 'P' : g.id === 'SODRA' ? 'S' : g.id;
    g.svg = c;
  }
  el('circle', { id: 'p-you', r: 3.2, cx: 0, cy: 0, class: 'p-you' });
  // compass on the plan
  const n = bearingToScene(0);
  const cg = el('g', { transform: 'translate(108 -96)' });
  el('circle', { r: 9, class: 'p-cmp' }, cg);
  el('path', { d: `M ${n.x * 7} ${n.z * 7} L ${-n.z * 2.4} ${n.x * 2.4} L ${n.z * 2.4} ${-n.x * 2.4} Z`, class: 'p-cmp-n' }, cg);
  el('text', { x: (n.x * 13).toFixed(1), y: (n.z * 13 + 2).toFixed(1), class: 'p-cmp-t' }, cg).textContent = 'N';
  el('text', { x: 0, y: 119, class: 'p-side' }).textContent = 'SKÅNEGATAN';
  el('text', { x: -122, y: 0, class: 'p-side', transform: 'rotate(-90 -122 0)' }).textContent = 'MARATONPORTEN';

  svg.addEventListener('pointermove', (e) => {
    const id = e.target.getAttribute && e.target.getAttribute('data-id');
    setHoverBlock(id != null ? W.blocks[+id] : null, e);
  });
  svg.addEventListener('pointerleave', () => { setHoverBlock(null); gateHover(null); });
  gg.addEventListener('pointerover', (e) => { const c = e.target.closest('[data-gate]'); gateHover(c ? GATES.find(g => g.id === c.dataset.gate) : null, e); });
  gg.addEventListener('pointerout', () => gateHover(null));
  svg.addEventListener('click', (e) => {
    const id = e.target.getAttribute && e.target.getAttribute('data-id');
    if (id != null) { const b = W.blocks[+id]; if (b.blocked) return toast('Behind the stage — not on sale for this concert.'); goBlock(b); }
    else if (e.target.closest && e.target.closest('#p-floor') && st.mode === 'concert') {
      const pt = svgPoint(e); selectFloor(new THREE.Vector3(pt.x, 0, pt.y));
    }
  });
}
function gateHover(g, e) {
  const secs = g ? (g.floor ? [] : g.vip ? [] : sectionsForGate(W.blocks, g)) : [];
  for (const b of W.blocks) b.svg.classList.toggle('gsec', secs.includes(b));
  const tip = $('#tip');
  if (!g) { tip.style.display = 'none'; return; }
  tip.innerHTML = `<b>${g.label}</b><span>${g.note || 'Public entrance'}</span>` + (secs.length ? `<span class="ok">Nearest for: ${secs.filter(b => !b.unofficial).map(b => b.name).join(', ') || secs.map(b => b.title).join(', ')}</span>` : '') + '<span>Your ticket shows your entrance</span>';
  tip.style.display = 'flex'; if (e) { tip.style.left = Math.min(innerWidth - 220, e.clientX + 14) + 'px'; tip.style.top = e.clientY + 14 + 'px'; }
}
function drawPlanRoute(R) {
  const pr = $('#p-route'), pi = $('#p-route-in'), tr = $('#p-tram'); if (!pr) return;
  if (!R) { pr.setAttribute('d', ''); pi.setAttribute('d', ''); tr.style.display = 'none'; GATES.forEach(g => g.svg && g.svg.classList.remove('on')); return; }
  const clampP = (p) => [Math.max(-122, Math.min(122, p.x)), Math.max(-116, Math.min(116, p.z))];
  const path = (pts) => pts.map((p, i) => { const [x, z] = clampP(p); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + z.toFixed(1); }).join('');
  pr.setAttribute('d', path(R.outside)); pi.setAttribute('d', path(R.inside));
  const [tx, tz] = clampP(R.tram.pos); tr.setAttribute('transform', `translate(${tx} ${tz})`); tr.style.display = '';
  GATES.forEach(g => g.svg && g.svg.classList.toggle('on', g === R.gate));
}
function svgPoint(e) { const svg = $('#plan'), p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
function updatePlanColors() {
  for (const b of W.blocks) {
    let fill;
    if (b.blocked) fill = '#2a2d33';
    else if (st.heat === 'view') fill = '#' + viewColor(b.avg, tmp).getHexString();
    else if (st.heat === 'price') fill = '#' + COL.cat[b.cat].getHexString();
    else if (st.heat === 'roof') { const k = b.seats.filter(s => s.covered).length / b.seats.length; fill = '#' + COL.wet.clone().lerp(COL.dry, k).getHexString(); }
    else if (st.heat === 'sun' && st.sunCalc && st.sunCalc.ready) {
      const k = b.seats.filter(s => s.sun === 'sun').length / b.seats.length;
      fill = '#' + COL.shade.clone().lerp(COL.sun, k).getHexString();
    } else fill = null;
    b.svg.style.fill = fill || '';
    b.svg.classList.toggle('on', b === st.activeBlock);
    b.svg.classList.toggle('hov', b === st.hoverBlock);
    b.svg.classList.toggle('blk', !!b.blocked);
  }
  $('#p-stage').style.display = st.mode === 'concert' ? '' : 'none';
  $('#p-floor').style.display = st.mode === 'concert' ? '' : 'none';
  $('#p-pitch').style.display = st.mode === 'concert' ? 'none' : '';
  const you = $('#p-you');
  if (st.state !== 'overview') W.blocks.forEach(b => b.svg.classList.remove('gsec'));
  if (st.sel) { you.setAttribute('cx', st.sel.pos.x); you.setAttribute('cy', st.sel.pos.z); you.style.display = ''; } else you.style.display = 'none';
}

/* ================================================================ camera */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.07; controls.maxPolarAngle = 1.42;
controls.minDistance = 25; controls.maxDistance = 1300; controls.enabled = false; controls.enablePan = false;
controls.autoRotateSpeed = 0.28;
controls.addEventListener('start', () => { controls.autoRotate = false; });
let flight = null;
function flyTo(pos, tgt, fov, ms, done, arc = 1) {
  controls.enabled = false;
  flight = { p0: camera.position.clone(), t0: controls.target.clone(), f0: camera.fov, p1: pos, t1: tgt, f1: fov, s: performance.now(), ms, done, arc };
}
const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const OVERVIEW = { pos: new THREE.Vector3(150, 195, 330), tgt: new THREE.Vector3(-2, 0, 26) };
function blockPose(b) {
  const c = b.center, h = new THREE.Vector2(-c.x * 0.75, -c.z).normalize();
  const covered = b.seats.some(s => s.covered);
  const k = camera.aspect < 1 ? 1.6 : 1;
  const pos = new THREE.Vector3(c.x + h.x * 52 * k, c.y + (covered ? 12 : 24) * k, c.z + h.y * 52 * k);
  return { pos, tgt: c.clone().add(new THREE.Vector3(0, -1, 0)) };
}
let povYaw = 0, povPitch = 0;
const povBase = new THREE.Vector3();
function povDir() {
  const yb = Math.atan2(povBase.x, povBase.z), pb = Math.asin(clamp(povBase.y, -1, 1));
  const fw = Math.max(0, Math.cos(povYaw)), y = yb + povYaw, p = clamp(pb * fw + 0.12 * (1 - fw) + povPitch, -1.25, 1.2);
  return new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
}

/* ================================================================ navigation */
function setState(s) { document.body.classList.toggle('has-sel', false); if (s !== 'overview' && s !== 'intro') controls.autoRotate = false; if (s !== 'pov') setSpin(false); st.state = s; st.routeView = false; if (W.route) W.route.show(null); document.body.dataset.state = s; if (innerWidth <= 860) layoutCamera(); }
function goOverview() {
  setState('overview'); st.activeBlock = null; st.sel = null; st.hoverSeat = null; st.rowHint = null;
  restoreFloorPeople(); applyCrowd(); paintAll(); updatePlanColors(); setHash(''); updateRoute();
  const o = overviewPose(); flyTo(o.pos, o.tgt, 42, 1600, () => { controls.enabled = true; });
  renderPanel();
}
function overviewPose() {
  if (camera.aspect < 1) return { pos: new THREE.Vector3(120, 640, 860), tgt: new THREE.Vector3(0, 0, -45) };
  const k = camera.aspect < 1.3 ? 1.3 : 1;
  return { pos: OVERVIEW.tgt.clone().add(OVERVIEW.pos.clone().sub(OVERVIEW.tgt).multiplyScalar(k)), tgt: OVERVIEW.tgt.clone() };
}
function goBlock(b, keepSel = false) {
  if (st.pickBlock !== b) { st.pickRow = null; st.pickBlock = b; }
  if (st.rowHint && st.rowHint.block === b) st.pickRow = st.rowHint.row;
  const fromPov = st.state === 'pov';
  const prevActive = st.activeBlock;
  setState('block'); st.activeBlock = b; if (!keepSel) st.sel = null;
  restoreFloorPeople(); applyCrowd(); paintAll(); updatePlanColors(); updateRoute();
  const p = blockPose(b);
  flyTo(p.pos, p.tgt, 42, fromPov ? 1300 : 1500, () => { controls.enabled = true; });
  if (!keepSel) setHash('');
  renderPanel();
}
function selectSeat(s) {
  if (s.blocked) return toast('Not on sale for this event — the stage is in the way.');
  const prev = st.sel; st.sel = s; st.rowHint = null;
  if (prev && prev.block && prev.block !== s.block) paintBlock(prev.block);
  st.gateOverride = null; st.routeView = false; updateRoute();
  paintBlock(s.block); updatePlanColors(); renderPanel(); syncPicker(); revealTicket();
}
function revealTicket() {
  if (innerWidth > 860) return;
  if (document.body.classList.contains('sheet-min')) setSheet(true);
  requestAnimationFrame(() => {
    const sc = $('#panel .scroll'), t = $('#ctx .ticket'), btn = t && t.querySelector('.pov-in');
    if (!sc || !t) return;
    const box = sc.getBoundingClientRect(), toCard = t.getBoundingClientRect().top - box.top - 12;
    const toButton = btn ? btn.getBoundingClientRect().bottom - box.bottom + 12 : toCard;
    sc.scrollTo({ top: sc.scrollTop + Math.max(toCard, toButton), behavior: 'smooth' });
  });
}
function selectFloor(pos) {
  pos.x = clamp(pos.x, STAGE.front + 3, 54); pos.z = clamp(pos.z, -31, 31);
  if (Math.abs(pos.z) < 5 && pos.x < STAGE.front + 25) pos.z = 5.5 * Math.sign(pos.z || 1);
  const prev = st.sel; st.sel = { floor: true, pos, block: null, n: null };
  if (prev && prev.block) paintBlock(prev.block);
  if (st.state !== 'pov') setState(st.state === 'overview' ? 'block' : st.state);
  st.activeBlock = null; st.gateOverride = null; updateRoute(); paintAll(); updatePlanColors(); renderPanel(); revealTicket();
  if (st.state === 'block') { const c = pos.clone(); flyTo(new THREE.Vector3(c.x + 45, 30, c.z + 40), c, 42, 1300, () => { controls.enabled = true; }); }
}
function goPov(sel, quick = false) {
  st.sel = sel; if (sel.block) st.activeBlock = sel.block;
  setState('pov'); povYaw = 0; povPitch = 0; st.rowHint = null;
  const eye = eyeOf(sel); povBase.copy(target()).sub(eye).normalize();
  if (sel.floor) hideFloorPeopleNear(sel.pos); else restoreFloorPeople();
  applyCrowd(); paintAll(); updatePlanColors(); if (!st.routeInfo || st.routeSel !== sel) { st.routeSel = sel; updateRoute(); } W.route.show(null);
  flyTo(eye, eye.clone().add(povDir().multiplyScalar(40)), 60, quick ? 450 : 2100, null, quick ? 0 : 0.3);
  setHash(hashFor(sel));
  renderPanel();
}
function stepSeat(dx, dr) {
  const s = st.sel; if (!s || s.floor) {
    if (s && s.floor) { const p = s.pos.clone(); p.x += dr * -2; p.z += dx * 2; selectFloor(p); if (st.state === 'pov') goPov(st.sel, true); }
    return;
  }
  const b = s.block; let t = null;
  if (dx) { const row = b.rows[s.rowIdx]; t = row[row.indexOf(s) + dx] || null; }
  else { const row = b.rows[s.rowIdx + dr]; if (row) t = row.reduce((a, x) => x.pos.distanceTo(s.pos) < a.pos.distanceTo(s.pos) ? x : a); }
  if (!t) return toast(dx ? 'End of the row — try the next section.' : dr > 0 ? 'That is the back row of this section.' : 'That is the front row of this section.');
  if (t.blocked) return toast('Not on sale for this event.');
  if (st.state === 'pov') goPov(t, true); else selectSeat(t);
}

/* ================================================================ ticket mode */
function setTicket(on) {
  st.ticket = on;
  document.body.classList.toggle('ticket', on);
  $('#tmode').checked = on;
  if (!on && st.heat === 'price') setHeat('off');
  applyCrowd(); paintAll(); updatePlanColors(); renderPanel(); updateHeatNote();
  toast(on ? 'Ticket mode (demo): simulated availability and prices. People on seats = sold.' : 'Seat view: every seat is open to preview. The crowd is just match-day atmosphere.');
}

/* ================================================================ quick picks */
function pickBest(kind) {
  let pool = W.seats.filter(s => !isTaken(s) && !s.blocked), why = '';
  if (kind === 'shade') {
    if (st.sunKey !== st.month + ':' + st.hour) computeSunSync();
    if (st.sunAlt <= 0) { why = 'The sun is down, so every seat is in the shade. Here is the best view.'; }
    else { pool = pool.filter(s => s.sun === 'shade'); why = `Best view that is in the shade at ${fmtTime(st.hour)}.`; }
  } else if (kind === 'roof') { pool = pool.filter(s => s.covered); why = 'Best view with a roof over your head.'; }
  else if (kind === 'value') why = 'Most view per krona: highest score relative to the price category (demo prices).';
  else if (kind === 'close') why = st.mode === 'concert' ? 'The seat closest to the stage that still faces it.' : 'The seat closest to the centre spot.';
  else why = st.ticket ? 'The highest-scoring free seat for this event.' : 'The highest-scoring seat in the stadium for this event.';
  if (!pool.length) return toast('No free seats match that right now.');
  if (kind === 'close') pool = pool.filter(s => !s.restricted);
  const tgtP = target();
  const val = (s) => kind === 'value' ? s.score / s.block.price * 1000 + s.score * 0.05 : kind === 'close' ? -eyeOf(s).distanceTo(tgtP) : s.score;
  const best = pool.reduce((a, s) => val(s) > val(a) ? s : a);
  st.sel = best; goBlock(best.block, true); selectSeat(best); toast(why);
}

/* ================================================================ seat search */
const RKEY = 'ullevi-seatview-recent';
function recent() { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch (e) { return []; } }
function pushRecent(s) {
  try {
    const r = recent().filter(x => !(x.n === s.block.name && x.r === s.row && x.s === s.num));
    r.unshift({ n: s.block.name, r: s.row, s: s.num }); localStorage.setItem(RKEY, JSON.stringify(r.slice(0, 4)));
  } catch (e) { /* storage unavailable */ }
}
function goToSeat(s) {
  pushRecent(s);
  st.activeBlock = s.block; st.sel = s; st.rowHint = null;
  if (s.blocked) toast('This seat is behind the stage at concerts. Showing the view anyway.');
  goPov(s); syncPicker();
}
function runAction(a) {
  closeSearch();
  if (!a) return;
  if (a.gate) { const g = a.gate; goOverview(); setTimeout(() => { flyTo(g.out.clone().multiplyScalar(1.9).setY(110), g.out.clone(), 42, 1500, () => { controls.enabled = true; }); W.route.highlight(g); for (const b of W.blocks) b.svg.classList.toggle('gsec', sectionsForGate(W.blocks, g).includes(b)); }, 50); toast(`${g.label}: sections highlighted on the plan are closest to it. Your ticket shows your actual entrance.`); return; }
  if (a.floor) { selectFloor(new THREE.Vector3(-8, 0, 6)); goPov(st.sel); return; }
  if (a.seat) return goToSeat(a.seat);
  if (a.row) { st.rowHint = { block: a.block, row: a.row }; goBlock(a.block); toast(`Row ${a.row} is highlighted in yellow. Click your seat, or type its number.`); syncPicker(a.block, a.row); return; }
  if (a.block) { goBlock(a.block); syncPicker(a.block); }
}
let qItems = [], qActive = 0;
function renderSearch() {
  const q = $('#q'), box = $('#qres'), val = q.value.trim();
  const focused = document.activeElement === q;
  if (!focused && !val) { box.innerHTML = ''; box.classList.remove('open'); return; }
  let html = '';
  if (!val) {
    const rec = recent().map(r => { const b = W.blocks.find(x => x.name === r.n); const seat = b && b.rows[r.r - 1] && b.rows[r.r - 1].find(x => x.num === r.s); return seat ? { kind: 'recent', title: `Section ${r.n} · Row ${r.r} · Seat ${r.s}`, sub: 'Recent', ok: true, action: { seat } } : null; }).filter(Boolean);
    qItems = rec;
    html += `<div class="q-help"><b>Type what's on your ticket</b><span>Section, row and seat. Swedish works too: <i>sektion A rad 12 plats 8</i></span>
      <div class="q-ex">${['A 12 8', 'N 21 5', 'Ä 3 14', 'C 14 32'].concat(st.mode === 'concert' ? ['Planen'] : []).map(e => `<button data-ex="${e}">${e}</button>`).join('')}</div></div>`;
  } else {
    const gm = val.match(/^\s*(?:entr[eé]e?|ing[aå]ng|gate|port(?:en)?|entrance)\s*(\d{1,2})/i) || (/^\s*parad/i.test(val) ? [0, 'PARAD'] : null);
    if (gm) {
      const g = GATES.find(x => x.id === gm[1] || x.id.split('/').includes(gm[1]));
      qItems = g ? [{ kind: 'gate', title: g.label + (g.note ? ' · ' + g.note : ''), sub: g.vip || g.floor ? 'Show on the map' : 'Nearest for sections ' + sectionsForGate(W.blocks, g).filter(b => !b.unofficial).map(b => b.name).join(', '), ok: true, action: { gate: g } }]
        : [{ kind: 'info', title: `No entrance ${gm[1]}`, sub: 'Ullevi entrances are numbered 1–10' }];
    } else qItems = suggest(parseQuery(val, W.blocks), W.blocks, { mode: st.mode });
  }
  qActive = Math.max(0, qItems.findIndex(i => i.primary)) || 0;
  if (qItems[qActive] && !qItems[qActive].ok) qActive = qItems.findIndex(i => i.ok);
  const ic = { gate: 'door', seat: 'seat', recent: 'clock', row: 'rows', section: 'grid', floor: 'person', error: 'alert', info: 'alert' };
  html += qItems.map((it, i) => `<div class="q-item ${it.ok ? '' : 'q-bad'} ${i === qActive ? 'act' : ''} ${it.primary ? 'prim' : ''}" data-i="${i}">
      <span class="q-ic">${icon(ic[it.kind] || 'grid')}</span><div><b>${it.title}</b><span>${it.sub || ''}</span></div>${it.ok ? `<em>${it.kind === 'seat' || it.kind === 'recent' || it.kind === 'floor' ? 'View ↵' : 'Open ↵'}</em>` : ''}</div>`).join('');
  if (val) html += `<div class="q-foot">Seat numbers follow this model and may differ slightly from your ticket.</div>`;
  box.innerHTML = html; box.classList.toggle('open', !!html);
  box.querySelectorAll('.q-item').forEach(el => {
    el.onmousedown = (e) => { e.preventDefault(); const it = qItems[+el.dataset.i]; if (it.ok) runAction(it.action); };
  });
  box.querySelectorAll('[data-ex]').forEach(el => el.onmousedown = (e) => { e.preventDefault(); q.value = el.dataset.ex; renderSearch(); });
}
function closeSearch() { const q = $('#q'); q.value = ''; q.blur(); renderSearch(); }
function initSearch() {
  const q = $('#q');
  q.addEventListener('input', renderSearch);
  q.addEventListener('focus', renderSearch);
  q.addEventListener('blur', () => setTimeout(renderSearch, 120));
  q.addEventListener('keydown', (e) => {
    const okIdx = qItems.map((it, i) => it.ok ? i : -1).filter(i => i >= 0);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!okIdx.length) return;
      const k = okIdx.indexOf(qActive), n = (k + (e.key === 'ArrowDown' ? 1 : -1) + okIdx.length) % okIdx.length; qActive = okIdx[n];
      document.querySelectorAll('.q-item').forEach(el => el.classList.toggle('act', +el.dataset.i === qActive));
    } else if (e.key === 'Enter') { e.preventDefault(); const it = qItems[qActive]; if (it && it.ok) runAction(it.action); }
    else if (e.key === 'Escape') { closeSearch(); }
  });
  addEventListener('keydown', (e) => {
    if ((e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); q.focus(); }
  });
  // pick-from-lists
  const ps = $('#ps'), pr = $('#pr'), pt = $('#pt');
  const groups = {};
  for (const b of W.blocks) (groups[b.stand] = groups[b.stand] || []).push(b);
  ps.innerHTML = '<option value="">Section</option>' + Object.entries(groups).map(([g, list]) => `<optgroup label="${g}">${list.sort((a, b) => (a.unofficial - b.unofficial) || a.name.localeCompare(b.name, 'sv')).map(b => `<option value="${b.id}">${b.unofficial ? b.title : b.name + (b.tier === 'U' ? ' · upper' : ' · lower')}</option>`).join('')}</optgroup>`).join('');
  const fillRows = () => { const b = W.blocks[+ps.value]; pr.innerHTML = '<option value="">Row</option>' + (b ? b.rows.map((r, i) => `<option value="${i + 1}">Row ${i + 1}</option>`).join('') : ''); pr.disabled = !b; fillSeats(); };
  const fillSeats = () => { const b = W.blocks[+ps.value], row = b && pr.value ? b.rows[+pr.value - 1] : null; pt.innerHTML = '<option value="">Seat</option>' + (row ? row.map(s => `<option value="${s.num}">Seat ${s.num}</option>`).join('') : ''); pt.disabled = !row; $('#pgo').disabled = !(row && pt.value); };
  ps.onchange = fillRows; pr.onchange = fillSeats; pt.onchange = () => { $('#pgo').disabled = !pt.value; };
  $('#pgo').onclick = () => { const b = W.blocks[+ps.value], row = b.rows[+pr.value - 1], s = row.find(x => x.num === +pt.value); if (s) goToSeat(s); };
  $('#qlist').onclick = () => { const el = $('#qpick'); el.hidden = !el.hidden; $('#qlist').classList.toggle('on', !el.hidden); if (!el.hidden) syncPicker(); };
  W.fillRows = fillRows; W.fillSeats = fillSeats;
}
function syncPicker(block, row) {
  const ps = $('#ps'); if (!ps || !W.fillRows) return;
  const s = st.sel && !st.sel.floor ? st.sel : null;
  const b = block || (s && s.block) || st.activeBlock; if (!b) return;
  ps.value = b.id; W.fillRows();
  const r = row || (s && s.block === b ? s.row : null);
  if (r) { $('#pr').value = r; W.fillSeats(); }
  if (s && s.block === b && !row) { $('#pt').value = s.num; $('#pgo').disabled = false; }
}

/* ================================================================ hash links */
const enc = (n) => n.replace(/Ä/g, 'AE').replace(/Ö/g, 'OE');
function hashFor(sel) {
  if (sel.floor) return `${st.mode}-floor-${Math.round(sel.pos.x)}-${Math.round(sel.pos.z)}`.replace(/--/g, '-n');
  return `${st.mode}-${enc(sel.block.name)}-${sel.tier}-${sel.row}-${sel.num}`;
}
function setHash(h) { try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { /* ignore */ } }
function openHash() {
  const h = decodeURIComponent(location.hash.slice(1)); if (!h) return false;
  const parts = h.split('-'); const mode = parts[0];
  if (!EVENTS[mode]) return false;
  setMode(mode, true);
  if (parts[1] === 'floor') {
    const num = (v) => v && v[0] === 'n' ? -(+v.slice(1)) : +v;
    selectFloor(new THREE.Vector3(num(parts[2]), 0, num(parts[3]))); goPov(st.sel); return true;
  }
  const [name, tier, row, num] = [parts[1], parts[2], +parts[3], +parts[4]];
  const b = W.blocks.find(b => enc(b.name) === name && b.tier === tier); if (!b) return false;
  const s = b.seats.find(s => s.row === row && s.num === num); if (!s) return false;
  st.sel = s; st.activeBlock = b; goPov(s); return true;
}

/* ================================================================ modes */
function setMode(m, silent) {
  st.mode = m; const ev = EVENTS[m];
  st.month = ev.month; st.day = ev.day; st.hour = ev.hour;
  W.football.visible = m === 'football'; W.concert.group.visible = m === 'concert';
  W.floor.mesh.material.map = W.floor.tex[m]; W.floor.mesh.material.needsUpdate = true;
  computeScores();
  if (st.sel && !st.sel.floor && st.sel.blocked) { st.sel = null; if (st.state === 'pov') goBlock(st.activeBlock); }
  if (st.sel && st.sel.floor && m !== 'concert') { st.sel = null; restoreFloorPeople(); if (st.state === 'pov') goOverview(); }
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  document.body.dataset.mode = m;
  applyStyle(); applyCrowd(); paintAll(); updateSun(); updatePlanColors(); updateRoute();
  if (st.state === 'pov' && st.sel) { povBase.copy(target()).sub(eyeOf(st.sel)).normalize(); povYaw = 0; povPitch = 0; setHash(hashFor(st.sel)); }
  renderPanel();
  if (!silent) toast(m === 'concert' ? 'Concert layout: stage at the Maratonporten end, standing floor on the pitch.' : 'Football layout: every seat scored against the centre spot.');
}

/* ================================================================ picking */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const objs = W.blocks.map(b => b.mesh); if (st.mode === 'concert') objs.push(W.floorPick);
  const hit = ray.intersectObjects(objs, false)[0];
  if (!hit) return null;
  if (hit.object === W.floorPick) return { floor: hit.point };
  const b = hit.object.userData.block; return { block: b, seat: b.seats[hit.instanceId] };
}
function setHoverBlock(b, e) {
  if (b === st.hoverBlock) { if (e) moveTip(e, b); return; }
  const old = st.hoverBlock; st.hoverBlock = b;
  if (old) paintBlock(old); if (b) paintBlock(b);
  updatePlanColors();
  if (b && e) moveTip(e, b); else if (!b) $('#tip').style.display = 'none';
}
function moveTip(e, b, seat) {
  const tip = $('#tip');
  let h;
  if (seat) {
    h = `<b>Row ${seat.row} · Seat ${seat.num}</b>` + (st.ticket ? `<span class="${isTaken(seat) || seat.blocked ? 'bad' : 'ok'}">${seat.blocked ? 'Not on sale' : isTaken(seat) ? 'Taken (demo)' : 'Available · ' + b.price + ' kr (demo)'}</span>` : `<span class="${seat.blocked ? 'bad' : 'ok'}">${seat.blocked ? 'Behind the stage' : 'View ' + seat.score.toFixed(1) + ' · click to select'}</span>`);
  } else if (b) {
    h = `<b>${secName(b)}</b><span>${b.stand}</span>` + (b.blocked ? '<span class="bad">Behind stage · not on sale</span>' : st.ticket ? `<span class="ok">${b.free} free · Kat ${b.cat} · ${b.price} kr</span>` : `<span class="ok">${b.rows.length} rows · view ${b.avg.toFixed(1)}</span>`);
  } else return;
  tip.innerHTML = h; tip.style.display = 'flex';
  tip.style.left = Math.min(innerWidth - 200, e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 16) + 'px';
}
const secName = (b) => b.unofficial ? b.title : b.title + (b.tier === 'U' ? ' · upper' : ' · lower');
let lastMove = 0, down = null, povDrag = null;
canvas.addEventListener('pointermove', (e) => {
  if (st.state === 'pov') {
    if (povDrag && !flight) {
      const k = camera.fov / 60 * 0.0052;
      povYaw = povDrag.yaw - (e.clientX - povDrag.x) * k;
      povPitch = clamp(povDrag.pitch + (e.clientY - povDrag.y) * k, -1.15, 1.1);
    }
    return;
  }
  if (st.state === 'intro' || flight || e.buttons) return;
  const now = performance.now(); if (now - lastMove < 45) return; lastMove = now;
  const h = pick(e);
  const nb = h && h.block ? h.block : null;
  const ns = st.state === 'block' && h && h.block === st.activeBlock ? h.seat : null;
  if (ns !== st.hoverSeat) { const o = st.hoverSeat; st.hoverSeat = ns; if (o) paintBlock(o.block); if (ns) paintBlock(ns.block); }
  setHoverBlock(nb && nb !== st.activeBlock ? nb : (ns ? null : (nb === st.activeBlock ? null : nb)), e);
  if (ns) moveTip(e, ns.block, ns);
  else if (nb && nb === st.activeBlock) $('#tip').style.display = 'none';
  if (h && h.floor && st.mode === 'concert') { const tip = $('#tip'); tip.innerHTML = '<b>Planen · standing floor</b><span>Click to stand here</span>'; tip.style.display = 'flex'; tip.style.left = e.clientX + 16 + 'px'; tip.style.top = e.clientY + 16 + 'px'; }
  else if (!h) $('#tip').style.display = 'none';
  canvas.style.cursor = h ? 'pointer' : 'grab';
});
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
  if (st.state === 'pov') { canvas.setPointerCapture(e.pointerId); setSpin(false); povDrag = { x: e.clientX, y: e.clientY, yaw: povYaw, pitch: povPitch }; }
});
canvas.addEventListener('pointerup', (e) => {
  const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6; down = null; povDrag = null;
  if (!click || flight || st.state === 'pov' || st.state === 'intro') return;
  const h = pick(e); if (!h) return;
  $('#tip').style.display = 'none';
  if (h.floor) return selectFloor(h.floor.clone());
  if (st.state === 'overview' || h.block !== st.activeBlock) {
    if (h.block.blocked) return toast('Behind the stage — not on sale for this concert.');
    setHoverBlock(null); return goBlock(h.block);
  }
  const s = h.seat;
  if (s.blocked) return toast('Not on sale for this event.');
  if (isTaken(s)) return toast(`Row ${s.row}, seat ${s.num} is taken (demo data). Pick a highlighted blue seat.`);
  selectSeat(s);
});
canvas.addEventListener('dblclick', () => { if (st.sel && st.state === 'block') goPov(st.sel); });
canvas.addEventListener('wheel', (e) => {
  if (st.state !== 'pov' || flight) return; e.preventDefault();
  camera.fov = clamp(camera.fov + e.deltaY * 0.03, 10, 75); camera.updateProjectionMatrix();
  const z = $('#zoomv'); if (z) z.textContent = (60 / camera.fov).toFixed(1) + '×';
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (k && st.sel) { e.preventDefault(); stepSeat(k[0], k[1]); }
  if (e.key === 'Escape') goBack();
  if (e.key === 'Enter' && st.sel && st.state === 'block') goPov(st.sel);
});

/* ================================================================ UI */
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
function dateLabel() { const d = new Date(Date.UTC(2026, st.month - 1, st.day)); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${st.day} ${MONTHS[st.month - 1]}`; }
function gauge(v) {
  const r = 26, c = 2 * Math.PI * r, k = v / 10, saved = VR; VR = [2, 9.5]; const col = '#' + viewColor(v, tmp).getHexString(); VR = saved;
  return `<svg class="gauge" viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" class="g-bg"/><circle cx="32" cy="32" r="${r}" class="g-fg" style="stroke:${col};stroke-dasharray:${c * k} ${c}"/><text x="32" y="37">${v.toFixed(1)}</text></svg>`;
}
function insightRows(sel) {
  const r = scoreSeat(sel), rows = [];
  const tgt = st.mode === 'football' ? 'centre spot' : 'stage';
  rows.push(['ruler', `Distance to ${tgt}`, `${Math.round(r.dist)} m`]);
  if (st.mode === 'concert') {
    rows.push(['angle', 'Angle to stage', sel.floor ? 'Straight on' : `${Math.round(r.theta)}°${r.restricted ? ' · side view' : ''}`]);
    rows.push(['person', 'Artist looks like', `${(600 * 1.8 / r.dist).toFixed(0)} mm at arm's length`]);
  } else {
    rows.push(['angle', 'Position', Math.abs(sel.n.y) > 0.9 ? 'Long side' : Math.abs(sel.n.y) > 0.5 ? 'Corner' : 'Behind the goal']);
  }
  if (!sel.floor) rows.push(['height', 'Eye height above pitch', `${(sel.pos.y + 1.2).toFixed(1)} m`]);
  rows.push(['roof', 'Rain cover', sel.floor ? 'Open air' : sel.covered ? 'Under the roof' : 'Open sky']);
  const sv = sel.floor ? (st.sunAlt > 0 ? 'sun' : 'night') : seatSun(sel);
  let sunTxt = sv === 'night' ? 'After sunset · floodlights' : sv === 'sun' ? 'In the sun' : 'In the shade';
  if (sv === 'sun') {
    const v = sunVec(), look = target().clone().sub(eyeOf(sel)); look.y = 0; look.normalize();
    const hz = new THREE.Vector3(v.x, 0, v.z).normalize();
    if (st.sunAlt < 28 && look.dot(hz) > 0.55) sunTxt += ' · low sun in your eyes';
  }
  rows.push(['sun', `At ${fmtTime(st.hour)}`, sunTxt]);
  return { r, rows };
}
const ICONS = {
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
  angle: '<path d="M4 20h16M4 20 16 6"/><path d="M10 20a6 6 0 0 0-2-4.5"/>',
  person: '<circle cx="12" cy="6" r="3"/><path d="M6 21v-4a6 6 0 0 1 12 0v4"/>',
  height: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
  roof: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  seat: '<path d="M6 4v9h12V4"/><path d="M4 13h16v3H4zM6 16v4M18 16v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  rows: '<path d="M3 7h18M3 12h18M3 17h18"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  door: '<path d="M5 21V4h11v17M3 21h18"/><circle cx="13" cy="12.5" r=".9"/>',
  tram: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 20l-2 2M15 20l2 2M8 16l-1 4M16 16l1 4"/><circle cx="9" cy="13" r=".7"/><circle cx="15" cy="13" r=".7"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M10 21l2-6-3-3 1-4 4 2 2 3M12 15l3 6"/>',
  stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  spin: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>', chevL: '<path d="M15 5l-7 7 7 7"/>',
  people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3a4.5 4.5 0 0 1 4.5 4.5V20M15 14.2h1.5A3.5 3.5 0 0 1 20 17.7V20"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  shade: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" class="ic">${ICONS[k]}</svg>`;
function goBack() {
  if (flight) flight = null; // never ignore a Back press
  if (st.routeView && st.sel) { st.routeView = false; W.route.show(null); if (st.sel.floor) goOverview(); else goBlock(st.activeBlock, true); return; }
  if (st.state === 'pov') { if (st.sel && st.sel.floor) goOverview(); else goBlock(st.activeBlock, true); return; }
  if (st.state === 'block' && st.sel && !st.sel.floor) { st.sel = null; st.routeInfo = null; drawPlanRoute(null); W.route.highlight(null); paintBlock(st.activeBlock); updatePlanColors(); renderPanel(); setHash(''); return; }
  goOverview();
}
function renderNav() {
  const n = $('#navbar'); if (!n) return;
  if (st.state === 'overview' || st.state === 'intro') { n.innerHTML = ''; return; }
  const s = st.sel, b = st.activeBlock;
  const t1 = s && s.floor ? 'Planen' : b ? `Section ${b.name}` : 'Ullevi';
  const t2 = st.routeView ? 'Your way in' : s && s.floor ? 'Standing floor' : s ? `Row ${s.row} · Seat ${s.num}` : b ? `${b.tier === 'U' ? 'Upper' : 'Lower'} tier · rows 1–${b.rows.length}` : '';
  n.innerHTML = `<button class="nb" data-nav="back" title="Back (Esc)">${icon('back')}Back</button>
    <div class="ntitle"><b ${s && b && !s.floor ? 'data-nav="block" title="Open section ' + b.name + '"' : ''}>${t1}</b><span>${t2}</span></div>
    <button class="nb home" data-nav="home" title="Start over: all sections">${icon('home')}</button>`;
  n.querySelectorAll('[data-nav]').forEach(el => el.onclick = () => {
    const a = el.dataset.nav;
    if (a === 'back') goBack(); else if (a === 'home') goOverview(); else if (a === 'block' && b) { st.sel = null; st.routeInfo = null; drawPlanRoute(null); goBlock(b); }
  });
}
function renderSteps() {
  const i = st.state === 'pov' ? 3 : st.sel ? 2 : st.state === 'block' ? 2 : 1;
  $('#steps').innerHTML = ['Pick a section', 'Pick a seat', 'See your view'].map((t, k) => `<div class="step ${k + 1 < i ? 'done' : ''} ${k + 1 === i ? 'cur' : ''}" data-step="${k + 1}" ${k + 1 < i ? 'title="Go back to this step"' : ''}><i>${k + 1 < i ? '✓' : k + 1}</i><span>${t}</span></div>`).join('');
  $('#steps').querySelectorAll('.step.done').forEach(el => el.onclick = () => {
    const k = +el.dataset.step;
    if (k === 1) goOverview();
    else if (k === 2 && st.activeBlock) { if (st.state === 'pov' || st.routeView) goBlock(st.activeBlock, true); }
  });
  renderNav();
}
function wayInCard() {
  const R = st.routeInfo; if (!R) return '';
  const s = st.sel, g = R.gate, isRec = g === R.rec;
  const why = st.gateOverride ? 'From your ticket' : g.access ? 'Wheelchair seats · lift up to section U' : g.floor ? 'Entrance to Planen (standing floor)' : `Nearest public entrance to section ${s.block.name}`;
  const inside = s.floor ? 'Walk straight out onto <b>Planen</b>' : `Inside, follow the signs to <b>section ${s.block.name}</b>${s.tier === 'U' ? ' (upper tier)' : ''}, then row ${s.row}`;
  return `<div class="wayin">
    <div class="wi-head"><span class="wi-badge">${g.id.length > 3 ? icon('door') : g.id}</span><div><span class="kicker">Your way in</span><b>${g.label}</b><small>${why}${g.note && !g.access && !g.floor ? ' · ' + g.note : ''}</small></div><em><b>${R.minutes}</b> min<br><small>${R.meters} m</small></em></div>
    <ol class="wi-steps">
      <li>${icon('tram')}<span>Tram to <b>${R.tram.name}</b></span></li>
      <li>${icon('walk')}<span>Walk ${R.outsideM} m to <b>${g.label}</b></span></li>
      <li>${icon('stairs')}<span>${inside}</span></li>
    </ol>
    <label class="wi-ticket"><span>Entrance on your ticket</span><select id="gsel"><option value="">Auto · nearest (${R.rec.label})</option>${GATES.filter(x => !x.floor || s.floor).map(x => `<option value="${x.id}" ${st.gateOverride === x.id ? 'selected' : ''}>${x.label}${x.note ? ' · ' + x.note : ''}</option>`).join('')}</select></label>
    <p class="wi-note">${isRec ? 'Got Event prints the entrance on every ticket and it can change per event. Your ticket always wins.' : `Your ticket says ${g.label}. The nearest entrance would be ${R.rec.label}.`}</p>
    <button class="route" data-act="route">${icon('route')}Show my way in on the map</button>
  </div>`;
}
function sectionChips() {
  const order = ['Skånegatan side (SW)', 'Paradentrén side (NE)', 'North-west end', 'South-east end'];
  const groups = {};
  for (const b of W.blocks) (groups[b.stand] = groups[b.stand] || []).push(b);
  return `<div class="pick"><span class="c-lbl">Pick a section</span><select class="dd" id="ddsec"><option value="">Choose section…</option>` + order.filter(g => groups[g]).map(g =>
    `<optgroup label="${g}">` + groups[g].sort((a, c) => (a.unofficial - c.unofficial) || a.name.localeCompare(c.name, 'sv')).map(b =>
      `<option value="${b.id}" ${b.blocked ? 'disabled' : ''}>${b.unofficial ? b.title : 'Section ' + b.name + ' · ' + (b.tier === 'U' ? 'upper' : 'lower')}${b.blocked ? ' (behind stage)' : ''}</option>`).join('') + '</optgroup>').join('') + `</select></div>`;
}
function rowSeatChips(b) {
  const r = st.pickRow && st.pickBlock === b ? st.pickRow : null;
  const row = r ? b.rows[r - 1] : null;
  return `<div class="ddrow">
    <label class="pick"><span class="c-lbl">Row</span><select class="dd" id="ddrow"><option value="">Row…</option>${b.rows.map((rw, i) => `<option value="${i + 1}" ${r === i + 1 ? 'selected' : ''}>Row ${i + 1}${i === 0 ? ' (front)' : ''}${rw.some(x => x.covered) ? ' · roof' : ''}</option>`).join('')}</select></label>
    <label class="pick"><span class="c-lbl">Seat</span><select class="dd" id="ddseat" ${row ? '' : 'disabled'}><option value="">${row ? 'Seat…' : 'Pick a row first'}</option>${row ? row.map(x => `<option value="${x.num}" ${isTaken(x) || x.blocked ? 'disabled' : ''} ${st.sel === x ? 'selected' : ''}>Seat ${x.num}${isTaken(x) ? ' (sold)' : ''}</option>`).join('') : ''}</select></label>
  </div>`;
}
function renderPanel() {
  renderSteps();
  const p = $('#ctx'); let h = '';
  const ev = EVENTS[st.mode];
  const evLine = `${ev.label} · ${dateLabel()} · ${fmtTime(st.hour)}`;
  if (st.sel) {
    const s = st.sel, { r, rows } = insightRows(s);
    const price = s.floor ? PRICES.floor : s.block.price, cat = s.floor ? 'Standing' : 'Kat ' + s.block.cat;
    h = `<div class="ticket">
      <div class="tk-head"><div><div class="tk-stand">${s.floor ? 'Planen · standing floor' : s.block.stand}</div></div>
        <div class="tk-price">${st.ticket ? `<b>${price} kr</b><span class="chip c${s.floor ? 0 : s.block.cat}">${cat} · demo</span>` : `<span class="chip cv">${s.floor ? 'Standing' : s.tier === 'U' ? 'Upper tier' : 'Lower tier'}</span>`}</div></div>
      ${s.floor ? `<div class="tk-grid one"><div><span>Zone</span><b>${s.pos.x < STAGE.front + 30 ? 'Front' : s.pos.x < 20 ? 'Middle' : 'Back'}</b></div><div><span>From stage</span><b>${Math.round(r.dist)} m</b></div></div>`
        : `<div class="tk-grid"><div><span>Section</span><b>${s.block.name}</b></div><div><span>Row</span><b>${s.row}</b></div><div><span>Seat</span><b>${s.num}</b></div></div>`}
      <div class="tk-score">${gauge(r.score)}<div><b>${label(r.score)} view</b><span>${s.floor ? 'Depends on the crowd in front of you' : r.restricted ? 'Side-on to the stage' : st.mode === 'football' ? 'Scored on distance, side and height' : 'Scored on distance and angle to stage'}</span></div></div>
      <div class="facts">${rows.map(([k, a, b]) => `<div data-k="${k}">${icon(k)}<span>${a}</span><b>${b}</b></div>`).join('')}</div>
      ${isTaken(s) && !s.floor ? '<div class="warn">This seat is taken (demo data). You are previewing its view.</div>' : ''}
      ${st.state === 'pov' ? '' : '<button class="primary pov-in" data-act="pov">See the view from here <span>↵</span></button>'}
    </div>` + (s.floor ? '' : `<div class="chseat"><span class="c-lbl">Change seat</span><div class="chbtns"><button data-step="-1,0">${icon('back')}Prev seat</button><button data-step="1,0">Next seat${icon('chevR')}</button><button data-step="0,-1">Row in front</button><button data-step="0,1">Row behind</button></div></div>`) + wayInCard() +
      (st.state === 'pov'
        ? `<div class="btnrow"><button class="ghost" data-act="copy">${icon('person')}Copy link to this view</button></div>`
        : `<button class="primary pov-bottom" data-act="pov">See the view from here <span>↵</span></button><div class="btnrow"><button class="ghost" data-act="${st.sel.floor ? 'back' : 'unsel'}">${st.sel.floor ? 'All sections' : 'Pick another seat'}</button></div>`);
  } else if (st.state === 'block' && st.activeBlock) {
    const b = st.activeBlock;
    h = `      <h2>${secName(b)}</h2><p class="sub">${b.stand} · ${b.rows.length} rows${b.unofficial ? ' · unlabelled on the official plan' : ''}</p>
      ${st.ticket ? `<div class="stats"><div><b>${b.free}</b><span>free of ${b.seats.length}</span></div><div><b>${b.price} kr</b><span>Kat ${b.cat} · demo</span></div><div><b>${b.avg.toFixed(1)}</b><span>avg view</span></div></div>` : `<div class="stats"><div><b>${b.seats.length}</b><span>seats</span></div><div><b>1–${b.rows.length}</b><span>rows</span></div><div><b>${b.avg.toFixed(1)}</b><span>avg view</span></div></div>`}
      ${b.seats.some(s => s.covered) ? `<p class="note">${icon('roof')} Rows ${Math.min(...b.seats.filter(s => s.covered).map(s => s.row))}+ are under the roof.</p>` : `<p class="note">${icon('roof')} No roof cover in this section.</p>`}
      ${rowSeatChips(b)}
      <p class="hint">${st.ticket ? 'Or tap a <b class="blue">blue</b> seat in 3D. People on seats = sold (demo).' : 'Or tap any seat in 3D, or type it in the search above.'}</p>`;
  } else {
    const free = W.seats.filter(s => !isTaken(s) && !s.blocked).length;
    const picks = st.ticket
      ? [['view', 'star', 'Best free seat'], ['value', 'tag', 'Best value']
      , ['roof', 'roof', 'Under the roof']]
      : [['view', 'star', 'Best view'], ['close', 'person', st.mode === 'concert' ? 'Closest to stage' : 'Closest to pitch'], ['roof', 'roof', 'Under the roof']];
    h = `<h2>${st.ticket ? 'Find a free seat' : 'Where do you want to sit?'}</h2>
      <p class="sub">${st.ticket ? 'Blue = free, people = sold.' : 'Every seat is open to preview.'} Pick a section below, tap one on the map, or type your seat above.${st.mode === 'concert' ? ' Click the floor to stand on Planen.' : ''}</p>
      ${st.ticket ? '<div class="demo">Demo data: availability and prices are simulated until a ticketing partner (e.g. Ticketmaster) is connected.</div>' : ''}
      ${sectionChips()}
      <div class="picks"><span class="c-lbl">Find me</span>${picks.map(([k, i, t]) => `<button data-pick="${k}">${icon(i)}${t}</button>`).join('')}</div>
      <div class="stats"><div><b>${W.seats.length.toLocaleString('sv-SE')}</b><span>seats modelled</span></div>${st.ticket ? `<div><b>${free.toLocaleString('sv-SE')}</b><span>free (demo)</span></div>` : `<div><b>${W.seats.filter(s => s.covered).length.toLocaleString('sv-SE')}</b><span>under the roof</span></div>`}<div><b>${W.blocks.filter(b => !b.blocked).length}</b><span>sections</span></div></div>`;
  }
  p.innerHTML = h;
  const ds = p.querySelector('#ddsec'); if (ds) ds.onchange = () => { if (ds.value !== '') { st.pickRow = null; goBlock(W.blocks[+ds.value]); } };
  const dr = p.querySelector('#ddrow'); if (dr) dr.onchange = () => { const b = st.activeBlock, n = +dr.value; if (!n) return; st.pickBlock = b; st.pickRow = n; st.rowHint = { block: b, row: n }; paintBlock(b); renderPanel(); };
  const dt = p.querySelector('#ddseat'); if (dt) dt.onchange = () => { const b = st.activeBlock, x = b.rows[st.pickRow - 1].find(z => z.num === +dt.value); if (x) selectSeat(x); };
  p.querySelectorAll('[data-sec]').forEach(el => el.onclick = () => { const b = W.blocks[+el.dataset.sec]; st.pickRow = null; goBlock(b); });
  p.querySelectorAll('[data-row]').forEach(el => el.onclick = () => { const b = st.activeBlock, n = +el.dataset.row; st.pickBlock = b; st.pickRow = n; st.rowHint = { block: b, row: n }; paintBlock(b); renderPanel(); });
  p.querySelectorAll('[data-seat]').forEach(el => el.onclick = () => { const b = st.activeBlock, x = b.rows[st.pickRow - 1].find(z => z.num === +el.dataset.seat); if (x) selectSeat(x); });
  for (const id of ['rowchips', 'seatchips']) { const c = p.querySelector('#' + id); const on = c && c.querySelector('.on'); if (on) c.scrollLeft = on.offsetLeft - c.clientWidth / 2 + on.clientWidth / 2; }
  { const sc = p.querySelector('#seatchips'); if (sc && !sc.querySelector('.on')) sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2; }
  p.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { const [x, r] = b.dataset.step.split(',').map(Number); stepSeat(x, r); });
  p.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => pickBest(b.dataset.pick));
  const gs = p.querySelector('#gsel'); if (gs) gs.onchange = () => { st.gateOverride = gs.value || null; updateRoute(); if (st.state !== 'pov') showWayIn(); else renderPanel(); };
  p.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'pov') goPov(st.sel);
    else if (a === 'back') goOverview();
    else if (a === 'unsel') { st.sel = null; paintBlock(st.activeBlock); updatePlanColors(); renderPanel(); }
    else if (a === 'copy') copyLink();
    else if (a === 'route') showWayIn();
  });
  renderHud();
}
function setSpin(on) { if (st.spin === on) return; st.spin = on; const b = document.querySelector('#hud [data-h=spin]'); if (b) b.classList.toggle('on', on); }
function renderHud() {
  const hud = $('#hud');
  if (st.state !== 'pov' || !st.sel) { hud.innerHTML = ''; return; }
  const atmo = document.body.classList.contains('atmo-open'), tgt = st.mode === 'concert' ? 'stage' : 'pitch';
  hud.innerHTML = `<button class="hb hback" data-h="exit" title="Back (Esc)">${icon('back')}<span>Back</span></button>
    <div class="htools">
      <button class="hb ${st.spin ? 'on' : ''}" data-h="spin" title="Slowly turn all the way around">${icon('spin')}<span>Spin 360°</span></button>
      <button class="hb" data-h="face" title="Turn back towards the ${tgt}">${icon('target')}<span>Face ${tgt}</span></button>
      <button class="hb ${atmo ? 'on' : ''}" data-h="atmo" title="Crowd, wave and light show">${icon('people')}<span>Crowd &amp; lights</span></button>
    </div>`;
  hud.querySelector('[data-h=exit]').onclick = goBack;
  hud.querySelector('[data-h=atmo]').onclick = () => { document.body.classList.toggle('atmo-open'); renderHud(); };
  hud.querySelector('[data-h=spin]').onclick = () => setSpin(!st.spin);
  hud.querySelector('[data-h=face]').onclick = () => { setSpin(false); povYaw = 0; povPitch = 0; };
}
async function copyLink() {
  const url = location.href;
  try { await navigator.clipboard.writeText(url); toast('Link copied — it opens straight into this view.'); }
  catch (e) { toast('Copy this link: ' + url); }
}
function renderConditions() {
  const sr = st.rise != null ? fmtTime(st.rise) : '—', ss = st.set != null ? fmtTime(st.set) : '—';
  $('#tval').textContent = fmtTime(st.hour);
  $('#tdate').textContent = dateLabel();
  $('#sunline').innerHTML = `<span>Sunrise ${sr}</span><span>${st.sunAlt > 0 ? 'Daylight' : (st.mode === 'concert' ? 'After dark · show lights on' : 'After dark · floodlights on')}</span><span>Sunset ${ss}</span>`;
  const slider = $('#time'); slider.value = st.hour;
  if (st.rise != null) {
    const a = (st.rise - 8) / 16 * 100, b = (st.set - 8) / 16 * 100;
    slider.style.setProperty('--a', a + '%'); slider.style.setProperty('--b', b + '%');
  }
  $('#month').value = st.month;
  updateHeatNote();
}
function compassWord(az) { return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(az / 45) % 8]; }
function keyItems() {
  const hex = (c) => '#' + c.getHexString();
  const it = (col, label, sub, sq) => ({ col, label, sub, sq });
  if (st.heat === 'view') return { grad: true, items: [it('#fde725', 'Excellent'), it('#5ec962', 'Great'), it('#21918c', 'Good'), it('#3b528b', 'Fair'), it('#440154', 'Limited')], note: 'Brighter = better view (colour-blind safe)' };
  if (st.heat === 'price') return { items: [1, 2, 3, 4].map(k => it(hex(COL.cat[k]), `Kat ${k}`, `${PRICES[st.mode][k - 1]} kr`, true)).concat(st.mode === 'concert' ? [it('#17191d', 'Not on sale', 'behind the stage', true)] : []), note: 'Demo prices' };
  if (st.heat === 'roof') return { items: [it('#0072b2', 'Under the roof', 'stays dry if it rains'), it('#e69f00', 'Open sky', 'bring a rain jacket')], note: '' };
  if (st.heat === 'sun') {
    if (st.sunAlt <= 0) return { items: [it('#2a3350', 'After sunset', 'floodlights on')], note: '' };
    return { items: [it('#ffc531', 'In the sun', `at ${fmtTime(st.hour)}`), it('#3d5a99', 'In the shade', `at ${fmtTime(st.hour)}`)], note: st.sunCalc && st.sunCalc.ready ? '' : 'Calculating…' };
  }
  const items = [];
  if (st.ticket) items.push(it('#3fb8ff', 'Free seat', 'demo data'), it('#5b6573', 'Sold', 'demo data'));
  else items.push(it('#2f5e9c', 'Seat', 'Ullevi blue'), it('#a22b30', 'Red seats', 'spell “ULLEVI”'), it('#3fb8ff', 'Open section', 'click any seat'));
  items.push(it('#a8e6a0', 'Your seat', 'selected'), it('#ffc233', 'Highlighted', 'row or hovered seat'));
  if (st.mode === 'concert') items.push(it('#17191d', 'Not on sale', 'behind the stage'));
  items.push(it('#f3efe4', 'Section', 'under your mouse', true));
  return { items, note: '' };
}
function renderKey() {
  if (st.heat === 'off') { const k0 = $('#key'); if (k0) k0.innerHTML = ''; const l0 = $('#legend'); if (l0) l0.innerHTML = ''; return; }
  const K = keyItems();
  const titles = { off: 'Seat colours in the stadium', view: '<b>Best view</b> · tap again to turn off', sun: `<b>Sun / shade</b> at ${fmtTime(st.hour)} · tap again to turn off`, roof: '<b>Rain cover</b> · tap again to turn off', price: '<b>Price</b> (demo) · tap again to turn off' };
  const dots = K.items.map(x => `<div class="k"><span class="dot${x.sq ? ' sq' : ''}" style="background:${x.col}"></span><span><b>${x.label}</b>${x.sub ? '<br>' + x.sub : ''}</span></div>`).join('');
  const html = `<div class="ktitle">${titles[st.heat] || ''}</div>` +
    (K.grad ? '<div class="grad"></div><div class="ends"><span>Limited</span><span>Excellent</span></div>' : '') + dots +
    (K.note && !K.grad ? `<div class="k wide" style="font-size:11px">${K.note}</div>` : '');
  const k = $('#key'); if (k) k.innerHTML = html;
  const lg = $('#legend'); if (lg) lg.innerHTML = K.items.slice(0, 4).map(x => `<span><i style="background:${x.col};border-radius:${x.sq ? 3 : 9}px"></i>${x.label}</span>`).join('');
}
const HEAT_DESC = {
  off: 'Tap a card to colour the seats. Tap it again to go back to normal.',
  view: 'Tap again to go back to normal colours.',
  price: 'Demo prices. Tap again to go back to normal colours.',
  sun: 'At the time you picked above. Tap again to go back to normal colours.',
};
function updateHeatNote() { renderKey(); const d = $('#heatdesc'); if (d) d.textContent = HEAT_DESC[st.heat]; }
function setHeat(h) {
  st.heat = h;
  document.querySelectorAll('#heat button').forEach(b => b.classList.toggle('on', b.dataset.h === h));
  if (h === 'sun') { st.sunCalc = null; computeSunMap(); } else sunJob++;
  paintAll(); updatePlanColors(); updateHeatNote();
}

/* ================================================================ landmarks */
const labelEls = [];
function buildLabels() {
  const box = $('#labels');
  for (const l of LANDMARKS) {
    const el = document.createElement('div'); el.className = 'lm' + (l.tram ? ' tram' : ''); el.innerHTML = `<b>${l.tram ? icon('tram') : ''}${l.name}</b><span>${l.sub}</span>`;
    box.appendChild(el); labelEls.push({ el, p: new THREE.Vector3(...l.p).setY(l.p[1] + 6), kind: 'lm' });
  }
  for (const b of W.blocks) {
    if (b.unofficial) continue;
    const el = document.createElement('button'); el.className = 'sl' + (b.tier === 'U' ? ' up' : ''); el.textContent = b.name; el.type = 'button';
    el.title = 'Section ' + b.name; el.onclick = () => { if (b.blocked) return toast('Behind the stage, not on sale for this concert.'); goBlock(b); };
    const mid = b.seats[Math.floor(b.seats.length / 2)];
    box.appendChild(el); labelEls.push({ el, p: b.center.clone().add(new THREE.Vector3(0, 2.5, 0)), kind: 'sec', block: b, n: new THREE.Vector3(mid.n.x, 0, mid.n.y) });
  }
  for (const g of GATES) {
    const el = document.createElement('div'); el.className = 'gt' + (g.vip ? ' vip' : ''); el.innerHTML = `<i>${g.id === 'PARAD' ? 'P' : g.id === 'SODRA' ? 'S' : g.id}</i><span>${g.label}</span>`;
    box.appendChild(el); labelEls.push({ el, p: g.out.clone().setY(3), kind: 'gate', gate: g });
  }
}
const vtmp = new THREE.Vector3();
function updateLabels() {
  const show = st.state === 'overview' && !flight, showGates = st.state !== 'pov' && !flight;
  const camP = camera.position;
  for (const { el, p, kind, gate, block, n } of labelEls) {
    if (kind === 'sec') {
      const show2 = st.secLabels && (st.state === 'overview' || st.state === 'block') && !flight && !st.routeView;
      if (!show2 || block.blocked) { el.style.opacity = 0; el.style.pointerEvents = 'none'; continue; }
      const face = -(n.x * (camP.x - p.x) + n.z * (camP.z - p.z)) / Math.hypot(camP.x - p.x, camP.z - p.z); // stands face inward
      vtmp.copy(p).project(camera);
      const inView = vtmp.z < 1 && Math.abs(vtmp.x) < 0.97 && Math.abs(vtmp.y) < 0.97;
      const back = face < -0.1;
      el.style.opacity = inView ? (back ? 0.82 : 1) : 0; el.style.pointerEvents = inView ? 'auto' : 'none';
      el.classList.toggle('back', back);
      el.classList.toggle('on', block === st.activeBlock || block === st.hoverBlock);
      el.style.transform = `translate(${(vtmp.x * 0.5 + 0.5) * innerWidth}px, ${(-vtmp.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -50%)`;
      continue;
    }
    const on = kind === 'gate' ? showGates && ((st.state === 'overview' && st.secLabels) || (st.routeInfo && st.routeInfo.gate === gate && st.routeView)) : show || (st.routeInfo && st.routeView && !flight && st.routeInfo.tram.name === el.textContent.replace('Tram stop', '').trim());
    if (!on) { el.style.opacity = 0; continue; }
    el.classList.toggle('on', !!(st.routeInfo && st.routeInfo.gate === gate));
    vtmp.copy(p).project(camera);
    const vis = vtmp.z < 1 && Math.abs(vtmp.x) < 0.95 && Math.abs(vtmp.y) < 0.95;
    el.style.opacity = vis ? 1 : 0;
    el.style.transform = `translate(${(vtmp.x * 0.5 + 0.5) * innerWidth}px, ${(-vtmp.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
  }
}

/* ================================================================ loop */
const PANEL = { open: true, cur: null };
function panelTarget() {
  if (!PANEL.open) return 0;
  if (innerWidth <= 860 && document.body.classList.contains('sheet-min')) return 84;
  return innerWidth > 860 ? 400 : Math.round(innerHeight * (st.state === 'pov' ? 0.3 : 0.6));
}
function applyOffset(px) {
  if (innerWidth > 860) { if (px > 0.5) camera.setViewOffset(innerWidth + px, innerHeight, px, 0, innerWidth, innerHeight); else camera.clearViewOffset(); }
  else { if (px > 0.5) camera.setViewOffset(innerWidth, innerHeight + px, 0, px, innerWidth, innerHeight); else camera.clearViewOffset(); }
  camera.updateProjectionMatrix();
}
function layoutCamera() {
  camera.aspect = innerWidth / innerHeight;
  PANEL.cur = panelTarget(); applyOffset(PANEL.cur);
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
}
function setSheet(open) { document.body.classList.toggle('sheet-min', !open); const g = $('#pgrab'); if (g) g.setAttribute('aria-label', open ? 'Swipe down to hide' : 'Swipe up to show'); }
function initSheet() {
  const sheet = $('#panel'), sc = sheet.querySelector('.scroll'); let y0 = null, top0 = 0;
  const start = (y, t) => { if (innerWidth > 860) return; y0 = y; top0 = t.closest('.scroll') ? sc.scrollTop : 0; };
  const end = (y) => { if (y0 === null) return; const dy = y - y0; y0 = null; const min = document.body.classList.contains('sheet-min');
    if (dy > 45 && !min && top0 <= 0) setSheet(false); else if (dy < -45 && min) setSheet(true); };
  sheet.addEventListener('touchstart', (e) => start(e.touches[0].clientY, e.target), { passive: true });
  sheet.addEventListener('touchend', (e) => end(e.changedTouches[0].clientY));
  sheet.addEventListener('click', (e) => { if (document.body.classList.contains('sheet-min') && !e.target.closest('button')) setSheet(true); });
}
function setPanel(open) {
  PANEL.open = open;
  document.body.classList.toggle('panel-closed', !open);
  const t = $('#ptoggle'); if (t) { t.innerHTML = `${icon(open ? 'chevR' : 'chevL')}<span>${open ? 'Hide' : 'Menu'}</span>`; t.title = open ? 'Hide the menu' : 'Show the menu'; t.setAttribute('aria-expanded', open); }
  const g = $('#pgrab'); if (g) g.setAttribute('aria-expanded', open);
}
addEventListener('resize', layoutCamera); layoutCamera();
let roofOpacity = 1, frameN = 0, roofMoving = false;
let crowdT = 0, lastFrameT = 0, lastInput = 0, lastIdleDraw = 0;
['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchmove'].forEach(ev => addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true, capture: true }));
function frameLoop(now) {
  requestAnimationFrame(frameLoop);
  if (st.paused) return; // main view sleeps while the phone preview runs
  const live = st.state === 'pov';
  const dtF = Math.min(0.1, (now - (lastFrameT || now)) / 1000); lastFrameT = now;
  if (live) crowdT += dtF;
  // when nothing is moving, draw only a few times per second (saves battery and keeps the page cool)
  const busy = live || flight || controls.autoRotate || now - lastInput < 1500 || roofMoving || (PANEL.cur !== null && Math.abs(panelTarget() - PANEL.cur) > 0.5) || st.routeView || st.sunCalc && !st.sunCalc.ready;
  if (!busy) { Q.last = now; Q.samples = []; if (now - lastIdleDraw < 250) return; lastIdleDraw = now; }
  if (QUALITY[Q.level].fps < 60 && now - (Q.lastDraw || 0) < 1000 / QUALITY[Q.level].fps - 2) return;
  Q.lastDraw = now; monitorFps(now);
  { const tgt = panelTarget(); if (PANEL.cur === null) PANEL.cur = tgt; if (Math.abs(tgt - PANEL.cur) > 0.5) { PANEL.cur += (tgt - PANEL.cur) * 0.16; applyOffset(PANEL.cur); } else if (PANEL.cur !== tgt) { PANEL.cur = tgt; applyOffset(tgt); } }
  if (flight) {
    const k = Math.min(1, (now - flight.s) / flight.ms), e = ease(k);
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    camera.position.y += Math.sin(Math.PI * e) * Math.min(40, flight.p0.distanceTo(flight.p1) * 0.12) * flight.arc;
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    camera.fov = flight.f0 + (flight.f1 - flight.f0) * e; camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    if (k >= 1) { const d = flight.done; flight = null; if (d) d(); }
  } else if (st.state === 'pov' && st.sel) {
    if (st.spin) povYaw -= Math.min(0.05, (now - (st.lastSpinT || now)) / 1000) * 0.35;
    st.lastSpinT = now;
    const eye = eyeOf(st.sel); camera.position.copy(eye);
    controls.target.copy(eye).add(povDir().multiplyScalar(40)); camera.lookAt(controls.target);
  } else if (controls.enabled) { controls.minDistance = st.state === 'overview' ? 230 : 25; if (st.state === 'overview') controls.target.lerp(overviewPose().tgt, 0.2); controls.update(); }
  // roof x-ray: fade when the section you're looking at sits under it
  const focus = st.state === 'block' ? st.activeBlock : st.hoverBlock;
  const wantRoof = st.state === 'pov' ? 1 : (focus && focus.seats.some(s => s.covered)) ? 0.22 : 1;
  roofMoving = Math.abs(wantRoof - roofOpacity) > 0.01; roofOpacity += (wantRoof - roofOpacity) * 0.12;
  for (const m of W.roof.userData.mats) { m.opacity = roofOpacity; m.depthWrite = roofOpacity > 0.97; }
  if (W.concert.beams.visible) W.concert.beams.children.forEach((b) => { const p = b.userData.phase + crowdT / 1.4; b.rotation.set(Math.sin(p) * 0.5, 0, -0.9 + Math.cos(p * 0.8) * 0.35); });
  // crowd animation, Mexican wave, LOD, route
  const tsec = crowdT; crowdUniforms.uTime.value = tsec;
  if (live && st.mode === 'football' && st.crowdOn) {
    if (!st.waveStart || tsec - st.waveStart > 46) { st.waveStart = tsec; st.waveA0 = Math.random() * Math.PI * 2; }
    const wt = tsec - st.waveStart;
    crowdUniforms.uWave.value = wt < 14 ? Math.min(1, wt / 1.5, (14 - wt) / 1.5) : 0;
    crowdUniforms.uWaveA.value = st.waveA0 + wt * 0.62;
  } else crowdUniforms.uWave.value = 0;
  if (W.crowdSys.update(camera.position)) W.show.refresh();
  if (st.goalT) { const gt = tsec - st.goalT; crowdUniforms.uGoal.value = gt < 6 ? Math.min(1, gt * 4, (6 - gt) / 1.2) : (st.goalT = 0, 0); }
  W.route.tick(now / 1000);
  W.show.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  updateLabels();
  const cmp = $('#needle');
  if (cmp) { const n = bearingToScene(0), dir = new THREE.Vector3(); camera.getWorldDirection(dir); const a = Math.atan2(n.x, n.z) - Math.atan2(dir.x, dir.z); cmp.style.transform = `rotate(${(-a * 180 / Math.PI) + 180}deg)`; }
  if (st.bloomOn) composer.render(); else renderer.render(scene, camera);
}

/* ================================================================ boot */
(async function boot() {
  await build();
  buildPlan(); buildLabels(); initSearch();
  $('#time').addEventListener('input', (e) => { st.hour = +e.target.value; updateSun(); });
  $('#month').addEventListener('change', (e) => { st.month = +e.target.value; st.day = Math.min(st.day, 28); updateSun(); });
  document.querySelectorAll('#heat button').forEach(b => b.onclick = () => setHeat(st.heat === b.dataset.h ? 'off' : b.dataset.h));
  document.querySelectorAll('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.m));
  $('#tmode').addEventListener('change', (e) => setTicket(e.target.checked));
  document.querySelectorAll('#cstyle button').forEach(b => b.onclick = () => { st.crowdStyle = b.dataset.c; document.querySelectorAll('#cstyle button').forEach(x => x.classList.toggle('on', x === b)); applyStyle(); applyCrowd(); });
  const inPhone = window.name === 'ullevi-phone-preview'; document.body.classList.toggle('in-phone', inPhone);
  const placeCond = () => { const c = $('#cond'), plan = document.querySelector('#panel .plan'); if (innerWidth <= 860) { if (c.parentElement !== plan.parentElement) plan.after(c); } else if (c.parentElement !== document.body) document.body.insertBefore(c, $('#hud')); };
  placeCond(); addEventListener('resize', placeCond);
  initSheet();
  $('#condmin').onclick = () => { const m = document.body.classList.toggle('cond-min'); $('#condmin').title = m ? 'Show filters and time' : 'Make smaller'; };
  $('#seclbl').onchange = (e) => { st.secLabels = e.target.checked; document.body.classList.toggle('labels-on', st.secLabels); };
  document.querySelectorAll('#crowdtog button').forEach(b => b.onclick = () => { st.crowdOn = b.dataset.v === '1'; document.querySelectorAll('#crowdtog button').forEach(x => x.classList.toggle('on', x === b)); applyCrowd(); });
  $('#atmoclose').onclick = () => { document.body.classList.remove('atmo-open'); renderHud(); };
  $('#phonebtn').onclick = () => { const f = $('#phoneframe'); if (!f.src) f.src = location.href.split('#')[0]; $('#phonewrap').hidden = false; st.paused = true; };
  $('#phoneclose').onclick = () => { $('#phonewrap').hidden = true; st.paused = false; };
  $('#ptoggle').onclick = () => setPanel(!PANEL.open); $('#pgrab').onclick = () => setSheet(document.body.classList.contains('sheet-min')); setPanel(true);
  addEventListener('keydown', (e) => { if (e.key === 'm' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) setPanel(!PANEL.open); });
  $('#goal').onclick = () => { if (st.state !== 'pov') return toast('Open a seat view to see the crowd react.'); st.goalT = crowdT; toast('GOAL! The whole stadium is on its feet.'); };
  document.querySelectorAll('#lights button').forEach(b => b.onclick = () => { st.lights = b.dataset.l; applyNight(); if ((st.nightK || 0) < 0.25 && st.lights !== 'off') toast('Lights show after sunset. Drag the time slider into the evening to see them.'); });
  document.querySelectorAll('#qual button').forEach(b => b.onclick = () => setQualityMode(b.dataset.q));
  document.querySelectorAll('#ctabs button').forEach(b => b.onclick = () => { document.querySelectorAll('#ctabs button').forEach(x => x.classList.toggle('on', x === b)); document.querySelectorAll('.cpane').forEach(p => { p.hidden = p.dataset.p !== b.dataset.t; }); });
  $('#wave').onclick = () => { if (st.state !== 'pov') return toast('Open a seat view to see the wave.'); st.waveStart = crowdT; st.waveA0 = Math.atan2(camera.position.z, camera.position.x) + 1; toast('Here comes the wave!'); };
  setMode('concert', true); applyQuality();
  renderer.shadowMap.needsUpdate = true;
  requestAnimationFrame(frameLoop);
  await tick();
  $('#loader').classList.add('gone');
  setState('overview');
  if (!openHash()) {
    const o = overviewPose(); flyTo(o.pos, o.tgt, 42, 3200, () => { controls.enabled = true; controls.autoRotate = true; });
    renderPanel();
  }
  window.__app = { composer, get dbg() { return { flight: !!flight, auto: controls.autoRotate, input: performance.now() - lastInput, roofMoving, roofOpacity, panel: PANEL.cur + '/' + panelTarget(), route: st.routeView, sun: st.sunCalc }; }, get povYaw() { return povYaw; }, set povYaw(v) { povYaw = v; }, Q, setQualityMode, crowdUniforms, GATES, recommendGate, showWayIn, applyStyle, setTicket, parseQuery, suggest, runAction, st, W, goBlock, goPov, goOverview, setMode, setHeat, selectSeat, selectFloor, updateSun, computeScores, scoreSeat, seatSun, camera, scene, renderer };
})();

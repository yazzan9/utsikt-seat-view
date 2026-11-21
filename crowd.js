// Lifelike, animated crowd with two levels of detail.
// Each person is one instanced mesh built from tagged parts (shirt, skin, hair, pants, scarf, shoes, long hair).
// Arms carry a second "raised" pose (pos2/nor2); the vertex shader blends between them for cheering and the Mexican wave.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const P_SHIRT = 0, P_SKIN = 1, P_HAIR = 2, P_PANTS = 3, P_SCARF = 4, P_SHOE = 5, P_LONG = 6, P_HAT = 7;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

function limb(a, b, r1, r2, seg) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), d.normalize());
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
  return g.toNonIndexed();
}
function tag(g, part, raised) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count;
  const r = raised ? (raised.index ? raised.toNonIndexed() : raised) : g;
  const p2 = new Float32Array(n * 4), rp = r.attributes.position.array;
  for (let i = 0; i < n; i++) { p2[i * 4] = rp[i * 3]; p2[i * 4 + 1] = rp[i * 3 + 1]; p2[i * 4 + 2] = rp[i * 3 + 2]; p2[i * 4 + 3] = part; }
  g.setAttribute('pos2', new THREE.BufferAttribute(p2, 4));
  g.setAttribute('nor2', r.attributes.normal.clone());
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'pos2', 'nor2'].includes(k)) g.deleteAttribute(k);
  return g;
}
const at = (g, x, y, z) => { g.translate(x, y, z); return g; };

// pose definitions (seat origin: seat pan top ≈ y 0.47, person faces +z)
const POSES = {
  seated: {
    hip: 0.50, torsoTop: 0.98, head: 1.15, shoulderY: 0.95, torsoZ: -0.06,
    legs: (s) => [[v3(s * 0.09, 0.5, -0.02), v3(s * 0.1, 0.52, 0.34)], [v3(s * 0.1, 0.52, 0.34), v3(s * 0.1, 0.07, 0.40)]],
    shoe: (s) => v3(s * 0.1, 0.04, 0.45),
    armRest: (s) => [v3(s * 0.2, 0.94, -0.06), v3(s * 0.23, 0.70, -0.01), v3(s * 0.13, 0.60, 0.22)],
    armUp: (s) => [v3(s * 0.2, 0.94, -0.06), v3(s * 0.27, 1.22, -0.02), v3(s * 0.31, 1.48, 0.02)],
  },
  standing: {
    hip: 0.95, torsoTop: 1.43, head: 1.60, shoulderY: 1.40, torsoZ: 0,
    legs: (s) => [[v3(s * 0.09, 0.95, 0), v3(s * 0.1, 0.5, 0.02)], [v3(s * 0.1, 0.5, 0.02), v3(s * 0.1, 0.07, 0)]],
    shoe: (s) => v3(s * 0.1, 0.04, 0.05),
    armRest: (s) => [v3(s * 0.2, 1.39, 0), v3(s * 0.24, 1.13, 0.02), v3(s * 0.22, 0.88, 0.07)],
    armUp: (s) => [v3(s * 0.2, 1.39, 0), v3(s * 0.27, 1.68, 0.03), v3(s * 0.30, 1.96, 0.06)],
  },
};

export function personGeometry(pose = 'seated', detail = 'near') {
  const P = POSES[pose], near = detail === 'near', seg = near ? 6 : 3, parts = [];
  const th = P.torsoTop - P.hip + 0.02;
  // torso
  const torso = near ? new THREE.CylinderGeometry(0.19, 0.165, th, 8, 1) : new THREE.BoxGeometry(0.36, th, 0.22);
  if (near) torso.scale(1, 1, 0.62);
  parts.push(tag(at(torso, 0, P.hip + th / 2 - 0.01, P.torsoZ), P_SHIRT));
  // legs
  for (const s of [-1, 1]) {
    const [thigh, shin] = P.legs(s);
    parts.push(tag(limb(thigh[0], thigh[1], 0.075, 0.07, seg), P_PANTS));
    if (near || pose === 'standing') parts.push(tag(limb(shin[0], shin[1], 0.062, 0.05, seg), P_PANTS));
    if (near) { const sh = P.shoe(s); parts.push(tag(at(new THREE.BoxGeometry(0.1, 0.07, 0.2), sh.x, sh.y, sh.z), P_SHOE)); }
  }
  // arms (rest + raised pose)
  for (const s of [-1, 1]) {
    const r = P.armRest(s), u = P.armUp(s);
    parts.push(tag(limb(r[0], r[1], 0.05, 0.045, seg), P_SHIRT, limb(u[0], u[1], 0.05, 0.045, seg)));
    parts.push(tag(limb(r[1], r[2], 0.038, 0.032, seg), P_SKIN, limb(u[1], u[2], 0.038, 0.032, seg)));
    if (near) { const h = new THREE.SphereGeometry(0.04, 8, 6), h2 = h.clone(); parts.push(tag(at(h, r[2].x, r[2].y, r[2].z), P_SKIN, at(h2, u[2].x, u[2].y, u[2].z))); }
  }
  // neck, head, hair
  const hz = P.torsoZ + 0.01;
  if (near) parts.push(tag(at(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6, 1, true), 0, P.torsoTop + 0.03, hz), P_SKIN));
  const head = near ? new THREE.SphereGeometry(0.1, 12, 9) : new THREE.IcosahedronGeometry(0.105, 0);
  head.scale(0.92, 1.1, 1); parts.push(tag(at(head, 0, P.head, hz), P_SKIN));
  const cap = near ? new THREE.SphereGeometry(0.106, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.56) : new THREE.SphereGeometry(0.11, 4, 2, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.scale(0.95, 1.12, 1.04); cap.rotateX(-0.28);
  parts.push(tag(at(cap, 0, P.head + 0.008, hz - 0.012), P_HAIR));
  if (near) {
    parts.push(tag(at(new THREE.BoxGeometry(0.19, 0.2, 0.05), 0, P.head - 0.09, hz - 0.085), P_LONG));
    parts.push(tag(at(new THREE.CylinderGeometry(0.075, 0.1, 0.07, 10, 1, true), 0, P.torsoTop - 0.005, hz), P_SCARF));
    const hat = new THREE.SphereGeometry(0.114, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); hat.scale(0.97, 1.2, 1.05);
    parts.push(tag(at(hat, 0, P.head + 0.02, hz - 0.005), P_HAT));
    const brim = new THREE.BoxGeometry(0.17, 0.015, 0.09); parts.push(tag(at(brim, 0, P.head + 0.03, hz + 0.1), P_HAT));
  } else {
    parts.push(tag(at(new THREE.BoxGeometry(0.17, 0.07, 0.14), 0, P.torsoTop - 0.005, hz), P_SCARF));
  }
  const g = mergeGeometries(parts);
  g.userData.headC = new THREE.Vector3(0, P.head - 0.05, hz);
  return g;
}

/* ---------------- palettes ---------------- */
const C = (h) => new THREE.Color(h);
const SKIN = ['#f3d2b8', '#eac1a0', '#d9a37f', '#c68863', '#a46b47', '#7a4b2f', '#5b3721'].map(C);
const HAIR = ['#e2c27a', '#c9a15e', '#8b6a45', '#5b3f28', '#3a2a1c', '#1d1714', '#1d1714', '#a09c97', '#9c4f2a'].map(C);
const PANTS = ['#2f3e5c', '#27324a', '#1d1e22', '#3b3d42', '#6b6f76', '#b7a88a', '#2f3e5c'].map(C);
export const STYLES = {
  sweden: { label: 'Sweden', shirts: [['#f5c400', 38], ['#ffd21a', 8], ['#005baa', 22], ['#003f7f', 6], ['#f2f2f2', 8], ['#1f2125', 10], ['#7a7f87', 8]], scarves: ['#f5c400', '#005baa'], scarf: 0.5, hat: 0.18, flag: 'sweden' },
  ifk: { label: 'IFK Göteborg', shirts: [['#0d3a8e', 38], ['#1d56c2', 10], ['#f4f4f4', 26], ['#1f2125', 14], ['#7a7f87', 12]], scarves: ['#0d3a8e', '#f4f4f4'], scarf: 0.6, hat: 0.18, flag: 'ifk' },
  neutral: { label: 'Neutral', shirts: [['#1f2125', 18], ['#f2f2f2', 14], ['#2c4a7a', 12], ['#7a7f87', 12], ['#8a2430', 8], ['#3f5e3a', 8], ['#c9b48a', 8], ['#d26a2c', 5], ['#5a4a7a', 5], ['#9fc0de', 10]], scarves: ['#1f2125', '#5b6779', '#8a2430'], scarf: 0.06, hat: 0.12, flag: null },
  concert: { label: 'Concert', shirts: [['#121316', 38], ['#f2f2f2', 14], ['#2b2f3a', 12], ['#575a60', 8], ['#7a1f2b', 6], ['#1f4e8c', 6], ['#e6c34a', 4], ['#c86b9c', 4], ['#3f5e3a', 4], ['#d9cbb5', 4]], scarves: ['#121316', '#3b3d42', '#7a1f2b'], scarf: 0.03, hat: 0.14, flag: null },
};
function weighted(list, r) { const tot = list.reduce((a, x) => a + x[1], 0); let k = r * tot; for (const [c, w] of list) { if ((k -= w) <= 0) return c; } return list[0][0]; }

/* ---------------- shared uniforms & animation ---------------- */
export const crowdUniforms = {
  uTime: { value: 0 }, uCheer: { value: 0.35 }, uConcert: { value: 0 }, uWave: { value: 0 }, uWaveA: { value: 0 },
  uGoal: { value: 0 }, uPhoneUp: { value: 0 }, uShow: { value: 0 }, uShowMode: { value: 0 },
  uLight: { value: new THREE.Color(1, 1, 1) }, uBeat: { value: 2.1 }, uTintK: { value: 0 }, uStagePos: { value: new THREE.Vector3(-64, 9, 0) },
};
// flags packed in misc.z: bit0 long hair, bit1 hat, bit2 phone holder
const LIFT_GLSL = `
  uniform float uTintK; uniform vec3 uStagePos;
  float bit(float v, float b) { return mod(floor(v / b), 2.0); }
  float liftOf(vec4 m, float phi) {
    float ph = m.x, ex = m.y;
    float c = smoothstep(0.82, 1.0, sin(uTime * 0.55 + ph * 6.2831)) * ex * uCheer;
    float beat = uTime * uBeat * 3.14159;
    float cc = ex * smoothstep(0.35, 1.0, 0.55 + 0.45 * sin(beat + ph * 2.7)) * step(0.45, ex);
    c = mix(c, cc, uConcert);
    float d = mod(phi - uWaveA + 3.14159, 6.28318) - 3.14159;
    float w = uWave * smoothstep(0.42, 0.0, abs(d)) * (0.75 + 0.25 * ex);
    float g = uGoal * step(0.18, ex);
    float phone = uPhoneUp * bit(m.z, 4.0) * smoothstep(0.0, 1.0, uPhoneUp * 1.4 - ph * 0.4);
    return clamp(max(max(c, w), max(g, phone)), 0.0, 1.0);
  }
  // Stage lighting: a coloured wash plus three moving spotlights, only on the side of a person that faces the stage.
  vec3 stageLight(vec3 wp, vec3 n) {
    if (uTintK < 0.01) return vec3(0.0);
    vec3 d = uStagePos - wp; float dist = length(d); vec3 L = d / dist;
    float facing = clamp(dot(n, L) * 0.85 + 0.15, 0.0, 1.0);
    facing *= facing;
    float fall = 1.0 / (1.0 + dist / 70.0);
    float t = uTime;
    vec3 wash = mix(vec3(0.20, 0.80, 1.0), vec3(1.0, 0.18, 0.54), 0.5 + 0.5 * sin(t * 0.21));   // Utsikt: Laser ↔ Scen
    wash = mix(wash, vec3(1.0, 0.55, 0.25), 0.5 + 0.5 * sin(t * 0.13 + 2.0)) ;                 // … ↔ Skymning
    float beat = 0.82 + 0.18 * sin(t * uBeat * 3.14159);
    float a = atan(wp.z - uStagePos.z, wp.x - uStagePos.x);
    float el = atan(wp.y, dist);
    float sp = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float ba = sin(t * (0.23 + fi * 0.07) + fi * 2.1) * 1.15;
      float be = 0.08 + 0.12 * (0.5 + 0.5 * sin(t * 0.31 + fi * 1.7));
      float da = a - ba, de = el - be;
      sp += exp(-(da * da) / 0.010 - (de * de) / 0.006);
    }
    vec3 spot = vec3(1.0, 0.95, 0.85) * sp;
    return (wash * 0.55 * beat + spot * 1.1) * facing * fall * uTintK;
  }
  vec3 showTint(float phi, float y) { return vec3(0.0); }`;

/* ---------------- near (full 3D) material ---------------- */
function makeNearMaterial(headC) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, crowdUniforms, { uHeadC: { value: headC } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 pos2; attribute vec3 nor2;
        attribute vec3 iShirt; attribute vec3 iSkin; attribute vec3 iHair; attribute vec3 iPants; attribute vec4 iScarf; attribute vec4 iMisc;
        uniform float uTime, uCheer, uConcert, uWave, uWaveA, uGoal, uPhoneUp, uShow, uBeat; uniform vec3 uHeadC;
        varying vec3 vPartCol; varying vec3 vTint;
        ${LIFT_GLSL}`)
      .replace('#include <beginnormal_vertex>', `float part = pos2.w; float lift = liftOf(iMisc, iScarf.w);
        vec3 objectNormal = normalize(mix(normal, nor2, lift));`)
      .replace('#include <begin_vertex>', `vec3 transformed = mix(position, pos2.xyz, lift);
        if (part > 5.5 && part < 6.5) transformed = mix(uHeadC, transformed, bit(iMisc.z, 1.0));
        if (part > 6.5) transformed = mix(uHeadC, transformed, bit(iMisc.z, 2.0));
        if (part > 3.5 && part < 4.5) transformed = mix(uHeadC, transformed, iMisc.w);
        float sway = sin(uTime * uBeat * 1.5708 + iScarf.w * 2.0 + iMisc.x) * 0.035 * uConcert * iMisc.y;
        transformed.x += sway * max(0.0, transformed.y - 0.45);
        transformed.y += sin(uTime * 1.6 + iMisc.x * 9.0) * 0.012 * iMisc.y + lift * 0.03
                       + uGoal * abs(sin(uTime * 7.0 + iMisc.x * 6.0)) * 0.12 * step(0.18, iMisc.y);
        vPartCol = part < 0.5 ? iShirt : part < 1.5 ? iSkin : part < 2.5 ? iHair : part < 3.5 ? iPants : part < 4.5 ? iScarf.rgb : part < 5.5 ? vec3(0.09) : part < 6.5 ? iHair : iScarf.rgb;
        { mat4 im4 = modelMatrix * instanceMatrix; vec3 wp = (im4 * vec4(transformed, 1.0)).xyz; vec3 wn = normalize(mat3(im4) * objectNormal); vTint = stageLight(wp, wn); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPartCol; varying vec3 vTint;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vPartCol, opacity );')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vTint * (vPartCol * 0.9 + 0.06);');
  };
  return mat;
}

/* ---------------- far (cut-out) atlas ---------------- */
// 8 frames, 96×192 px each: [seated front, seated front arms up, seated back, seated back arms up, standing ×4]
// Channels: R = shirt, G = skin, B = hair, black-opaque = trousers, alpha = coverage.
function drawAtlas() {
  const FW = 96, FH = 192, c = document.createElement('canvas'); c.width = FW * 8; c.height = FH;
  const g = c.getContext('2d');
  const SH = 'rgb(255,0,0)', SK = 'rgb(0,255,0)', HR = 'rgb(0,0,255)', PA = 'rgb(0,0,0)';
  const ell = (x, y, rx, ry, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
  const rr = (x, y, w, h, r, col) => { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  const limb = (x1, y1, x2, y2, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  // y scale: frame height 192 px = 2.0 m  → 96 px per metre; x centre 48
  const Y = (m) => FH - m * 96, cx = 48;
  for (let f = 0; f < 8; f++) {
    g.save(); g.translate(f * FW, 0);
    const standing = f >= 4, back = (f % 4) >= 2, up = f % 2 === 1;
    const hip = standing ? 0.95 : 0.5, top = standing ? 1.43 : 0.98, head = standing ? 1.6 : 1.15;
    // legs
    if (standing) { limb(cx - 8, Y(hip), cx - 9, Y(0.06), 13, PA); limb(cx + 8, Y(hip), cx + 9, Y(0.06), 13, PA); }
    else if (!back) { rr(cx - 17, Y(0.56), 34, 13, 6, PA); limb(cx - 9, Y(0.5), cx - 10, Y(0.08), 11, PA); limb(cx + 9, Y(0.5), cx + 10, Y(0.08), 11, PA); }
    // arms
    const sy = Y(top - 0.05);
    for (const s of [-1, 1]) {
      if (up) { limb(cx + s * 17, sy, cx + s * 24, Y(top + 0.28), 10, SH); limb(cx + s * 24, Y(top + 0.28), cx + s * 28, Y(top + 0.52), 8, SK); ell(cx + s * 28, Y(top + 0.55), 5, 5, SK); }
      else if (standing) { limb(cx + s * 18, sy, cx + s * 21, Y(top - 0.3), 10, SH); limb(cx + s * 21, Y(top - 0.3), cx + s * 20, Y(top - 0.55), 8, SK); }
      else if (!back) { limb(cx + s * 18, sy, cx + s * 20, Y(top - 0.28), 10, SH); limb(cx + s * 20, Y(top - 0.28), cx + s * 10, Y(top - 0.36), 8, SK); }
      else limb(cx + s * 18, sy, cx + s * 20, Y(top - 0.3), 10, SH);
    }
    // torso
    g.fillStyle = SH; g.beginPath();
    g.moveTo(cx - 19, Y(top - 0.02)); g.quadraticCurveTo(cx, Y(top + 0.03), cx + 19, Y(top - 0.02));
    g.lineTo(cx + 16, Y(hip)); g.lineTo(cx - 16, Y(hip)); g.closePath(); g.fill();
    // neck + head + hair
    rr(cx - 5, Y(top + 0.08), 10, 10, 3, SK);
    if (back) { ell(cx, Y(head), 10, 12, HR); }
    else { ell(cx, Y(head), 10, 12, SK); g.fillStyle = HR; g.beginPath(); g.ellipse(cx, Y(head + 0.035), 10.5, 9, 0, Math.PI, 0); g.fill(); }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.premultiplyAlpha = false; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
  return t;
}
function makeFarMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...crowdUniforms, uAtlas: { value: drawAtlas() } },
    vertexShader: `
      attribute vec3 iShirt; attribute vec3 iSkin; attribute vec3 iHair; attribute vec3 iPants; attribute vec4 iScarf; attribute vec4 iMisc; attribute vec2 iFlags;
      uniform float uTime, uCheer, uConcert, uWave, uWaveA, uGoal, uPhoneUp, uShow, uBeat;
      varying vec2 vUv; varying vec3 vS, vK, vH, vP, vTint; varying float vShade;
      ${LIFT_GLSL}
      void main() {
        float standing = iFlags.y;
        if (iFlags.x < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 face = normalize((instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
        float sc = length((instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vec3 toCam3 = normalize(cameraPosition - base);
        vec3 toCam = cameraPosition - base; toCam.y = 0.0; toCam = normalize(toCam);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        vec3 upv = normalize(mix(vec3(0.0, 1.0, 0.0), cross(toCam3, right), 0.55));
        float back = step(dot(face, toCam), 0.0);
        float lift = liftOf(iMisc, iScarf.w);
        float up = step(0.45, lift);
        float frame = standing * 4.0 + back * 2.0 + up;
        vUv = vec2((frame + uv.x) / 8.0, uv.y);
        float jump = lift * 0.06 + uGoal * abs(sin(uTime * 7.0 + iMisc.x * 6.0)) * 0.12 * step(0.18, iMisc.y);
        vec3 p = base + right * position.x * sc + upv * (position.y * sc) + vec3(0.0, jump, 0.0);
        vS = iShirt; vK = iSkin; vH = iHair; vP = iPants;
        vec3 visN = normalize(mix(face, -face, back) + vec3(0.0, 0.25, 0.0)); vTint = stageLight(p + vec3(0.0, 0.6, 0.0), visN);
        vShade = 0.82 + 0.18 * uv.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas; uniform vec3 uLight;
      varying vec2 vUv; varying vec3 vS, vK, vH, vP, vTint; varying float vShade;
      void main() {
        vec4 t = texture2D(uAtlas, vUv);
        if (t.a < 0.5) discard;
        float pants = clamp(1.0 - t.r - t.g - t.b, 0.0, 1.0);
        vec3 col = vS * t.r + vK * t.g + vH * t.b + vP * pants;
        gl_FragColor = vec4(col * uLight * vShade + vTint * (col * 0.9 + 0.06), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/* ---------------- the crowd system ---------------- */
// One far mesh (2 triangles per person, everyone) + two near meshes (full 3D, only people close to the camera).
// That is 3 draw calls for ~47 000 people; all movement happens on the GPU.
const HAND = { seated: [new THREE.Vector3(0.13, 0.66, 0.26), new THREE.Vector3(0.31, 1.57, 0.06)], standing: [new THREE.Vector3(0.22, 0.95, 0.1), new THREE.Vector3(0.30, 2.05, 0.1)] };
export function makeCrowd(scene, people, rand) {
  // people: [{ matrix, pos, phi, standing, seat? , x?, z? }]
  const n = people.length;
  const F = (k) => new Float32Array(n * k);
  const D = { shirt: F(3), skin: F(3), hair: F(3), pants: F(3), scarf: F(4), misc: F(4), flags: F(2), mat: F(16) };
  people.forEach((p, i) => {
    p.idx = i; p.matrix.toArray(D.mat, i * 16);
    SKIN[Math.floor(rand() * SKIN.length)].toArray(D.skin, i * 3);
    HAIR[Math.floor(rand() * HAIR.length)].toArray(D.hair, i * 3);
    PANTS[Math.floor(rand() * PANTS.length)].toArray(D.pants, i * 3);
    const long = rand() < 0.38 ? 1 : 0, phone = rand() < 0.42 ? 4 : 0;
    p.rnd = [rand(), rand(), rand(), rand()];
    D.misc.set([rand(), 0.25 + rand() * 0.75, long + phone, 0], i * 4);
    D.scarf[i * 4 + 3] = p.phi;
    D.flags.set([1, p.standing ? 1 : 0], i * 2);
  });
  // far mesh
  const plane = new THREE.PlaneGeometry(0.62, 2.0); plane.translate(0, 1.0, 0);
  const far = new THREE.InstancedMesh(plane, makeFarMaterial(), n);
  far.instanceMatrix = new THREE.InstancedBufferAttribute(D.mat, 16);
  const IA = (arr, k) => new THREE.InstancedBufferAttribute(arr, k);
  const farAttr = { iShirt: IA(D.shirt, 3), iSkin: IA(D.skin, 3), iHair: IA(D.hair, 3), iPants: IA(D.pants, 3), iScarf: IA(D.scarf, 4), iMisc: IA(D.misc, 4), iFlags: IA(D.flags, 2) };
  for (const [k, a] of Object.entries(farAttr)) plane.setAttribute(k, a);
  far.frustumCulled = false; scene.add(far);
  // near meshes (capacity-limited, refilled when the camera moves)
  const CAP = 4000;
  const mkNear = (pose) => {
    const g = personGeometry(pose, 'near');
    const m = new THREE.InstancedMesh(g, makeNearMaterial(g.userData.headC), CAP);
    const A = { iShirt: IA(new Float32Array(CAP * 3), 3), iSkin: IA(new Float32Array(CAP * 3), 3), iHair: IA(new Float32Array(CAP * 3), 3), iPants: IA(new Float32Array(CAP * 3), 3), iScarf: IA(new Float32Array(CAP * 4), 4), iMisc: IA(new Float32Array(CAP * 4), 4) };
    for (const [k, a] of Object.entries(A)) g.setAttribute(k, a);
    m.count = 0; m.frustumCulled = false; m.receiveShadow = true; scene.add(m);
    return { m, A };
  };
  const near = { seated: mkNear('seated'), standing: mkNear('standing') };
  const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
  people.forEach((p, i) => { X[i] = p.pos.x; Y[i] = p.pos.y; Z[i] = p.pos.z; });
  let nearList = [], lastCam = new THREE.Vector3(1e9, 0, 0), radius = 20, cap = 3000, dirty = true;
  const sys = {
    people, far, near, data: D,
    style(name) {
      const S = STYLES[name];
      people.forEach((p, i) => {
        const [a, b, c, d] = p.rnd;
        C(weighted(S.shirts, a)).toArray(D.shirt, i * 3);
        C(S.scarves[Math.floor(b * S.scarves.length) % S.scarves.length]).toArray(D.scarf, i * 4);
        D.misc[i * 4 + 3] = c < S.scarf ? 1 : 0;
        const z = D.misc[i * 4 + 2]; const hasHat = d < S.hat ? 2 : 0;
        D.misc[i * 4 + 2] = (z % 2) + hasHat + (Math.floor(z / 4) % 2) * 4;
      });
      farAttr.iShirt.needsUpdate = farAttr.iScarf.needsUpdate = farAttr.iMisc.needsUpdate = true; dirty = true;
    },
    setVisible(i, v) { if (D.flags[i * 2] !== (v ? 1 : 0)) { D.flags[i * 2] = v ? 1 : 0; dirty = true; } },
    commit() { farAttr.iFlags.needsUpdate = true; dirty = true; },
    setRange(r, c) { radius = r; cap = c; dirty = true; },
    setEnabled(on) { far.visible = on; near.seated.m.visible = near.standing.m.visible = on; },
    update(cam, force) {
      if (!force && !dirty && cam.distanceToSquared(lastCam) < 4) return false;
      lastCam.copy(cam); dirty = false;
      // restore previous near people to far
      for (const i of nearList) D.flags[i * 2] = D.flags[i * 2] >= 1 ? 1 : 0;
      const r2 = radius * radius, cand = [];
      for (let i = 0; i < n; i++) {
        if (D.flags[i * 2] < 0.5) continue;
        const dx = X[i] - cam.x, dy = Y[i] - cam.y, dz = Z[i] - cam.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r2) cand.push([d2, i]);
      }
      if (cand.length > cap) { cand.sort((a, b) => a[0] - b[0]); cand.length = cap; }
      nearList = cand.map(c => c[1]);
      const cnt = { seated: 0, standing: 0 };
      for (const i of nearList) {
        const kind = D.flags[i * 2 + 1] > 0.5 ? 'standing' : 'seated', N = near[kind], k = cnt[kind]++;
        if (k >= CAP) continue;
        N.m.instanceMatrix.array.set(D.mat.subarray(i * 16, i * 16 + 16), k * 16);
        N.A.iShirt.array.set(D.shirt.subarray(i * 3, i * 3 + 3), k * 3);
        N.A.iSkin.array.set(D.skin.subarray(i * 3, i * 3 + 3), k * 3);
        N.A.iHair.array.set(D.hair.subarray(i * 3, i * 3 + 3), k * 3);
        N.A.iPants.array.set(D.pants.subarray(i * 3, i * 3 + 3), k * 3);
        N.A.iScarf.array.set(D.scarf.subarray(i * 4, i * 4 + 4), k * 4);
        N.A.iMisc.array.set(D.misc.subarray(i * 4, i * 4 + 4), k * 4);
        D.flags[i * 2] = 2; // visible, drawn in 3D → far shader hides values ≠ 1
      }
      for (const kind of ['seated', 'standing']) {
        const N = near[kind]; N.m.count = Math.min(CAP, cnt[kind]);
        N.m.instanceMatrix.needsUpdate = true; for (const a of Object.values(N.A)) a.needsUpdate = true;
      }
      farAttr.iFlags.needsUpdate = true;
      return true;
    },
    nearCount() { return nearList.length; },
  };
  // far shader: draw only flags.x == 1 (2 = drawn as near 3D)
  far.material.vertexShader = far.material.vertexShader.replace('if (iFlags.x < 0.5)', 'if (iFlags.x < 0.5 || iFlags.x > 1.5)');
  sys.hands = (i) => {
    const p = people[i], h = HAND[p.standing ? 'standing' : 'seated'];
    return [h[0].clone().applyMatrix4(p.matrix), h[1].clone().applyMatrix4(p.matrix)];
  };
  return sys;
}

/* ---------------- light show: LED wristbands & phone flashlights ---------------- */
export function makeLightShow(scene, crowd) {
  const n = crowd.people.length, D = crowd.data;
  const rest = new Float32Array(n * 3), up = new Float32Array(n * 3);
  crowd.people.forEach((p, i) => { const [a, b] = crowd.hands(i); a.toArray(rest, i * 3); b.toArray(up, i * 3); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(rest, 3));
  g.setAttribute('aUp', new THREE.BufferAttribute(up, 3));
  g.setAttribute('iMisc', new THREE.BufferAttribute(D.misc, 4));
  g.setAttribute('iScarf', new THREE.BufferAttribute(D.scarf, 4));
  g.setAttribute('iFlags', new THREE.BufferAttribute(D.flags, 2));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...crowdUniforms, uScale: { value: 800 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aUp; attribute vec4 iMisc; attribute vec4 iScarf; attribute vec2 iFlags;
      uniform float uTime, uCheer, uConcert, uWave, uWaveA, uGoal, uPhoneUp, uShow, uBeat, uScale; uniform int uShowMode;
      varying vec3 vCol; varying float vA, vPhone;
      ${LIFT_GLSL}
      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main() {
        float lift = liftOf(iMisc, iScarf.w);
        float isPhone = bit(iMisc.z, 4.0);
        bool phones = uShowMode == 2 || uShowMode == 3, bands = uShowMode == 1 || uShowMode == 3;
        vPhone = (phones && isPhone > 0.5) ? 1.0 : 0.0;
        float show = (vPhone > 0.5) ? smoothstep(0.35, 0.8, lift) : (bands ? 1.0 : 0.0);
        if (iFlags.x < 0.5 || show < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec3 p = mix(position, aUp, lift);
        // LED wristband choreography: cycles every 12 s
        float phi = iScarf.w, t = uTime, beat = sin(t * uBeat * 3.14159) * 0.5 + 0.5;
        float scene = mod(floor(t / 12.0), 4.0);
        vec3 c;
        if (scene < 0.5) c = hue(fract(phi / 6.2831 + t * 0.12));                                   // colour wave around the bowl
        else if (scene < 1.5) c = mix(vec3(1.0, 0.18, 0.54), vec3(0.20, 0.88, 1.0), step(0.5, fract(phi * 2.5 + floor(t * uBeat))));   // sections swap on the beat
        else if (scene < 2.5) c = hue(0.58 + 0.1 * sin(t * 0.3)) * (0.25 + 0.75 * beat);            // whole stadium pulses
        else c = vec3(1.0) * step(0.86, fract(sin(dot(p.xz, vec2(12.9, 78.2)) + floor(t * 6.0)) * 43758.5));  // white twinkle
        vCol = vPhone > 0.5 ? vec3(1.0, 0.96, 0.86) * (0.8 + 0.2 * sin(t * 3.0 + iMisc.x * 40.0)) : c;
        vA = show * uShow;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float sz = uScale * (vPhone > 0.5 ? 0.16 : 0.11) / max(-mv.z, 0.1);
        gl_PointSize = clamp(sz, 1.6, 14.0);
        vA *= clamp(sz / 1.6, 0.15, 1.0);   // tiny far-away lights fade instead of piling up
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vA, vPhone;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(min(vCol * (1.3 + 1.2 * core * core), vec3(2.5)), clamp(vA * core, 0.0, 1.0));
      }`,
  });
  m.uniforms.uShowMode = { value: 0 };
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
  return { points: pts, uniforms: m.uniforms, refresh() { g.attributes.iFlags.needsUpdate = true; g.attributes.iMisc.needsUpdate = true; } };
}

/* ---------------- flags ---------------- */
function flagTexture(kind) {
  const c = document.createElement('canvas'); c.width = 160; c.height = 100; const g = c.getContext('2d');
  if (kind === 'sweden') { g.fillStyle = '#005baa'; g.fillRect(0, 0, 160, 100); g.fillStyle = '#f5c400'; g.fillRect(50, 0, 20, 100); g.fillRect(0, 40, 160, 20); }
  else { for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#f4f4f4' : '#0d3a8e'; g.fillRect(i * 160 / 6, 0, 160 / 6 + 1, 100); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function makeFlags(scene, mounts) {
  // mounts: [{ pos: Vector3 (hand), yaw, phase }]
  const n = mounts.length;
  const pg = new THREE.PlaneGeometry(1.5, 0.95, 10, 3); pg.translate(0.75, 0, 0);
  const tex = { sweden: flagTexture('sweden'), ifk: flagTexture('ifk') };
  const m = new THREE.MeshLambertMaterial({ map: tex.sweden, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = crowdUniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float iPh;')
      .replace('#include <begin_vertex>', 'vec3 transformed = position; float k = position.x / 1.5; transformed.z += sin(position.x * 3.2 - uTime * 6.0 + iPh * 6.28) * 0.16 * k; transformed.y -= k * k * 0.12;');
  };
  const im = new THREE.InstancedMesh(pg, m, n);
  const ph = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); pg.setAttribute('iPh', ph);
  const poleG = new THREE.CylinderGeometry(0.015, 0.015, 1.3, 4); poleG.translate(0, 0.35, 0);
  const poles = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0x8a8f96 }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  mounts.forEach((f, i) => {
    q.setFromAxisAngle(v3(0, 1, 0), f.yaw);
    m4.compose(f.pos.clone().add(v3(0, 0.55, 0)), q, v3(1, 1, 1)); im.setMatrixAt(i, m4);
    m4.compose(f.pos, q, v3(1, 1, 1)); poles.setMatrixAt(i, m4);
    ph.array[i] = f.phase;
  });
  scene.add(im, poles);
  return { mesh: im, poles, setKind(k) { m.map = tex[k] || tex.sweden; m.needsUpdate = true; }, set visible(v) { im.visible = poles.visible = v; } };
}

// Ullevi geometry model — derived from Got Event's official section plan,
// Wikipedia (architecture facts) and Google Earth measurements.
// Scene axes: +x = SE (bearing 139°, Södra porten), -x = NW (Maratonporten),
//             +z = SW (Skånegatan side, sections A–H / P–X), -z = NE (Paradentrén, L/Ä, M–Ö).
import * as THREE from 'three';

export const sstep = THREE.MathUtils.smoothstep;
export const L = 42.2, TR_IN = 36.5, TR_OUT = 46.3, R0 = 51.5;
export const H0 = 1.3, DL = 0.80, RL = 0.36, DU = 0.90, RU = 0.50, GAP = 2.8;
const STR = 2 * L, CUR = Math.PI * R0, TOT = 2 * STR + 2 * CUR;
export const SEG = [STR / TOT, CUR / TOT, STR / TOT, CUR / TOT];
export const S0 = [0, SEG[0], SEG[0] + SEG[1], SEG[0] + SEG[1] + SEG[2]];
export const T_SE_MID = S0[1] + SEG[1] / 2;

export function frame(t) {
  t = ((t % 1) + 1) % 1;
  if (t < S0[1]) { const u = t / SEG[0]; return { cx: -L + 2 * L * u, cz: 0, nx: 0, nz: 1 }; }
  if (t < S0[2]) { const u = (t - S0[1]) / SEG[1], a = Math.PI / 2 - u * Math.PI; return { cx: L, cz: 0, nx: Math.cos(a), nz: Math.sin(a) }; }
  if (t < S0[3]) { const u = (t - S0[2]) / SEG[2]; return { cx: L - 2 * L * u, cz: 0, nx: 0, nz: -1 }; }
  const u = (t - S0[3]) / SEG[3], a = -Math.PI / 2 - u * Math.PI;
  return { cx: -L, cz: 0, nx: Math.cos(a), nz: Math.sin(a) };
}
export const P = (t, d, y) => { const f = frame(t); return [f.cx + f.nx * d, y, f.cz + f.nz * d]; };

// Cross-section of the bowl at perimeter position t.
// Lower ring runs all the way round (22 rows at the ends, 17 on the long sides);
// the upper tier exists on the long sides only: 28 rows on the SW main stand, 35 rows (N/O) on the NE side.
export function profile(t, float = false) {
  const f = frame(t), side = Math.abs(f.nz), sgn = f.nz >= 0 ? 1 : -1;
  const w = sstep(side, 0.58, 0.9);
  let nL = 20 - 3 * sstep(side, 0.5, 0.9);
  let nU = (sgn > 0 ? 28 : 35) * w;
  if (!float) { nL = Math.round(nL); nU = Math.round(nU); if (nU < 3) nU = 0; }
  const band = float ? (sgn > 0 ? 5 : 6) * w : (nU ? (sgn > 0 ? 5 : 6) : 0);
  const lowerBack = R0 + nL * DL, lowerTop = H0 + nL * RL;
  const upStart = lowerBack + band, upY0 = lowerTop + GAP * (float ? w : (nU ? 1 : 0));
  const hasU = float ? w > 0.02 : nU > 0;
  const back = hasU ? upStart + nU * DU + (float ? 2 * (1 - w) : 0) : lowerBack + 2;
  const top = hasU ? upY0 + nU * RU : lowerTop;
  return { f, side, sgn, w, nL, nU, band, lowerBack, lowerTop, upStart, upY0, back, top };
}

// Roof: continuous ring. Depth measured from the back of the stand, tuned so the
// official rule holds: rows 8+ of A,B,C,P,Q,R and rows 28–35 of N,O are covered.
export function roofAt(t) {
  const pr = profile(t, true);
  const deep = pr.sgn > 0 ? (28 * DU - (7 * DU + 0.05)) : (35 * DU - (27 * DU + 0.05));
  const depth = THREE.MathUtils.lerp(5.0, deep, pr.w);
  const front = pr.back - depth;
  const backEdge = pr.back + (pr.sgn > 0 ? THREE.MathUtils.lerp(1.2, 3.5, pr.w) : 1.2);
  const yBack = pr.top + 4.2;
  const yFront = yBack + 1.5;
  return { front, backEdge, yBack, yFront, pr };
}

// Official sections (Got Event arena plan). φ = polar angle of a seat around the centre,
// φ=90° is the SW long side, 270° the NE long side. `u` = segment not named on the official plan.
export const SECTIONS = [
  ['SO1', 'L', 0, 15, 1], ['X', 'L', 15, 30], ['U', 'L', 30, 45], ['T', 'L', 45, 64], ['S', 'L', 64, 90],
  ['D', 'L', 90, 116], ['E', 'L', 116, 135], ['F', 'L', 135, 150], ['H', 'L', 150, 165],
  ['NV1', 'L', 165, 180, 1], ['NV2', 'L', 180, 195, 1], ['NV3', 'L', 195, 212, 1],
  ['NL2', 'L', 212, 232, 1], ['NL1', 'L', 232, 250, 1], ['L', 'L', 250, 270], ['Ä', 'L', 270, 290],
  ['NÄ1', 'L', 290, 308, 1], ['NÄ2', 'L', 308, 328, 1], ['SO3', 'L', 328, 345, 1], ['SO2', 'L', 345, 360, 1],
  ['V', 'U', 28, 42], ['R', 'U', 42, 57], ['Q', 'U', 57, 73], ['P', 'U', 73, 90],
  ['A', 'U', 90, 107], ['B', 'U', 107, 123], ['C', 'U', 123, 138], ['G', 'U', 138, 152],
  ['M', 'U', 208, 232], ['N', 'U', 232, 270], ['O', 'U', 270, 308], ['Ö', 'U', 308, 332],
].map(([name, tier, a, b, u]) => ({ name, tier, a, b, unofficial: !!u }));

export const phiOf = (x, z) => ((Math.atan2(z, x) / Math.PI * 180) + 360) % 360;
export function sectionFor(tier, phi) {
  for (const s of SECTIONS) if (s.tier === tier && phi >= s.a && phi < s.b) return s;
  return null;
}
export function standName(sec, x, z) {
  const phi = phiOf(x, z);
  if (phi > 32 && phi < 148) return 'Skånegatan side (SW)';
  if (phi > 212 && phi < 328) return 'Paradentrén side (NE)';
  if (phi >= 148 && phi <= 212) return 'North-west end';
  return 'South-east end';
}

// Compass: scene +x points to bearing 139°, scene -z to bearing 49°.
export const AXIS = 139;
export function bearingToScene(b) { // returns unit vector (x,z)
  return { x: Math.cos((b - AXIS) * Math.PI / 180), z: -Math.cos((b - 49) * Math.PI / 180) };
}
export function sceneToBearing(x, z) { // inverse
  // world east/north components
  const e = x * 0.656 + (-z) * 0.755, n = x * -0.755 + (-z) * 0.656;
  return ((Math.atan2(e, n) * 180 / Math.PI) + 360) % 360;
}

// Sun position (simplified NOAA / Meeus), Gothenburg.
export const LAT = 57.7058, LON = 11.9872;
export function sunPosition(date) {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86400000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const lam = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(e) * Math.sin(lam));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const H = (gmst * 15 + LON) * rad - ra;
  const la = LAT * rad;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { alt: alt / rad, az: ((az / rad) + 360) % 360 };
}
export function localDate(year, month, day, hours) { // Swedish local time → Date
  const off = (month >= 4 && month <= 10) ? 2 : 1; // CEST approx
  const h = Math.floor(hours), m = Math.round((hours - h) * 60);
  return new Date(Date.UTC(year, month - 1, day, h - off, m));
}
export function sunTimes(year, month, day) {
  let rise = null, set = null, prev = null;
  for (let m = 0; m <= 24 * 60; m += 5) {
    const a = sunPosition(localDate(year, month, day, m / 60)).alt;
    if (prev !== null) {
      if (prev < -0.83 && a >= -0.83 && rise === null) rise = m / 60;
      if (prev >= -0.83 && a < -0.83) set = m / 60;
    }
    prev = a;
  }
  return { rise, set };
}

export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

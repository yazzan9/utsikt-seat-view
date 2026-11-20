// Ullevi entrances, positioned from Got Event's official arena plan (ullevi_arenaplan_2026_a4.pdf).
// Angles are measured around the arena centre in scene space (φ = atan2(z, x), 90° = Skånegatan side, 270° = Paradentrén).
// Got Event does not publish a fixed section→entrance list (it is printed on each ticket and varies per event),
// so the tool recommends the nearest public entrance and lets the user override it with the one on their ticket.
import * as THREE from 'three';
import { P, profile, frame, phiOf } from './model.js';

export const GATES = [
  { id: '1', label: 'Entré 1', phi: 106, note: 'Stairs up from Skånegatan side' },
  { id: '2', label: 'Entré 2', phi: 124 },
  { id: '3', label: 'Entré 3', phi: 145, note: 'Norra porten' },
  { id: '4/5', label: 'Entré 4 / 5', phi: 199, note: 'Maratonporten' },
  { id: '6/7', label: 'Entré 6 / 7', phi: 341, note: 'Blå porten' },
  { id: '8', label: 'Entré 8', phi: 34 },
  { id: '9', label: 'Entré 9', phi: 57, note: 'Lift · wheelchair seats in section U', access: true },
  { id: '10', label: 'Entré 10', phi: 75, note: 'Stairs up from Skånegatan side' },
  { id: 'PARAD', label: 'Paradentrén', phi: 270, note: 'VIP, press & guests', vip: true },
  { id: 'SODRA', label: 'Södra porten', phi: 6, note: 'Planen · standing floor at concerts', floor: true },
];
export const TRAMS = [
  { name: 'Ullevi Norra', pos: new THREE.Vector3(-168, 0, 60) },
  { name: 'Ullevi Södra', pos: new THREE.Vector3(-14, 0, 200) },
];

// --- perimeter helpers: an outer walkway ring around the facade, parameterised by arc length
const N = 720;
const RING = [], CON = [];
function tAtPhi(phi) {
  let best = 0, bd = 1e9;
  for (let k = 0; k < 2000; k++) {
    const t = k / 2000, pr = profile(t, true), p = P(t, pr.back, 0);
    const d = Math.abs(((phiOf(p[0], p[2]) - phi + 540) % 360) - 180);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
let ringLen = 0;
(function buildRing() {
  let acc = 0, prev = null;
  for (let k = 0; k <= N; k++) {
    const t = k / N, pr = profile(t, true);
    const p = new THREE.Vector3(...P(t, pr.back + 9, 0.3));
    if (prev) acc += p.distanceTo(prev);
    RING.push({ t, p, s: acc }); prev = p;
    CON.push({ t, p: new THREE.Vector3(...P(t, pr.back - 4, 0.4)) });
  }
  ringLen = acc;
})();
const ringIdx = (t) => Math.round((((t % 1) + 1) % 1) * N);
for (const g of GATES) {
  g.t = tAtPhi(g.phi);
  const pr = profile(g.t, true);
  g.pos = new THREE.Vector3(...P(g.t, pr.back + 1.5, 0));
  g.out = RING[ringIdx(g.t)].p.clone();
  g.s = RING[ringIdx(g.t)].s;
}
function arc(sA, sB) { const d = Math.abs(sA - sB); return Math.min(d, ringLen - d); }
function ringPath(tA, tB, list = RING) {
  const a = ringIdx(tA), b = ringIdx(tB);
  let fwd = (b - a + N) % N, step = fwd <= N / 2 ? 1 : -1, n = step > 0 ? fwd : N - fwd;
  const pts = [];
  for (let i = 0, k = a; i <= n; i++, k = (k + step + N) % N) if (i % 6 === 0 || i === n) pts.push(list[k].p.clone());
  return pts;
}

// --- public API
export function recommendGate(sel) {
  if (sel.floor) return GATES.find(g => g.floor);
  if (sel.block && sel.block.name === 'U') return GATES.find(g => g.access);
  const s = RING[ringIdx(sel.t)].s;
  let best = null, bd = 1e9;
  for (const g of GATES) { if (g.vip || g.floor) continue; const d = arc(s, g.s); if (d < bd) { bd = d; best = g; } }
  return best;
}
export function sectionsForGate(blocks, gate) {
  return blocks.filter(b => { const mid = b.seats[Math.floor(b.seats.length / 2)]; return recommendGate(mid) === gate; });
}

// Builds the walk: tram stop → outer ring → entrance → concourse → section aisle → seat.
export function buildRoute(sel, gate, eye) {
  // choose tram stop with the shortest outside walk
  let best = null;
  for (const tr of TRAMS) {
    let bi = 0, bd = 1e9;
    RING.forEach((r, i) => { const d = r.p.distanceTo(tr.pos); if (d < bd) { bd = d; bi = i; } });
    const total = bd + arc(RING[bi].s, gate.s);
    if (!best || total < best.total) best = { tr, i: bi, total };
  }
  const outside = [best.tr.pos.clone().setY(0.3), ...ringPath(RING[best.i].t, gate.t), gate.pos.clone().setY(0.3)];
  const inside = [gate.pos.clone().setY(0.4)];
  if (sel.floor) {
    inside.push(new THREE.Vector3(60, 0.4, 0), sel.pos.clone().setY(0.4));
  } else {
    const t = sel.t, pr = profile(t);
    inside.push(...ringPath(gate.t, t, CON).slice(1));
    const isUpper = sel.tier === 'U';
    const aisleD = isUpper ? pr.lowerBack + pr.band / 2 : pr.nU ? pr.lowerBack + pr.band / 2 : pr.lowerBack - 0.4;
    const aisleY = (isUpper || pr.nU ? pr.lowerTop : pr.lowerTop) + 0.2;
    inside.push(new THREE.Vector3(...P(t, pr.back - 4, aisleY)));       // stairs up inside the stand
    inside.push(new THREE.Vector3(...P(t, aisleD, aisleY)));            // out onto the walkway / top of section
    inside.push(eye.clone().setY(sel.pos.y + 0.3));                     // along the aisle to the row
  }
  const len = (pts) => pts.reduce((a, p, i) => i ? a + p.distanceTo(pts[i - 1]) : 0, 0);
  const lo = len(outside), li = len(inside);
  return { tram: best.tr, outside, inside, outsideM: Math.round(lo), meters: Math.round(lo + li), minutes: Math.max(1, Math.round((lo + li) / 1.2 / 60)) };
}

// --- 3D drawing
function dashTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 8; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 8); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(40, 0, 24, 8);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
}
export function makeRouteLayer(scene) {
  const grp = new THREE.Group(); grp.renderOrder = 10; scene.add(grp);
  const tex = dashTexture();
  const mats = {
    out: new THREE.MeshBasicMaterial({ color: 0xa8e6a0, map: tex, transparent: true }),
    inn: new THREE.MeshBasicMaterial({ color: 0xa8e6a0, map: tex.clone(), transparent: true, opacity: 0.95 }),
    ghost: new THREE.MeshBasicMaterial({ color: 0xa8e6a0, transparent: true, opacity: 0.35, depthTest: false }),
  };
  mats.inn.map.wrapS = THREE.RepeatWrapping;
  const tube = (pts, r, mat) => {
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 0.01) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    const len = path.getLength();
    const g = new THREE.TubeGeometry(path, Math.max(8, Math.round(len / 2)), r, 6, false);
    const m = new THREE.Mesh(g, mat); m.userData.len = len; return m;
  };
  // gate markers (always visible)
  const gateMarkers = new THREE.Group(); scene.add(gateMarkers);
  for (const g of GATES) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.25, 24), new THREE.MeshBasicMaterial({ color: g.vip ? 0x5f6b7d : 0x0e1420 }));
    disc.position.copy(g.out).setY(0.15); disc.visible = false; gateMarkers.add(disc); g.disc = disc;
  }
  let anim = null;
  return {
    group: grp, gateMarkers,
    show(route) {
      grp.clear();
      if (!route) return;
      const o = tube(route.outside, 0.9, mats.out), i = tube(route.inside, 0.45, mats.inn), gh = tube(route.inside, 0.45, mats.ghost);
      mats.out.map.repeat.set(o.userData.len / 6, 1); mats.inn.map.repeat.set(i.userData.len / 3, 1);
      grp.add(o, i, gh);
      anim = { o, i };
    },
    highlight(gate) { for (const g of GATES) { g.disc.visible = g === gate; g.disc.material.color.set(0xa8e6a0); g.disc.scale.setScalar(1.4); } },
    tick(time) { mats.out.map.offset.x = -time * 0.8; mats.inn.map.offset.x = -time * 1.2; },
  };
}

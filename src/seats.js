import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { R0, H0, DL, RL, DU, RU, frame, P, profile, roofAt, SECTIONS, sectionFor, phiOf, standName, T_SE_MID, mulberry32 } from './model.js';

export const SEAT_BLUE = new THREE.Color(0x2f5e9c), SEAT_RED = new THREE.Color(0xa22b30);

const seatGeo = (() => {
  const pan = new THREE.BoxGeometry(0.44, 0.07, 0.40); pan.translate(0, 0.43, 0.04);
  const back = new THREE.BoxGeometry(0.44, 0.40, 0.06); back.translate(0, 0.66, -0.17);
  return mergeGeometries([pan, back]);
})();

// "ULLEVI" spelt in seats on both long-side lower tiers: blue letters on red.
function letterMask() {
  const W = 760, H = 140, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f00'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#00f'; g.font = '900 150px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.scale(1, 0.72); g.fillText('ULLEVI', W / 2, H / 2 / 0.72 + 6); g.restore();
  const data = g.getImageData(0, 0, W, H).data;
  return (u, v) => { const x = Math.min(W - 1, Math.max(0, Math.floor(u * W))), y = Math.min(H - 1, Math.max(0, Math.floor((1 - v) * H))); const i = (y * W + x) * 4; return data[i + 2] > 128 ? 'blue' : 'red'; };
}

export function buildSeats(scene) {
  const rand = mulberry32(1958);
  const mask = letterMask();
  const blocks = new Map();
  for (const s of SECTIONS) blocks.set(s.tier + s.name, { ...s, id: 0, seats: [], rows: [] });
  const seats = [];
  const SAMPLES = 12000;
  for (const tier of ['L', 'U']) {
    const maxRows = tier === 'L' ? 22 : 35;
    for (let r = 0; r < maxRows; r++) {
      const cands = []; let last = null, acc = null;
      for (let s = 0; s <= SAMPLES; s++) {
        const t = T_SE_MID + s / SAMPLES, pr = profile(t);
        let d, y;
        if (tier === 'L') { if (r >= pr.nL) { last = null; acc = null; cands.push(null); continue; } d = R0 + r * DL + 0.45; y = H0 + r * RL; }
        else { if (r >= pr.nU) { last = null; acc = null; cands.push(null); continue; } d = pr.upStart + r * DU + 0.5; y = pr.upY0 + r * RU; }
        const p = P(t, d, y);
        if (last && Math.hypot(p[0] - last[0], p[2] - last[2], p[1] - last[1]) > 1.0) { cands.push(null); acc = null; }
        if (!acc || Math.hypot(p[0] - acc[0], p[2] - acc[2]) >= 0.5) { cands.push({ t, p, d }); acc = p; }
        last = p;
      }
      // group by section; first & last of each run become the aisle
      let run = [], runSec = null;
      const flush = () => {
        if (runSec && run.length > 2) {
          const b = blocks.get(tier + runSec.name);
          const rowSeats = [];
          run.slice(1, -1).forEach((cd, k) => {
            const f = frame(cd.t);
            const seat = {
              block: b, tier, row: r + 1, num: k + 1, t: cd.t, d: cd.d,
              pos: new THREE.Vector3(cd.p[0], cd.p[1], cd.p[2]), n: new THREE.Vector2(f.nx, f.nz),
              taken: false, crowd: -1, local: 0, idx: 0,
            };
            rowSeats.push(seat);
          });
          if (rowSeats.length) { b.rows[r] = (b.rows[r] || []).concat(rowSeats); }
        }
        run = []; runSec = null;
      };
      for (const cd of cands) {
        if (!cd) { flush(); continue; }
        const sec = sectionFor(tier, phiOf(cd.p[0], cd.p[2]));
        if (sec !== runSec) { flush(); runSec = sec; }
        run.push(cd);
      }
      flush();
    }
  }
  // finalise blocks: renumber seats within each row, compute occupancy & colours
  const list = [];
  for (const b of blocks.values()) {
    b.rows = b.rows.filter(Boolean);
    if (!b.rows.length) continue;
    b.rows.forEach((row, ri) => row.forEach((s, k) => { s.num = k + 1; s.rowIdx = ri; }));
    b.seats = b.rows.flat();
    b.id = list.length; list.push(b);
  }
  // seat colours & occupancy
  for (const b of list) {
    b.occ = 0.42 + rand() * 0.4;
    for (const s of b.seats) {
      s.idx = seats.length; seats.push(s);
      const lift = 1 - Math.min(1, s.row / (b.tier === 'U' ? 40 : 26)) * 0.25;
      s.taken = rand() < b.occ * lift + Math.sin(s.num * 0.31 + s.row * 1.3 + b.id) * 0.12;
      s.fan = s.taken || rand() < 0.86; // match-day crowd (atmosphere), independent of ticket availability
      let c = SEAT_BLUE;
      if (s.tier === 'L' && Math.abs(s.n.y) > 0.99 && Math.abs(s.pos.x) < 38 && s.row >= 3 && s.row <= 16) {
        const u = s.n.y > 0 ? (38 - s.pos.x) / 76 : (s.pos.x + 38) / 76;
        const v = (s.row - 3) / 13;
        c = mask(u, v) === 'blue' ? SEAT_BLUE : SEAT_RED;
      }
      s.base = c.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.035);
    }
    { const cx = b.seats.reduce((a, s) => a + s.pos.x, 0) / b.seats.length, cz = b.seats.reduce((a, s) => a + s.pos.z, 0) / b.seats.length; b.stand = standName(b, cx, cz); }
    const k = b.name.replace(/\D/g, '');
    b.title = !b.unofficial ? 'Section ' + b.name : b.name.startsWith('NV') ? 'North-west end · block ' + k : b.name.startsWith('SO') ? 'South-east end · block ' + k : b.name.startsWith('NL') ? 'Lower NE (west) · block ' + k : 'Lower NE (east) · block ' + k;
    b.center = new THREE.Vector3(); b.seats.forEach(s => b.center.add(s.pos)); b.center.divideScalar(b.seats.length);
    b.midT = b.seats[Math.floor(b.seats.length / 2)].t;
    // covered by the roof? (geometric test against the roof model)
    for (const s of b.seats) { const r = roofAt(s.t); s.covered = s.d > r.front + 0.0; }
    // outline for the 2D plan: front row, right edge, back row, left edge
    const pts = [];
    const first = b.rows[0], lastRow = b.rows[b.rows.length - 1];
    const off = (s, k) => [s.pos.x + s.n.x * k, s.pos.z + s.n.y * k];
    const step = (arr) => arr.filter((_, i) => i % 3 === 0 || i === arr.length - 1);
    step(first).forEach(s => pts.push(off(s, -0.45)));
    b.rows.forEach(r => pts.push(off(r[r.length - 1], 0)));
    step([...lastRow].reverse()).forEach(s => pts.push(off(s, 0.5)));
    [...b.rows].reverse().forEach(r => pts.push(off(r[0], 0)));
    b.poly = pts;
  }

  // instanced seats per block
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
  const seatMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const matrixFor = (s, scale = ONE, y = 0) => { q.setFromAxisAngle(UP, Math.atan2(-s.n.x, -s.n.y)); return m4.compose(new THREE.Vector3(s.pos.x, s.pos.y + y, s.pos.z), q, scale); };
  for (const b of list) {
    const im = new THREE.InstancedMesh(seatGeo, seatMat, b.seats.length);
    b.seats.forEach((s, k) => { s.local = k; im.setMatrixAt(k, matrixFor(s)); im.setColorAt(k, s.base); });
    im.receiveShadow = true; im.userData.block = b; im.computeBoundingSphere(); b.mesh = im; scene.add(im);
  }
  // seated crowd (people only; meshes are built by the crowd system)
  const crowdSeats = seats.filter(s => s.fan);
  const people = crowdSeats.map(s => {
    const kid = rand() < 0.06, sc = kid ? 0.8 : 0.96 + rand() * 0.08;
    const m = matrixFor(s, new THREE.Vector3(sc, sc, sc)).clone();
    const p = { matrix: m, pos: s.pos, phi: Math.atan2(s.pos.z, s.pos.x), standing: false, seat: s, scale: sc };
    s.person = p; return p;
  });
  return { seats, blocks: list, crowd: { people, seats: crowdSeats }, matrixFor };
}

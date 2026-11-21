// Seat search: free-text parser + suggestions + Section/Row/Seat pickers.
// Understands e.g. "A 12 8", "A12-8", "sektion A rad 12 plats 8", "section Ä row 3 seat 14",
// "AE 3 14", "N, row 21", "planen" / "floor".
const KEYWORDS = new Set(['SEKTION', 'SECTION', 'SECT', 'SEKT', 'SEK', 'SEC', 'BLOCK', 'RAD', 'ROW', 'PLATS', 'SEAT', 'STOL', 'NR', 'NO', 'NUMMER', 'NUMBER', 'UPPER', 'LOWER', 'ÖVRE', 'NEDRE', 'OVRE']);
const FLOOR = new Set(['PLANEN', 'FLOOR', 'GOLV', 'GOLVET', 'STÅPLATS', 'STAPLATS', 'STANDING', 'PLAN']);

export function tokenize(q) {
  let s = (q || '').toUpperCase().normalize('NFC');
  s = s.replace(/[^A-Z0-9ÅÄÖ]+/g, ' ');
  s = s.replace(/([A-ZÅÄÖ])(\d)/g, '$1 $2').replace(/(\d)([A-ZÅÄÖ])/g, '$1 $2');
  return s.split(' ').filter(Boolean);
}

export function parseQuery(q, blocks) {
  const toks = tokenize(q);
  const out = { section: null, row: null, seat: null, floor: false, partial: '', raw: q, tokens: toks };
  const byName = new Map(blocks.map(b => [b.name.toUpperCase(), b]));
  const alias = (t) => t === 'AE' ? 'Ä' : t === 'OE' ? 'Ö' : t;
  const nums = [];
  for (let i = 0; i < toks.length; i++) {
    const t = alias(toks[i]);
    if (FLOOR.has(t)) { out.floor = true; continue; }
    if (KEYWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) { nums.push(+t); continue; }
    if (!out.section) {
      // unofficial blocks are letters+digit (NV1, SO2, NL1, NÄ2): join with the following number
      if (i + 1 < toks.length && /^\d$/.test(toks[i + 1]) && byName.has(t + toks[i + 1])) { out.section = byName.get(t + toks[i + 1]); i++; continue; }
      if (byName.has(t)) { out.section = byName.get(t); continue; }
      out.partial = t;
    }
  }
  if (nums.length) out.row = nums[0];
  if (nums.length > 1) out.seat = nums[1];
  return out;
}

// Turns a parsed query into an ordered list of suggestions: {kind, title, sub, action, ok}
export function suggest(p, blocks, ctx) {
  const res = [];
  if (p.floor) {
    if (ctx.mode === 'concert') res.push({ kind: 'floor', title: 'Planen · standing floor', sub: 'Stand in the middle of the floor and look at the stage', ok: true, action: { floor: true } });
    else res.push({ kind: 'info', title: 'Planen is only open at concerts', sub: 'Switch to Concert at the top to stand on the floor' });
    return res;
  }
  const b = p.section;
  if (!b) {
    const pre = p.partial;
    const list = blocks.filter(x => !pre || x.name.toUpperCase().startsWith(pre) || (pre.length > 2 && x.title.toUpperCase().includes(pre)))
      .sort((x, y) => (x.unofficial - y.unofficial) || x.name.localeCompare(y.name, 'sv'));
    if (pre && !list.length) res.push({ kind: 'info', title: `No section called “${pre}”`, sub: 'Ullevi sections are letters A–Ö, e.g. A, N, Ä' });
    for (const x of list.slice(0, pre ? 8 : 6)) res.push({ kind: 'section', title: x.unofficial ? x.title : `Section ${x.name}`, sub: `${x.stand} · rows 1–${x.rows.length}`, ok: true, action: { block: x } });
    return res;
  }
  const rows = b.rows.length;
  if (p.row == null) {
    res.push({ kind: 'section', title: b.unofficial ? b.title : `Section ${b.name}`, sub: `${b.stand} · ${rows} rows · type a row, e.g. “${b.name} ${Math.min(12, rows)}”`, ok: true, action: { block: b } });
    return res;
  }
  if (p.row < 1 || p.row > rows) {
    res.push({ kind: 'error', title: `Row ${p.row} doesn't exist in ${b.name}`, sub: `${b.name} has rows 1–${rows}` });
    const near = Math.max(1, Math.min(rows, p.row));
    res.push({ kind: 'row', title: `Section ${b.name} · Row ${near}`, sub: `Closest row`, ok: true, action: { block: b, row: near } });
    return res;
  }
  const row = b.rows[p.row - 1];
  if (p.seat == null) {
    res.push({ kind: 'row', title: `Section ${b.name} · Row ${p.row}`, sub: `Seats 1–${row.length} · add your seat number`, ok: true, action: { block: b, row: p.row } });
    const mid = row[Math.floor(row.length / 2)];
    res.push({ kind: 'seat', title: `Middle of the row · Seat ${mid.num}`, sub: 'See the view from the middle of this row', ok: true, action: { seat: mid } });
    return res;
  }
  const seat = row.find(s => s.num === p.seat);
  if (!seat) {
    res.push({ kind: 'error', title: `Seat ${p.seat} isn't in row ${p.row}`, sub: `Row ${p.row} in ${b.name} has seats 1–${row.length}` });
    const near = row[Math.max(0, Math.min(row.length - 1, p.seat - 1))];
    res.push({ kind: 'seat', title: `Section ${b.name} · Row ${p.row} · Seat ${near.num}`, sub: 'Closest seat', ok: true, action: { seat: near } });
    return res;
  }
  res.push({ kind: 'seat', title: `Section ${b.name} · Row ${p.row} · Seat ${seat.num}`, sub: seat.blocked ? 'Behind the stage at concerts — you can still preview it' : `${b.stand} · see the view from this seat`, ok: true, primary: true, action: { seat } });
  return res;
}

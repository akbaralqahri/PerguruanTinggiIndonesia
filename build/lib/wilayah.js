'use strict';

// Parses cahyadsn/wilayah `wilayah_level_1_2.sql` (MIT, sourced from
// Kepmendagri) into records with centroid, area, population and boundaries.
//
// Several upstream quirks are handled here, all found by validating the parse:
//   1. A `-- [12] SUMATERA UTARA` comment sits between VALUES and its tuple.
//      Skipping SQL comments is required or Sumatera Utara is silently lost.
//   2. Kota Banjar (32.79) has a truncated `path` missing its final bracket.
//   3. `path` nesting is not consistent across rows (see collectRings).

const COLS = ['kode', 'nama', 'ibukota', 'lat', 'lng', 'elv', 'tz', 'luas', 'penduduk', 'path', 'status'];

function parseTuples(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const vi = text.indexOf('VALUES', i);
    if (vi === -1) break;
    i = vi + 6;
    while (i < n) {
      for (;;) { // skip whitespace and `-- ...` line comments
        while (i < n && /\s/.test(text[i])) i++;
        if (text[i] === '-' && text[i + 1] === '-') {
          const nl = text.indexOf('\n', i);
          i = nl === -1 ? n : nl + 1;
          continue;
        }
        break;
      }
      if (text[i] === ';') { i++; break; }
      if (text[i] === ',') { i++; continue; }
      if (text[i] !== '(') break;
      i++;
      const fields = [];
      let cur = '', inQ = false, isStr = false;
      while (i < n) {
        const c = text[i];
        if (inQ) {
          if (c === '\\') { cur += text[i + 1]; i += 2; continue; }
          if (c === "'") {
            if (text[i + 1] === "'") { cur += "'"; i += 2; continue; }
            inQ = false; i++; continue;
          }
          cur += c; i++; continue;
        }
        if (c === "'") { inQ = true; isStr = true; i++; continue; }
        if (c === ',') { fields.push(isStr ? cur : cur.trim()); cur = ''; isStr = false; i++; continue; }
        if (c === ')') { fields.push(isStr ? cur : cur.trim()); cur = ''; isStr = false; i++; break; }
        cur += c; i++;
      }
      out.push(fields);
    }
  }
  return out;
}

// Repairs a `path` whose brackets are unbalanced by appending the missing
// closers. Only ever adds `]` — never invents coordinates.
function parsePath(raw, kode, warn) {
  if (!raw || raw === 'NULL') return null;
  const s = raw.trim();
  try {
    return JSON.parse(s);
  } catch (e) {
    let open = 0, close = 0;
    for (const ch of s) { if (ch === '[') open++; else if (ch === ']') close++; }
    if (open > close) {
      const repaired = s + ']'.repeat(open - close);
      try {
        const v = JSON.parse(repaired);
        warn(`path ${kode}: unbalanced brackets, appended ${open - close} "]"`);
        return v;
      } catch (_) { /* fall through */ }
    }
    warn(`path ${kode}: unparseable, dropped`);
    return null;
  }
}

const depth = a => { let d = 0, c = a; while (Array.isArray(c)) { d++; c = c[0]; } return d; };

// `path` nesting varies row to row, and assuming one shape silently drops
// geometry. Observed across the 552 wilayah:
//   - 246 rows: a flat ring          [[lat,lng], [lat,lng], ...]
//   - 303 rows: a list of rings      [[[lat,lng], ...], ...]
//   -   3 rows: a list of polygons   [[[[lat,lng], ...], ...], ...]   (92, 96, 96.01)
//   -   1 row : Kota Semarang (33.74) mixes both — a 6-point ring sits at
//               index 0, followed by 136 bare points forming the main body.
// So rather than branch on the outer depth, walk the elements: consecutive
// bare points accumulate into a ring, nested arrays are rings in their own
// right, and deeper nesting recurses.
function collectRings(node) {
  const rings = [];
  let flat = [];
  const flush = () => { if (flat.length >= 4) rings.push(flat); flat = []; };
  for (const el of node) {
    const d = depth(el);
    if (d === 1) {
      if (el.length === 2 && typeof el[0] === 'number' && typeof el[1] === 'number') flat.push(el);
    } else if (d === 2) {
      flush();
      rings.push(el);
    } else if (d >= 3) {
      flush();
      rings.push(...collectRings(el));
    }
  }
  flush();
  return rings;
}

function parseWilayahSQL(sql, warn = () => {}) {
  const num = v => (v === 'NULL' || v === '' || v == null) ? null : Number(v);
  const recs = [];
  for (const t of parseTuples(sql)) {
    if (t.length !== COLS.length) continue;
    const o = Object.fromEntries(COLS.map((c, k) => [c, t[k]]));
    recs.push({
      kode: o.kode,
      nama: o.nama.trim(), // 31.72 has a trailing space upstream
      ibukota: o.ibukota === 'NULL' ? null : o.ibukota,
      lat: num(o.lat), lng: num(o.lng),
      luas: num(o.luas), penduduk: num(o.penduduk),
      // normalised to a flat list of rings; points stay [lat, lng]
      rings: (() => {
        const p = parsePath(o.path, o.kode, warn);
        if (!p || !Array.isArray(p)) return null;
        const rings = collectRings(p);
        if (!rings.length) { warn(`path ${o.kode}: no usable rings`); return null; }
        return rings;
      })(),
    });
  }
  return recs;
}

module.exports = { parseWilayahSQL };

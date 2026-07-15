'use strict';

// Corrections for defects in the upstream wilayah boundaries.
//
// Every entry was found by cross-checking each wilayah's `path` polygon
// against its `lat`/`lng` column — two independent fields, so when they
// disagree something is genuinely wrong. Only defects with unambiguous
// evidence are corrected; the rest are dropped rather than guessed at.

// A wilayah's ibukota point must fall inside its own bounding box. Allow
// generous slack so this only ever fires on gross errors, not on sprawling
// wilayah where the point sits slightly off the simplified outline.
const CENTROID_TOLERANCE_DEG = 0.35;

// Wakatobi's lng reads 23.539 — that is in the Congo basin, ~100 degrees west
// of Sulawesi. Its polygon sits correctly at 123.46..124.62, so the leading
// "1" was simply dropped from the coordinate column.
const CENTROID_FIX = {
  '74.07': { lng: 123.539, why: 'kolom lng 23.539 kehilangan angka 1; poligonnya sendiri berada di 123.46..124.62' },
};

// Sangihe's polygon sits on Talaud's centroid and Talaud's sits on Sangihe's:
// the two boundaries are swapped upstream. The evidence is mutual, so the
// swap is safe to undo.
const RINGS_SWAP = [['71.03', '71.04', 'poligon Sangihe dan Talaud tertukar di sumber; bbox masing-masing memuat centroid yang lain']];

// Boundaries that are simply wrong and cannot be reconstructed. These wilayah
// keep their statistics and table rows; only their polygon is withheld, so
// the map never draws a shape we know to be false.
const DROP_GEOMETRY = {
  '12.18': 'path hanya 14 titik seluas ~1,7 km2 di lokasi yang salah, sedangkan luas resminya 1.950 km2',
  '14.10': 'path membentang di lng 104,2..108,0 padahal Kepulauan Meranti berada di lng ~102,7',
  '32.18': 'ring utama berada di lat -7,14..-6,70 / lng 107,18..107,73, jauh dari Pangandaran (-7,62 / 108,50)',
};

function bboxOfRings(rings) {
  let y0 = Infinity, x0 = Infinity, y1 = -Infinity, x1 = -Infinity;
  for (const ring of rings) for (const [la, ln] of ring) {
    if (ln < x0) x0 = ln; if (ln > x1) x1 = ln;
    if (la < y0) y0 = la; if (la > y1) y1 = la;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Applies the known fixes in place and re-validates every wilayah.
 * @returns {{applied: string[], dropped: Object, unexpected: string[]}}
 */
function applyGeoFixes(records, warn = () => {}) {
  const byKode = new Map(records.map(r => [r.kode, r]));
  const applied = [];

  for (const [kode, fix] of Object.entries(CENTROID_FIX)) {
    const r = byKode.get(kode);
    if (!r) { warn(`geofix: ${kode} tidak ditemukan`); continue; }
    if (fix.lng != null) r.lng = fix.lng;
    if (fix.lat != null) r.lat = fix.lat;
    applied.push(`${kode} ${r.nama}: centroid diperbaiki (${fix.why})`);
  }

  for (const [a, b, why] of RINGS_SWAP) {
    const ra = byKode.get(a), rb = byKode.get(b);
    if (!ra || !rb) { warn(`geofix: swap ${a}/${b} tidak lengkap`); continue; }
    const t = ra.rings; ra.rings = rb.rings; rb.rings = t;
    applied.push(`${a} ${ra.nama} <-> ${b} ${rb.nama}: poligon ditukar balik (${why})`);
  }

  for (const [kode, why] of Object.entries(DROP_GEOMETRY)) {
    const r = byKode.get(kode);
    if (!r) { warn(`geofix: ${kode} tidak ditemukan`); continue; }
    r.geoUnusable = why;
    r.rings = null;
    applied.push(`${kode} ${r.nama}: poligon dibuang (${why})`);
  }

  // Re-run the check that found all of the above, so a future data refresh
  // that introduces a new defect surfaces here instead of silently drawing
  // the wrong shape.
  const unexpected = [];
  for (const r of records) {
    if (!r.rings || r.lat == null || r.lng == null) continue;
    const b = bboxOfRings(r.rings);
    const inX = r.lng >= b.x0 - CENTROID_TOLERANCE_DEG && r.lng <= b.x1 + CENTROID_TOLERANCE_DEG;
    const inY = r.lat >= b.y0 - CENTROID_TOLERANCE_DEG && r.lat <= b.y1 + CENTROID_TOLERANCE_DEG;
    if (!inX || !inY) {
      unexpected.push(`${r.kode} ${r.nama}: centroid (${r.lat.toFixed(2)}, ${r.lng.toFixed(2)}) di luar bbox poligonnya (lat ${b.y0.toFixed(2)}..${b.y1.toFixed(2)}, lng ${b.x0.toFixed(2)}..${b.x1.toFixed(2)})`);
    }
  }

  return { applied, dropped: DROP_GEOMETRY, unexpected };
}

module.exports = { applyGeoFixes, DROP_GEOMETRY, CENTROID_FIX, RINGS_SWAP, CENTROID_TOLERANCE_DEG };

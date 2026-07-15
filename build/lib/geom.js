'use strict';

// Polygon reduction. The raw Kepmendagri boundaries are ~747k vertices across
// ~74k rings — far too heavy for an interactive Leaflet layer. We drop
// negligible islets and simplify what remains, always keeping each wilayah's
// largest ring so nothing disappears from the map entirely.

// Shoelace area in squared degrees. Only used to rank/threshold rings against
// each other, so leaving it in degrees (rather than projecting) is fine.
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(a / 2);
}

function perpDist(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

// Iterative Douglas-Peucker: recursion overflows the stack on the largest
// rings (Kepulauan Anambas alone carries 48k vertices).
function simplifyRing(pts, tol) {
  if (pts.length <= 4) return pts;
  const sq = tol * tol;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDist(pts[i], pts[first], pts[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sq && idx !== -1) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/**
 * Convert source rings ([lat,lng]) into a GeoJSON MultiPolygon ([lng,lat]).
 * @param {number} tol       simplification tolerance in degrees
 * @param {number} minArea   drop rings smaller than this (deg^2)
 */
function ringsToMultiPolygon(rings, tol, minArea) {
  if (!rings || !rings.length) return null;

  const scored = rings
    .filter(r => Array.isArray(r) && r.length >= 4)
    .map(r => ({ r, a: ringArea(r) }))
    .sort((x, y) => y.a - x.a);
  if (!scored.length) return null;

  // always keep the largest ring, even if it falls under minArea
  const kept = scored.filter((s, i) => i === 0 || s.a >= minArea);

  const polys = [];
  for (const { r } of kept) {
    let ring = simplifyRing(r, tol);
    if (ring.length < 4) ring = r.length >= 4 ? r.slice(0, 4) : null;
    if (!ring) continue;
    // swap [lat,lng] -> [lng,lat] and round; 4dp ~= 11 m, plenty here
    const coords = ring.map(p => [
      Math.round(p[1] * 1e4) / 1e4,
      Math.round(p[0] * 1e4) / 1e4,
    ]);
    const f = coords[0], l = coords[coords.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) coords.push([f[0], f[1]]); // close ring
    if (coords.length < 4) continue;
    polys.push([coords]);
  }
  if (!polys.length) return null;
  return { type: 'MultiPolygon', coordinates: polys };
}

function countVertices(geom) {
  if (!geom) return 0;
  let n = 0;
  for (const poly of geom.coordinates) for (const ring of poly) n += ring.length;
  return n;
}

module.exports = { ringsToMultiPolygon, countVertices, ringArea };

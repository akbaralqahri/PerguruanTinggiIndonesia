'use strict';

// Normalisation + data-quality rules for the PDDIKTI export.
// Every rule here is recorded as a flag on the row rather than applied
// silently, so the site can show exactly what was excluded and why.

const FLAG = {
  BIAYA_KORUP: 'biaya_korup',
  BIAYA_TINGGI: 'biaya_tinggi_meragukan',
  BIAYA_MIN_SENTINEL: 'biaya_min_sentinel',
  KAB_KOSONG: 'kabupaten_kosong',
  AKREDITASI_KOSONG: 'akreditasi_kosong',
  NO_KELULUSAN: 'kelulusan_kosong',
  NO_BIAYA: 'biaya_kosong',
};

// A real semester fee never reaches Rp1 miliar. Rows above it are mangled in
// the source: e.g. "Rp5.150.000 - 62.620.000.000.000" (Rp62 triliun). The
// max side has digit groups concatenated together. The true value is not
// recoverable, so the fee is marked unusable rather than guessed at.
const BIAYA_MAX_IMPOSSIBLE = 1e9;

// "Rp1"/"Rp600"/"Rp0" minimums are placeholders for subsidised UKT brackets
// (UB, UGM, UPI, IPB all use them), not actual prices.
const BIAYA_MIN_SENTINEL = 1000;

// Above this the figure stops being credible as a *per semester* fee: the
// dearest published Indonesian tuition (kedokteran swasta) tops out around
// Rp165 juta. Rows beyond it — Universitas Tadulako at Rp850 juta, Politeknik
// Negeri Kupang at Rp500 juta, both PTN whose real UKT is tens of millions —
// look like one-off uang pangkal/SPI folded into the same column. Unlike the
// >= Rp1 miliar rows the number is not provably impossible, so it is kept and
// marked rather than dropped; the reader decides.
const BIAYA_MAX_MERAGUKAN = 2e8;

function parseBiaya(raw) {
  if (!raw) return { min: null, max: null, flags: [FLAG.NO_BIAYA] };
  // some rows repeat the prefix: "Rp1.000.000 - Rp6.000.000"
  const parts = raw.replace(/Rp/g, '').split(' - ');
  if (parts.length !== 2) return { min: null, max: null, flags: [FLAG.NO_BIAYA] };
  const toInt = s => {
    const v = parseInt(s.replace(/\./g, '').trim(), 10); // "." is a thousands separator
    return Number.isNaN(v) ? null : v;
  };
  let min = toInt(parts[0]), max = toInt(parts[1]);
  const flags = [];
  if (min === null || max === null) return { min: null, max: null, flags: [FLAG.NO_BIAYA] };
  if (max >= BIAYA_MAX_IMPOSSIBLE) {
    flags.push(FLAG.BIAYA_KORUP);
    return { min: null, max: null, flags, raw };
  }
  if (max >= BIAYA_MAX_MERAGUKAN) flags.push(FLAG.BIAYA_TINGGI);
  if (min <= BIAYA_MIN_SENTINEL) { flags.push(FLAG.BIAYA_MIN_SENTINEL); min = null; }
  return { min, max, flags };
}

// The export mixes two accreditation regimes: the pre-2022 letter grades
// (A/B/C) and the current descriptive peringkat (Unggul / Baik Sekali / Baik).
// They are broadly equivalent tier-for-tier, so a comparable rank is exposed
// for ranking/colouring while the original label is always kept for display.
const AKREDITASI = {
  'Unggul': { rank: 1, group: 'Unggul / A', regime: 'baru' },
  'A': { rank: 1, group: 'Unggul / A', regime: 'lama' },
  'Baik Sekali': { rank: 2, group: 'Baik Sekali / B', regime: 'baru' },
  'B': { rank: 2, group: 'Baik Sekali / B', regime: 'lama' },
  'Baik': { rank: 3, group: 'Baik / C', regime: 'baru' },
  'C': { rank: 3, group: 'Baik / C', regime: 'lama' },
  'Terakreditasi': { rank: 4, group: 'Terakreditasi (tanpa peringkat)', regime: 'lain' },
  'Terakreditasi Pertama': { rank: 4, group: 'Terakreditasi (tanpa peringkat)', regime: 'lain' },
  'Terakreditasi Sementara': { rank: 4, group: 'Terakreditasi (tanpa peringkat)', regime: 'lain' },
  'Tidak Terakreditasi': { rank: 5, group: 'Tidak Terakreditasi', regime: 'lain' },
};

function parseAkreditasi(raw) {
  const hit = AKREDITASI[raw];
  if (!hit) return { label: raw || null, rank: null, group: null, regime: null, flags: [FLAG.AKREDITASI_KOSONG] };
  return { label: raw, rank: hit.rank, group: hit.group, regime: hit.regime, flags: [] };
}

function parseKelulusan(raw) {
  if (!raw) return { value: null, flags: [FLAG.NO_KELULUSAN] };
  const v = parseFloat(raw);
  if (Number.isNaN(v)) return { value: null, flags: [FLAG.NO_KELULUSAN] };
  return { value: Math.round(v * 100) / 100, flags: [] };
}

module.exports = { parseBiaya, parseAkreditasi, parseKelulusan, FLAG, AKREDITASI, BIAYA_MAX_IMPOSSIBLE, BIAYA_MIN_SENTINEL, BIAYA_MAX_MERAGUKAN };

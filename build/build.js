'use strict';

/**
 * Builds the site data from:
 *   - pddikti_pt_gabungan.csv        (5.433 perguruan tinggi)
 *   - wilayah_level_1_2.sql          (Kepmendagri boundaries + penduduk + luas)
 *
 * Emits site/data/*.js as window globals so index.html works when opened
 * directly from disk (fetch() is blocked on file:// by CORS).
 *
 * Run: node build/build.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const { parseCSV, toObjects } = require('./lib/csv');
const { parseWilayahSQL } = require('./lib/wilayah');
const { ringsToMultiPolygon, countVertices } = require('./lib/geom');
const { parseBiaya, parseAkreditasi, parseKelulusan, FLAG } = require('./lib/clean');
const { createMatcher } = require('./lib/match');
const { applyGeoFixes } = require('./lib/geofix');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'pddikti_pt_gabungan.csv');
const CACHE_DIR = path.join(__dirname, '.cache');
const SQL_PATH = path.join(CACHE_DIR, 'wilayah_level_1_2.sql');
const SQL_URL = 'https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah_level_1_2.sql';
const OUT_DIR = path.join(ROOT, 'site', 'data');

// Tuned to keep the map readable while staying light enough to pan smoothly.
const TOL_PROV = 0.008, MIN_AREA_PROV = 0.0008;
const TOL_KAB = 0.004, MIN_AREA_KAB = 0.0004;

const warnings = [];
const warn = m => warnings.push(m);
const log = (...a) => console.log(...a);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const get = u => https.get(u, { headers: { 'User-Agent': 'node' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return get(res.headers.location);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + u)); }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    });
    get(url).on('error', err => { fs.unlink(dest, () => reject(err)); });
  });
}

const median = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const writeGlobal = (file, varName, obj) => {
  const p = path.join(OUT_DIR, file);
  fs.writeFileSync(p, `window.${varName}=${JSON.stringify(obj)};\n`);
  return (fs.statSync(p).size / 1e6).toFixed(2);
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (!fs.existsSync(SQL_PATH)) {
    log('mengunduh data wilayah Kepmendagri (~23 MB, sekali saja)...');
    await download(SQL_URL, SQL_PATH);
  }
  log('membaca sumber...');
  const rows = toObjects(parseCSV(fs.readFileSync(CSV_PATH, 'utf8')));
  const wil = parseWilayahSQL(fs.readFileSync(SQL_PATH, 'utf8'), warn);

  const L1 = wil.filter(r => r.kode.length === 2);
  const L2 = wil.filter(r => r.kode.length === 5);
  log(`  PT: ${rows.length} | provinsi: ${L1.length} | kab/kota: ${L2.length}`);
  if (L1.length !== 38 || L2.length !== 514) {
    throw new Error(`wilayah parse salah: dapat ${L1.length} prov / ${L2.length} kab (harusnya 38/514)`);
  }

  // ---- repair known boundary defects ------------------------------------
  const geoFix = applyGeoFixes(wil, warn);
  log('memeriksa geometri...');
  geoFix.applied.forEach(m => log('  fix: ' + m));
  if (geoFix.unexpected.length) {
    log(`  ${geoFix.unexpected.length} geometri mencurigakan BARU (belum ditangani):`);
    geoFix.unexpected.forEach(m => { log('  !! ' + m); warn('geometri mencurigakan: ' + m); });
  } else {
    log('  tidak ada geometri mencurigakan yang belum ditangani.');
  }

  // ---- join + clean ------------------------------------------------------
  const match = createMatcher(L2);
  const methodCount = {};
  const unmatched = new Map();

  const pt = rows.map((r, i) => {
    const m = match(r.Kabupaten, r.Provinsi);
    if (m) methodCount[m.method] = (methodCount[m.method] || 0) + 1;
    else unmatched.set(r.Kabupaten + '||' + r.Provinsi, (unmatched.get(r.Kabupaten + '||' + r.Provinsi) || 0) + 1);

    const biaya = parseBiaya(r['Rentang Biaya / Semester']);
    const akr = parseAkreditasi(r.Akreditasi);
    const lulus = parseKelulusan(r['Persentase Kelulusan']);
    const flags = [...biaya.flags, ...akr.flags, ...lulus.flags];
    if (!m) flags.push(FLAG.KAB_KOSONG);

    return {
      i,
      nama: r.Nama,
      singkat: r.Singkatan,
      jenis: r.Jenis,
      status: r.Status,
      // as printed by PDDIKTI, kept so the table matches the source
      kabRaw: r.Kabupaten,
      provRaw: r.Provinsi.replace(/^Prov\.\s*/, ''),
      // resolved against Kepmendagri
      kab: m ? m.kode : null,
      prov: m ? m.kode.slice(0, 2) : null,
      prodi: parseInt(r['Jumlah Prodi'], 10) || 0,
      lulus: lulus.value,
      biayaMin: biaya.min,
      biayaMax: biaya.max,
      biayaRaw: r['Rentang Biaya / Semester'] || null,
      akr: akr.label,
      akrRank: akr.rank,
      akrGroup: akr.group,
      flags,
    };
  });

  log('  cocok:', JSON.stringify(methodCount));
  const unmatchedRows = [...unmatched.values()].reduce((a, b) => a + b, 0);
  log(`  tidak cocok: ${unmatched.size} pasangan / ${unmatchedRows} baris`);
  for (const k of unmatched.keys()) {
    if (!k.startsWith('Tidak Diisi')) warn(`kabupaten tidak cocok: ${k}`);
  }

  // ---- geometry ----------------------------------------------------------
  log('menyederhanakan poligon...');
  const geoProv = { type: 'FeatureCollection', features: [] };
  for (const r of L1) {
    const g = ringsToMultiPolygon(r.rings, TOL_PROV, MIN_AREA_PROV);
    if (!g) { warn(`provinsi ${r.kode} tanpa geometri`); continue; }
    geoProv.features.push({ type: 'Feature', properties: { kode: r.kode, nama: r.nama }, geometry: g });
  }
  const geoKab = { type: 'FeatureCollection', features: [] };
  for (const r of L2) {
    if (r.geoUnusable) continue; // deliberately withheld by geofix
    const g = ringsToMultiPolygon(r.rings, TOL_KAB, MIN_AREA_KAB);
    if (!g) { warn(`kabupaten ${r.kode} tanpa geometri`); continue; }
    geoKab.features.push({ type: 'Feature', properties: { kode: r.kode, nama: r.nama }, geometry: g });
  }
  const vProv = geoProv.features.reduce((a, f) => a + countVertices(f.geometry), 0);
  const vKab = geoKab.features.reduce((a, f) => a + countVertices(f.geometry), 0);
  log(`  prov: ${geoProv.features.length} fitur / ${vProv.toLocaleString('id')} titik`);
  log(`  kab : ${geoKab.features.length} fitur / ${vKab.toLocaleString('id')} titik`);

  // ---- wilayah reference (penduduk, luas, centroid) -----------------------
  const wilRef = {};
  for (const r of [...L1, ...L2]) {
    wilRef[r.kode] = {
      nama: r.nama,
      ibukota: r.ibukota,
      lat: r.lat, lng: r.lng,
      luas: r.luas,
      penduduk: r.penduduk,
      induk: r.kode.length === 5 ? r.kode.slice(0, 2) : null,
      // set when the upstream boundary is wrong and was withheld
      geoUnusable: r.geoUnusable || null,
    };
  }

  // ---- aggregates --------------------------------------------------------
  // Computed for the *active* institutions, which is the site's default view.
  function agg(list) {
    const aktif = list.filter(p => p.status === 'Aktif');
    const biaya = aktif.map(p => p.biayaMax).filter(v => v != null);
    const lulus = aktif.map(p => p.lulus).filter(v => v != null);
    const byJenis = {}, byAkr = {};
    for (const p of aktif) {
      byJenis[p.jenis] = (byJenis[p.jenis] || 0) + 1;
      if (p.akrGroup) byAkr[p.akrGroup] = (byAkr[p.akrGroup] || 0) + 1;
    }
    return {
      total: list.length,
      aktif: aktif.length,
      prodi: aktif.reduce((a, p) => a + p.prodi, 0),
      byJenis, byAkr,
      unggul: aktif.filter(p => p.akrRank === 1).length,
      biayaMedian: median(biaya),
      biayaN: biaya.length,
      lulusMedian: median(lulus),
      lulusN: lulus.length,
    };
  }

  const statsProv = {}, statsKab = {};
  for (const kode of Object.keys(wilRef)) {
    const list = kode.length === 2 ? pt.filter(p => p.prov === kode) : pt.filter(p => p.kab === kode);
    if (!list.length) { (kode.length === 2 ? statsProv : statsKab)[kode] = agg([]); continue; }
    (kode.length === 2 ? statsProv : statsKab)[kode] = agg(list);
  }
  // per-100k needs population, which every wilayah record has
  for (const [kode, s] of Object.entries({ ...statsProv, ...statsKab })) {
    const w = wilRef[kode];
    s.per100k = w.penduduk ? Math.round((s.aktif / w.penduduk) * 1e5 * 100) / 100 : null;
  }

  // ---- data quality ------------------------------------------------------
  const flagCount = {};
  for (const p of pt) for (const f of p.flags) flagCount[f] = (flagCount[f] || 0) + 1;

  const meta = {
    dibuat: new Date().toISOString().slice(0, 10),
    sumber: {
      pt: { file: 'pddikti_pt_gabungan.csv', baris: rows.length },
      wilayah: { repo: 'cahyadsn/wilayah', lisensi: 'MIT', dasar: 'Kepmendagri No 300.2.2-2138 Tahun 2025', prov: L1.length, kab: L2.length },
    },
    join: { methods: methodCount, tidakCocokBaris: unmatchedRows, tidakCocokPasangan: unmatched.size },
    flags: flagCount,
    geo: {
      provFitur: geoProv.features.length,
      kabFitur: geoKab.features.length,
      perbaikan: geoFix.applied,
      dibuang: geoFix.dropped,
    },
    catatan: [
      'Dataset PDDIKTI memakai pembagian 34 provinsi (sebelum pemekaran Papua 2022); data wilayah resmi memakai 38. Provinsi tiap PT diturunkan ulang dari kode kabupaten resmi, sehingga PT di Papua tersebar ke provinsi pemekarannya.',
      `${flagCount[FLAG.BIAYA_KORUP] || 0} baris punya biaya rusak di sumbernya (nilai >= Rp1 miliar/semester, contoh "Rp5.150.000 - 62.620.000.000.000"). Nilainya tidak bisa dipulihkan sehingga dikeluarkan dari statistik biaya.`,
      `${flagCount[FLAG.BIAYA_MIN_SENTINEL] || 0} baris memakai batas bawah Rp1.000 ke bawah (mis. "Rp1") sebagai penanda UKT bersubsidi, bukan harga sebenarnya. Batas bawahnya diabaikan.`,
      `${flagCount[FLAG.BIAYA_TINGGI] || 0} baris mencantumkan biaya di atas Rp200 juta per semester, melampaui tarif tertinggi yang wajar di Indonesia (kedokteran swasta sekitar Rp165 juta). Contohnya Universitas Tadulako (Rp850 juta) dan Politeknik Negeri Kupang (Rp500 juta) — keduanya PTN dengan UKT sebenarnya puluhan juta. Angka ini kemungkinan mencampur uang pangkal ke kolom biaya per semester. Karena tidak terbukti mustahil, nilainya tetap ditampilkan namun ditandai, bukan dibuang.`,
      `${unmatchedRows} baris tidak punya isian Kabupaten ("Tidak Diisi") sehingga tidak muncul di peta kabupaten, tapi tetap dihitung di total nasional.`,
      'Akreditasi mencampur skema lama (A/B/C) dan baru (Unggul/Baik Sekali/Baik). Keduanya dikelompokkan setara per tingkat untuk pewarnaan peta; label asli tetap ditampilkan di tabel.',
      `Batas wilayah dari sumber diperiksa dengan membandingkan poligon terhadap kolom koordinat yang terpisah. ${Object.keys(geoFix.dropped).length} kabupaten punya batas yang keliru dan poligonnya tidak digambar (statistiknya tetap dihitung); Sangihe dan Talaud poligonnya tertukar dan sudah dikembalikan; centroid Wakatobi diperbaiki.`,
      'Persentase Kelulusan dan Rentang Biaya hanya terisi pada sebagian PT, sehingga median wilayah dengan sedikit data perlu dibaca hati-hati.',
    ],
    peringatan: warnings,
  };

  // ---- write -------------------------------------------------------------
  log('menulis site/data/...');
  const sizes = {
    'pt.js': writeGlobal('pt.js', '__PT', pt),
    'wilayah.js': writeGlobal('wilayah.js', '__WIL', { ref: wilRef, prov: statsProv, kab: statsKab }),
    'geo-prov.js': writeGlobal('geo-prov.js', '__GEO_PROV', geoProv),
    'geo-kab.js': writeGlobal('geo-kab.js', '__GEO_KAB', geoKab),
    'meta.js': writeGlobal('meta.js', '__META', meta),
  };
  for (const [f, mb] of Object.entries(sizes)) log(`  ${f.padEnd(12)} ${mb} MB`);

  log('\nringkasan kualitas data:');
  for (const [f, c] of Object.entries(flagCount).sort((a, b) => b[1] - a[1])) log(`  ${f.padEnd(22)} ${c}`);
  if (warnings.length) {
    log(`\n${warnings.length} peringatan:`);
    warnings.slice(0, 10).forEach(w => log('  - ' + w));
  }
  log('\nselesai.');
}

main().catch(e => { console.error('BUILD GAGAL:', e); process.exit(1); });

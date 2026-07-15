/**
 * Independent re-computation from the raw CSV, compared against the emitted
 * site data. Deliberately does NOT reuse build/lib, so a bug in the pipeline
 * cannot validate itself.
 *
 * Run: node build/verify.js   (after node build/build.js)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function pc(t) {
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const r = []; let w = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { w.push(f); f = ''; }
    else if (c === '\n') { w.push(f); r.push(w); w = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || w.length) { w.push(f); r.push(w); }
  return r.filter(x => x.length > 1);
}
const R = pc(fs.readFileSync(path.join(ROOT, 'pddikti_pt_gabungan.csv'), 'utf8'));
const H = R[0];
const CSV = R.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, (r[i] ?? '').trim()])));

global.window = {};
const data = f => require(path.join(ROOT, 'site', 'data', f));
data('pt.js'); data('wilayah.js'); data('meta.js');
const PT = window.__PT, WIL = window.__WIL, META = window.__META;

let fail = 0, pass = 0;
const chk = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'OK  ' : 'GAGAL'} ${name.padEnd(52)} ${ok ? got : `dapat=${JSON.stringify(got)} mau=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

console.log('=== integritas baris');
chk('jumlah baris dipertahankan', PT.length, CSV.length);
chk('nama unik tidak berubah', new Set(PT.map(p => p.nama)).size, new Set(CSV.map(c => c.Nama)).size);
chk('urutan nama baris 1 sama', PT[0].nama, CSV[0].Nama);
chk('urutan nama baris terakhir sama', PT[PT.length - 1].nama, CSV[CSV.length - 1].Nama);

console.log('\n=== distribusi kategori tidak berubah');
for (const st of ['Aktif', 'Alih Bentuk', 'Tutup', 'Alih Kelola', 'Pembinaan', 'Merger']) {
  chk(`status ${st}`, PT.filter(p => p.status === st).length, CSV.filter(c => c.Status === st).length);
}
for (const jn of ['Swasta', 'Agama', 'Kedinasan', 'Negeri']) {
  chk(`jenis ${jn}`, PT.filter(p => p.jenis === jn).length, CSV.filter(c => c.Jenis === jn).length);
}

console.log('\n=== agregat turunan');
const aktif = PT.filter(p => p.status === 'Aktif');
const csvAktif = CSV.filter(c => c.Status === 'Aktif');
chk('total prodi (aktif)', aktif.reduce((a, p) => a + p.prodi, 0),
  csvAktif.reduce((a, c) => a + (parseInt(c['Jumlah Prodi'], 10) || 0), 0));
chk('Unggul+A (aktif)', aktif.filter(p => p.akrRank === 1).length,
  csvAktif.filter(c => c.Akreditasi === 'Unggul' || c.Akreditasi === 'A').length);
chk('punya nilai kelulusan (aktif)', aktif.filter(p => p.lulus != null).length,
  csvAktif.filter(c => c['Persentase Kelulusan']).length);

console.log('\n=== join wilayah');
const matched = PT.filter(p => p.kab).length;
chk('terpetakan + tidak terpetakan = total', matched + PT.filter(p => !p.kab).length, PT.length);
chk('tidak terpetakan sama dengan "Tidak Diisi"', PT.filter(p => !p.kab).length,
  CSV.filter(c => c.Kabupaten === 'Tidak Diisi').length);
chk('setiap kode kab yang terpetakan ada di referensi',
  PT.filter(p => p.kab && !WIL.ref[p.kab]).length, 0);
chk('provinsi selalu 2 digit awal kode kab',
  PT.filter(p => p.kab && p.prov !== p.kab.slice(0, 2)).length, 0);
// no PT counted in two provinces
const provSum = [...new Set(PT.map(p => p.prov).filter(Boolean))]
  .reduce((a, k) => a + PT.filter(p => p.prov === k).length, 0);
chk('jumlah per provinsi = baris terpetakan', provSum, matched);

console.log('\n=== aturan biaya');
const parseRaw = s => {
  if (!s) return null;
  const p = s.replace(/Rp/g, '').split(' - ');
  if (p.length !== 2) return null;
  const n = x => { const v = parseInt(x.replace(/\./g, ''), 10); return isNaN(v) ? null : v; };
  return [n(p[0]), n(p[1])];
};
const csvBiaya = CSV.map(c => parseRaw(c['Rentang Biaya / Semester'])).filter(b => b && b[1] != null);
chk('baris >= Rp1 miliar ditandai korup',
  PT.filter(p => p.flags.includes('biaya_korup')).length, csvBiaya.filter(b => b[1] >= 1e9).length);
chk('nilai korup tidak dipakai di statistik',
  PT.filter(p => p.flags.includes('biaya_korup') && p.biayaMax != null).length, 0);
chk('baris > Rp200jt ditandai meragukan',
  PT.filter(p => p.flags.includes('biaya_tinggi_meragukan')).length,
  csvBiaya.filter(b => b[1] >= 2e8 && b[1] < 1e9).length);
chk('nilai meragukan TETAP ditampilkan',
  PT.filter(p => p.flags.includes('biaya_tinggi_meragukan') && p.biayaMax == null).length, 0);
chk('min sentinel diabaikan',
  PT.filter(p => p.flags.includes('biaya_min_sentinel') && p.biayaMin != null).length, 0);
chk('tidak ada biayaMax >= Rp1 miliar tersisa', PT.filter(p => p.biayaMax != null && p.biayaMax >= 1e9).length, 0);
chk('tidak ada biayaMin <= Rp1.000 tersisa', PT.filter(p => p.biayaMin != null && p.biayaMin <= 1000).length, 0);

console.log('\n=== sanity spasial');
const jkt = PT.filter(p => p.prov === '31' && p.status === 'Aktif').length;
chk('DKI Jakarta punya PT aktif', jkt > 200, true);
chk('Wakatobi centroid diperbaiki', Math.round(WIL.ref['74.07'].lng), 124);
chk('3 poligon ditahan', Object.keys(META.geo.dibuang).length, 3);
chk('poligon kab = 514 - 3', META.geo.kabFitur, 511);
chk('poligon prov = 38', META.geo.provFitur, 38);

console.log(`\n${pass} lolos, ${fail} gagal`);
process.exit(fail ? 1 : 0);

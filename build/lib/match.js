'use strict';

// Joins the PDDIKTI "Kabupaten"/"Provinsi" text columns onto official
// Kepmendagri wilayah codes.
//
// The two sources disagree in several ways, all handled below:
//   - PDDIKTI still uses the pre-2022 34-province split; the official data
//     has 38 (Papua was divided into six).
//   - Spelling drifts ("Palangka Raya" vs "Palangkaraya").
//   - Real renames ("Toba Samosir" -> "Toba", "Pontianak" -> "Mempawah").
//   - Kab/Kota misclassification ("Kab. Sungai Penuh" is a Kota).
//   - A handful of rows have Kabupaten = "Tidak Diisi".

// Dataset province -> official province code(s).
const PROV_MAP = {
  'Prov. Aceh': ['11'], 'Prov. Sumatera Utara': ['12'], 'Prov. Sumatera Barat': ['13'],
  'Prov. Riau': ['14'], 'Prov. Jambi': ['15'], 'Prov. Sumatera Selatan': ['16'],
  'Prov. Bengkulu': ['17'], 'Prov. Lampung': ['18'], 'Prov. Bangka Belitung': ['19'],
  'Prov. Kepulauan Riau': ['21'], 'Prov. D.K.I. Jakarta': ['31'], 'Prov. Jawa Barat': ['32'],
  'Prov. Jawa Tengah': ['33'], 'Prov. D.I. Yogyakarta': ['34'], 'Prov. Jawa Timur': ['35'],
  'Prov. Banten': ['36'], 'Prov. Bali': ['51'], 'Prov. Nusa Tenggara Barat': ['52'],
  'Prov. Nusa Tenggara Timur': ['53'], 'Prov. Kalimantan Barat': ['61'],
  'Prov. Kalimantan Tengah': ['62'], 'Prov. Kalimantan Selatan': ['63'],
  'Prov. Kalimantan Timur': ['64'], 'Prov. Kalimantan Utara': ['65'],
  'Prov. Sulawesi Utara': ['71'], 'Prov. Sulawesi Tengah': ['72'],
  'Prov. Sulawesi Selatan': ['73'], 'Prov. Sulawesi Tenggara': ['74'],
  'Prov. Gorontalo': ['75'], 'Prov. Sulawesi Barat': ['76'], 'Prov. Maluku': ['81'],
  'Prov. Maluku Utara': ['82'],
  // post-pemekaran successors
  'Prov. Papua': ['91', '93', '94', '95'],
  'Prov. Papua Barat': ['92', '96'],
};

// Hand-verified fixes for cases string similarity cannot (or must not) solve.
// Value is an official name, or "kode:XX.XX" to bypass name matching.
const ALIAS = {
  // Upstream stores 16.02 as "Kabupaten Ogan Komering", dropping "Ilir".
  // Fuzzy matching lands on Ogan Komering ULU (16.01) — a different
  // kabupaten — so this one is pinned by code.
  'Kab. Ogan Komering Ilir||Prov. Sumatera Selatan': 'kode:16.02',

  // renamed wilayah
  'Kab. Toba Samosir||Prov. Sumatera Utara': 'Kabupaten Toba',
  'Kab. Polewali Mamasa||Prov. Sulawesi Barat': 'Kabupaten Polewali Mandar',
  'Kab. Maluku Tenggara Barat||Prov. Maluku': 'Kabupaten Kepulauan Tanimbar',
  'Kab. Pontianak||Prov. Kalimantan Barat': 'Kabupaten Mempawah',
  'Kab. Yapen Waropen||Prov. Papua': 'Kabupaten Kepulauan Yapen',
  'Kab. Kepulauan Morotai||Prov. Maluku Utara': 'Kabupaten Pulau Morotai',
  'Kab. Selayar||Prov. Sulawesi Selatan': 'Kabupaten Kepulauan Selayar',
  'Kab. Sawahlunto/ Sijunjung||Prov. Sumatera Barat': 'Kabupaten Sijunjung',
  'Kab. Kepulauan Sitaro||Prov. Sulawesi Utara': 'Kabupaten Kep. Siau Tagulandang Biaro',

  // recorded as Kab. but actually Kota
  'Kab. Sabussalam||Prov. Aceh': 'Kota Subulussalam',
  'Kab. Sungai Penuh||Prov. Jambi': 'Kota Sungai Penuh',

  // spelling
  'Kab. Lima Puluh Koto||Prov. Sumatera Barat': 'Kabupaten Lima Puluh Kota',
  'Kab. Pangkajene Kepulauan||Prov. Sulawesi Selatan': 'Kabupaten Pangkajene Dan Kepulauan',
  'Kab. Kep. Sangihe||Prov. Sulawesi Utara': 'Kabupaten Kepulauan Sangihe',
  'Kab. Kuburaya||Prov. Kalimantan Barat': 'Kabupaten Kubu Raya',
  'Kab. Bolaang Mongondaw||Prov. Sulawesi Utara': 'Kabupaten Bolaang Mongondow',
  'Kab. Pasir||Prov. Kalimantan Timur': 'Kabupaten Paser',
  'Kab. Bulongan||Prov. Kalimantan Timur': 'Kabupaten Bulungan',
};

const norm = s => s.toLowerCase()
  .replace(/\bkab\.\s*/, 'kabupaten ')
  .replace(/\bkep\.\s*/g, 'kepulauan ')
  .replace(/\badministrasi\b/g, ' ') // DKI wilayah are "Kota Administrasi X"
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const despace = s => norm(s).replace(/\s/g, '');
const stripType = s => norm(s).replace(/^(kabupaten|kota)\s+/, '');

function lev(a, b) {
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

// Only accept a fuzzy hit at this similarity or better. Verified by review:
// at 0.85 the accepted set is exactly the real typos (Tenggamus->Tanggamus,
// Nagakeo->Nagekeo, Pasawaran->Pesawaran, Parigi Mautong->Parigi Moutong,
// Humbang Hasudutan->Humbang Hasundutan, Padang Sidempuan->Padangsidimpuan).
const FUZZY_MIN = 0.85;

/**
 * @param {Array} level2 official kabupaten/kota records ({kode, nama})
 * @returns {(kab: string, prov: string) => {kode, nama, method} | null}
 */
function createMatcher(level2) {
  const cache = new Map();

  return function match(kab, prov) {
    const key = kab + '||' + prov;
    if (cache.has(key)) return cache.get(key);
    const res = resolve(kab, prov, key);
    cache.set(key, res);
    return res;
  };

  function resolve(kab, prov, key) {
    if (!kab || kab === 'Tidak Diisi') return null;
    const provKodes = PROV_MAP[prov];
    if (!provKodes) return null;
    const cands = level2.filter(r => provKodes.includes(r.kode.slice(0, 2)));

    const al = ALIAS[key];
    if (al) {
      if (al.startsWith('kode:')) {
        const hit = level2.find(c => c.kode === al.slice(5));
        return hit ? { kode: hit.kode, nama: hit.nama, method: 'alias-kode' } : null;
      }
      // aliases are hand-verified, so fall back nationwide when the dataset
      // files a wilayah under a stale province (e.g. Bulungan under Kaltim)
      const hit = cands.find(c => norm(c.nama) === norm(al)) || level2.find(c => norm(c.nama) === norm(al));
      return hit ? { kode: hit.kode, nama: hit.nama, method: 'alias' } : null;
    }

    let hit = cands.find(c => norm(c.nama) === norm(kab));
    if (hit) return { kode: hit.kode, nama: hit.nama, method: 'exact' };

    hit = cands.find(c => despace(c.nama) === despace(kab)); // Palangka Raya == Palangkaraya
    if (hit) return { kode: hit.kode, nama: hit.nama, method: 'despace' };

    // Kalimantan Utara split from Kalimantan Timur in 2012 but a few rows
    // still use the old province. Accept only names unique nationwide.
    const natl = level2.filter(c => despace(c.nama) === despace(kab));
    if (natl.length === 1) return { kode: natl[0].kode, nama: natl[0].nama, method: 'national' };

    const scored = cands
      .map(c => ({ c, s: sim(stripType(c.nama), stripType(kab)) }))
      .sort((a, b) => b.s - a.s);
    if (scored.length && scored[0].s >= FUZZY_MIN) {
      return { kode: scored[0].c.kode, nama: scored[0].c.nama, method: 'fuzzy' };
    }
    return null;
  }
}

module.exports = { createMatcher, PROV_MAP, ALIAS, FUZZY_MIN };

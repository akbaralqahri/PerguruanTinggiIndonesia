/* Peta Pendidikan Tinggi Indonesia
   Data arrives as window globals from data/*.js so the page works when opened
   straight off disk (fetch() is blocked on file:// by CORS). */
'use strict';

(function () {
  const PT = window.__PT;
  const WIL = window.__WIL;
  const META = window.__META;
  const GEO_PROV = window.__GEO_PROV;
  const GEO_KAB = window.__GEO_KAB;

  const REF = WIL.ref;

  // ---------- formatting ----------
  const nf = new Intl.NumberFormat('id-ID');
  const fmt = n => (n == null ? '—' : nf.format(n));
  const fmt1 = n => (n == null ? '—' : n.toLocaleString('id-ID', { maximumFractionDigits: 1 }));
  const pct = n => (n == null ? '—' : fmt1(n) + '%');

  function rupiah(n) {
    if (n == null) return '—';
    if (n >= 1e6) return 'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
    if (n >= 1e3) return 'Rp' + Math.round(n / 1e3).toLocaleString('id-ID') + ' rb';
    return 'Rp' + nf.format(n);
  }
  const median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const el = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- palette (validated; see build notes) ----------
  // Categorical slots are bound to entities, never to rank, so filtering a
  // category out never repaints the survivors.
  const JENIS_COLOR = {
    'Negeri': 'var(--s1)', 'Swasta': 'var(--s2)', 'Agama': 'var(--s3)', 'Kedinasan': 'var(--s4)',
  };
  const JENIS_ORDER = ['Negeri', 'Swasta', 'Agama', 'Kedinasan'];

  // Accreditation is ordinal -> one-hue ramp, monotone lightness.
  const AKR_ORDER = ['Unggul / A', 'Baik Sekali / B', 'Baik / C', 'Terakreditasi (tanpa peringkat)', 'Tidak Terakreditasi'];
  const AKR_COLOR = {
    'Unggul / A': '#cde2fb',
    'Baik Sekali / B': '#9ec5f4',
    'Baik / C': '#6da7ec',
    'Terakreditasi (tanpa peringkat)': '#3987e5',
    'Tidak Terakreditasi': '#184f95',
  };
  const STATUS_COLOR = {
    'Aktif': 'var(--s1)', 'Alih Bentuk': 'var(--s3)', 'Tutup': 'var(--s6)',
    'Alih Kelola': 'var(--s5)', 'Pembinaan': 'var(--s7)', 'Merger': 'var(--s8)',
  };
  // Sequential ramp for the choropleth: one hue, dark (low) -> light (high),
  // so the low end recedes toward the dark map surface.
  const RAMP = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#5598e7', '#86b6ef', '#b7d3f6', '#cde2fb'];
  const NO_DATA = '#3a3a38';

  // ---------- state ----------
  const state = {
    status: 'Aktif', jenis: '', akr: '', prov: '', q: '',
    level: 'prov', metric: 'count', focusProv: null,
    sortKey: 'nama', sortDir: 1, page: 1,
  };
  const PER_PAGE = 50;

  // ---------- filtering ----------
  function filtered() {
    const q = state.q.trim().toLowerCase();
    return PT.filter(p => {
      if (state.status && p.status !== state.status) return false;
      if (state.jenis && p.jenis !== state.jenis) return false;
      if (state.akr && p.akrGroup !== state.akr) return false;
      if (state.prov && p.prov !== state.prov) return false;
      if (q && !(p.nama.toLowerCase().includes(q) || (p.singkat || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }

  // Aggregate the current slice by wilayah code. Recomputed on every filter
  // change so the map, charts and table always describe the same rows.
  function aggregate(rows) {
    const byProv = new Map(), byKab = new Map();
    const push = (m, k, p) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(p); };
    for (const p of rows) { push(byProv, p.prov, p); push(byKab, p.kab, p); }
    const build = m => {
      const out = new Map();
      for (const [k, list] of m) {
        const ref = REF[k];
        const biaya = list.map(p => p.biayaMax).filter(v => v != null);
        const lulus = list.map(p => p.lulus).filter(v => v != null);
        const unggul = list.filter(p => p.akrRank === 1).length;
        out.set(k, {
          count: list.length,
          prodi: list.reduce((a, p) => a + p.prodi, 0),
          unggul,
          unggulPct: list.length ? (unggul / list.length) * 100 : null,
          per100k: ref && ref.penduduk ? (list.length / ref.penduduk) * 1e5 : null,
          biaya: median(biaya), biayaN: biaya.length,
          lulus: median(lulus), lulusN: lulus.length,
          rows: list,
        });
      }
      return out;
    };
    return { prov: build(byProv), kab: build(byKab) };
  }

  const METRIC = {
    count: { label: 'Jumlah PT', fmt: fmt, get: a => a.count },
    per100k: { label: 'PT per 100.000 penduduk', fmt: v => fmt1(v), get: a => a.per100k },
    unggulPct: { label: '% Unggul/A', fmt: pct, get: a => a.unggulPct },
    prodi: { label: 'Jumlah prodi', fmt: fmt, get: a => a.prodi },
    // medians over a handful of rows are noisy, so require a minimum sample
    biaya: { label: 'Median biaya tertinggi', fmt: rupiah, get: a => (a.biayaN >= 3 ? a.biaya : null), minN: 3 },
    lulus: { label: 'Median kelulusan', fmt: pct, get: a => (a.lulusN >= 3 ? a.lulus : null), minN: 3 },
  };

  // ---------- map ----------
  const map = L.map('map', {
    center: [-2.3, 118], zoom: 5, minZoom: 4, maxZoom: 11,
    zoomControl: true, attributionControl: true,
    preferCanvas: true, // 511 kabupaten polygons: canvas beats SVG here
  });
  map.attributionControl.setPrefix('');

  let baseLayer = null;
  el('m-base').addEventListener('change', e => {
    if (e.target.checked) {
      baseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 11,
      }).addTo(map);
      baseLayer.bringToBack();
    } else if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
  });

  let layerProv = null, layerKab = null, agg = null, scale = null;
  // reassigned once the map is framed to the container (see bottom of file)
  let homeView = () => map.setView([-2.3, 118], 5);

  function makeScale(values) {
    const v = values.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const lo = v[0], hi = v[v.length - 1];
    if (lo === hi) return { lo, hi, at: () => RAMP[RAMP.length - 1] };
    // Counts are extremely skewed (Jawa Barat has ~40x the smallest province),
    // so a linear ramp would flatten everything outside Java into one shade.
    // Quantile breaks keep every class populated.
    const breaks = [];
    for (let i = 1; i < RAMP.length; i++) breaks.push(v[Math.floor((i / RAMP.length) * v.length)]);
    return {
      lo, hi, breaks,
      at(x) {
        if (x == null || !isFinite(x)) return NO_DATA;
        let i = 0;
        while (i < breaks.length && x >= breaks[i]) i++;
        return RAMP[i];
      },
    };
  }

  function styleFor(kode, level) {
    const a = (level === 'prov' ? agg.prov : agg.kab).get(kode);
    const m = METRIC[state.metric];
    const v = a ? m.get(a) : null;
    return {
      fillColor: scale ? scale.at(v) : NO_DATA,
      fillOpacity: v == null ? 0.25 : 0.85,
      color: '#0d0d0d', weight: 0.6, opacity: 0.9,
    };
  }

  function tipHtml(kode, level) {
    const ref = REF[kode];
    const a = (level === 'prov' ? agg.prov : agg.kab).get(kode);
    const m = METRIC[state.metric];
    const v = a ? m.get(a) : null;
    let s = `<b>${esc(ref ? ref.nama : kode)}</b>`;
    s += `<div class="t-row">${esc(m.label)}: <b>${v == null ? 'tidak ada data' : m.fmt(v)}</b></div>`;
    if (state.metric !== 'count') s += `<div class="t-row">Jumlah PT: <b>${fmt(a ? a.count : 0)}</b></div>`;
    if (ref && ref.geoUnusable) s += `<div class="t-row" style="color:var(--warning)">batas wilayah tidak digambar</div>`;
    return s;
  }

  function bindLayer(feature, layer, level) {
    const kode = feature.properties.kode;
    layer.bindTooltip(() => tipHtml(kode, level), { className: 'map-tip', sticky: true });
    layer.on('mouseover', () => { layer.setStyle({ weight: 2, color: '#fff' }); showSide(kode, level); });
    layer.on('mouseout', () => layer.setStyle({ weight: 0.6, color: '#0d0d0d' }));
    layer.on('click', () => {
      if (level === 'prov') drillTo(kode);
      else { showSide(kode, level); map.fitBounds(layer.getBounds(), { padding: [30, 30] }); }
    });
  }

  function drawProv() {
    if (layerProv) map.removeLayer(layerProv);
    layerProv = L.geoJSON(GEO_PROV, {
      style: f => styleFor(f.properties.kode, 'prov'),
      onEachFeature: (f, l) => bindLayer(f, l, 'prov'),
    }).addTo(map);
  }
  function drawKab(filterProv) {
    if (layerKab) map.removeLayer(layerKab);
    layerKab = L.geoJSON(GEO_KAB, {
      filter: f => !filterProv || f.properties.kode.slice(0, 2) === filterProv,
      style: f => styleFor(f.properties.kode, 'kab'),
      onEachFeature: (f, l) => bindLayer(f, l, 'kab'),
    }).addTo(map);
  }

  function drillTo(provKode) {
    state.focusProv = provKode;
    state.level = 'kab';
    syncSeg();
    renderMap();
    const b = layerKab && layerKab.getBounds();
    if (b && b.isValid()) map.fitBounds(b, { padding: [24, 24] });
    showSide(provKode, 'prov');
  }

  function renderMap() {
    const level = state.level;
    const src = level === 'prov' ? agg.prov : agg.kab;
    const codes = level === 'prov'
      ? GEO_PROV.features.map(f => f.properties.kode)
      : GEO_KAB.features
          .filter(f => !state.focusProv || f.properties.kode.slice(0, 2) === state.focusProv)
          .map(f => f.properties.kode);
    const m = METRIC[state.metric];
    scale = makeScale(codes.map(k => { const a = src.get(k); return a ? m.get(a) : null; }));

    if (layerProv) { map.removeLayer(layerProv); layerProv = null; }
    if (layerKab) { map.removeLayer(layerKab); layerKab = null; }
    if (level === 'prov') drawProv(); else drawKab(state.focusProv);
    renderLegend();
  }

  function renderLegend() {
    const lg = el('legend');
    if (!scale) { lg.hidden = true; return; }
    lg.hidden = false;
    const m = METRIC[state.metric];
    el('lg-title').textContent = m.label;
    el('lg-bar').innerHTML = RAMP.map(c => `<i style="background:${c}"></i>`).join('');
    el('lg-min').textContent = m.fmt(scale.lo);
    el('lg-max').textContent = m.fmt(scale.hi);
  }

  function showSide(kode, level) {
    const ref = REF[kode];
    if (!ref) return;
    const a = (level === 'prov' ? agg.prov : agg.kab).get(kode);
    const rows = a ? a.rows : [];
    const parent = ref.induk ? REF[ref.induk] : null;

    let h = `<h3>${esc(ref.nama)}</h3>`;
    h += `<div class="side-sub">${parent ? esc(parent.nama) + ' · ' : ''}${level === 'prov' ? 'Provinsi' : 'Kabupaten/Kota'}${ref.ibukota ? ' · ibu kota ' + esc(ref.ibukota) : ''}</div>`;

    const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
    h += kv('Perguruan tinggi', fmt(rows.length));
    h += kv('Program studi', fmt(a ? a.prodi : 0));
    h += kv('Penduduk', fmt(ref.penduduk));
    h += kv('PT per 100.000 penduduk', a && a.per100k != null ? fmt1(a.per100k) : '—');
    h += kv('Luas', ref.luas ? fmt1(ref.luas) + ' km²' : '—');
    h += kv('Terakreditasi Unggul/A', a ? `${fmt(a.unggul)} (${a.unggulPct == null ? '—' : pct(a.unggulPct)})` : '—');
    h += kv('Median biaya tertinggi', a && a.biayaN >= 3 ? rupiah(a.biaya) : '—');
    h += kv('Median kelulusan', a && a.lulusN >= 3 ? pct(a.lulus) : '—');

    if (ref.geoUnusable) {
      h += `<p style="color:var(--warning);font-size:12.5px;margin:12px 0 0">Batas wilayah dari sumber keliru, jadi poligonnya tidak digambar. Statistik di atas tetap dihitung.</p>`;
    }

    if (rows.length) {
      const byJenis = {};
      rows.forEach(p => byJenis[p.jenis] = (byJenis[p.jenis] || 0) + 1);
      h += `<div style="margin-top:16px"><div class="lg-title" style="color:var(--ink-3);font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Menurut jenis</div><div class="legend-inline">`;
      for (const j of JENIS_ORDER) if (byJenis[j]) {
        h += `<span class="li"><i style="background:${JENIS_COLOR[j]}"></i>${esc(j)} <b>${fmt(byJenis[j])}</b></span>`;
      }
      h += `</div></div>`;

      const top = [...rows].sort((a, b) => b.prodi - a.prodi).slice(0, 6);
      h += `<div style="margin-top:16px"><div style="color:var(--ink-3);font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Prodi terbanyak</div>`;
      top.forEach(p => {
        h += `<div class="kv"><span style="max-width:200px">${esc(p.nama)}</span><span>${fmt(p.prodi)}</span></div>`;
      });
      h += `</div>`;
    } else {
      h += `<p class="side-empty" style="margin-top:14px">Tidak ada perguruan tinggi yang cocok dengan penyaring saat ini.</p>`;
    }
    el('side').innerHTML = h;
  }

  // ---------- charts ----------
  function barRows(container, items, color, fmtVal) {
    const max = Math.max(...items.map(i => i.v), 1);
    container.innerHTML = items.map(i => `
      <div class="bar-row" title="${esc(i.label)}: ${fmtVal(i.v)}">
        <span class="lbl">${esc(i.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.max((i.v / max) * 100, 1.2)}%;background:${color}"></span></span>
        <span class="val">${fmtVal(i.v)}</span>
      </div>`).join('');
  }

  function stackBar(stackEl, legendEl, items, total) {
    stackEl.innerHTML = items.map(i =>
      `<i style="background:${i.color};width:${(i.v / total) * 100}%" title="${esc(i.label)}: ${fmt(i.v)}"></i>`
    ).join('');
    // direct labels alongside the legend: the categorical set sits in the
    // 8-12 CVD floor band, so colour never carries identity alone
    legendEl.innerHTML = items.map(i =>
      `<span class="li"><i style="background:${i.color}"></i>${esc(i.label)} <b>${fmt(i.v)}</b> <span style="color:var(--ink-3)">(${fmt1((i.v / total) * 100)}%)</span></span>`
    ).join('');
  }

  function histogram(hostId, xId, values, bins, fmtEdge, color) {
    const host = el(hostId), xax = el(xId);
    if (!values.length) {
      host.innerHTML = `<div style="color:var(--ink-3);font-size:13px;align-self:center">Tidak ada data pada penyaring ini.</div>`;
      xax.innerHTML = ''; return;
    }
    const counts = new Array(bins.length - 1).fill(0);
    for (const v of values) {
      let i = bins.findIndex((b, k) => k < bins.length - 1 && v >= b && v < bins[k + 1]);
      if (v >= bins[bins.length - 1]) i = bins.length - 2;
      if (i >= 0) counts[i]++;
    }
    const max = Math.max(...counts, 1);
    host.innerHTML = counts.map((c, i) =>
      `<span class="hb" style="height:${(c / max) * 100}%;background:${color}" title="${fmtEdge(bins[i])} – ${fmtEdge(bins[i + 1])}: ${fmt(c)} PT"></span>`
    ).join('');
    xax.innerHTML = `<span>${fmtEdge(bins[0])}</span><span>${fmtEdge(bins[Math.floor(bins.length / 2)])}</span><span>${fmtEdge(bins[bins.length - 1])}+</span>`;
  }

  function renderCharts(rows) {
    // provinces by count
    const provItems = [...agg.prov.entries()]
      .map(([k, a]) => ({ label: REF[k] ? REF[k].nama : k, v: a.count }))
      .sort((a, b) => b.v - a.v).slice(0, 15);
    barRows(el('c-prov'), provItems, 'var(--s1)', fmt);
    el('c-prov-sub').textContent = `${provItems.length} teratas dari ${agg.prov.size} provinsi yang terwakili`;

    // per 100k — only provinces with a meaningful base
    const perItems = [...agg.prov.entries()]
      .filter(([k, a]) => a.per100k != null && a.count >= 3)
      .map(([k, a]) => ({ label: REF[k].nama, v: a.per100k }))
      .sort((a, b) => b.v - a.v).slice(0, 15);
    barRows(el('c-per100k'), perItems, 'var(--s2)', fmt1);

    // jenis
    const byJenis = {};
    rows.forEach(p => byJenis[p.jenis] = (byJenis[p.jenis] || 0) + 1);
    const jItems = JENIS_ORDER.filter(j => byJenis[j]).map(j => ({ label: j, v: byJenis[j], color: JENIS_COLOR[j] }));
    const jTotal = jItems.reduce((a, i) => a + i.v, 0) || 1;
    stackBar(el('c-jenis-stack'), el('c-jenis-legend'), jItems, jTotal);
    el('c-jenis-sub').textContent = `${fmt(jTotal)} perguruan tinggi terpilih`;

    // akreditasi
    const byAkr = {};
    rows.forEach(p => { if (p.akrGroup) byAkr[p.akrGroup] = (byAkr[p.akrGroup] || 0) + 1; });
    const aItems = AKR_ORDER.filter(a => byAkr[a]).map(a => ({ label: a, v: byAkr[a], color: AKR_COLOR[a] }));
    const aTotal = aItems.reduce((a, i) => a + i.v, 0) || 1;
    stackBar(el('c-akr-stack'), el('c-akr-legend'), aItems, aTotal);

    // biaya
    const biaya = rows.map(p => p.biayaMax).filter(v => v != null);
    histogram('c-biaya', 'c-biaya-x', biaya,
      [0, 1e6, 2e6, 3e6, 4e6, 5e6, 7.5e6, 1e7, 1.5e7, 2e7, 3e7, 5e7], rupiah, 'var(--s1)');
    el('c-biaya-sub').textContent = biaya.length
      ? `Batas atas kisaran biaya · ${fmt(biaya.length)} PT punya data (median ${rupiah(median(biaya))})`
      : 'Tidak ada data biaya pada penyaring ini';

    // kelulusan
    const lulus = rows.map(p => p.lulus).filter(v => v != null);
    histogram('c-lulus', 'c-lulus-x', lulus,
      [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], v => fmt1(v) + '%', 'var(--s2)');
    el('c-lulus-sub').textContent = lulus.length
      ? `${fmt(lulus.length)} PT punya data (median ${pct(median(lulus))})`
      : 'Tidak ada data kelulusan pada penyaring ini';
  }

  // ---------- tiles ----------
  function renderTiles(rows) {
    const prodi = rows.reduce((a, p) => a + p.prodi, 0);
    const unggul = rows.filter(p => p.akrRank === 1).length;
    const biaya = rows.map(p => p.biayaMax).filter(v => v != null);
    const lulus = rows.map(p => p.lulus).filter(v => v != null);
    const provN = new Set(rows.map(p => p.prov).filter(Boolean)).size;
    const kabN = new Set(rows.map(p => p.kab).filter(Boolean)).size;

    const tiles = [
      { k: 'Perguruan tinggi', v: fmt(rows.length), sub: `dari ${fmt(PT.length)} baris dataset` },
      { k: 'Program studi', v: fmt(prodi), sub: 'dijumlahkan dari PT terpilih' },
      { k: 'Unggul / A', v: fmt(unggul), sub: rows.length ? pct((unggul / rows.length) * 100) + ' dari yang terpilih' : '—' },
      { k: 'Kabupaten/kota', v: `${fmt(kabN)}`, sub: `dari 514 · ${provN} provinsi` },
      { k: 'Median biaya', v: biaya.length ? rupiah(median(biaya)) : '—', sub: `${fmt(biaya.length)} PT punya data` },
      { k: 'Median kelulusan', v: lulus.length ? pct(median(lulus)) : '—', sub: `${fmt(lulus.length)} PT punya data` },
    ];
    el('tiles').innerHTML = tiles.map(t =>
      `<div class="tile"><div class="k">${esc(t.k)}</div><div class="v">${t.v}</div><div class="sub">${esc(t.sub)}</div></div>`
    ).join('');
  }

  // ---------- table ----------
  // Fees above Rp200 juta/semester almost certainly fold one-off uang pangkal
  // into a per-semester column. They stay visible — flagged, not hidden — so
  // the number is never read as a clean semester price.
  function biayaCell(p) {
    if (p.biayaMax == null) {
      return p.flags.includes('biaya_korup')
        ? `<span class="dash" title="Nilai di sumber rusak: ${esc(p.biayaRaw)}">rusak</span>`
        : '<span class="dash">—</span>';
    }
    const dubious = p.flags.includes('biaya_tinggi_meragukan');
    if (!dubious) return rupiah(p.biayaMax);
    return `<span style="color:var(--warning)" title="Di atas Rp200 juta per semester — kemungkinan tercampur uang pangkal. Nilai asli: ${esc(p.biayaRaw)}">${rupiah(p.biayaMax)} ⚠</span>`;
  }

  function renderTable(rows) {
    const key = state.sortKey, dir = state.sortDir;
    const val = p => {
      if (key === 'kab') return REF[p.kab] ? REF[p.kab].nama : p.kabRaw;
      if (key === 'prov') return REF[p.prov] ? REF[p.prov].nama : p.provRaw;
      return p[key];
    };
    const sorted = [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;   // blanks always last, regardless of direction
      if (y == null) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y), 'id') * dir;
    });

    const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * PER_PAGE;
    const slice = sorted.slice(start, start + PER_PAGE);

    el('tbody').innerHTML = slice.map(p => {
      const kab = REF[p.kab] ? REF[p.kab].nama : `<span class="dash">${esc(p.kabRaw)}</span>`;
      const prov = REF[p.prov] ? REF[p.prov].nama : `<span class="dash">${esc(p.provRaw)}</span>`;
      const akrC = p.akrGroup ? AKR_COLOR[p.akrGroup] : null;
      return `<tr>
        <td class="nm">${esc(p.nama)}</td>
        <td>${esc(p.singkat) || '<span class="dash">—</span>'}</td>
        <td><span class="pill" style="background:${JENIS_COLOR[p.jenis] || 'var(--surface-3)'};color:#fff">${esc(p.jenis)}</span></td>
        <td>${esc(p.status)}</td>
        <td>${p.akr ? `<span class="pill" style="background:${akrC};color:#0b0b0b">${esc(p.akr)}</span>` : '<span class="dash">—</span>'}</td>
        <td>${kab}</td>
        <td>${prov}</td>
        <td class="num">${fmt(p.prodi)}</td>
        <td class="num">${p.lulus == null ? '<span class="dash">—</span>' : pct(p.lulus)}</td>
        <td class="num">${biayaCell(p)}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="10" style="padding:26px;text-align:center;color:var(--ink-3)">Tidak ada yang cocok dengan penyaring.</td></tr>`;

    document.querySelectorAll('#tbl thead th').forEach(th => {
      const k = th.dataset.sort;
      th.innerHTML = th.textContent.replace(/ [▲▼]$/, '') + (k === key ? ` <span class="arrow">${dir === 1 ? '▲' : '▼'}</span>` : '');
    });

    const p = state.page;
    let ph = `<button class="btn" ${p === 1 ? 'disabled' : ''} data-page="${p - 1}">‹</button>`;
    ph += `<span>Halaman ${fmt(p)} dari ${fmt(pages)} · ${fmt(sorted.length)} baris</span>`;
    ph += `<button class="btn" ${p === pages ? 'disabled' : ''} data-page="${p + 1}">›</button>`;
    el('pager').innerHTML = ph;
  }

  // ---------- data quality ----------
  const FLAG_LABEL = {
    biaya_kosong: 'Rentang biaya tidak diisi',
    kelulusan_kosong: 'Persentase kelulusan tidak diisi',
    biaya_min_sentinel: 'Batas bawah biaya berupa penanda (mis. "Rp1")',
    kabupaten_kosong: 'Kabupaten "Tidak Diisi" — tidak bisa dipetakan',
    biaya_korup: 'Biaya rusak di sumber (≥ Rp1 miliar/semester)',
    biaya_tinggi_meragukan: 'Biaya > Rp200 juta/semester — ditandai, tidak dibuang',
    akreditasi_kosong: 'Akreditasi kosong',
  };
  function renderQuality() {
    el('dq-notes').innerHTML = META.catatan.map(c => `<li>${esc(c)}</li>`).join('');
    el('dq-total').textContent = fmt(META.sumber.pt.baris);
    el('dq-flags').innerHTML = Object.entries(META.flags)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<div class="flag-row"><span class="fname">${esc(FLAG_LABEL[k] || k)}</span><span class="fcount">${fmt(v)}</span></div>`)
      .join('');
    el('dq-geo').innerHTML = (META.geo.perbaikan || []).map(c => `<li>${esc(c)}</li>`).join('');
    el('foot-build').textContent =
      `Dibangun ${META.dibuat} · ${fmt(META.sumber.pt.baris)} PT · ${META.geo.provFitur} poligon provinsi · ${META.geo.kabFitur} poligon kabupaten/kota · ${fmt(META.join.tidakCocokBaris)} baris tanpa isian kabupaten.`;
  }

  // ---------- filters UI ----------
  function opts(select, values, allLabel) {
    select.innerHTML = `<option value="">${allLabel}</option>` +
      values.map(v => `<option value="${esc(v.v)}">${esc(v.l)}</option>`).join('');
  }
  function initFilters() {
    const uniq = k => [...new Set(PT.map(p => p[k]))].filter(Boolean).sort();
    const counts = k => {
      const c = {};
      PT.forEach(p => { if (p[k]) c[p[k]] = (c[p[k]] || 0) + 1; });
      return c;
    };
    const cs = counts('status'), cj = counts('jenis');
    opts(el('f-status'), uniq('status').map(v => ({ v, l: `${v} (${fmt(cs[v])})` })), `Semua status (${fmt(PT.length)})`);
    opts(el('f-jenis'), uniq('jenis').map(v => ({ v, l: `${v} (${fmt(cj[v])})` })), 'Semua jenis');
    opts(el('f-akr'), AKR_ORDER.filter(a => PT.some(p => p.akrGroup === a)).map(v => ({ v, l: v })), 'Semua akreditasi');
    const provs = [...new Set(PT.map(p => p.prov).filter(Boolean))]
      .map(k => ({ v: k, l: REF[k].nama })).sort((a, b) => a.l.localeCompare(b.l, 'id'));
    opts(el('f-prov'), provs, 'Seluruh Indonesia');
    el('f-status').value = state.status;

    el('f-status').addEventListener('change', e => { state.status = e.target.value; state.page = 1; render(); });
    el('f-jenis').addEventListener('change', e => { state.jenis = e.target.value; state.page = 1; render(); });
    el('f-akr').addEventListener('change', e => { state.akr = e.target.value; state.page = 1; render(); });
    el('f-prov').addEventListener('change', e => {
      state.prov = e.target.value; state.page = 1;
      state.focusProv = e.target.value || null;
      state.level = e.target.value ? 'kab' : 'prov';
      syncSeg(); render(); fitFocus();
    });
    let t;
    el('f-q').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = e.target.value; state.page = 1; render(); }, 180);
    });
    el('f-reset').addEventListener('click', () => {
      Object.assign(state, { status: 'Aktif', jenis: '', akr: '', prov: '', q: '', focusProv: null, level: 'prov', page: 1 });
      el('f-status').value = 'Aktif'; el('f-jenis').value = ''; el('f-akr').value = '';
      el('f-prov').value = ''; el('f-q').value = '';
      syncSeg(); render(); homeView();
    });
  }

  function syncSeg() {
    document.querySelectorAll('#seg-level button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.level === state.level)));
  }
  function fitFocus() {
    if (state.focusProv && layerKab) {
      const b = layerKab.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [24, 24] });
    }
  }

  function initMapControls() {
    document.querySelectorAll('#seg-level button').forEach(b => {
      b.addEventListener('click', () => {
        state.level = b.dataset.level;
        if (state.level === 'prov') state.focusProv = null;
        syncSeg(); renderMap();
      });
    });
    el('m-metric').addEventListener('change', e => { state.metric = e.target.value; renderMap(); });
    el('m-reset').addEventListener('click', () => {
      state.focusProv = null; state.level = 'prov'; state.prov = ''; el('f-prov').value = '';
      syncSeg(); render(); homeView();
    });
    el('pager').addEventListener('click', e => {
      const b = e.target.closest('button[data-page]');
      if (!b || b.disabled) return;
      state.page = +b.dataset.page;
      renderTable(filtered());
      document.getElementById('tabel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.querySelectorAll('#tbl thead th').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = 1; }
        state.page = 1;
        renderTable(filtered());
      });
    });
  }

  // ---------- render ----------
  function render() {
    const rows = filtered();
    agg = aggregate(rows);
    el('count-live').textContent = fmt(rows.length);
    renderTiles(rows);
    renderMap();
    renderCharts(rows);
    renderTable(rows);
  }

  el('lede-total').textContent = fmt(PT.length);
  initFilters();
  initMapControls();
  renderQuality();
  render();

  // Indonesia spans ~46° of longitude and does not fit the container at a
  // fixed zoom: at zoom 5 on a 881px map the view only covers ~39°, cropping
  // both Aceh and Papua. Frame the real bounds against the real container
  // instead. The first framing is unanimated so the map opens already in
  // place rather than gliding there.
  const INDONESIA = L.latLngBounds([-11.2, 94.8], [6.2, 141.2]);
  const frameIndonesia = (animate = true) => map.fitBounds(INDONESIA, { padding: [8, 8], animate });
  frameIndonesia(false);
  window.addEventListener('resize', () => { if (!state.focusProv) frameIndonesia(false); });
  homeView = frameIndonesia;

  // Debug handle: lets the map be inspected/driven from the console.
  window.__peta = { map, state, filtered, aggregate, frameIndonesia };
})();

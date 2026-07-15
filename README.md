# Peta Pendidikan Tinggi Indonesia

Dashboard geospasial untuk dataset PDDIKTI: 5.433 perguruan tinggi, dipetakan ke
batas wilayah resmi Kepmendagri (38 provinsi, 514 kabupaten/kota).

## Menjalankan

Buka `site/index.html` langsung di browser — cukup klik dua kali. Data dimuat
sebagai variabel global JavaScript, bukan lewat `fetch()`, supaya bisa jalan dari
`file://` tanpa server.

Kalau lebih suka lewat server lokal:

```
npm start        # http://localhost:8791
```

Situs jalan **offline**. Leaflet di-vendor di `site/vendor/`. Peta dasar
OpenStreetMap bersifat opsional (mati secara bawaan) dan hanya itu yang butuh
internet.

## Membangun ulang data

```
npm run build    # baca CSV + data wilayah -> site/data/*.js
npm run verify   # cek hasilnya terhadap CSV mentah
```

`build.js` mengunduh `wilayah_level_1_2.sql` (~23 MB) sekali ke `build/.cache/`
saat pertama dijalankan.

`verify.js` menghitung ulang semuanya langsung dari CSV **tanpa memakai
`build/lib`**, sehingga bug di pipeline tidak bisa meloloskan dirinya sendiri.
Ada 34 pemeriksaan: keutuhan baris, distribusi kategori, integritas join, aturan
biaya, dan kewajaran spasial.

## Sumber data

| Data | Sumber | Lisensi |
|---|---|---|
| Perguruan tinggi | `pddikti_pt_gabungan.csv` | dataset PDDIKTI |
| Batas wilayah, penduduk, luas | [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) — Kepmendagri No 300.2.2-2138 Tahun 2025 | MIT |
| Peta | [Leaflet](https://leafletjs.com/) 1.9.4 | BSD-2-Clause |

## Struktur

```
build/
  build.js        pipeline utama
  verify.js       pemeriksaan independen terhadap CSV mentah
  lib/
    csv.js        pembaca CSV (RFC 4180)
    wilayah.js    parser SQL wilayah + normalisasi bentuk poligon
    geom.js       Douglas-Peucker + penyaringan pulau mikro
    clean.js      normalisasi & aturan kualitas data PDDIKTI
    match.js      penggabungan nama kabupaten -> kode Kepmendagri
    geofix.js     perbaikan batas wilayah yang cacat
site/
  index.html
  assets/         style.css, app.js
  data/           *.js hasil build (variabel global)
  vendor/         Leaflet
```

## Catatan penting soal data

Dataset sumber punya sejumlah cacat. Semuanya **ditandai, bukan dibuang diam-diam**,
dan tampil di panel "Catatan kualitas data" pada situs.

**Perbedaan pembagian provinsi.** Dataset PDDIKTI masih memakai 34 provinsi
(sebelum pemekaran Papua 2022), sedangkan data wilayah resmi memakai 38. Provinsi
setiap PT **diturunkan ulang dari kode kabupaten resmi**, sehingga PT di Papua
tersebar ke provinsi pemekarannya. Angka per provinsi karena itu bisa berbeda dari
yang tercetak di CSV.

**Biaya.** 15 baris mencantumkan nilai ≥ Rp1 miliar per semester (contoh:
`Rp5.150.000 - 62.620.000.000.000`) — angkanya tergabung/rusak dan tidak bisa
dipulihkan, sehingga dikeluarkan dari statistik. 15 baris lain berada di atas
Rp200 juta per semester (Universitas Tadulako Rp850 juta, Politeknik Negeri Kupang
Rp500 juta — keduanya PTN dengan UKT sebenarnya puluhan juta); ini kemungkinan
mencampur uang pangkal, tapi karena tidak terbukti mustahil nilainya **tetap
ditampilkan dengan tanda ⚠**. 108 baris memakai batas bawah seperti `Rp1` sebagai
penanda UKT bersubsidi, bukan harga.

**Cakupan.** Kolom Persentase Kelulusan kosong pada 50% baris dan Rentang Biaya
pada 53%. Median untuk wilayah dengan sedikit data perlu dibaca hati-hati —
peta menuntut minimal 3 sampel sebelum mewarnai sebuah wilayah untuk ukuran median.

**Akreditasi.** Dataset mencampur skema lama (A/B/C) dan baru (Unggul/Baik
Sekali/Baik). Keduanya disetarakan per tingkat untuk pewarnaan; label asli tetap
tampil di tabel.

**Batas wilayah.** Poligon diperiksa silang dengan kolom koordinat yang terpisah.
Serdang Bedagai, Kepulauan Meranti, dan Pangandaran punya batas yang keliru di
sumbernya sehingga poligonnya tidak digambar (statistiknya tetap dihitung);
poligon Sangihe dan Talaud tertukar dan sudah dikembalikan; centroid Wakatobi
(tertulis `lng 23.539`, di Afrika) diperbaiki. Pemeriksaan ini berjalan setiap
build, jadi cacat baru akan muncul sebagai peringatan.

68 baris (1,3%) tidak punya isian Kabupaten sehingga tidak muncul di peta
kabupaten, tapi tetap dihitung dalam total nasional.

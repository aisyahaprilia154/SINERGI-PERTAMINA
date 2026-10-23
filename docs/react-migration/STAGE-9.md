# Tahap 9 — Pisahkan logika peta

Tanggal: 24 Oktober 2026. Branch `react-migration-baseline`; checkpoint awal `46ec023`.

## Perubahan

Pencarian/ranking aset, klasifikasi label, cakupan fasilitas, hitungan geometri/jaringan/pole groups/graph, pilihan target relasi, predikat overlay/preset, ID URL stabil dan konteks dataset kini berada di domain/map-read-model.js. State seleksi serta parse/serialize URL dipindah utuh ke domain/map-selection.js; traversal graph terkonfirmasi ke domain/map-network-tracing.js. Subkategori jaringan dan ringkasan hitungan juga dipisahkan dari renderer sidebar.

Map-page dan network-sidebar legacy memakai modul murni itu. Modul lama mengekspor ulang API publik agar tes dan konsumen yang belum dimigrasi tetap kompatibel. readRequestedDatasetContext menerima search/storage sebagai argumen; hanya pemanggil UI yang mengakses window. mapSelectionOptions dan mapSelectionQuery memusatkan default jaringan, alias ID dan penulisan parameter yang sebelumnya berada di halaman besar. createMapReadModel mengomposisikan adapter dataset, scope area, seleksi URL, ringkasan topologi dan overlay untuk halaman React tahap 10.

UI/markup, CSS, event binder, MapLibre, dialog, editor dan rute aktif peta tetap legacy. Tidak ada aktivasi peta React atau perubahan API/backend/database. Pemindahan memakai UTF-8 eksplisit.

## Verifikasi

341 tes Node frontend dan 97 tes React lulus; backend 77 lulus dengan 1 integrasi PostgreSQL dilewati. Lima tes Node baru memeriksa komposisi scope/model yang tidak memutasi input, pemilihan kosong eksplisit, parameter URL di luar seleksi, ID stabil, prioritas konteks dataset tanpa window, dan identitas fungsi pada facade kompatibilitas.

extraction-proof.json mencatat checkpoint sumber dan hash 21 fungsi + 2 modul. Body yang dipindah dibandingkan langsung dengan source Git sebelum tahap ini. Perbandingan hanya menormalkan export dan penggantian input global konteks dataset menjadi argumen. Semua identik. Helper komposisi baru diuji melalui hasil model, bukan dengan menggandakan implementasinya.

Capture peta sebelum/sesudah dalam desktop/mobile dan terang/gelap memakai fixture API yang sama, font asli dan vector basemap kosong. Empat pasangan halaman penuh identik pada ambang RGB >12; contact sheet tersedia di stage-9/. Algoritme graph/layout yang sudah diuji tetap dipakai. Salah satu capture awal menangkap marker sebelum GPU selesai menggambar garis (1237 pixel pada mobile gelap). Capture final menunggu layout marker, dua animation frame dan 500 ms untuk upload source GPU; keempat pasangan final identik. Tidak ada perubahan renderer untuk menyembunyikan perbedaan.

Lint root/frontend/backend dan build frontend/backend lulus. Smoke baseline 10/10 kelompok lulus. Dua run browser lengkap masing-masing mencapai 42/43: satu terganggu navigation context pada login, satu menunggu event unduhan. Kedua kasus tersebut lulus pada run terisolasi 2/2 tanpa perubahan kode/assertion/timeout; 43 kasus keseluruhan terverifikasi melalui regresi dan uji ulang, bukan satu run bersih. Ketidakstabilan browser ini dicatat sebagai batas lingkungan. Runtime Chromium Headless Shell 156.

## Batas dan kelanjutan

Semua operasi tulis pengujian tetap memakai mock; tidak ada perubahan data operasional. Integrasi database uji terpisah belum tersedia, peta/satelit eksternal dan beban dataset produksi besar tidak diuji. Docker image tidak di-redeploy. File pengguna docs/figures/, penghapusan .env.docker.example, rahasia dan backup dibiarkan di luar checkpoint.

Lima halaman tetap React, peta/topologi tetap legacy. Setelah pemeriksaan dan checkpoint tahap 9 lulus, lanjut langsung tahap 10 sesuai permintaan pengguna. Peta React tahap 10 tetap tidak menjadi rute aktif sampai pekerjaan lanjutannya selesai; berhenti setelah tahap 10.

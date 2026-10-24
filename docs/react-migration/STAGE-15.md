# Tahap 15 — Edit topologi dan penyimpanan

Tanggal: 24 Oktober 2026 (Asia/Jakarta). Dasar kode: `919d142` (tahap 14). Branch lokal: `react-migration-baseline`.

## Hasil dan cakupan

`/topology` dan `/topologi`, termasuk trailing slash, sekarang aktif memakai React. Login, empat halaman administrasi/impor, peta beserta dialognya, dan topologi sudah memakai React pada rute produksi. Navigasi antarhalaman masih memuat dokumen penuh sampai tahap 16.

Toolbar, tambah/pilih frame, pencarian jenis/tiang, nama frame, pilihan penempatan aset, pencarian/tambah/hapus relasi, indikator draft, Batal/Simpan, status/error dan ekspor merupakan JSX. Implementasi tidak memasang halaman HTML lama dalam komponen React. Sesi, tema dan penjagaan akses menggunakan provider bersama.

`useTopologyEditor` memiliki dokumen kerja terpisah, AbortController, subscription revision, proteksi beforeunload dan scope unduhan. Dokumen mutable hasil ekstraksi tahap 13 tetap menjadi pemilik draft/snapshot/revision; React menerima snapshot setelah perintah edit. Mesin graph/layout, aturan penggantian relasi kamera, pengelompokan turunan JB, sumber ikon dan SVG/PNG tetap dipakai.

Adapter SVG mengelola pointer capture, ambang drag, ghost/umpan balik, hit testing, auto-pan dan drop. Drag ke perangkat menambah relasi; drag ke frame mengubah penempatan; drag dalam frame menyimpan koordinat diagram dengan koreksi zoom. Escape, pointercancel, lost capture dan dispose membatalkan drag. Gerakan pointer tidak mengubah state halaman React. Indikator zoom memakai state komponen navigasi tersendiri, sehingga zoom tidak merender ulang dokumen, sidebar dan inspector.

Perpindahan JB menggunakan `frameMoveAssetIds` yang sama dengan baseline untuk membawa turunan satu frame. Penempatan ke tiang memperbarui proyeksi mounting, sedangkan Indoor/Non-tiang melepaskan mounting sesuai aturan lama. Pilihan kosong yang sementara dibuang ketika composer dibatalkan. Nama custom frame dideduplicasi sebagai `create-frame`; nama frame tiang memakai `rename-frame`.

Baseline tidak menyediakan tindakan UI hapus frame: menu Lainnya hanya berisi ubah nama. Tahap ini mempertahankan operasi yang tersedia; tidak menambahkan operasi hapus frame baru. Tidak ada perubahan endpoint, payload, expectedRevision, token, kunci storage, database, SSR, TypeScript atau redesign.

## Penyimpanan dan lifecycle

Perubahan tetap berupa draft sampai pengguna memilih Simpan. Batal mengembalikan graph, mounting, frame, nama dan posisi ke snapshot terakhir yang diakui server. Simpan diserialkan, tombol terkait dinonaktifkan saat sibuk, ID edge sementara tidak dikirim dan revision asli dipertahankan saat 409. Draft/error tetap tersedia untuk retry eksplisit; tidak ada retry tulis otomatis. Refresh sesudah simpan mempertahankan pemeriksaan versi dataset dan fallback pemberitahuan bila pembacaan ulang gagal.

beforeunload menjaga draft saat navigasi dokumen. Event revision lintas halaman tidak memuat ulang draft kotor. Request read/write, ikon, subscription, listener, timer/RAF, observer, pointer/auto-pan/ghost, renderer dan object URL mempunyai pemilik dan cleanup. Respons setelah abort diabaikan. Tidak ada worker topologi baru yang diaktifkan; tes kepemilikan worker yang sudah ada tetap memakai stub.

Perbaikan yang ditemukan melalui verifikasi:

- Input nama hanya diseleksi saat editor dibuka, sehingga pengetikan tidak menggantikan karakter sebelumnya.
- Label custom frame dapat difokuskan/diaktifkan dengan keyboard.
- Panel ekspor berada di atas inspector, sehingga tombol SVG/PNG dapat digunakan ketika detail terbuka. Pada baseline desktop panel tertutup inspector.
- Menutup inspector mempertahankan pilihan aset/relasi sesuai baseline. Perubahan panel yang tidak mengubah graph tidak menggambar ulang SVG atau menggeser kamera mobile.

## Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend Node lama, concurrency 1 | 341 lulus |
| React/Vitest seluruh suite | 192 lulus, 13 berkas |
| Backend Node, concurrency 1 | 77 lulus, 1 integrasi PostgreSQL dilewati |
| Playwright seluruh suite | 80/80 lulus dalam satu run |
| Playwright topologi setelah perbaikan akhir viewport | 16/16 lulus |
| Smoke baseline sesudah perbaikan akhir | 10/10 kelompok lulus, errors/unexpected kosong |
| Lint root/frontend JSX-Hooks/backend | Lulus |
| Build frontend/backend | Lulus; `dist/client/index.html` dan `dist/server/index.js` tersedia |
| Bukti sumber dan viewport | 21 sumber lama identik; 13 fungsi viewport dan perhitungan posisi label identik |

Tiga belas tes baru terhadap checkpoint tahap 14 mencakup kontrol edit React, cancel, perlindungan navigasi, konflik/payload revision, simpan tunggal dan retry, relasi/search, provisional frame, create/rename/dedup, penempatan/mounting dan rollback, posisi hasil delta/zoom, Viewer, respons simpan setelah unmount, ekspor/Escape/fokus serta isolasi render zoom/panel. Enam kasus browser baru memeriksa alur relasi/409/cancel/save, frame/nama/penempatan yang bertahan setelah reload, drag nyata tanpa redraw saat pointer bergerak dan pembatalan Escape, unduhan SVG/PNG nyata untuk Viewer, beforeunload/late write serta posisi drag yang tersimpan dan dirender setelah reload.

Empat tes legacy hasil ekstraksi tetap berjalan melalui fixture terisolasi `e2e/fixtures/topology-legacy.html`; tidak ada assertion yang dibuang. Ekspektasi routing produksi diperbarui untuk aktivasi React. Seluruh 80 kasus browser lulus sebelum perbaikan akhir yang terbatas pada adapter topologi; sesudahnya seluruh 192 Vitest, 16 kasus browser topologi, smoke, tes Node lama, lint dan build dijalankan pada sumber akhir. Tidak mengklaim run 80 kasus kedua setelah perbaikan itu.

Run diagnostik awal menemukan fixture legacy yang salah path import, frame kosong yang belum dimunculkan dalam fixture tes mounting, input nama terseleksi ulang, label custom yang belum bisa difokuskan, panel ekspor tertutup, dan harness beforeunload yang menunggu dialog setelah click selesai. Kode/harness diperbaiki, bukan menghapus/melemahkan assertion atau menaikkan timeout. Satu penulisan SVG capture mendapat error Windows UNKNOWN sementara; skrip capture menambahkan retry I/O terbatas, lalu capture selesai. Kegagalan diagnostik tidak dihitung sebagai hasil akhir.

Runtime: Node 24.22.1, Chromium Headless Shell 156.0.8078.4, satu worker browser. Label proyek Playwright `desktop-edge` bukan bukti pengujian Microsoft Edge. Peringatan chunk MapLibre >500 kB yang sudah ada tetap muncul.

## Bukti visual

Capture Administrator membandingkan detail, tambah frame, draft bar, ekspor dan nama frame pada desktop 1440×900/mobile 390×844, terang/gelap: **40 screenshot halaman + 40 potongan, 20 pasangan**. Semua pasangan potongan berukuran sama dan **17 identik** pada ambang RGB >12. Selisih tiga pasangan adalah dua panel ekspor desktop (10.494–10.519 pixel) yang sekarang terlihat di atas inspector dan satu highlight seleksi teks nama pada mobile terang (1.200 pixel). Contact sheet, crop/diff dan diagram mobile diperiksa secara visual.

Seluruh **20 pasangan metrik viewport identik**, mencakup scroll, posisi frame, transform dan zoom. **16 pasangan SVG DOM identik byte demi byte**; empat composer hanya berbeda pada atribut tabindex/role/aria-label untuk keyboard custom frame. Menghapus tiga atribut itu pada kedua sumber menghasilkan kesamaan seluruh 20 pasangan; tidak menyatakan ke-20 SVG mentah identik. UUID capture dibuat deterministik pada kedua implementasi. Hash DOM asli dicatat sebelum SVG artefak merapikan spasi akhir baris. Capture memakai reduced motion; tes interaktif memakai preferensi motion default.

Perbandingan seluruh halaman tidak diklaim identik: header menggunakan komponen React bersama dengan identitas sesi yang benar, sementara header legacy menampilkan identitas generik. Artefak, metadata, comparison, contact sheet, proof, log pemeriksaan dan `verification-results.json` berada di `stage-15/`.

## Batas verifikasi dan kelanjutan

Semua operasi tulis UI memakai API mock. Database operasional tidak diubah. Integrasi PostgreSQL dilewati karena `SINERGI_TEST_DATABASE_URL` tidak tersedia. Login dengan password asli, data produksi besar dan seluruh perangkat/browser belum diverifikasi. Koneksi proxy Vite ke backend Docker diperiksa tanpa sesi dan mengembalikan 401 yang diharapkan.

Vite melayani kode terbaru pada port 5173 dengan proxy backend 5001. Frontend Docker port 5174 tetap menggunakan image lama; tidak ada rebuild/deployment Docker, push atau merge. Penghapusan lokal `.env.docker.example`, folder pengguna `docs/figures/`, rahasia dan backup tidak disertakan dalam checkpoint.

Semua halaman utama aktif React. Entrypoint transisi, renderer/binder halaman lama, serta CSS/import kompatibilitas masih tersimpan; hanya fixture regresi yang memanggil halaman topologi lama. Tahap berikutnya **16 — Integrasi akhir dan hapus jalur lama**, mencakup navigasi SPA, penjagaan draft internal, pembersihan legacy, README dan pemeriksaan Docker frontend/direct URL/back-forward. Berhenti setelah checkpoint lokal tahap 15.

# Tahap 11 — Detail dan edit aset di peta

Selesai lokal pada 24 Oktober 2026, branch `react-migration-baseline`, dari checkpoint tahap 10 `89ab7f4`. Permintaan “lnjut” diterapkan untuk tahap 11 saja. Tahap 12 belum dimulai. Tidak ada perubahan database, push, merge, atau deployment.

## Bagian yang berubah

Rute `/map`, `/map/`, `/peta` dan `/peta/` kini memakai `MapRoute` React melalui entrypoint yang sama. Halaman peta lama tidak dipanggil pada rute aktif; file lama tetap tersedia sampai pembersihan akhir migrasi. Navigasi antarhalaman masih memuat dokumen penuh.

`AssetDetailDrawer.jsx` mengelola markup dan event detail aset dengan JSX: identitas/ikon, jaringan yang mencakup aset, relasi langsung, navigasi ke aset terkait, fokus posisi peta, ringkas/perluas mobile, retry dan pesan proses/error. Administrator dapat mengganti/menghapus ikon, mencari dan menambah relasi, mengganti relasi dalam satu request atomik, menghapus relasi, serta mencari/menetapkan/mengganti/melepas tiang sesuai capability API. Viewer menerima kontrol baca saja. Aturan kategori, label, jarak dan jenis aset memakai fungsi murni yang disalin dari drawer lama, bukan HTML renderer lama.

`useAssetDetail` membatalkan request ketika aset berubah, halaman ditinggalkan atau komponen dilepas; respons terlambat tidak mengambil alih drawer baru. Kontrak backend operasional schema 2 memakai `recordRevision`/`revision` tanpa `activePointer`; kontrak lama tetap memakai `activePointer.revision`. Keduanya diperiksa sebelum detail boleh diedit. Ini mempertahankan pemeriksaan revision sekaligus menangani bentuk respons backend yang benar.

`useMapDocument` memiliki revision, snapshot proyeksi, status busy, request tulis dan guard draft. Semua operasi tulis berasal dari tindakan pengguna, diserialkan, dan mengirim `expectedRevision` melalui service yang sudah ada. Penggantian relasi mengirim remove-edge dan add-relation dalam satu payload. Graph dan pemasangan yang terlihat hanya diganti setelah respons server valid. Kegagalan biasa mempertahankan graph/ikon sebelumnya serta query editor; 409 mempertahankan draft dan memblokir penulisan berikutnya sampai reload. Notifikasi revision dari tab lain memuat ulang halaman yang bersih atau menampilkan peringatan pada editor yang sedang dipakai. Draft dilindungi ketika menutup drawer, berganti aset, berpindah dokumen dan beforeunload. Konfirmasi perpindahan dokumen tidak diikuti prompt native kedua.

Respons simpan ikon backend saat ini hanya mengembalikan revision. UI menggunakan data gambar yang sudah disetujui server sebagai proyeksi lokal jika customIconUrl tidak dikembalikan. Signal opsional pada `prepareAssetIcon` membatalkan decoding dan segera melepas object URL saat drawer/halaman dilepas. Endpoint, payload, sesi, kunci penyimpanan dan backend tidak diubah.

## Integrasi dengan MapLibre

Canvas tetap satu instance selama edit, pencarian, seleksi, kontrol jaringan dan perubahan tema. Adapter menyimpan salinan aset milik renderer dan mengirim pembaruan ikon, graph serta pole groups ke instance yang sama; snapshot React tidak dimutasi oleh renderer. Kamera tidak direset oleh pembaruan proyeksi.

Pemeriksaan browser menemukan renderer lama juga menulis daftar aksesibilitas di luar container peta. Opsi kompatibel `manageAccessibleAssets` tetap true secara default untuk pemanggil lama, dan false pada adapter React. Daftar serta handler React kini tetap dimiliki React. Cleanup mencakup renderer, observer, request dataset/detail/ikon/tulis, respons factory terlambat, listener dan decoding gambar.

CSS lama menyembunyikan paragraf pertama ringkasan relasi, termasuk feedback simpan/error. Override khusus peta React memastikan feedback tetap terlihat. Pada mobile, pencarian tiang menggulir container isi drawer agar input/hasil terlihat tanpa menggeser halaman peta. Tampilan lama dan perilaku keyboard/fokus menjadi pembanding.

## Dialog yang masih memakai implementasi lama

Tombol aksi data dan pemicu diagram dikelola React. Dialog impor/ekspor yang sudah tersedia dipertahankan melalui `useMapTransfer`, sehingga aktivasi peta tidak menghilangkan fitur sambil menunggu tahap 12. Bridge hanya membuka dialog terpisah; tidak membungkus halaman lama atau binder drawer lama. Bridge menutup dialog dan membatalkan request saat halaman dilepas. Timer polling dialog dibuat abortable, dan object URL unduhan dibersihkan ketika dialog ditutup. Dialog impor juga tetap tersedia pada keadaan gagal memuat dataset. Diagram tetap menuju halaman topologi dengan dataset/area/aset terpilih, sesuai baseline.

Migrasi JSX untuk isi dialog impor/ekspor belum dikerjakan. Topologi masih sepenuhnya legacy. Enam dari tujuh halaman aktif memakai React: login, pengguna, versi database, riwayat/unggah, preview dan peta.

## Hasil pemeriksaan akhir

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend Node lama | 341 lulus |
| React / Vitest | 129 lulus, 10 berkas |
| Backend | 77 lulus, 1 integrasi PostgreSQL dilewati |
| Playwright seluruh suite | 56/56 lulus dalam satu run |
| Ulang browser terdampak perapian fokus terakhir | 13/13 peta dan detail/edit |
| Smoke baseline | 10/10 kelompok lulus; errors dan unexpected kosong |
| Lint | Root, frontend termasuk JSX/Hooks, backend lulus |
| Build | Frontend dan backend lulus |

Lima belas tes React baru mencakup kontrak detail operasional, role, error/retry, detail revision usang, abort/respons terlambat, query saat simpan gagal, penulisan tunggal, payload revision, replace atomik, hapus, pemasangan tiang, validasi gambar, respons ikon hanya revision, konflik 409, draft, cleanup request tulis, decoding/object URL dan pembaruan native tanpa mutasi/kamera reset. Tujuh tes browser baru menjalankan interaksi tersebut pada renderer MapLibre sungguhan, termasuk decoding gambar PNG sungguhan dan mobile. Tes routing diperbarui untuk aktivasi kedua alias; assertion fungsi lama tetap dipertahankan. Tes panel mobile kini menutup drawer detail terlebih dahulu, karena drawer menyembunyikan tab sesuai CSS baseline.

Run diagnostik awal berhenti pada kepemilikan daftar aksesibilitas, feedback yang tersembunyi oleh CSS lama, dan asumsi tes mobile sebelum drawer diaktifkan. Penyebab diperbaiki sebelum run akhir 56/56. Tidak ada timeout yang dinaikkan atau assertion dihapus untuk menyembunyikan kegagalan.

Run penuh browser dilakukan sebelum penyempurnaan fokus menu ikon terakhir. Tes 13 kasus peta/detail serta 129 tes React dijalankan kembali pada sumber akhir; build dan lint frontend juga diulang. Menu ikon memfokuskan aksi pertama, menutup saat fokus keluar, dan mengembalikan fokus ke pemicu melalui Escape.

Runtime: Node 24.22.1 dan Playwright Chromium Headless Shell 156, satu worker browser. Nama project konfigurasi tetap `desktop-edge`; runtime dipilih melalui `BASELINE_BROWSER_CHANNEL=chromium-headless-shell` karena kendala Edge/Chromium standar yang dicatat pada tahap sebelumnya. Build mempertahankan `dist/client` dan `dist/server/index.js`; peringatan ukuran chunk MapLibre yang sudah ada tetap muncul.

## Visual dan artefak

`capture-map-edit.cjs` mengambil **40 screenshot halaman + 40 potongan drawer** untuk detail, pencarian relasi, pencarian tiang, menu ikon dan error, dalam desktop 1440×900/mobile 390×844 serta terang/gelap. Referensi memuat entry legacy secara terisolasi dan memastikan modul yang benar digunakan. Seluruh API dimock. Satu capture dengan font CDN gagal diganti setelah verifikasi font; script kini memeriksa Material Symbols sebelum memotret. Capture detail desktop gelap yang sempat berbeda akibat paint juga diambil ulang sebagai pasangan.

`compare-map-edit.py` membandingkan 20 pasangan drawer, seluruh dimensi sama: **12 pasangan identik**, delapan berbeda **322–551 pixel, maksimum 0,26%**, pada ambang RGB >12 per kanal. Selisih tersisa berupa fokus tombol/menu yang dipertahankan React; contact sheet, diff dan tampilan mobile diperiksa. Pencarian relasi dan tiang identik pada keempat kombinasi viewport/tema. Kesamaan pixel seluruh halaman tidak diklaim.

Artefak ada di `stage-11/`: screenshot, contact-sheet.jpg, capture-results.json, visual-comparison.json, playwright-results.txt, verification-results.json dan smoke-results.json. Fixture `map-edit-fixtures.cjs` meniru schema 2 dan respons write backend yang hanya membawa revision, tanpa database operasional.

## Keterbatasan dan keadaan lokal

Operasi tulis seluruh pengujian UI memakai API mock. Integrasi PostgreSQL terpisah dilewati karena `SINERGI_TEST_DATABASE_URL` tidak tersedia. Login dengan password akun asli, edit langsung pada data produksi dan ketersediaan seluruh tile eksternal tidak diuji. Pembatalan request menjaga lifecycle klien; tidak menjanjikan pembatalan transaksi yang sudah diterima server.

Kode terbaru tersedia melalui Vite port 5173 dengan proxy backend Docker port 5001. Frontend Docker port 5174 tetap image sebelum tahap 7, tanpa rebuild/deployment. Penghapusan lokal `.env.docker.example`, folder pengguna `docs/figures/`, rahasia serta backup database tidak masuk checkpoint tahap ini.

Tahap berikutnya: **12 — Dialog peta dan ekspor**, menunggu permintaan baru. Pengerjaan berhenti setelah checkpoint tahap 11.

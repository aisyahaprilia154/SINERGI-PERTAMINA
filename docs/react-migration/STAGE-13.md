# Tahap 13 — Pisahkan logika topologi

Selesai lokal pada 24 Oktober 2026, branch `react-migration-baseline`, dari checkpoint tahap 12 `bdb7358`. Permintaan pengguna hanya tahap 13. Tahap 14 belum dimulai. Checkpoint dibuat setelah pemeriksaan selesai.

## Pemisahan tanggung jawab

Halaman `/topology` dan alias `/topologi` tetap memakai renderer/binder halaman lama. Tidak ada halaman atau komponen topologi React yang diaktifkan pada tahap ini. Enam halaman dan dialog peta yang sudah React tetap aktif; navigasi antarhalaman masih memuat dokumen penuh.

- `topology-document`: working graph/roots, snapshot terakhir yang diakui server, penambahan/penghapusan/pemulihan relasi, deduplikasi perubahan frame/posisi, batal, save dan refresh setelah save. State serta callback UI diberikan oleh pemanggil; modul tidak membaca DOM.
- `topology-workspace-state` dan `topology-selection`: prioritas URL/area tersimpan, state awal independen, seleksi aset/edge/frame yang saling eksklusif, serta pencarian yang masuk dari overview ke area. Pemanggil menyediakan efek render/fokus/persistensi.
- `topology-search`: pencarian perangkat, kandidat relasi pada area yang sama, jalur jaringan dan relasi langsung. Batas hasil dan aturan graph lama dipertahankan.
- `topology-workspace-model`: komposisi input model dan pilihan layout, termasuk ukuran viewport, overview, frame kosong/custom serta posisi node tersimpan. Algoritme model/layout tidak diganti; koordinasi layout tetap sinkron seperti baseline. Worker layout lama tetap tersedia dan belum diaktifkan.
- `topology-document-service`: pengambilan active dataset, fallback graph dan roots, dengan signal pembatalan. Dataset fallback kini diberikan eksplisit dari konteks hasil load agar tidak bergantung pada penulisan sessionStorage di tengah request.
- `topology-graph-renderer`: hanya container SVG, keadaan kosong, ikon sumber serta pembaruan ukuran/transform. Toolbar, sidebar, inspector dan binder UI tetap legacy.
- `topology-workspace-scope`: lifecycle tunggal untuk AbortSignal, listener, timeout, requestAnimationFrame, observer dan cleanup resource. Ada API kepemilikan worker yang diuji menggunakan stub; tidak ada worker baru yang dijalankan oleh halaman.

`renderTopologyPage` membersihkan mount sebelumnya pada retry/remount dan mengembalikan fungsi dispose setelah load. Pagehide juga menghentikan scope. Load/save/refresh/ikon/PNG memakai signal; respons sesudah pembatalan tidak mengubah UI. Timer pencarian/toast, frame viewport/drop target, ResizeObserver, pointer capture, auto-pan dan feedback drag dilepas. Callback ikon yang selesai setelah seleksi berubah menggambar snapshot terkini; callback sesudah dispose diabaikan. Unduhan menggunakan pemilik object URL yang sama dengan dialog peta. Cleanup revision subscription juga melepas listener pagehide miliknya sendiri.

Efek tulis tetap berasal dari aksi pengguna. Endpoint, token, storage key, payload `expectedRevision`/changes, pemeriksaan versi dataset setelah save dan perilaku konflik tetap dipertahankan. Kegagalan biasa/409 menyimpan draft untuk retry sesuai baseline; tidak ditambahkan penulisan otomatis. Pembatalan request klien tidak menjamin transaksi server yang sudah diterima ikut dibatalkan.

## Bukti tidak berubahnya graph/layout dan UI

`prove-topology-extraction.cjs` membandingkan dengan Git `bdb7358` dan menghasilkan `stage-13/extraction-proof.json`:

- 17 modul mesin/domain graph, layout, SVG, viewport, drag, worker dan relasi identik; empat CSS terkait juga identik, total 21 berkas.
- 11 fungsi tetap identik setelah normalisasi whitespace, export dan parameter model eksplisit. Termasuk operasi draft/mounting serta markup workspace/sidebar/loading/error.
- Model dan layout identik dalam 18 kombinasi: desktop/tablet/mobile, overview/dua scope area, serta dengan/tanpa frame draft dan posisi tersimpan. Model Map/Set juga dibandingkan secara mendalam, bukan hanya JSON.

Capture mencakup overview, diagram fasilitas, detail/inspector, pencarian, kosong dan error dalam desktop 1440×900/mobile 390×844, terang/gelap: 24 sebelum + 24 sesudah. Dua puluh capture baseline awal diambil sebelum ekstraksi; empat capture diagram fasilitas memakai source halaman checkpoint `bdb7358` melalui intercept browser terisolasi. Rute aplikasi tidak diganti untuk pembandingan.

Ke-24 pasangan berukuran sama; 18 identik pada ambang RGB >12. Enam pasangan berbeda 207–3670 pixel, maksimum 0,284% halaman. Diff berada pada kontrol zoom/navigasi di bagian bawah, termasuk posisi dock pada satu capture; diagram, sidebar dan inspector tidak menunjukkan selisih tersebut. CSS/markup/hasil layout tetap sama. Contact sheet, diff dan diagram fasilitas diperiksa secara visual. Kesamaan seluruh pixel tidak diklaim.

## Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend Node lama | 341 lulus |
| React/Vitest | 163 lulus, 12 berkas |
| Backend | 77 lulus, 1 integrasi PostgreSQL dilewati |
| Browser topologi baru | 4/4 lulus |
| Browser seluruh suite | 68/68 lulus pada run ulang penuh |
| Smoke baseline | 10/10 kelompok lulus; errors/unexpected kosong |
| Lint | Root/frontend JSX-Hooks/backend lulus |
| Build | Frontend dist/client + dist/server/index.js dan backend lulus |

Dua belas tes Vitest baru memeriksa deduplikasi draft, batal/pemulihan mounting dan posisi, relasi lama dipulihkan tanpa tambahan duplikat, konflik/retry/payload revision, save tunggal, refresh gagal setelah save berhasil, abort respons tulis/read terlambat, Viewer, URL/storage, pencarian/jalur/seleksi, fallback dataset, disposal timer/frame/listener/observer/worker, serta ikon yang selesai setelah perubahan seleksi/dispose.

Empat tes browser baru memakai halaman legacy aktif: Viewer dan pencarian/seleksi, hapus/batal relasi, konflik save dan retry ganda, error/retry/kosong, pending load sesudah pagehide, serta remount/dispose yang tidak meninggalkan handler dan debounce. Semua API dimock.

Satu tes statis lama awalnya gagal karena mencari `loadActiveDataset`, save dan opsi layout hanya di file halaman. Pemeriksaannya dipindahkan ke modul pemilik yang baru, dengan assertion tambahan bahwa halaman memanggil modul tersebut. Assertion UI dan larangan markup lama tetap dipertahankan. Tes batal draft baru juga diperbaiki setelah memeriksa perilaku baseline: pemulihan mounting menambahkan metadata null/array kosong secara eksplisit. Tidak ada tes dihapus atau timeout dinaikkan.

Run penuh browser pertama mencapai 67/68; kegagalan sebelum alur unduhan dimulai karena canvas MapLibre tidak muncul dalam 5 detik. RAM bebas saat pemeriksaan sekitar 37 MB. Ini dicatat sebagai gangguan lingkungan, bukan dianggap lulus. Run ulang dilakukan bergantian dengan tes unit/build dan seluruh 68 tes lulus dalam satu run, tanpa perubahan assertion atau timeout.

Artefak di `stage-13/`: capture sebelum/sesudah dan hasil perbandingan, contact sheet/diff, extraction-proof.json, log Node/Vitest/backend, lint/build, run browser pertama dan akhir, smoke serta verification-results.json. Browser memakai Chromium Headless Shell 156, satu worker; runtime Node 24.22.1. Peringatan ukuran chunk MapLibre >500 kB yang sudah ada tetap muncul.

## Batas verifikasi dan kelanjutan

Operasi tulis UI hanya memakai API mock; database operasional tidak diubah. Integrasi PostgreSQL terpisah dilewati karena `SINERGI_TEST_DATABASE_URL` tidak tersedia. Login dengan password asli, edit dataset produksi besar dan seluruh variasi browser/perangkat tidak diverifikasi. Listener akun/tema global tetap milik aplikasi legacy dan tidak dibuat ulang oleh scope workspace.

Vite terbaru memakai port 5173 dan proxy backend Docker 5001. Frontend Docker 5174 tetap image lama tanpa rebuild/deployment. Build Docker frontend wajib dilakukan pada tahap 16. Tidak ada push/merge/deployment. Penghapusan lokal `.env.docker.example`, folder pengguna `docs/figures/`, rahasia serta backup tidak disertakan dalam checkpoint.

Tahap berikutnya **14 — Topologi React untuk membaca data**, setelah diminta. Tahap 13 tidak mengaktifkan topologi React.

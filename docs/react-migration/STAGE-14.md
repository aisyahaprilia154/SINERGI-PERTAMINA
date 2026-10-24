# Tahap 14 — Topologi React untuk membaca data

Selesai lokal pada 24 Oktober 2026, branch `react-migration-baseline`, dari checkpoint tahap 13 `00f9d08`. Permintaan pengguna hanya tahap 14. Checkpoint dibuat sesudah pemeriksaan lulus. Tahap 15 belum dimulai.

## UI yang sudah memakai React

`TopologyRoute`, `TopologyReadPage`, `TopologyBoard` dan `TopologyPanels` menyiapkan halaman baca topologi dengan JSX, satu React root, Context sesi/tema yang sudah ada, dan useReducer/useState. Sidebar, pilihan fasilitas, pencarian dan hasil/keyboard, panel perangkat/relasi, tray aset tanpa koneksi, legenda, toolbar navigasi, loading/error/kosong, retry serta toast dimiliki React. Halaman lama tidak dibungkus dan binder topologi lama tidak dipanggil oleh UI baru.

Pencarian tetap memakai perangkat dan aturan hasil lama. Hasil dari overview membuka fasilitas yang benar, memilih aset, mengosongkan query dan memusatkan kamera. Seleksi aset/edge/frame tetap saling eksklusif. Enter, panah, Escape, Ctrl/Cmd K, buka/tutup sidebar serta pengembalian fokus didukung. Fokus SVG dipertahankan ketika container digambar ulang; menutup inspector mengembalikannya ke aset/edge terkait. Pilihan fasilitas menghapus permintaan fokus sebelumnya, sehingga seleksi awal URL tidak dihidupkan kembali setelah pencarian.

Input URL, alias `assetId`, konteks dataset, area tersimpan, kunci session/localStorage dan parameter yang tidak terkait tetap dipertahankan. URL fixture tetap berada pada path fixture; implementasi ini tidak mengaktifkan navigasi SPA. Link/header dan tombol kembali ke peta membawa dataset, area dan aset terpilih. AppHeader mendapatkan dukungan `selectedAssetId` opsional untuk link peta; perilaku tanpa nilai tersebut tetap sama. Role/sesi memakai provider dan guard React yang sudah ada. Sesi 401/403 mengakhiri request dan kembali ke login.

**Rute aktif `/topology`, `/topologi` dan trailing slash tetap legacy.** React tersedia melalui fixture development `/e2e/fixtures/topology.html` untuk pemeriksaan. Enam halaman dan dialog peta yang sebelumnya React tetap aktif. Tidak ada perubahan pada pemilihan rute produksi. Edit frame, drag aset, perubahan relasi, draft/save dan ekspor tetap pekerjaan tahap 15. Pada fixture, tombol edit/ekspor yang belum diimplementasikan dinonaktifkan; Viewer tidak menerima tombol Administrator. Tidak ada endpoint tulis dataset yang dipanggil UI baca baru.

## Adapter dan fondasi yang dipertahankan

`topology-read-adapter` menggunakan model/layout/SVG serta perhitungan viewport yang sama. Adapter hanya memiliki isi frame SVG, ukuran/transform canvas dan event viewport: pan, Ctrl/Meta-wheel, zoom, fit/reset dan fokus. Ia tidak membuat menu, form, toolbar atau inspector HTML. Label overview dihitung adapter lalu dikirim sebagai data ke JSX. Pan tidak memutasi dokumen atau posisi sumber. Pembaruan seleksi, UI dan tema mempertahankan instance adapter/frame.

`topology-workspace-model` hasil tahap 13 tetap menjadi penghubung model/layout, dengan input ukuran viewport eksplisit. `topology-view` memisahkan helper tampilan murni untuk JSX. Loader ikon membawa Bearer token, mengubah hasil menjadi data URL, dan membagikan cache kepada panel React. Opsi `preserveFocus` pada renderer SVG bersama bersifat opt-in dan false bagi pemanggil legacy.

Lifecycle meliputi abort dataset/fallback/ikon pada unmount dan pagehide, pembersihan revision subscription, timer debounce/toast, frame fokus, ResizeObserver, event pointer/wheel/scroll/keyboard dan pointer capture. Respons dataset/ikon yang terlambat tidak membuat mount baru. Factory/update adapter gagal menampilkan retry lokal, tanpa mengulangi pengambilan dataset atau memasang handler ganda. API adapter menjadi no-op sesudah dispose. Tidak ada worker baru yang diaktifkan; worker dan mesin layout lama tetap tersedia.

## Bukti kesesuaian dengan baseline

`prove-topology-read.cjs` membandingkan dengan Git `00f9d08`: **21 berkas sumber tetap identik**, termasuk halaman legacy, engine graph/model/layout/SVG/worker dan CSS terkait. **13 fungsi viewport identik** setelah normalisasi whitespace. Perhitungan posisi label overview juga identik; hanya penyajian labelnya dipindah ke React. Bukti dan SHA-256 tersedia di `stage-14/extraction-proof.json`.

Capture membandingkan legacy Viewer dengan React Viewer untuk overview, diagram fasilitas, detail, pencarian, legenda, kosong dan error pada desktop 1440×900/mobile 390×844, terang/gelap: **56 screenshot halaman dan 56 potongan**. Semua 28 pasangan potongan berukuran sama, **18 identik**, 10 berbeda **118–472 pixel**, maksimum **0,083%** pada ambang RGB >12. Selisih tersisa terbatas pada kontrol yang dinonaktifkan sesuai scope tahap 14. Panel detail, pencarian, legenda dan error identik di empat kombinasi viewport/tema.

Seluruh **20 pasangan SVG identik byte demi byte**. Ke-**24 pasangan metrik viewport** yang tersedia identik, mencakup scrollLeft/scrollTop, frame left/top, transform dan label zoom. Perbandingan seluruh halaman tidak diklaim identik; header memakai komponen React bersama dengan identitas user yang benar, sedangkan header legacy saat ini menampilkan identitas generik pada mount topologi.

Hash SVG DOM asli dicatat sebelum penyimpanan. Berkas SVG artefak merapikan spasi akhir baris agar tidak menimbulkan whitespace error Git; hash DOM asli maupun SVG tersimpan sama pada seluruh 20 pasangan.

Capture awal menemukan teks status pembaca layar yang terlihat dan atribut kontrol yang juga dipakai selector CSS lama. Keduanya diperbaiki sebelum capture akhir. Capture akhir memakai `prefers-reduced-motion: reduce` pada kedua implementasi agar scroll tidak dipotret di tengah animasi. Tes interaktif browser memakai preferensi motion default. Contact sheet, diff serta diagram mobile diperiksa secara visual.

## Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend Node lama | 341 lulus |
| React/Vitest akhir | 179 lulus, 13 berkas |
| Backend | 77 lulus, 1 integrasi PostgreSQL dilewati |
| Browser seluruh suite | 74/74 lulus dalam satu run |
| Browser topologi baca baru | 6/6 lulus |
| Smoke baseline | 10/10 kelompok lulus; errors/unexpected kosong |
| Lint | Root/frontend termasuk JSX-Hooks/backend lulus; frontend diulang pada sumber akhir |
| Build | Frontend dist/client + dist/server/index.js dan backend lulus; frontend diulang pada sumber akhir |

Enam belas tes komponen/adapter baru mencakup routing tetap legacy, StrictMode/abort load pertama, read-only/role, loading/error/retry/kosong, URL/storage, pencarian/fokus/seleksi, reset fasilitas setelah fokus awal URL, konteks link peta, kontrol viewport, keyboard/mobile/legenda, invalid selection, retry adapter tanpa refetch, abort/unmount/pagehide/sesi, immutable source, fokus SVG saat redraw, wheel anchoring, observer/listener/request ikon dan dispose idempotent. Run awal 15 tes baru dan run penuh 178 tes lulus; satu regresi fokus kemudian ditambahkan untuk verifikasi akhir.

Enam tes browser baru menjalankan renderer SVG sebenarnya di fixture: request baca tanpa binder lama, input/seleksi dan link, zoom/tema dengan kamera/frame persisten, inspeksi edge melalui keyboard, pencarian overview-ke-fasilitas, mobile Viewer dan fokus tutup panel/legenda, error/retry/kosong, pagehide ketika read tertunda serta rute alias produksi yang tetap legacy. Semua API dimock. Tes lama tidak dihapus atau dilemahkan, dan timeout tidak dinaikkan. Kegagalan diagnostik awal berasal dari assertion Promise routing yang belum di-await dan selector nama untuk elemen tersembunyi; harness diperbaiki dengan tetap memeriksa perilakunya.

Artefak di `stage-14/` memuat screenshot/potongan, SVG, capture metadata, visual comparison, contact sheet/diff, extraction proof, log build/lint/tes, hasil browser/smoke serta verification-results.json. Runtime Node 24.22.1 dan Chromium Headless Shell 156, satu worker. Peringatan chunk MapLibre >500 kB yang sudah ada tetap muncul.

## Batas verifikasi dan kelanjutan

UI React baru hanya aktif di fixture development, sehingga belum masuk rute produksi maupun bundle halaman produksi. JSX diperiksa lint/Vitest dan dijalankan browser melalui Vite; build produksi memeriksa rute aktif yang tetap legacy. Operasi tulis UI seluruh suite memakai API mock; database operasional tidak diubah. Integrasi PostgreSQL dilewati karena `SINERGI_TEST_DATABASE_URL` tidak tersedia. Login dengan password asli, dataset produksi besar dan seluruh browser/perangkat belum diverifikasi.

Kode terbaru dilayani Vite port 5173 dengan proxy backend Docker 5001. Frontend Docker 5174 tetap image lama tanpa rebuild/deployment. Build Docker frontend dan navigasi SPA penuh tetap pemeriksaan tahap 16. Tidak ada push/merge/deployment. Penghapusan lokal `.env.docker.example`, folder pengguna `docs/figures/`, rahasia dan backup tidak disertakan dalam checkpoint.

Tahap berikutnya **15 — Edit topologi dan penyimpanan**, termasuk aktivasi rute React setelah seluruh kriterianya lulus. Berhenti setelah checkpoint tahap 14.

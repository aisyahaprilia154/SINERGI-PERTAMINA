# Tahap 4 — komponen bersama

Selesai lokal pada 23 Oktober 2026 (Asia/Jakarta), branch `react-migration-baseline`. Checkpoint sebelumnya: `422e055`.

## Komponen dan integrasi

Komponen baru tersedia di `frontend/src/react/components/`:

| Komponen | Kontrak |
| --- | --- |
| `BrandLogo`, `Icon` | JSX logo dan ikon mengikuti sistem aset/kelas yang sudah ada; tanpa markup HTML string |
| `ThemeToggle` | Varian header/login; label, pressed state, ikon dan storage mengikuti tema yang sama |
| `AppHeader` | Navigasi peta/topologi, menu akun, menu Administrator, active tab, dataset/area/draftVersionId, logout via Context sesi; anchor tetap memuat dokumen penuh |
| `AdminLayout` | Kerangka admin, header, `data-admin-content`, serta lifecycle body class/title |
| `DataTable` | Kolom render/field, row key stabil, loading, empty, error/retry, dan escaping React; state input baris bertahan ketika urutan berubah |
| `WorkspaceControls` | Zoom/reset/fit/fokus/help melalui callback; tidak mengelola mesin peta atau layout |
| `Dialog`, `Drawer`, `Overlay` | Portal, label dialog unik, initial focus, trap Tab, Escape/backdrop, busy state, nested overlay, inert background, scroll lock dan pengembalian fokus |

`ThemeProvider` dan `useTheme` berada di `src/react/theme/`. Login sudah memakai provider, logo dan toggle bersama. Hook tema khusus login dihapus karena tidak lagi dipakai. Komponen header/admin, tabel, overlay dan workspace belum dipasang pada halaman aplikasi lain; pengujian terisolasi tersedia pada `/e2e/fixtures/shared.html` saat development saja.

Context tema berbagi listener sistem hingga pemilik terakhir dilepas. Cleanup juga membatalkan frame animasi pergantian tema. Binder dan pembaruan DOM legacy mengabaikan kontrol bertanda React agar satu klik tidak diproses dua kali, dan atribut kontrol React tetap dimiliki React. Helper/komponen legacy tetap tersedia bagi enam halaman yang belum dimigrasikan.

Menu akun mendukung panah atas/bawah, Home/End, Tab, Escape, klik di luar, dan pengembalian fokus. Menu admin mengikuti role; identitas pengguna dirender sebagai teks. Event pembuka menu dihentikan agar panah yang membuka menu tidak sekaligus memindahkan fokus ke item kedua.

Overlay mengelola satu stack fokus per dokumen. Overlay teratas menerima keyboard dan pointer; background serta overlay di bawahnya inert. Urutan z-index mengikuti stack, dan nilai inert/overflow semula dipulihkan saat stack habis. Callback dan busy state terbaru dibaca tanpa memasang ulang overlay saat isi form berubah. Busy memblokir Escape, backdrop, dan tombol tutup bawaan. Pemanggil tetap bertanggung jawab pada disabled state serta operasi bisnis tombol submit/footer.

CSS tambahan dibatasi pada marker komponen React, sehingga halaman lama tidak terkena perubahan. Geometri overlay dan kontrol mengikuti CSS admin/topologi yang ada. Batas ikon workspace mencegah teks fallback font yang gagal dimuat menutupi tombol sebelahnya.

## Cara memakai pada tahap berikutnya

- Halaman admin React dibungkus `ThemeProvider`, `SessionProvider`, dan `SessionGate`, lalu `AdminLayout`. Layout merupakan presentasi; bukan pengganti pemeriksaan akses. Muat stylesheet global/header/admin yang dipakai halaman, mengikuti pola fixture dan route login.
- `AppHeader` menerima `active="users"`, `imports`, `versions`, `map` atau `topology`, serta object `context` opsional.
- `DataTable` memerlukan key kolom dan row key yang unik/stabil; gunakan `column.render(row)` untuk isi sel khusus. Pertahankan rows lama saat API error bila perilaku halaman memerlukannya.
- `Drawer`/`Dialog` menerima `open`, `onClose`, `title`, `busy`, `initialFocusRef`, `children`, dan `footer`. Nested dialog dibuka melalui state dari aksi pengguna; jangan memanggil binder overlay lama pada container React.
- `WorkspaceControls` ditempatkan dalam host workspace berposisi; callback disambungkan ke instance renderer yang tetap. Jangan membuat ulang renderer untuk setiap klik/state UI.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Tes frontend Node lama | **336/336 lulus** |
| Vitest / Testing Library | **41/41 lulus**, termasuk 13 pemeriksaan komponen bersama |
| Browser regresi sebelumnya | **15/15 lulus** pada run browser utama |
| Browser komponen bersama | **4/4 lulus** pada rerun terarah setelah perbaikan CSS ikon |
| Smoke baseline API mock | **10/10 kelompok lulus** |
| Backend Node | **75 lulus; 1 integrasi PostgreSQL dilewati** |
| Build frontend/backend | Berhasil; `dist/client` dan `dist/server` tetap; fixture tidak ada di output produksi |
| Lint root/frontend/backend | Berhasil, termasuk JSX dan Hooks |

Run browser utama terakhir menghasilkan 18 lulus dan satu kegagalan pada kontrol workspace, karena ikon fallback melampaui tombol. Sesudah pembatasan ikon diperbaiki, keempat tes shared dijalankan ulang dan semuanya lulus. Dengan demikian 19 tes browser unik tercakup oleh run utama dan rerun relevan tersebut; tidak ada assertion yang dihapus, dilonggarkan, atau dipaksa melewati pemeriksaan pointer.

Pengujian awal juga menemukan pembuka menu keyboard diproses ganda; implementasinya diperbaiki. Beberapa run awal mengalami timeout ketika browser/unit berjalan bersamaan dan font eksternal tertunda. Worker browser dan Vitest kini satu; tes perilaku memakai fixture bersama yang mengisolasi CDN font. Screenshot visual tetap memakai font asli. Timeout/asersi tidak dinaikkan atau dinonaktifkan untuk meloloskan tes.

Visual mencakup empat mode desktop/mobile × light/dark:

- Empat screenshot login dibanding baseline tahap 1: **0 piksel berbeda pada ambang kanal >12**, tanpa masking.
- Empat crop header React dibanding header legacy: **0 piksel berbeda pada ambang yang sama**.
- Fixture shared, drawer, dan dialog bertingkat diambil pada keempat mode dan diperiksa melalui [contact sheet](stage-4/shared-contact-sheet.jpg). Kontrol workspace juga terlihat pada fixture tersebut.
- Detail perbandingan ada di [header-comparison.json](stage-4/header-comparison.json) dan [login-comparison.json](stage-4/login-comparison.json). Screenshot penuh login tahap ini berada di `.runtime/react-stage4/`; baseline lama tidak ditimpa.

Percobaan capture ulang semua tujuh halaman berhenti pada peta karena timeout canvas WebGL. Verifikasi visual akhir dibatasi pada bagian yang berubah: login dan komponen bersama. Perilaku peta/topologi legacy tetap dicakup oleh browser regresi dan smoke baseline yang lulus; hasil visual seluruh tujuh halaman bukan klaim tahap ini.

`capture-baseline.cjs` kini menerima `BASELINE_PAGES=login` atau daftar nama dipisahkan koma; default tetap tujuh halaman. `capture-shared.cjs` merekam fixture komponen. Keduanya memakai Playwright yang tersedia melalui `NODE_PATH=frontend/node_modules`, dengan Vite berjalan di port 5173.

## Batas dan checkpoint

Tidak ada perubahan endpoint API, payload, database, revision, paket dependency, atau renderer MapLibre/topologi. Browser memakai data/mock API; autentikasi server nyata dan integrasi Postgres belum diverifikasi karena backend/database lokal belum tersedia. Docker belum dibangun. Peringatan ukuran chunk MapLibre yang sudah ada masih muncul.

Frontend kembali dijalankan pada port 5173 setelah build. Ini tetap frontend saja sampai backend/database dikonfigurasi. File lokal baru di `docs/figures/` muncul saat pengerjaan dan dibiarkan utuh di luar checkpoint migrasi.

Halaman aktif React tetap login/fallback publik. Kelola pengguna, Versi database, Riwayat/unggah impor, Preview, Peta dan Topologi masih legacy. Tahap berikutnya: **5 — Kelola pengguna**. Tidak ada push, merge atau deployment.

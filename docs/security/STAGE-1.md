# Tahap 1 — Pemetaan dan dependency

Baseline commit f7e213e; branch react-migration-baseline. Perubahan pengguna pada .env.docker.example dan docs/figures/ dipertahankan.

Matriks memetakan seluruh 45 poin berdasarkan kode aktif. Audit dependency bukan VA/pentest atau sertifikasi. CI audit mendapat jadwal Senin 02:17 UTC (09:17 WIB), serta pemicu manual.

Hasil verifikasi dicatat dalam evidence/. Integrasi PostgreSQL baseline dilewati bila SINERGI_TEST_DATABASE_URL belum disediakan; pengujian terisolasi disiapkan pada tahap berikutnya. Tidak ada perubahan pada database operasional atau workbook sumber.

Hasil: baseline frontend Node 341/341, React 196/196; backend 77 lulus dan satu integrasi PostgreSQL dilewati. Sesudah pembaruan undici 8.11.2 ke 8.12.3, React 196/196 lulus; lint JSX/Hooks dan build frontend/worker lulus. Audit ketiga lockfile nol temuan. Optional dependency lintas platform dipertahankan, tanpa perubahan package.json atau audit fix --force.

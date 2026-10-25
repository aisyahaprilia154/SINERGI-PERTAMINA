# Tahap 3 — Konfigurasi hosting dan bukti operasional

Tanggal 25 Oktober 2026, Asia/Jakarta. Dasar tahap 2: `6ade93c`; tahap 1: `f8da358`. Branch `react-migration-baseline`.

## Hasil

Konfigurasi `docker-compose.production.yml` berdiri sendiri dan tidak mengganti Compose lokal. Hanya frontend memublikasikan port; backend menjadi penghubung jaringan edge dan database internal. Binding default loopback. Konfigurasi nginx produksi memakai sertifikat eksternal, TLS 1.2/1.3, redirect HTTP dan HSTS HTTPS. Template environment tidak mengandung kredensial nyata.

Migrate memakai owner dan membuat role runtime tanpa superuser/createdb/createrole/replication/bypassRLS/membership. Hak runtime: DML tabel aplikasi, SELECT/INSERT audit, tanpa CREATE/TEMP database, CREATE skema, TRUNCATE atau UPDATE/DELETE audit. Role yang sudah memiliki objek/membership ditolak. Tidak ada perubahan pada tabel dataset operasional atau penerapan role baru ke database operasional saat pengerjaan ini.

Backup menerima --project, --env-file dan --compose-file (dapat diulang), dengan --restore-db yang sudah ada. Sintaks lama tetap tersedia. Skrip menolak backend yang belum berhenti dan target restore yang sudah ada. Dump dialirkan ke file; query/dump/restore berjalan di container sehingga database produksi tidak memerlukan port host. Manifest memuat SHA-256 dump, hash/jumlah tabel dan semua file. Symlink pada salinan sumber ditolak. Dump/file belum dienkripsi oleh skrip; runbook mewajibkan penyimpanan/transfer terenkripsi oleh pengelola.

Satu runbook memuat prasyarat hosting, inventaris/review risiko teknis, akun, patch, insiden, backup/restore, BCP/DR, retensi/penghapusan dan serah terima. Owner, klasifikasi, masa simpan, RTO/RPO, persetujuan serta bukti infrastruktur perusahaan tidak diisi dengan asumsi palsu. Tidak ada scheduler backup atau penghapusan data bisnis otomatis.

## Bukti pengujian final

- Seluruh backend: **98/98 lulus, nol skip**, termasuk workflow PostgreSQL nyata. Suite memakai owner hanya untuk fault injection pada database uji. Pengujian role runtime dan backend produksi dilakukan terpisah.
- Sembilan kelompok pemeriksaan stack lulus: isolasi port/jaringan, TLS/certificate/HSTS/CSP, privilege runtime, suite PostgreSQL, akun/reset/role/legacy-password/proxy-throttle, impor/apply/checkpoint, sanitasi log dan penolakan writer aktif, penolakan overwrite restore, serta pemulihan lengkap.
- Password lama 12 karakter dari hash scrypt sintetis tetap bisa login. Password baru pendek ditolak; create/reset/perubahan role melalui backend produksi bekerja dan mencabut sesi terkait.
- Percobaan mengganti X-Forwarded-For melalui nginx tidak melewati batas login. Log container diuji tidak mengandung password/token pengujian. HTTP unit tambahan memastikan error database tidak tercatat sebagai login berhasil dan pesan error mentah tidak bocor.
- Backup memulihkan **13 tabel** dengan digest sama, satu file KML sintetis dengan hash sama, lalu login, membaca dataset dan mengunduh KML identik dari container pemulihan baru.
- Image backend/frontend dibangun dari kode final. TLS diuji memakai sertifikat sintetis dengan CA dipercaya eksplisit oleh client, bukan melewati verifikasi sertifikat. Sertifikat/domain produksi belum dipasang.
- Hasil frontend tahap 2: Node 341/341, React 196/196, browser 95 lulus/1 tes khusus produksi skip pada Vite. Tes CSP khusus produksi kemudian lulus pada nginx; 15 kasus SPA Administrator/Viewer pada image produksi juga lulus. Tidak ada perubahan JavaScript frontend pada tahap 3.
- Lint dan build akhir dicatat dalam evidence/. Peringatan ukuran chunk MapLibre tetap ada; build berhasil.

Percobaan awal mengungkap DB dengan network internal membutuhkan bridge loopback khusus fixture test, serta healthcheck socket PostgreSQL dapat terlalu dini saat inisialisasi volume kosong. Override fixture hanya ada pada runner; konfigurasi produksi tetap tanpa port database. Healthcheck produksi diperbaiki untuk menunggu TCP siap. Bukti final berasal dari putaran setelah perbaikan, tanpa menyembunyikan kegagalan awal.

Runner membersihkan container/network/volume proyek unik sinergi-security-test-* setelah pengujian. Secret/cert/dump sintetis tetap di .local-runtime yang diabaikan Git; tidak masuk evidence publik. Ketiga container operasional asli tetap berjalan dan tidak dibangun ulang/diganti. Frontend Vite dapat dibuka untuk pengembangan, tetapi hardening backend/hosting belum dideploy ke container operasional.

## Status checklist dan batas

**7 terverifikasi lokal, 14 sebagian, 24 belum; total 45.** Poin lokal: TLS (10), backup/restore (12), RBAC (22), segmentasi (28), audit (31), drill lokal (42), migrasi data (43). Ini tidak menyatakan 45 poin patuh atau 21 poin sepenuhnya lulus.

Audit dependency tahap 1 dan pemeriksaan akhir kembali nol temuan pada root/backend/frontend; lihat evidence/final-dependency-audit.json. Audit dependency tidak membuktikan bebas seluruh kelemahan aplikasi/image/host. Penetration test, SSO/MFA, SIEM/SOC/alert, enkripsi disk/backup, persetujuan data/vendor/hosting, sertifikasi dan kepatuhan hukum tetap memerlukan pekerjaan/bukti terpisah.

Tidak ada push, merge, deployment, perubahan workbook sumber atau perubahan database operasional. Perubahan pengguna pada .env.docker.example dan docs/figures/ dipertahankan di luar checkpoint.

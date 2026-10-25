# Operasional keamanan SINERGI

Paket ini menyiapkan aplikasi lokal untuk hosting. Persetujuan data, vendor, sertifikat publik, kontrol host, dan kepatuhan perusahaan tetap menunggu pihak yang berwenang. [Matriks 45 poin](CHECKLIST.md) mencatat batas bukti. Jangan memakai runbook monitoring historis sebagai bukti metrics/SIEM aktif pada backend sekarang.

## Inventaris dan review teknis

Inventaris aplikasi: identitas/email/role dan hash password (`app_users`), koordinat serta metadata IP/hostname jaringan (`assets`/`source_objects`), dokumen KML/KMZ asli, relasi/topologi, audit dan backup. Label klasifikasi serta persetujuan pemakaian masing-masing data belum ditetapkan owner; inventaris ini bukan persetujuan data publik.

Review teknis 25 Oktober 2026 mengidentifikasi brute force login, pemalsuan alamat proxy, penyalahgunaan privilege database, kehilangan/kebocoran backup, dan dependency rentan. Kontrol terkait sudah diuji lokal sesuai evidence. Risiko tersisa mencakup data yang belum diklasifikasi, token browser yang dapat dibaca JavaScript, belum ada MFA/SSO, enkripsi host/backup yang belum dibuktikan, pemantauan terpusat dan pentest yang belum dilakukan. Owner/IT masih harus melakukan dan menyetujui Risk Assessment formal sebelum hosting eksternal.

## Sebelum hosting

1. Business Owner/IT menetapkan pemilik, klasifikasi data, siapa yang boleh mengakses koordinat/IP/hostname/aset jaringan, lokasi hosting, retensi, RTO/RPO, dan persetujuan pemakaian data. Gunakan data sintetis untuk demonstrasi yang belum disetujui memakai data nyata.
2. Tinjau vendor, kontrak, hak audit, kepemilikan/penyerahan data, sertifikasi, UU PDP/PSE bila berlaku, dan kebijakan perusahaan melalui tim terkait. Dokumentasi kode tidak menggantikan persetujuan tersebut.
3. Salin `docker/production.env.example` menjadi `.env.production` yang diabaikan Git. Isi dua secret acak **berbeda**, masing-masing 64 karakter hex: `POSTGRES_PASSWORD` untuk migrasi/backup dan `SINERGI_RUNTIME_DB_PASSWORD` untuk aplikasi. Contoh pembangkit lokal: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Simpan hasil ke pengelola rahasia, jangan ke chat/log/repository.
4. Gunakan database/volume deployment tersendiri. Jangan mengarahkan konfigurasi baru ke database operasional yang sedang berjalan tanpa rencana migrasi, backup terverifikasi, dan persetujuan perubahan. Tidak ada migrasi in-place yang dilakukan oleh paket ini.
5. Minta pengelola hosting menyediakan sertifikat valid untuk domain, `fullchain.pem` dan `privkey.pem`, pada direktori absolut `SINERGI_TLS_DIR`. Proteksi direktori/key melalui ACL host. Sertifikat self-signed dari tes tidak boleh dipakai sebagai sertifikat publik.
6. Tinjau `SINERGI_PROXY_SUBNET` agar tidak berbenturan dengan jaringan host. Compose produksi hanya mengizinkan frontend di jaringan edge dan backend sebagai penghubung ke jaringan database internal. Backend hanya mempercayai proxy pada subnet eksplisit itu; nginx menimpa header alamat klien. Jika menambah CDN/load balancer, tinjau kembali rantai IP dan batas kepercayaannya.
7. Default binding frontend adalah loopback. Pengelola menentukan binding/domain/firewall saat deployment terpisah; database/backend tidak mempunyai port publik pada file produksi. Tetapkan image immutable/commit yang telah diuji lewat variabel image. Aktifkan firewall host, proteksi endpoint, enkripsi volume dan lokasi backup sesuai standar perusahaan. Password hash bukan enkripsi database/disk.

Perintah untuk operator **setelah** prasyarat dan persetujuan terpenuhi, bukan perintah yang sudah dijalankan pada deployment:

```powershell
docker compose --project-name sinergi-production --env-file .env.production --file docker-compose.production.yml up --build -d
```

Migrate memakai owner untuk menyiapkan skema dan role `sinergi_runtime`, kemudian selesai. Backend memakai role terbatas: DML aplikasi, SELECT/INSERT audit, tanpa superuser, role administration, CREATE/TEMP database, CREATE skema, TRUNCATE atau perubahan audit. Provisioning menolak role runtime yang memiliki membership/objek tak terduga. Jalankan provisioning kembali melalui migrate setelah perubahan skema; tabel baru tidak diberi hak diam-diam lewat default privileges.

TLS hanya 1.2/1.3; HTTP mengalihkan ke HTTPS kecuali `/health` yang diperlukan healthcheck internal. HSTS dipasang pada HTTPS tanpa preload/includeSubDomains agar tidak membuat komitmen terhadap domain lain. Ganti/renew sertifikat melalui proses operator dan reload nginx sesudah `nginx -t`. Bukti tes lokal tidak membuktikan konfigurasi domain publik.

## Akun, log, patch, dan insiden

- Berikan akun individual. Gunakan Viewer untuk membaca dan akun Administrator terpisah hanya untuk tugas istimewa. Tinjau daftar pengguna secara berkala. Reset password/perubahan role mencabut sesi; tidak ada shared/default account yang dibuat oleh konfigurasi produksi.
- Password baru/reset minimal 15 karakter. Password lama tetap berlaku sampai diganti; rencanakan reset bersama pemilik akun. Login lokal belum memakai SSO/MFA dan token browser tetap di sessionStorage, bukan HttpOnly cookie. Ini batas paket awal, bukan klaim perlindungan penuh dari XSS.
- Pembatas login berlaku per proses. Lima kegagalan per pasangan IP/identifier atau 30 percobaan per IP dalam 15 menit menghasilkan 429 + Retry-After. Tidak ada unlock permanen atau password dicetak. Jangan menambah replika sebelum menyediakan pembatas bersama. Restart mereset counter; bukan prosedur normal membuka pembatasan.
- Log autentikasi/error berupa JSON ke stdout, audit perubahan tetap append-only pada PostgreSQL. Container produksi membatasi file log 10 MB × 3. Batas ukuran ini **bukan** kebijakan retensi hari atau pengiriman SIEM. Pengelola menetapkan retensi, lokasi, hak akses dan integrasi SOC/SIEM/alert; saat ini belum tersambung.
- Saat insiden: catat waktu, requestId, dampak, operator dan timeline; batasi akses sesuai keputusan owner, amankan log/backup, lalu analisis akun, jaringan dan perubahan terakhir. Jangan menghapus audit, menulis SQL ad-hoc ke aset, atau membagikan token/password untuk debugging. Reset kredensial yang terdampak dan lakukan pemulihan teruji. Eskalasi ke kontak IT/Cyber Security yang ditetapkan owner; daftar kontak aktual masih harus diisi.
- Konfigurasi CI menyediakan audit dependency pada push/PR, pemicu manual, dan Senin 09:17 WIB. Aktivasi/run GitHub baru berlaku setelah perubahan dipush melalui permintaan terpisah. Operator meninjau temuan, memperbarui patch kompatibel, menjalankan tes/build, lalu mencatat hasil. Jangan memakai `audit fix --force` atau mengabaikan High/Critical. Audit dependency, VA aplikasi, image/host scanning dan penetration test adalah pemeriksaan berbeda; paket ini belum merupakan pentest/sertifikasi.
- CSP melarang script inline, unsafe-eval, object dan framing. React/MapLibre tetap memerlukan inline style, blob worker dan data/blob image. Google Fonts serta imagery ArcGIS diizinkan eksplisit. Provider tile/font tambahan harus ditinjau dan ditambahkan ke allowlist; jangan mengganti dengan wildcard.

## Backup, pemulihan, dan kontinuitas

Tetapkan jadwal backup dan lokasi terenkripsi/off-site bersama owner. Tidak ada scheduler backup atau janji RTO/RPO produksi yang diaktifkan dalam paket ini. RTO, RPO, masa simpan audit/data/backup, pemilik dan jadwal review masih **menunggu penetapan**.

Untuk proyek Compose lokal lama, sintaks backup sebelumnya tetap berlaku. Untuk konfigurasi produksi baru:

```powershell
# Operator menghentikan writer pada change window yang telah disetujui.
docker compose --project-name sinergi-production --env-file .env.production --file docker-compose.production.yml stop backend
node backend/scripts/backup-operational.mjs --project=sinergi-production --env-file=.env.production --compose-file=docker-compose.production.yml --restore-db=sinergi_restore_check_baru
# Setelah verifikasi dan keputusan operator, mulai kembali layanan.
docker compose --project-name sinergi-production --env-file .env.production --file docker-compose.production.yml start backend
```

- Pastikan semua writer lain telah berhenti; skrip memeriksa service backend tetapi tidak dapat membuktikan tidak ada koneksi eksternal. Skrip tidak menghentikan/memulai layanan otomatis. Bila backup gagal, operator memutuskan pemulihan/penyalaan kembali sesuai kondisi.
- Backup menolak backend yang masih berjalan dan database restore yang sudah ada, sebelum membuat dump. Database tidak perlu mempunyai port host: `pg_dump`, `psql`, dan `pg_restore` berjalan melalui container database dengan owner, tanpa password pada argumen/output.
- Hasil berada di direktori timestamp `.local-runtime/operational-backup/`: `database.dump`, `source-storage/`, dan `manifest.json`. Manifest mencatat SHA-256 dump, hash/jumlah seluruh tabel, ukuran/hash setiap file, dan pemeriksaan restore ke database baru. Salin satu set utuh, beserta versi kode/image yang cocok, ke penyimpanan backup terenkripsi dan terbatas.
- Dump dan file sumber **belum dienkripsi oleh skrip**. Gunakan disk/backup storage terenkripsi sebelum menyimpan atau mentransfer data operasional; jangan mengirim melalui kanal tanpa perlindungan. Pengelolaan kunci dan bukti enkripsi menjadi tanggung jawab pengelola host.
- Pemulihan memakai database baru dan salinan direktori sumber; jangan menimpa database/volume aktif. Cocokkan seluruh checksum, jalankan kode yang sesuai, lalu uji login, role, dataset, peta/topologi dan unduhan sumber pada lingkungan pemulihan. Operator mengalihkan layanan hanya setelah hasil diperiksa dan disetujui.
- Bila aplikasi tidak tersedia, hentikan perubahan operasional aplikasi. Bila owner mengizinkan, gunakan ekspor terakhir yang disimpan aman untuk referensi dan pencatatan perubahan manual. Setelah pulih, rekonsiliasi melalui UI dengan pemeriksaan revision dan review owner; jangan menggabungkan perubahan langsung ke database.
- Catat waktu deteksi, mulai restore dan layanan kembali, hasil verifikasi, data yang hilang, serta tindakan perbaikan. Drill lokal sintetis sudah dibuktikan; drill dan persetujuan produksi tetap terpisah.

## Retensi, penghapusan, dan serah terima

Owner menentukan retensi sebelum penghapusan. Buat daftar dataset/impor/file sumber, akun, audit, log, backup, salinan dan versi kode. Bedakan masa simpan data aktif dari backup serta kewajiban menyimpan audit. Tidak ada penghapusan otomatis data bisnis/audit yang ditambahkan.

Untuk migrasi/terminasi, serahkan dump + file sumber + manifest + versi kode melalui kanal yang disetujui, verifikasi restore di tujuan, dan simpan tanda terima. Setelah izin penghapusan dan batas retensi terpenuhi, pengelola menghapus salinan utama, snapshot, log/backup terkait dan akses/kunci sesuai fitur penyedia. Penghapusan file atau `DELETE` saja tidak membuktikan penghapusan permanen dari backup/provider; bukti proses tersebut masih dibutuhkan. Hak penyerahan data dan audit vendor harus diatur dalam kontrak.

## Mengulang pengujian terisolasi

```powershell
npm --prefix backend run test:security:stack
```

Memerlukan Docker, Node yang didukung, dan OpenSSL (`SINERGI_DOCKER_BIN`/`SINERGI_OPENSSL_BIN` dapat menunjuk executable). Runner menghasilkan proyek unik `sinergi-security-test-*`, secret/cert sintetis dalam `.local-runtime`, jaringan/volume/port loopback khusus uji, kemudian membersihkan container/network/volume proyek itu pada akhir proses. Ia tidak membaca `.env.docker` operasional. Test bridge tambahan untuk database hanya ada di override uji, tidak pada file produksi.

Tes integrasi memakai owner untuk fault injection DDL pada database uji. Tes terpisah menguji role runtime dan backend produksi sesungguhnya agar kelulusan suite owner tidak dianggap sebagai bukti privilege runtime. Hasil publik yang tidak mengandung rahasia disimpan pada `evidence/`; secret, sertifikat dan backup sintetis tetap diabaikan Git. Sertifikat uji berlaku satu hari.

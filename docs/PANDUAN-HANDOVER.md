# Panduan dan template handover SINERGI Pertamina

Tanggal penyusunan: 9 Oktober 2026.
Status: template kerja; belum merupakan bukti kelulusan pengujian atau penerimaan perusahaan.
Isi seluruh `[placeholder]` sebelum diserahkan.

## 1. Tujuan dan kondisi awal

Handover selesai ketika perusahaan menerima aplikasi, source code, data, dokumentasi, akses, dan kemampuan menjalankan serta merawat sistem secara mandiri. Menyerahkan ZIP source code saja belum cukup.

Berdasarkan repository, aplikasi mencakup peta aset jaringan, impor KML/KMZ, review dan aktivasi dataset, diagram topologi, serta pengaturan ikon aset. Frontend memakai JavaScript/Vite/MapLibre; backend Node.js; database PostgreSQL/PostGIS. Docker Compose memuat db, migrate, backend, dan frontend/Nginx.

Pemeriksaan ini hanya membaca source dan dokumentasi; tidak menjalankan aplikasi, menguji ulang fitur, atau mengesahkan kesiapan produksi.

Catatan khusus yang harus masuk ke handover:

- Dockerfile memakai Node 24 dan Compose memakai image `postgis/postgis:16-3.4`. Catat versi image aktual/digest pada rilis final.
- Port frontend dan API Compose terikat ke `127.0.0.1`. Akses dari komputer pengguna perusahaan memerlukan konfigurasi jaringan dan reverse proxy HTTPS yang dikelola tim infrastruktur.
- Database dan file aplikasi berada pada dua named volume: `sinergi-postgres-data` dan `sinergi-app-data`. Nama aktual dapat mendapat prefix Compose project. Keduanya perlu dicadangkan secara konsisten.
- Sesi login pada konfigurasi yang didokumentasikan tersimpan dalam memori backend; restart mengharuskan pengguna login ulang.
- Basemap memakai integrasi/proxy OpenFreeMap secara default. Verifikasi akses jaringan, atribusi, dan perilaku jika koneksi eksternal terputus.
- Panduan backup yang ada mencatat pengujian pilot dengan PostgreSQL/PostGIS yang berbeda dari image Compose. Sesuaikan prosedur dengan server penerima dan uji restore di lingkungan tersebut.
- Dokumen observability masih menyebut pekerjaan produksi yang belum selesai. Validasi ulang terhadap implementasi dan lingkungan final.
- Skrip lint saat ini adalah pemeriksaan sintaks, bukan bukti audit keamanan atau kualitas menyeluruh.

## 2. Langkah pelaksanaan

### Langkah 1 — Sepakati ruang lingkup dan penerima

Tentukan sponsor/pemilik aplikasi, pengguna bisnis, penerima teknis, administrator data, dan PIC infrastruktur. Catat fitur yang diserahkan, dataset/cabang yang termasuk, batasan, serta pekerjaan di luar lingkup. Sepakati kriteria penerimaan, lokasi deployment, tanggal perpindahan tanggung jawab, dan dukungan setelah serah terima.

Output: ringkasan proyek, daftar PIC, dan kriteria penerimaan.

### Langkah 2 — Tentukan versi rilis final

Periksa perubahan lokal. Simpan perubahan yang termasuk rilis ke repository perusahaan, lalu catat commit SHA dan tag rilis yang disepakati. Pastikan source, lockfile dependency, migrasi SQL, Dockerfile, Compose, konfigurasi contoh, dan dokumentasi berasal dari versi yang sama. Bila memakai ZIP, catat SHA-256 ZIP tersebut.

Jangan menyertakan password, token, konfigurasi rahasia, akun pribadi, atau data operasional yang belum disetujui pemiliknya. File data dan backup diserahkan melalui kanal perusahaan dengan akses terbatas. Jangan mengandalkan ZIP source untuk membawa data volume Docker.

Output: repository/rilis dan manifest paket penyerahan.

### Langkah 3 — Siapkan lingkungan perusahaan

Minta tim infrastruktur menetapkan server/VM, sistem operasi, kapasitas, Docker engine, penyimpanan persisten, alamat akses, DNS/HTTPS, firewall, dan akses ke layanan basemap. Catat kebutuhan internet saat build jika dependency dan image belum tersedia secara internal.

Kapasitas CPU/RAM/disk dan target jumlah pengguna ditentukan dari pengujian dengan ukuran dataset dan beban yang disepakati; angka minimum belum diverifikasi dari repository.

Deploy di staging terlebih dahulu menggunakan panduan `../docs/DOCKER-SETUP.md`. Konfigurasi `.env.docker` dibuat dan disimpan oleh PIC melalui kanal rahasia perusahaan. Buat akun perusahaan dengan role dan scope cabang/dataset yang sesuai.

Output: aplikasi staging dapat diakses dan konfigurasi lingkungan tercatat tanpa nilai rahasia.

### Langkah 4 — Verifikasi aplikasi dan data

Jalankan build, pemeriksaan sintaks, dan tes backend/frontend pada versi rilis. Simpan output serta tanggal, lingkungan, dan commit yang diuji. Bedakan tes unit dari tes integrasi database yang membutuhkan layanan aktif; tes yang dilewati dicatat sebagai belum diuji.

Lakukan UAT bersama pengguna bisnis: login, scope akses, pencarian/filter peta, detail/ikon aset, impor KML/KMZ, preview/review, aktivasi, diagram topologi, dan fungsi lain yang masuk lingkup. Gunakan data representatif yang disetujui perusahaan.

Verifikasi jumlah aset, cabang/dataset aktif, versi dataset, sampel koordinat, dan relasi topologi dengan pemilik data. Pengujian aplikasi tidak otomatis membuktikan bahwa data aset sesuai kondisi lapangan.

Output: hasil tes, UAT, persetujuan data, dan daftar masalah terbuka.

### Langkah 5 — Uji backup, restore, dan pemulihan

Tetapkan jadwal backup, retensi, lokasi penyimpanan, PIC, RPO (kehilangan data maksimum yang dapat diterima), dan RTO (waktu pemulihan maksimum). Backup database dan file sumber/upload sebagai pasangan konsisten; dokumentasikan metode menghindari perubahan data selama pengambilan backup.

Restore ke lingkungan terpisah yang bersih, lalu buktikan login, dataset aktif, sumber KML/KMZ, peta, dan topologi berfungsi. Catat checksum, jumlah record, durasi, dan hasil. Uji prosedur rollback rilis dan kompatibilitas migrasi; mengembalikan image lama saja belum tentu cukup jika schema berubah.

Jangan menjalankan `docker compose down -v` pada lingkungan yang datanya harus dipertahankan.

Output: runbook sesuai lingkungan perusahaan dan bukti restore/pemulihan.

### Langkah 6 — Lengkapi dokumen dan transfer pengetahuan

Susun manual pengguna dengan screenshot rilis final. Susun manual teknis untuk deploy, konfigurasi, migrasi, akun, log/healthcheck, backup/restore, update/rollback, dan troubleshooting. Dokumentasikan arsitektur, model database, API, serta aturan interpretasi KML/topologi dan koreksi khusus lokasi pada `shared/`.

Adakan pelatihan pengguna dan sesi teknis. Minta penerima melakukan instalasi/start, membuat akun, memeriksa log, dan menjalankan restore latihan dengan mengikuti panduan.

Output: dokumen final, daftar hadir, dan catatan latihan mandiri penerima.

### Langkah 7 — Serahkan akses dan lakukan cutover

Pindahkan repository, server, database, domain/sertifikat bila ada, backup, monitoring, dan akun aplikasi ke pengelolaan perusahaan. Daftar akses berisi pemilik dan lokasi secret, bukan password. Verifikasi penerima benar-benar dapat mengaksesnya.

Pada waktu cutover yang disepakati: hentikan/perketat perubahan data bila diperlukan, ambil backup final, lakukan pemindahan, verifikasi data dan fungsi inti, lalu tentukan lanjut atau rollback berdasarkan kriteria yang sudah disetujui. Catat siapa yang memutuskan dan siapa yang menjalankan rollback.

Output: akses terverifikasi dan catatan cutover.

### Langkah 8 — Tanda tangan penerimaan dan masa dukungan

BAST menyebut rilis/commit, lampiran, hasil UAT, data yang diserahkan, masalah yang diterima sebagai pengecualian, PIC penerima, tanggal perpindahan tanggung jawab, dan dukungan. Gunakan format resmi perusahaan bila tersedia. Sinkronkan pengaturan hak penggunaan/source code dan dukungan dengan kontrak serta PIC perusahaan.

Tetapkan durasi, jam layanan, kanal laporan, target respons menurut tingkat masalah, dan batas perbaikan bug versus fitur baru. Sesudah akses perusahaan terverifikasi, rotasi kredensial dan cabut akses pribadi yang tidak lagi diperlukan sesuai kesepakatan.

Output: BAST, lampiran penerimaan, dan kesepakatan dukungan.

## 3. Paket dokumen

| Dokumen/barang | Isi minimum | Penanggung jawab verifikasi |
|---|---|---|
| Ringkasan proyek dan ruang lingkup | Tujuan, fitur, pengguna, batasan, PIC | Pemilik aplikasi |
| Manifest source dan rilis | Repo, commit/tag, checksum, dependency/image | Penerima teknis |
| Manual pengguna | Login, peta, impor, review, aktivasi, topologi | Pengguna bisnis |
| Manual deployment dan operasi | Instalasi, konfigurasi, akun, health/log, update/rollback | IT/Operations |
| Arsitektur, database, API | Komponen, alur data, schema/ERD, endpoint/auth/error | Penerima teknis |
| Inventaris dan validasi data | Cabang, dataset/versi aktif, jumlah aset, sumber, kualitas | Pemilik data |
| Backup dan runbook restore | DB + file sumber, checksum, retensi, RPO/RTO, bukti restore | Operations |
| Bukti pengujian dan UAT | Skenario, expected/actual, evidence, status, sign-off | QA/pengguna bisnis |
| Register akses | Layanan, role/scope, pemilik, lokasi secret, hasil verifikasi | IT/administrator |
| Known issues | Masalah, dampak, workaround, PIC, keputusan penerimaan | Pemilik aplikasi |
| Pelatihan | Materi, peserta, tanggal, hasil latihan | Penerima |
| BAST dan kesepakatan dukungan | Objek serah terima, lampiran, pengecualian, tanggal, tanda tangan | Pihak penyerah/penerima |

## 4. Contoh susunan paket penyerahan

```text
SINERGI-HANDOVER-[versi]/
  01-ringkasan-dan-scope/
  02-source-dan-release-manifest/
  03-arsitektur-database-api/
  04-panduan-deploy-dan-operasi/
  05-manual-pengguna/
  06-hasil-test-dan-uat/
  07-inventaris-data-dan-manifest-backup/
  08-register-akses-tanpa-password/
  09-known-issues-dan-dukungan/
  10-pelatihan-dan-bast/
```

Data, backup, dan secret dapat berada di penyimpanan perusahaan terpisah. Manifest mencatat lokasi dan pemilik aksesnya; paket dokumen tidak harus berisi salinan data sensitif.

## 5. Template ringkasan proyek

- Nama: SINERGI Pertamina
- Tujuan bisnis: [tujuan]
- Penyerah: [nama/tim]
- Penerima bisnis: [nama/jabatan]
- Penerima teknis/Operations: [nama/jabatan]
- Versi/tag dan commit SHA: [versi, SHA]
- Lingkungan dan alamat akses: [staging/produksi, URL]
- Fitur yang diserahkan: [daftar]
- Cabang/dataset yang diserahkan: [daftar]
- Di luar ruang lingkup: [daftar]
- Kriteria penerimaan: [fungsi, kualitas data, performa, pemulihan]
- Batasan: [daftar]
- Tanggal cutover dan penerimaan: [tanggal, waktu WIB]
- Perpindahan tanggung jawab: [tanggal dan PIC]

## 6. Template manifest rilis dan data

| Item | Versi/lokasi | SHA-256 atau identitas | Penerima | Status |
|---|---|---|---|---|
| Source repository | [URL] | [commit SHA/tag] | [PIC] | [belum/diterima] |
| Source archive bila dipakai | [lokasi] | [SHA-256] | [PIC] | [status] |
| Container images | [registry/tag] | [digest setiap image] | [PIC] | [status] |
| Migrasi database | [versi terakhir] | [commit SHA] | [PIC] | [status] |
| Backup PostgreSQL | [lokasi, waktu, ukuran] | [SHA-256] | [PIC] | [status] |
| Backup file aplikasi/sumber | [lokasi, waktu, ukuran] | [SHA-256] | [PIC] | [status] |
| Manifest dataset | [cabang/dataset/versi aktif/jumlah] | [identitas versi] | [pemilik data] | [status] |
| Dokumen | [folder, versi] | [identitas paket] | [PIC] | [status] |

Catat tanggal uji restore, durasi, lingkungan target, hasil pemeriksaan data, dan tautan evidence: [isi].

## 7. Template UAT

Versi/commit: [isi]. Lingkungan: [isi]. Tanggal: [isi]. Penguji bisnis: [isi].
Setiap baris dilengkapi data uji, langkah, hasil aktual, screenshot/log, dan nomor isu jika gagal.

| ID | Skenario | Hasil yang diharapkan | Aktual/evidence | Status |
|---|---|---|---|---|
| UAT-01 | Login dengan akun valid dan invalid | Akun valid masuk; akun invalid ditolak | [isi] | Belum diuji |
| UAT-02 | Viewer mengakses aksi admin dan data di luar scope | Aksi/data terlarang ditolak oleh API | [isi] | Belum diuji |
| UAT-03 | Cari aset, filter cabang/jaringan, buka detail | Hasil sesuai data acuan | [isi] | Belum diuji |
| UAT-04 | Impor KML/KMZ valid; unggah file invalid | File valid diproses; invalid mendapat pesan yang sesuai | [isi] | Belum diuji |
| UAT-05 | Preview, review, dan aktivasi versi dataset | Data/relasi sesuai keputusan; versi aktif tercatat | [isi] | Belum diuji |
| UAT-06 | Impor penambahan aset | Hasil sesuai aturan additions-only dan data acuan | [isi] | Belum diuji |
| UAT-07 | Buka/koreksi topologi dan ubah ikon | Hasil tampil sesuai; perubahan persisten setelah reload | [isi] | Belum diuji |
| UAT-08 | Restart layanan pada staging | Data tetap ada; login ulang sesuai perilaku sesi | [isi] | Belum diuji |
| UAT-09 | Restore DB dan file sumber ke lingkungan terpisah | Data aktif, sumber, peta/topologi dapat digunakan | [isi] | Belum diuji |
| UAT-10 | Gunakan dataset/beban representatif | Waktu respons dan kapasitas sesuai target [isi] | [isi] | Belum diuji |
| UAT-11 | Akses basemap terganggu pada staging | Perilaku sesuai batasan yang disepakati | [isi] | Belum diuji |

Keputusan: [diterima / diterima dengan pengecualian / belum diterima].
Pengecualian dan tindak lanjut: [nomor isu, dampak, PIC, tenggat].
Persetujuan pengguna bisnis dan penerima teknis: [nama, tanggal, tanda tangan].

## 8. Template register akses

Tidak memuat password, connection string berpassword, private key, atau token.

| Layanan | Alamat/identitas | Role/scope | Pemilik perusahaan | Lokasi secret | Verifikasi akses | Rotasi/pencabutan |
|---|---|---|---|---|---|---|
| Repository | [URL] | [maintainer] | [PIC] | [SSO/vault bila perlu] | [tanggal/hasil] | [status] |
| Server | [hostname] | [operator] | [PIC] | [vault] | [hasil] | [status] |
| Database | [host/nama DB] | [role] | [PIC] | [vault] | [hasil] | [status] |
| Aplikasi | [username] | [Administrator/Viewer, scope] | [PIC] | [vault] | [hasil] | [status] |
| Backup/monitoring | [lokasi] | [role] | [PIC] | [vault] | [hasil] | [status] |
| DNS/sertifikat bila ada | [identitas] | [role] | [PIC] | [vault] | [hasil] | [status] |

## 9. Template known issues dan dukungan

| ID | Masalah/batasan | Dampak | Workaround | Prioritas | PIC/tenggat | Keputusan penerima |
|---|---|---|---|---|---|---|
| KI-01 | [isi berdasarkan bukti] | [isi] | [isi] | [isi] | [isi] | [diterima/harus diperbaiki] |

Jangan mencatat tes gagal sebagai lulus; masalah yang menunda penerimaan harus diselesaikan atau diputuskan secara eksplisit oleh penerima.

- Periode dukungan: [tanggal mulai–selesai]
- Jam layanan dan zona waktu: [isi]
- Kanal laporan: [ticket/email perusahaan]
- PIC dan eskalasi: [isi]
- Kategori masalah dan target respons/pemulihan: [isi per kategori]
- Perbaikan yang termasuk: [isi]
- Permintaan fitur/perubahan di luar lingkup: [mekanisme]
- Pemeliharaan setelah periode dukungan: [tim penanggung jawab]

## 10. Template BAST

BERITA ACARA SERAH TERIMA APLIKASI SINERGI PERTAMINA

Nomor: [nomor sesuai format perusahaan]
Tanggal dan tempat: [isi]

Pihak penyerah: [nama, jabatan, organisasi].
Pihak penerima: [nama, jabatan, perusahaan].

Pada tanggal tersebut, pihak penyerah menyerahkan aplikasi SINERGI Pertamina versi [tag] dengan commit [SHA] untuk lingkup [fitur/cabang/dataset]. Pihak penerima menerima barang dan dokumen yang tercantum pada manifest lampiran [nomor/versi].

Lingkungan deployment: [URL/hostname dan lingkungan].
Hasil UAT: [nomor laporan, tanggal, keputusan].
Hasil restore: [nomor evidence, tanggal, hasil].
Akses yang telah diverifikasi: [nomor register akses].
Status penerimaan: [diterima / diterima dengan pengecualian / belum diterima].
Pengecualian/tindak lanjut: [nomor issue, PIC, tenggat; atau tidak ada].
Tanggal perpindahan tanggung jawab operasional: [tanggal/waktu WIB].
Penanggung jawab operasional perusahaan: [nama/tim].
Ketentuan dukungan: [rujukan lampiran/kontrak].
Ketentuan source code/hak penggunaan: [rujukan kesepakatan/kontrak perusahaan].

Lampiran:
1. Ringkasan proyek dan ruang lingkup.
2. Manifest rilis, data, backup, dan dokumentasi.
3. Hasil tes/UAT dan bukti restore.
4. Register akses tanpa rahasia.
5. Known issues, pelatihan, dan kesepakatan dukungan.

Tanda tangan pihak penyerah: [nama/tanggal].
Tanda tangan pihak penerima: [nama/tanggal].
Persetujuan teknis/pemilik aplikasi bila diperlukan: [nama/tanggal].

## 11. Checklist sebelum penerimaan

- [ ] Ruang lingkup, kriteria penerimaan, dan PIC disepakati.
- [ ] Repo perusahaan memiliki source final dan commit/tag tercatat.
- [ ] Paket rilis tidak memuat rahasia; data dipindahkan melalui kanal resmi.
- [ ] Deployment pada lingkungan penerima berhasil.
- [ ] Akses pengguna, HTTPS/jaringan, dan dependency basemap diverifikasi.
- [ ] Tes dan UAT memiliki evidence untuk versi yang diserahkan.
- [ ] Data dan relasi aset divalidasi pemilik data.
- [ ] Backup DB + file sumber tersedia dan restore terbukti berhasil.
- [ ] Prosedur update/rollback, monitoring, dan penanganan insiden diuji sesuai lingkup.
- [ ] Penerima dapat mengoperasikan sistem dengan dokumentasi.
- [ ] Akses milik perusahaan terverifikasi dan rotasi/pencabutan dijadwalkan.
- [ ] Known issues dan dukungan tertulis.
- [ ] BAST serta seluruh lampiran ditandatangani sesuai proses perusahaan.

## 12. Referensi dokumentasi repository

- [README](../README.md)
- [Docker dan akun](DOCKER-SETUP.md)
- [Arsitektur pipeline](ARSITEKTUR-PIPELINE-PARSER-DAN-RELASI-ASSET.md)
- [Kontrak KML dan topologi](KONTRAK-DATA-KML-DAN-TOPOLOGI.md)
- [Impor administrator](../backend/docs/administrator-import-pipeline.md)
- [Impor penambahan aset](../backend/docs/additions-only-import.md)
- [Backup/restore pilot](migrations/BACKUP-RESTORE-RUNBOOK-2026-08-04.md)
- [Operasional dan insiden](operations/OBSERVABILITY-INCIDENT-RUNBOOK-2026-08-05.md)

Dokumen historis/pilot perlu diperiksa kesesuaiannya dengan rilis final sebelum dijadikan panduan resmi perusahaan.

# Database operasional SINERGI

SINERGI memakai satu dataset kumulatif untuk seluruh fasilitas. Administrator mengubah data; Viewer membaca seluruh fasilitas. Fasilitas menjadi lokasi/filter, bukan batas akses cabang.

## Skema untuk DBeaver

Buka **Databases → sinergi → Schemas → sinergi → Tables**. Skema aplikasi memiliki 13 tabel:

| Tabel | Fungsi |
| --- | --- |
| `dataset_state` | Revision aktif, impor terakhir, layout/frame/root diagram |
| `facilities` | Lokasi fasilitas dan alias folder sumber |
| `asset_categories` | Nama kategori, ikon default, peran diagram default |
| `assets` | Identitas stabil dan kondisi operasional aset |
| `asset_aliases` | Identitas sumber yang pernah menunjuk ke aset |
| `source_objects` | Geometri PostGIS, koordinat sumber, folder, metadata |
| `relations` | Koneksi dan mounting; termasuk penghapusan yang harus dipertahankan |
| `imports` | File asli, checksum, pengunggah, status, ringkasan, metadata arsip |
| `import_items` | Tambahan/konflik, keputusan admin, hasil penerapan |
| `jobs` | Progres, pemilik pemrosesan, batas retry, pemulihan job |
| `app_users` | Akun Administrator/Viewer dengan hash kata sandi |
| `audit_events` | Riwayat tindakan penting; tidak dapat ditulis ulang |
| `dataset_checkpoints` | Maksimal 10 versi operasional terkompresi per dataset untuk pemulihan |

`public.schema_migrations` dan tabel bawaan PostGIS berada di luar 13 tabel aplikasi. Tabel versi/graph/interface/component/approval lama telah dihentikan. Checkpoint hanya dibaca saat menyimpan/memulihkan versi; bukan arsip graph untuk pembacaan peta. Migrasi SQL lama tetap menjadi riwayat perubahan skema.

Untuk demonstrasi, tunjukkan fasilitas dan kategori, lalu hubungan `assets → source_objects` dan `relations`. Setelah impor diterapkan di web, tunjukkan tambahan baris serta perubahan revision/audit. Gunakan DBeaver untuk memeriksa data; edit melalui web agar revision, validasi, dan audit berjalan bersama.

```sql
SELECT a.id, a.name, f.name AS facility, c.name AS category,
       a.properties->>'diagramRole' AS diagram_role,
       ST_AsText(COALESCE(a.coordinate_override, s.geometry)) AS geometry
FROM sinergi.assets a
JOIN sinergi.asset_categories c ON c.id=a.category_id
LEFT JOIN sinergi.facilities f ON f.id=a.facility_id
LEFT JOIN sinergi.source_objects s ON s.id=a.source_object_id
WHERE NOT a.deleted
ORDER BY f.name, a.name;

SELECT r.kind, a.name AS source, b.name AS target, r.provenance
FROM sinergi.relations r
JOIN sinergi.assets a ON a.id=r.source_asset_id
JOIN sinergi.assets b ON b.id=r.target_asset_id
WHERE NOT r.deleted;
```

## Alur impor

1. Upload KML/KMZ dari halaman admin atau dialog peta. Upload membuat job dan menyimpan file asli; belum mengubah aset aktif.
2. Parser membaca sumber sekali. Identitas eksplisit, alias sumber, fingerprint sumber yang sama, serta kombinasi fasilitas/folder/nama/jenis mencocokkan aset lama. Nama saja tidak cukup.
3. Preview menunjukkan tambahan aset, relasi, kategori baru, dan konflik. Aset lama dapat ditampilkan sebagai konteks sambungan.
4. Admin mencocokkan konflik ke aset lama, memastikan aset baru, memilih pasangan relasi, atau melewati item. Pilihan tetap dipertahankan ketika preview dihitung ulang selama masih sesuai dengan baseline.
5. **Terapkan tambahan** memakai satu transaksi untuk aset, alias, relasi, audit, dan kenaikan revision. Baseline yang berubah menolak preview lama dengan `409`.

Aset lama yang berubah atau hilang dari KMZ tidak otomatis diganti atau dihapus. KMZ penuh maupun parsial dapat dipakai. Mengimpor sumber yang sama menghasilkan nol duplikasi. Kategori baru menjadi `endpoint`, termasuk Kulkas/Printer; nama kategori tetap dipertahankan.

Garis dapat menghubungkan JB lama ke kategori perangkat baru. Metadata endpoint dipakai bila tersedia; selain itu kandidat geometris harus unik dalam toleransi endpoint 6 m. Verteks JB di tengah garis dapat membentuk segmen, memakai toleransi 2 m. Kandidat ganda menjadi konflik. Jenis kabel hanya diisi sesuai informasi sumber.

Mounting eksplisit dari sumber dapat diimpor. Inferensi mounting terbatas pada CCTV/JB dengan satu kandidat tiang dalam 5 m. Kedekatan Kulkas/Printer dengan tiang tidak otomatis berarti pemasangan fisik. Admin dapat mengubah mounting secara manual.

Peta dan diagram membaca tabel relasi yang sama. Koneksi manual tanpa jalur sumber digambar sebagai garis langsung. Posisi visual node disimpan dalam layout; koordinat geografis tidak berubah. Memindahkan perangkat ke frame tiang mengubah mounting secara eksplisit. Halaman pada tab lain menyegarkan revision setelah perubahan disimpan; draft yang belum disimpan tetap dipertahankan.

Penghapusan relasi menyimpan tombstone. Jalur sumber yang seluruh koneksinya dibuang admin disembunyikan dari peta dan ekspor operasional, sementara geometri serta KMZ asli tetap tersimpan. Jalur yang masih dipakai relasi aktif tetap terlihat.

File asli selalu tetap utuh. Ekspor KML operasional memuat geometri saat ini, metadata relasi/mounting, dan garis koneksi manual.

## API

- `/api/imports`: upload/riwayat; `/:id/preview`, `/:id/items/:itemId`, `/:id/refresh`, `/:id/apply`, `/:id/source-file`.
- `/api/datasets/:id/active`: data operasional; `/assets`, `/sites`, `/overlays`, `/exports/kml`.
- `/api/datasets/:id/topology/graph`: graph yang dibentuk dari aset dan relasi.
- `/api/datasets/:id/diagram`: penyimpanan dengan `expectedRevision` dan daftar perubahan.

Pembacaan tidak memuat arsip dataset besar. Cache view/graph berada di memori, memakai revision, dan bisa dibentuk ulang setelah restart. Job di PostgreSQL dipulihkan setelah lease worker lama berakhir; maksimum tiga percobaan. Akun dan hash kata sandi lama dipertahankan.

## Database baru

`docker compose --env-file .env.docker up --build -d` menjalankan bootstrap skema operasional dan membuat dataset kosong jika database baru. Database lama tidak dimigrasikan otomatis saat startup.

## Migrasi database lama

Perintah berikut dijalankan dari root proyek, dengan Docker Desktop aktif. Jangan menjalankan penulisan ke database selama peralihan.

1. Hentikan backend: `docker compose --env-file .env.docker stop backend`.
2. Backup dan restore terpisah: `node backend/scripts/backup-operational.mjs --restore-db=sinergi_final_check`. Gunakan nama database restore baru; skrip menolak menimpa database yang sudah ada. Simpan direktori backup yang dicetak.
3. Migrasikan salinan: `node backend/scripts/migrate-operational.mjs --database=sinergi_final_check`.
4. Verifikasi sumber: `node backend/scripts/verify-operational-baseline.mjs --database=sinergi_final_check --source-root=<backup>/source-storage`.
5. Uji penghentian tabel lama pada salinan: `node backend/scripts/retire-legacy-schema.mjs --backup=<backup>`.
6. Migrasikan aktif: `node backend/scripts/migrate-operational.mjs --live --verified-backup --backup=<backup>`. Skrip memeriksa checksum backup, kesamaan baseline dengan restore, backend berhenti, dan cache peta efektif masih sesuai sumber.
7. Setelah verifikasi, hentikan tabel lama: `node backend/scripts/retire-legacy-schema.mjs --live --backup=<backup>`.
8. Build image: `docker compose --env-file .env.docker build backend frontend migrate`.
9. Jalankan bootstrap: `docker compose --env-file .env.docker run --rm --no-deps migrate`.
10. Jalankan aplikasi tanpa membuat ulang database: `docker compose --env-file .env.docker up -d --no-deps backend frontend`.

Migrasi mengambil keadaan efektif yang tampil sebelumnya, mempertahankan ID dan koordinat, serta mematerialisasi koreksi tampilan satu kali. Versi lama diarsipkan sebagai metadata impor dan file asli. Riwayat lengkap sebelum migrasi tetap tersedia dalam backup database; tidak diaktifkan kembali ke dataset operasional.

Pemeriksaan baseline pada migrasi ini: 1.376 aset, sembilan fasilitas, 594 pasangan koneksi efektif, 324 mounting, 43 frame, 153 penempatan frame, 430 ikon sumber dan 430 overlay. Peta mempertahankan 1.000 geometri yang sebelumnya terlihat. Seluruh 1.376 geometri sumber tetap tersimpan, termasuk yang disembunyikan dalam tampilan.

## Backup operasional dan rollback

Sesudah migrasi, skrip backup yang sama memverifikasi hash seluruh tabel operasional, termasuk checkpoint jika sudah tersedia, pada database restore. Gunakan nama restore baru, misalnya `--restore-db=sinergi_after_migration_check`. Hentikan backend selama backup konsisten, kemudian jalankan kembali dengan `up -d --no-deps backend frontend`. Backup tidak menghapus volume.

### Versi data di halaman Impor

Administrator dapat **Simpan versi** untuk menyimpan keadaan yang sudah dikoreksi, dan **Pulihkan** untuk kembali ke versi tersebut. Impor otomatis menyimpan keadaan sebelum dan sesudah penerapan dalam transaksi yang sama. Sebelum pemulihan, keadaan sekarang ikut disimpan. Kegagalan penyimpanan, validasi sumber, atau audit membatalkan seluruh perubahan.

Snapshot memuat ID aset, EWKB geometri dan koreksi, ikon, fasilitas/kategori, alias aktif/nonaktif, koneksi/tombstone, mounting, layout/frame/root, serta referensi impor dan manifest sumber. File asli tetap satu salinan. Akun/password/sesi, job, audit, dan skema tidak dikembalikan. Revision selalu naik ketika keadaan dipulihkan; preview dan draft lama tidak dapat ditulis ke revision baru.

Maksimal 10 keadaan unik per dataset. Keadaan identik memakai versi yang sudah ada dan memperbarui urutan retensinya. Pemangkasan melindungi versi aktif dan cadangan sebelum operasi terakhir pada saat operasi tersebut berjalan. Nama yang dimasukkan untuk keadaan identik tidak mengganti nama versi sebelumnya. Edit biasa tidak otomatis membuat checkpoint.

Riwayat impor tetap tersedia, tetapi impor yang dibatalkan oleh pemulihan ditandai **Pernah diterapkan · di luar data aktif**. Untuk menerapkannya kembali, unggah sumbernya melalui preview biasa. Download sumber atau ekspor KML bukan pemulihan keadaan database lengkap. Versi sebelum fitur diaktifkan tidak direkonstruksi; bootstrap membuat satu **Baseline saat fitur versi diaktifkan**.

API Administrator: `GET /api/datasets/:id/versions`, `POST /api/datasets/:id/versions` dengan `{name, expectedRevision}`, dan `POST /api/datasets/:id/versions/:versionId/restore` dengan `{expectedRevision}`. Daftar hanya mengembalikan metadata, tanpa payload snapshot. Pembacaan aktif/graph tetap memakai tabel operasional.

Untuk peralihan dari 12 tabel: backup dan uji restore, hentikan backend, jalankan `npm run db:migrate` memakai image baru, kemudian jalankan backend/frontend baru. Migrasi `0011_dataset_checkpoints` menambahkan tabel dan daftar impor aktif tanpa mengganti baseline. Pemulihan bencana tetap membutuhkan dump dan penyimpanan sumber yang cocok dengan versi kode.

Backup sebelum peralihan lokal tersimpan di `.local-runtime/operational-backup/2026-10-09T15-02-25-385Z/`, berisi `database.dump`, `source-storage`, dan manifest checksum. Laporan verifikasi berada di `.local-runtime/operational-migration/`. Direktori ini diabaikan Git; salin ke penyimpanan backup deployment.

Backup sesudah migrasi tersimpan di `.local-runtime/operational-backup/2026-10-09T15-53-47-046Z/`. Restore ke `sinergi_after_migration_check` telah mencocokkan jumlah dan hash seluruh 12 tabel. Impor ulang KMZ asli pada restore mengenali 1.376 aset, menghasilkan nol tambahan aset, nol tambahan relasi, dan nol konflik. Pemeriksaan peta–diagram, unduhan sumber asli, ikon, serta overlay berhasil.

Untuk rollback, hentikan backend/frontend dan restore dump ke **database baru yang kosong**, melalui `pg_restore --exit-on-error`; jangan menimpa database aktif. Restore direktori `source-storage` ke penyimpanan aplikasi. Jalankan kode/image yang cocok dengan dump tersebut dan arahkan koneksi ke database hasil restore. Backup sebelum migrasi ini cocok dengan kode sebelum perubahan pada commit `a132fcb`; kode baru akan menolak database legacy. Verifikasi sumber, akun, peta, dan diagram pada database restore sebelum mengalihkan layanan.

## Pengujian

Jalankan `npm test`, `npm run lint`, dan `npm run build` dari `backend` dan `frontend`. `npm run test:operational` dari backend menjalankan integrasi PostgreSQL pada `sinergi_migration_check`, bukan database aktif. Pengujian mencakup impor, akun, revision, rollback transaksi, penghapusan relasi, kategori baru, pemulihan worker, serta A → B → C, batas checkpoint, sumber hilang, kegagalan snapshot/audit, dan perubahan bersamaan.

`node backend/scripts/verify-dataset-checkpoints.mjs --database=sinergi_migration_check --source-root=<backup>/source-storage` mengukur simpan/pulihkan dan memeriksa kesamaan seluruh baseline 1.376 aset. Skrip menolak database aktif, mengubah data pada salinan untuk pengujian, lalu memulihkan keadaan awal dengan revision baru.

Audit visual browser tidak dijalankan pada pengerjaan ini sesuai permintaan untuk tidak memakai computer use. Validasi UI memakai pengujian adapter, layout, render, dan build.

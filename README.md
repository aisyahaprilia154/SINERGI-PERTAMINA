# SINERGI Pertamina

Aplikasi peta aset jaringan, impor KML/KMZ, dan diagram topologi. Frontend memakai Vite; API memakai Node.js dan PostgreSQL/PostGIS.

## Fitur

- Peta jaringan aset dengan pilihan area, pencarian, filter jaringan, dan diagram topologi.
- Satu dataset kumulatif untuk seluruh fasilitas. Impor KML/KMZ menampilkan preview tambahan dan konflik sebelum Administrator menerapkan.
- Penggantian ikon aset melalui panel detail; ikon berlaku pada peta dan diagram.
- Peta dan diagram memakai aset serta relasi yang sama, dengan revision untuk mencegah perubahan usang.
- Kategori baru, termasuk Kulkas dan Printer, menjadi perangkat akhir; Viewer membaca seluruh fasilitas.

## Jalankan dengan Docker

1. Salin `.env.docker.example` menjadi `.env.docker`.
2. Ganti `POSTGRES_PASSWORD` di `.env.docker`.
3. Jalankan:

   ```powershell
   docker compose --env-file .env.docker up --build -d
   ```

Buka alamat sesuai `SINERGI_HTTP_PORT` di `.env.docker` untuk masuk (misalnya `http://localhost:5174/`). Buat akun database dengan langkah pada [pengaturan Docker](docs/DOCKER-SETUP.md). Jika port sudah dipakai, ubah `SINERGI_HTTP_PORT` atau `SINERGI_API_PORT` di `.env.docker` sebelum menjalankan perintah. Lihat status dengan `docker compose --env-file .env.docker ps`.

Server Vite di port 5173 adalah lingkungan pengembangan terpisah. `npm run dev` dari root memakai PostgreSQL yang ditentukan `SINERGI_DATABASE_URL`, atau koneksi lokal dari `.env.docker`. Database harus sudah memakai skema operasional. Untuk menjalankan hanya frontend dengan API Docker, isi `frontend/.env.local` dengan `SINERGI_API_TARGET=http://127.0.0.1:5001` (sesuaikan port), kemudian jalankan `npm run dev` dari `frontend`.

## Dokumentasi

- [Pengaturan Docker dan volume](docs/DOCKER-SETUP.md)
- [Ikon aset dan optimasi dataset/basemap](docs/OPTIMASI-2026-10-02.md)
- [Optimasi frontend dan output build](docs/OPTIMASI-2026-09-30.md)
- [Skema operasional, migrasi, backup, dan rollback](docs/OPERATIONAL-DATABASE.md)

## Struktur repo

| Direktori | Isi |
| --- | --- |
| `frontend/` | UI peta, diagram, dan halaman impor |
| `backend/` | API, parser KML/KMZ, topologi, dan migrasi database |
| `shared/` | Utilitas yang dipakai frontend dan backend |
| `docker/` | Dockerfile dan konfigurasi Nginx |
| `docs/` | Pengaturan, arsitektur, dan catatan pengujian |
| `audit/` | Skrip serta laporan audit topologi |

Konfigurasi akun/database, cache, output build, screenshot lokal, dan file sementara tidak disimpan di Git. Contoh konfigurasi tersedia di `.env.docker.example` dan `frontend/.env.example`.

## Pemeriksaan kode

Jalankan `npm run lint` dari root untuk memeriksa sintaks script peluncur, termasuk `scripts/dev.mjs`.

Jalankan `npm run build`, `npm run lint`, dan `npm test` dari direktori `frontend` atau `backend` sesuai bagian yang diubah. Saat ini `lint` hanya menjalankan pemeriksaan sintaks Node.js; tes dan peninjauan kode tetap diperlukan. Build frontend menghasilkan `frontend/dist/client` untuk aset statis dan `frontend/dist/server` untuk worker.

# SINERGI Pertamina

Aplikasi peta aset jaringan, impor KML/KMZ, dan peninjauan topologi. Frontend memakai Vite; API memakai Node.js dan PostgreSQL/PostGIS.

## Jalankan dengan Docker

1. Salin `.env.docker.example` menjadi `.env.docker`.
2. Ganti `POSTGRES_PASSWORD` dan `SINERGI_AUTH_TOKENS` di `.env.docker`.
3. Jalankan:

   ```powershell
   docker compose --env-file .env.docker up --build -d
   ```

Buka `http://localhost:5173/map`. Jika port 5173 atau 5000 sudah dipakai, ubah `SINERGI_HTTP_PORT` atau `SINERGI_API_PORT` di `.env.docker` sebelum menjalankan perintah. Lihat status dengan `docker compose --env-file .env.docker ps`.

## Dokumentasi

- [Pengaturan Docker dan volume](docs/DOCKER-SETUP.md)
- [Perubahan optimasi, angka, dan batas pengukuran](docs/OPTIMASI-2026-09-30.md)
- [Alur sinkronisasi topologi](docs/TOPOLOGY-SYNC.md)

## Pemeriksaan kode

Jalankan `npm run build`, `npm run lint`, dan `npm test` dari direktori `frontend` atau `backend` sesuai bagian yang diubah. Saat ini `lint` hanya menjalankan pemeriksaan sintaks Node.js; tes dan peninjauan kode tetap diperlukan. Build frontend menghasilkan `frontend/dist/client` untuk aset statis dan `frontend/dist/server` untuk worker.

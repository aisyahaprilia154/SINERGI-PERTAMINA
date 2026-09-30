# SINERGI Pertamina

Aplikasi peta aset jaringan, impor KML/KMZ, dan peninjauan topologi. Frontend memakai Vite; API memakai Node.js dan PostgreSQL/PostGIS.

## Jalankan dengan Docker

1. Salin `.env.docker.example` menjadi `.env.docker`.
2. Ganti `POSTGRES_PASSWORD` di `.env.docker`.
3. Jalankan:

   ```powershell
   docker compose --env-file .env.docker up --build -d
   ```

Buka alamat sesuai `SINERGI_HTTP_PORT` di `.env.docker` untuk masuk (misalnya `http://localhost:5174/`). Buat akun database dengan langkah pada [pengaturan Docker](docs/DOCKER-SETUP.md). Jika port sudah dipakai, ubah `SINERGI_HTTP_PORT` atau `SINERGI_API_PORT` di `.env.docker` sebelum menjalankan perintah. Lihat status dengan `docker compose --env-file .env.docker ps`.

Server Vite di port 5173 adalah lingkungan pengembangan terpisah. Agar form login di sana memakai akun database Docker, buat `frontend/.env.local` berisi `SINERGI_API_TARGET=http://127.0.0.1:5001` (sesuaikan angka dengan `SINERGI_API_PORT`), lalu mulai ulang `npm run dev`. Tanpa pengaturan ini, Vite memakai backend pengembangan di port 5000 yang tidak menyediakan login akun database.

## Dokumentasi

- [Pengaturan Docker dan volume](docs/DOCKER-SETUP.md)
- [Perubahan optimasi, angka, dan batas pengukuran](docs/OPTIMASI-2026-09-30.md)
- [Alur sinkronisasi topologi](docs/TOPOLOGY-SYNC.md)

## Pemeriksaan kode

Jalankan `npm run build`, `npm run lint`, dan `npm test` dari direktori `frontend` atau `backend` sesuai bagian yang diubah. Saat ini `lint` hanya menjalankan pemeriksaan sintaks Node.js; tes dan peninjauan kode tetap diperlukan. Build frontend menghasilkan `frontend/dist/client` untuk aset statis dan `frontend/dist/server` untuk worker.

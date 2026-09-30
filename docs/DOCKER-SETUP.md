# Docker setup

Stack lokal SINERGI terdiri dari empat service:

- `db`: PostgreSQL dengan PostGIS.
- `migrate`: menjalankan migration operasional sekali setelah database sehat.
- `backend`: API dan durable worker pada mode `postgres`.
- `frontend`: build Vite yang dilayani Nginx dan meneruskan `/api` ke backend.

## Prasyarat

Docker Desktop harus memakai Linux containers dan engine-nya harus aktif. Pada Windows,
Docker Desktop biasanya membutuhkan WSL 2 atau backend Hyper-V yang telah diaktifkan.

## Menjalankan

```powershell
Copy-Item .env.docker.example .env.docker
# Edit .env.docker dan ganti POSTGRES_PASSWORD serta SINERGI_AUTH_TOKENS.
docker compose --env-file .env.docker up --build -d
```

`SINERGI_BRANCH_IDS` dan `SINERGI_BRANCH_DATASETS` menentukan cabang yang
tersedia pada halaman import. Contoh bawaan mendaftarkan `semarang` ke
`dataset-semarang`; tambahkan pasangan baru di `.env.docker` bila deployment
memiliki cabang lain.

Dengan `.env.docker.example`, buka [http://localhost:5173/map](http://localhost:5173/map).
Jika port 5173 sudah dipakai, atur `SINERGI_HTTP_PORT=5174` di `.env.docker`,
jalankan kembali perintah `docker compose up --build -d` di atas, lalu buka
`http://localhost:5174/map`. Jika port API 5000 sudah dipakai, atur
`SINERGI_API_PORT=5001`. Healthcheck API langsung ada di
`http://localhost:<SINERGI_API_PORT>/health`; healthcheck melalui frontend ada di
`http://localhost:<SINERGI_HTTP_PORT>/health`.

Perintah operasional:

```powershell
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f backend
docker compose --env-file .env.docker down
```

Migrasi dijalankan otomatis oleh service `migrate`. Setelah perubahan file migrasi,
bangun ulang image migrasi dan jalankan migrasi sebelum backend terbaru dimulai:

```powershell
docker compose --env-file .env.docker build migrate backend
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker up -d --no-deps backend
docker compose --env-file .env.docker restart frontend
```

`sinergi-postgres-data` dan `sinergi-app-data` adalah named volume. Jangan menjalankan
`docker compose down -v` kecuali memang ingin menghapus database dan file upload lokal.

Port frontend dan API hanya diikat ke `127.0.0.1`. Untuk akses jarak jauh,
pasang reverse proxy HTTPS di depannya. Koreksi Diagram Topologi pada stack
Docker memakai draft dan publikasi setelah peninjauan; lihat
[alur sinkronisasi topologi](TOPOLOGY-SYNC.md). Cadangkan volume PostgreSQL
dan volume file sumber sebagai satu pasangan yang konsisten.

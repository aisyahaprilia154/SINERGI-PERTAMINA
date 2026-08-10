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
# Edit .env.docker dan ganti POSTGRES_PASSWORD sebelum dipakai bersama.
docker compose --env-file .env.docker up --build -d
```

Buka [http://localhost:8080](http://localhost:8080). API langsung tersedia di
[http://localhost:5000/health](http://localhost:5000/health), sedangkan healthcheck
melalui frontend tersedia di [http://localhost:8080/health](http://localhost:8080/health).

Perintah operasional:

```powershell
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f backend
docker compose --env-file .env.docker down
```

Migration dijalankan otomatis oleh service `migrate`. Untuk menjalankannya ulang setelah
perubahan migration, gunakan `docker compose --env-file .env.docker run --rm migrate`.

`sinergi-postgres-data` dan `sinergi-app-data` adalah named volume. Jangan menjalankan
`docker compose down -v` kecuali memang ingin menghapus database dan file upload lokal.


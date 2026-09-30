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
# Edit .env.docker dan ganti POSTGRES_PASSWORD.
docker compose --env-file .env.docker up --build -d
```

`SINERGI_BRANCH_IDS` dan `SINERGI_BRANCH_DATASETS` menentukan cabang yang
tersedia pada halaman import. Contoh bawaan mendaftarkan `semarang` ke
`dataset-semarang`; tambahkan pasangan baru di `.env.docker` bila deployment
memiliki cabang lain.

Dengan `.env.docker.example`, buka [http://localhost:5173/](http://localhost:5173/).
Jika port 5173 sudah dipakai, atur `SINERGI_HTTP_PORT=5174` di `.env.docker`,
jalankan kembali perintah `docker compose up --build -d` di atas, lalu buka
`http://localhost:5174/`. Jika port API 5000 sudah dipakai, atur
`SINERGI_API_PORT=5001`. Healthcheck API langsung ada di
`http://localhost:<SINERGI_API_PORT>/health`; healthcheck melalui frontend ada di
`http://localhost:<SINERGI_HTTP_PORT>/health`.

## Akun login

Setelah migrasi, buat akun melalui backend. Perintah ini meminta kata sandi tanpa
menyimpannya dalam berkas proyek. Sesuaikan scope cabang dan dataset untuk pengguna.

```powershell
$adminPassword = [System.Net.NetworkCredential]::new('', (Read-Host 'Kata sandi admin' -AsSecureString)).Password
$adminPassword | docker compose --env-file .env.docker exec -T backend npm run account:create -- --username=admin --role=Administrator --branches=semarang --datasets=dataset-semarang
Remove-Variable adminPassword

$userPassword = [System.Net.NetworkCredential]::new('', (Read-Host 'Kata sandi user' -AsSecureString)).Password
$userPassword | docker compose --env-file .env.docker exec -T backend npm run account:create -- --username=user --role=Viewer --branches=semarang --datasets=dataset-semarang
Remove-Variable userPassword
```

Perintah pembuatan akun dapat dijalankan kembali untuk mengganti kata sandi atau
scope akun yang sama. Kata sandi disimpan sebagai hash `scrypt` di PostgreSQL.
Sesi login disimpan di memori backend selama delapan jam; setelah backend dimulai
ulang, pengguna perlu masuk kembali. Token lama dari `SINERGI_AUTH_TOKENS` tidak
dipakai oleh backend Docker pada mode produksi.

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
pasang reverse proxy HTTPS di depannya. Koreksi Diagram Topologi oleh administrator
disimpan langsung ke dataset aktif. Cadangkan volume PostgreSQL dan volume file
sumber sebagai satu pasangan yang konsisten.

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

Seluruh fasilitas memakai satu dataset operasional. Fasilitas menjadi filter lokasi;
akses pengguna ditentukan oleh peran Administrator atau Viewer. Database lama perlu
migrasi baseline terlebih dahulu; lihat [panduan migrasi](OPERATIONAL-DATABASE.md).

Dengan `.env.docker.example`, buka [http://localhost:5173/](http://localhost:5173/).
Jika port 5173 sudah dipakai, atur `SINERGI_HTTP_PORT=5174` di `.env.docker`,
jalankan kembali perintah `docker compose up --build -d` di atas, lalu buka
`http://localhost:5174/`. Jika port API 5000 sudah dipakai, atur
`SINERGI_API_PORT=5001`. Healthcheck API langsung ada di
`http://localhost:<SINERGI_API_PORT>/health`; healthcheck melalui frontend ada di
`http://localhost:<SINERGI_HTTP_PORT>/health`.

## Akun login

Setelah migrasi, buat akun melalui backend. Perintah ini meminta kata sandi tanpa
menyimpannya dalam berkas proyek. Kedua peran membaca seluruh fasilitas.

```powershell
$adminPassword = [System.Net.NetworkCredential]::new('', (Read-Host 'Kata sandi admin' -AsSecureString)).Password
$adminPassword | docker compose --env-file .env.docker exec -T backend npm run account:create -- --username=admin --role=Administrator
Remove-Variable adminPassword

$userPassword = [System.Net.NetworkCredential]::new('', (Read-Host 'Kata sandi user' -AsSecureString)).Password
$userPassword | docker compose --env-file .env.docker exec -T backend npm run account:create -- --username=user --role=Viewer
Remove-Variable userPassword
```

Perintah pembuatan akun dapat dijalankan kembali untuk mengganti kata sandi atau
peran akun yang sama. Kata sandi disimpan sebagai hash `scrypt` di PostgreSQL.
Sesi login disimpan di memori backend selama delapan jam; setelah backend dimulai
ulang, pengguna perlu masuk kembali. Token lama dari `SINERGI_AUTH_TOKENS` tidak
dipakai oleh backend Docker pada mode produksi.

Setelah akun administrator pertama tersedia, buka **Admin → Pengguna** di
`/admin/users` untuk menambah akun, mengganti peran, mengaktifkan/nonaktifkan akun,
dan mereset password. Perubahan peran, status akun, atau password mengakhiri seluruh
sesi akun tersebut. Administrator aktif terakhir tidak dapat dinonaktifkan atau
diturunkan perannya. Perubahan akun tercatat di `audit_events` tanpa menyimpan password.

**Online** dan **Aktif** mempunyai arti berbeda. Akun aktif boleh masuk; Online
berarti ada sesi yang mengirim heartbeat atau request dalam 90 detik terakhir.
Web mengirim heartbeat setiap 30 detik; daftar Pengguna diperbarui tiap 15 detik
saat halaman terlihat. Logout langsung mengakhiri sesi itu; sesi lain milik akun
yang sama tetap dihitung. Tab tertutup atau koneksi terputus baru menjadi Offline
setelah batas 90 detik. Waktu terakhir aktif disimpan di `app_users.last_seen_at`.
Saat daftar gagal dimuat, UI menampilkan **Belum diperbarui**, bukan status Online
yang dianggap masih benar. Indikator memakai satu backend Docker; menjalankan
beberapa replika backend membutuhkan penyimpanan sesi bersama terlebih dahulu.

## Satu server untuk beberapa komputer di LAN

Semua pengguna memakai satu database apabila mereka membuka URL **server Docker
yang sama**. Bergabung dalam jaringan yang sama saja tidak menyatukan database;
menjalankan Compose di setiap laptop menghasilkan database masing-masing.

Pada komputer yang dijadikan server, ubah `.env.docker`:

```dotenv
SINERGI_HTTP_BIND_ADDRESS=0.0.0.0
SINERGI_HTTP_PORT=5174
```

Terapkan pengaturan hanya ke frontend (database dan backend tetap berjalan):

```powershell
docker compose --env-file .env.docker up -d --no-deps frontend
ipconfig
```

Cari IPv4 adapter Wi-Fi/Ethernet server, misalnya `192.168.1.10`. Komputer lain
membuka `http://192.168.1.10:5174` dan masuk dengan akun masing-masing. Semua request
API melalui frontend tersebut menuju backend dan PostgreSQL yang sama. Server dan
Docker harus tetap menyala. Izinkan port web pada firewall jaringan privat bila
akses dari komputer lain terhalang; pembatasan Wi-Fi antarperangkat juga bisa
menghalangi akses. Untuk deployment dengan alamat tetap, gunakan reservasi IP atau
DNS lokal. Pengaturan port mengikuti
[dokumentasi Docker](https://docs.docker.com/engine/network/port-publishing/).

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
docker compose --env-file .env.docker run --rm --no-deps migrate
docker compose --env-file .env.docker up -d --no-deps backend
docker compose --env-file .env.docker restart frontend
```

`sinergi-postgres-data` dan `sinergi-app-data` adalah named volume. Jangan menjalankan
`docker compose down -v` kecuali memang ingin menghapus database dan file upload lokal.

Secara default port frontend dan API diikat ke `127.0.0.1`; frontend dapat dibuka
untuk LAN melalui pengaturan di atas. PostgreSQL dan API tetap memakai localhost.
Untuk deployment di luar LAN, pasang reverse proxy HTTPS di depannya.
Koreksi Diagram Topologi oleh administrator
disimpan langsung ke dataset aktif. Cadangkan volume PostgreSQL dan volume file
sumber sebagai satu pasangan yang konsisten.

# Login Google dan permintaan akses SINERGI

> Status UI saat ini: opsi Google dan menu penghubungan akun sudah dihapus. Login password, pengajuan akses, dan bantuan reset tetap tersedia. Bagian Google di bawah disimpan sebagai referensi implementasi; mengisi Client ID saja tidak memunculkan opsi Google kembali.

## Alur yang tersedia

- Login username/password tetap tersedia.
- `Ajukan akses` meminta nama lengkap, email, dan unit/bagian, tanpa alasan akses.
- `Lupa kata sandi?` menerima email atau username dengan respons yang sama untuk semua akun.
- Administrator membuka **Kelola pengguna > Permintaan akses & bantuan**, memverifikasi identitas, lalu menyetujui atau menolak. Persetujuan akses selalu membuat Viewer.
- Pengajuan manual/reset menggunakan password yang ditentukan admin. Admin menyampaikannya secara pribadi melalui kanal internal resmi yang telah diverifikasi. Aplikasi tidak mengirim email, tidak menyimpan password pada permintaan, dan tidak menyatakan email telah dikirim.
- Pengajuan melalui Google tidak membutuhkan password lokal. Setelah disetujui, pengguna memilih Google lagi untuk masuk.
- Email yang sama tidak otomatis menggabungkan akun. Akun lokal harus login, membuka **menu akun > Metode login**, memasukkan ulang password SINERGI, lalu memilih akun Google.
- Reset password lokal mencabut session lama; pemulihan akun Google dilakukan melalui Google.

## Migrasi

Migration `0013_access_requests` menambahkan dua tabel, nama/unit akun, dan mengizinkan akun tanpa password lokal untuk Google. Jumlah tabel aplikasi menjadi 15.

Gunakan konfigurasi koneksi database milik migration owner, lalu jalankan:

```powershell
npm.cmd run db:migrate --prefix backend
```

Untuk deployment dengan runtime role terpisah, jalankan kembali provisioning role setelah migration. Compose production melakukan keduanya melalui layanan `migrate`. Backup database sebelum migrasi deployment. Rollback migration menolak berjalan jika masih ada akun Google-only, agar akun tidak kehilangan akses.

## Menyiapkan Google Client ID

1. Buka Google Cloud Console / Google Auth Platform, pilih atau buat project milik organisasi.
2. Lengkapi Branding dan Audience. Dalam mode testing, masukkan akun penguji yang diizinkan bila diwajibkan Google.
3. Buat OAuth client dengan jenis **Web application**.
4. Pada **Authorized JavaScript origins**, daftarkan origin frontend secara tepat. Untuk pengembangan gunakan `http://localhost:5173` dan, bila digunakan, `http://127.0.0.1:5173`. Daftarkan origin produksi HTTPS secara terpisah. Jangan memakai URL API internal atau path `/api` sebagai origin.
5. Implementasi ini memakai JavaScript callback GIS, sehingga tidak memerlukan redirect URI atau client secret. Scope login cukup profil dasar, email, dan OpenID; tidak meminta akses Gmail/Drive.
6. Salin **Client ID**, biasanya berakhiran `.apps.googleusercontent.com`.

Panduan resmi: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

## Konfigurasi pengembangan

Sebelum menjalankan `npm.cmd run dev` dari root:

```powershell
$env:SINERGI_GOOGLE_CLIENT_ID='CLIENT_ID_ANDA.apps.googleusercontent.com'
$env:SINERGI_PUBLIC_ORIGINS='http://127.0.0.1:5173,http://localhost:5173'
npm.cmd run dev
```

Koneksi PostgreSQL tetap memakai konfigurasi `SINERGI_DATABASE_URL` atau `.env.docker` yang sudah tersedia. Jangan menaruh secret di frontend atau source code.

Pengajuan akses dan reset manual tetap berfungsi tanpa konfigurasi Google. Konfigurasi diperoleh dari backend; tidak perlu build frontend ulang ketika Client ID berubah, tetapi backend perlu restart.

## Konfigurasi Docker/produksi

Isi pada file environment deployment:

```dotenv
SINERGI_GOOGLE_CLIENT_ID=CLIENT_ID_ANDA.apps.googleusercontent.com
SINERGI_PUBLIC_ORIGINS=https://sinergi.example.com
```

`SINERGI_PUBLIC_ORIGINS` dipakai untuk memeriksa Origin request bantuan dan Google. Isilah origin browser yang sebenarnya, tanpa trailing slash, dipisahkan koma bila lebih dari satu. Nilai ini tetap dibutuhkan pada produksi meskipun Google dinonaktifkan, agar form permintaan manual dapat digunakan. Compose pengembangan memakai port HTTP yang dikonfigurasi sebagai default origin.

Nginx sudah mengizinkan endpoint GIS yang diperlukan pada CSP dan memakai COOP yang mendukung popup Google. Gunakan HTTPS pada produksi, serta konfigurasi trusted proxy sesuai jaringan deployment agar rate limit memakai alamat client yang benar.

Session login dan challenge Google disimpan dalam memori backend. Pengembangan/deployment saat ini menggunakan satu instance backend; restart mengharuskan login ulang. Deployment beberapa instance memerlukan shared session/challenge store atau sticky session sebelum diaktifkan.

## Pemeriksaan setelah Client ID tersedia

1. Akun Google baru membuka pengajuan; unit harus diisi dan tidak bisa masuk sebelum disetujui.
2. Pengajuan berulang tidak membuat akun/permintaan pending ganda.
3. Admin menyetujui satu kali; login berikutnya masuk sebagai Viewer.
4. Akun lokal dengan email sama diarahkan menghubungkan Google, bukan dibuatkan duplikat.
5. Hubungkan Google dari akun lokal dengan password yang benar; login Google berikutnya memakai akun/peran yang sama.
6. Uji pembatalan popup, token kedaluwarsa, nonce berbeda, penolakan admin, dan koneksi Google terputus.

Tanpa Client ID sungguhan, test memakai verifier dan callback Google terkontrol. Pengujian login Google langsung dengan akun nyata masih perlu dilakukan setelah konfigurasi tersedia.

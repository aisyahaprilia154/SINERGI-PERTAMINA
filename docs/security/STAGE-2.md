# Tahap 2 — Pengamanan aplikasi

Dasar: f8da358. Seluruh perubahan lokal; layanan database operasional tidak diubah.

## Perilaku

- Login dibatasi 5 kegagalan per pasangan IP/identifier dan 30 percobaan per IP dalam 15 menit. Pending verification ikut dibatasi agar paralel tidak melewati batas. Respons 429 mempunyai Retry-After; kegagalan internal database melepaskan reservation tanpa menghitung password salah.
- Identifier pembatas di-hash, bukan disimpan mentah. Maksimum 10.000 entri; kapasitas penuh menolak sementara, bukan mengevict entri aktif untuk membuka bypass. Entri kedaluwarsa dibersihkan saat request, tanpa timer yang tertinggal. Ini pembatas satu proses; restart mereset counter. Multi-replica memerlukan pembatas bersama sebelum deployment.
- X-Forwarded-For diabaikan secara default. SINERGI_TRUSTED_PROXIES menerima daftar IP/CIDR dipisahkan koma; konfigurasi salah menolak startup. Resolver membaca rantai dari kanan. Nginx mengganti header dengan alamat peer yang dilihatnya, tidak meneruskan rantai yang disuplai klien.
- Password baru/reset 15–1024 karakter pada backend, CLI stdin, dan form React. Verifikasi password lama tidak diubah. Hash scrypt, sesi maksimum 8 jam, revoke/logout/role dan token sessionStorage dipertahankan.
- Kejadian login berhasil/gagal, throttle, logout, akses ditolak dan error internal memiliki timestamp/event/requestId/status dan actorId bila diketahui. Sink default JSON ke stdout; password, token, identifier gagal, IP, body, query URL dan error mentah tidak dicetak. Pengiriman SIEM/alert belum diterapkan.
- API dan nginx memakai header nosniff, DENY, referrer dan permissions policy. CSP melarang script inline, unsafe-eval, object dan framing. Blob worker/data image serta origin font/imagery yang dipakai diizinkan eksplisit. Inline style tetap diizinkan untuk React/MapLibre. Provider tile baru memerlukan review allowlist, bukan wildcard.

## Verifikasi

Frontend Node 341/341, React 196/196, backend 84 lulus/1 integrasi PostgreSQL skip sebelum tahap 3. Tujuh tes keamanan baru mencakup boundary/cooldown/concurrency/kapasitas/proxy, HTTP 401/403/429, expiry/logout, sanitasi log dan CLI tanpa koneksi database. Lint backend dan JSX/Hooks lulus. Image frontend produksi dibangun.

Lima belas tes SPA Administrator/Viewer pada nginx produksi lulus. Satu tes CSP tambahan menguji worker blob, peta, impor/preview, SVG/PNG kedua diagram dan script inline yang harus diblokir. Percobaan awal memakai kontrol fixture yang tidak tersedia di halaman produksi lalu mencoba toolbar saat drawer masih terbuka; alur tes diperbaiki untuk mengikuti kontrol produksi dan menutup drawer. Tidak ada pelonggaran CSP, force-click atau kenaikan timeout untuk meluluskan tes.

Regresi browser penuh: 95 lulus, satu tes CSP produksi dilewati pada Vite lalu lulus terpisah pada image nginx. Hasil dicatat di evidence/stage-2-browser-full.txt. Tes CSP sengaja hanya dijalankan terhadap image nginx, sehingga dilewati pada suite Vite development. Integrasi PostgreSQL terpisah, TLS produksi dan role database terbatas diselesaikan/dibuktikan pada tahap 3.

# Import tambahan dan perlindungan baseline

Import ke dataset yang sudah aktif menggunakan `contentMode: additions_only`
secara default. Field ini terpisah dari `importMode: stage_only`; import tambahan
harus ditinjau sebelum aktivasi. Database kosong tetap memproses seluruh sumber.
Mode `full` masih tersedia secara eksplisit bagi integrasi lama, tetapi form
import memakai tambahan saja dan tidak menawarkan aktivasi otomatis.

Identitas dicocokkan melalui stable ID dan identitas sumber yang tersimpan,
dengan batas fasilitas. Aset lama yang berubah atau tidak hadir dalam KMZ tetap
disalin dari baseline, bersama koordinat, klasifikasi, keputusan relasi, mounting,
registry interface, dan audit. Inferensi baru memakai konteks baseline tetapi
hanya menambahkan hasil yang menyentuh aset/jalur baru; koreksi lama dilindungi.
Konflik identitas memblokir aktivasi. Pemeriksaan baseline version dan record
revision diulang di dalam transaksi aktivasi JSON maupun PostgreSQL.

Warna KML `AABBGGRR` dibaca sebagai evidence jaringan: biru FO, hijau LAN/UTP.
Evidence ini bertahan di canonical source feature dan stored bundle rebuild.
Endpoint fisik yang jelas didahulukan dari label. Evidence kabel yang ambigu
tidak diganti shortcut kamera ke JB terdekat. Toleransi endpoint 6m, inline 2m,
fallback kamera–JB 30m, dan mounting otomatis maksimal 5m tetap dipertahankan.

Restart server tidak lagi meregenerasi dataset lama karena perubahan rule-set.
Worker juga mengabaikan job otomatis historis untuk dataset aktif/arsip.
Perubahan data manual yang diminta melalui alur admin tetap tersedia.

Audit pembanding dapat dijalankan tanpa koneksi database atau penulisan data:

```powershell
node backend/scripts/audit-import-inference.mjs <snapshot-baseline.json> <sumber.kml>
```

Audit hanya membandingkan koreksi eksplisit dengan inferensi, dan melaporkan
pengecualian lapangan. Ia bukan held-out accuracy gate. Pengujian import,
aktivasi, dan regresi menggunakan fixture, database sementara, atau adapter
PostgreSQL palsu; jangan menjalankannya terhadap database pengguna.

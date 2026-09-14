# FT Tegal Baru — koreksi 14 September 2026

Fakta pengguna berada di `shared/facility-corrections.mjs` dan dipakai oleh
regenerasi engine serta adapter diagram untuk dataset aktif yang sudah tersimpan.
Metadata geometri sumber tidak diubah. Relasi koreksi memiliki provenance dan
bukti konfirmasi terpisah; penamaan ambigu tidak dipilih secara sembarang.

- Server terhubung ke JB-01 dan JB-14 (alias JB-014).
- C-08 ke JB-01; C-13 ke JB-02; C-31 ke JB-09.
- JB-02 terhubung langsung ke JB-04.
- Sesuai klarifikasi pengguna: C-32 ke JB-10-EXP, bukan JB-32.
- C-08–C-13, C-15, C-27: indoor.
- JB-08, JB-08.3, JB-09.1/C-33, JB-10.1/C-34,
  JB-13-EXP/C-37–C-40, JB-14/C-44–C-46: di luar tiang.
- Alias kamera dengan nol awal dan akhiran EXP dicocokkan; nomor turunan JB
  tetap berbeda dari JB induknya.

Layout tidak boleh mewariskan frame tiang melalui relasi jaringan atau keluarga
JB jika expectation aset adalah indoor/standalone. Frame non-tiang dipisahkan
menurut komponen yang terhubung, termasuk aset tanpa relasi. Label menampilkan
nomor/nama aset dan tipe kamera dari folder sumber bila tersedia.

Regenerasi berikutnya menyimpan relasi koreksi sebagai relasi terkonfirmasi.
Adapter menerapkannya pada diagram dataset lama tanpa menulis ulang penyimpanan.
Tes regresi: `backend/tests/facility-corrections.test.js`.

# Checklist keamanan SINERGI

Acuan: 01_Security_Checklist_Aplikasi_External_Hosting.xlsx, sheet Security Checklist, 45 poin. File sumber tidak diubah.

Status tahap 2: pengamanan aplikasi. **Terverifikasi lokal** bukan persetujuan produksi, sertifikasi, atau hasil penetration test. Bukti historis tidak otomatis berlaku untuk runtime sekarang.

| No | Kategori | Checklist | Status | Bukti / kondisi | Tindakan berikutnya |
|---|---|---|---|---|---|
| 1 | Governance | Business Owner dan IT Owner telah ditetapkan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 2 | Governance | Risk Assessment telah dilakukan sebelum implementasi | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 3 | Governance | Persetujuan Enterprise IT / Cyber Security telah diperoleh | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 4 | Governance | Data Classification telah dilakukan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 5 | Governance | Vendor Security Assessment telah dilakukan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 6 | Governance | SLA dan Security Requirement tercantum dalam kontrak | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 7 | Governance | Hak audit (Right to Audit) dicantumkan dalam kontrak | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 8 | Data Security | Tidak menyimpan data Rahasia/Strategis tanpa persetujuan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 9 | Data Security | Data pribadi memenuhi UU PDP | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 10 | Data Security | Data terenkripsi saat transit (TLS 1.2/1.3) | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 11 | Data Security | Data terenkripsi saat disimpan (AES-256 atau setara) | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 12 | Data Security | Backup tersedia dan telah diuji restore | sebagian | Skrip backup dan restore beserta checksum tersedia. | Uji ulang pada proyek Docker terpisah; persetujuan dan jadwal produksi belum ada. |
| 13 | Data Security | Mekanisme Data Retention & Data Deletion tersedia | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 14 | Application Security | Secure SDLC diterapkan | sebagian | Tes Node/React/browser dan CI dependency tersedia. | Tambahkan hasil paket keamanan dan review perubahan. |
| 15 | Application Security | Vulnerability Assessment telah dilakukan | sebagian | Audit dependency tersedia; bukan VA aplikasi lengkap. | Lengkapi pengujian keamanan terarah dan penilaian independen. |
| 16 | Application Security | Penetration Test telah dilakukan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 17 | Application Security | Seluruh High/Critical Vulnerability telah ditutup | sebagian | Audit 25 Oktober: root/backend/frontend nol temuan setelah undici 8.12.3; [bukti](evidence/stage-1-audit.json). | Audit dependency lulus; temuan runtime/pentest belum dinilai. |
| 18 | Application Security | Patch Management berjalan | sebagian | Lockfile dan CI audit tersedia. | Jadwal mingguan dan SOP penanganan patch. |
| 19 | Application Security | Source Code Repository aman | sebagian | .env dan backup diabaikan Git; CI contents:read. | Verifikasi repository private, MFA pengelola, proteksi branch dan secret scanning di GitHub. |
| 20 | Identity & Access | Single Sign-On (SSO) terintegrasi dengan AD/Azure AD | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 21 | Identity & Access | Multi-Factor Authentication (MFA) diterapkan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 22 | Identity & Access | Role Based Access Control (RBAC) diterapkan | terverifikasi lokal | RBAC backend dan 401/403 diuji HTTP; role Administrator/Viewer diuji browser produksi. | Ulangi integrasi dengan database uji pada tahap 3; hak akses produksi tetap memerlukan review owner. |
| 23 | Identity & Access | Tidak menggunakan shared account | sebagian | Akun individual didukung; belum ada bukti pemakaian per orang. | Owner memastikan akun tidak dibagi. |
| 24 | Identity & Access | Privileged Account dipisahkan | sebagian | Role Administrator dan Viewer terpisah; runtime DB masih memakai owner. | Pisahkan role runtime/migrasi dan akun harian/admin. |
| 25 | Infrastructure & Cloud | Lokasi data center diketahui dan disetujui | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 26 | Infrastructure & Cloud | Cloud Provider memiliki sertifikasi ISO 27001/SOC 2 | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 27 | Infrastructure & Cloud | Firewall/WAF digunakan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 28 | Infrastructure & Cloud | Network Segmentation diterapkan | sebagian | Port database/backend hanya bind localhost pada Compose lokal. | Konfigurasi produksi tanpa publikasi port dan jaringan terpisah. |
| 29 | Infrastructure & Cloud | Security Hardening telah dilakukan | sebagian | Non-root backend, validasi upload, pembatas login, proxy trust, header/CSP dan password baru 15 karakter; lihat STAGE-2.md. | Pisahkan privilege DB dan buktikan konfigurasi produksi pada tahap 3. |
| 30 | Infrastructure & Cloud | Endpoint Protection tersedia | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 31 | Monitoring | Audit Log aktif | sebagian | Audit perubahan append-only tersedia; log autentikasi JSON tersanitasi dan pemeriksaan sink lulus. | Buktikan audit pada PostgreSQL terpisah dan tetapkan retensi/pengiriman log. |
| 32 | Monitoring | Log dikirim ke SIEM/SOC | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 33 | Monitoring | Alert keamanan tersedia | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 34 | Monitoring | Incident Response Procedure tersedia | sebagian | Runbook historis tersedia tetapi menyebut metrics runtime lama. | Tulis runbook sesuai runtime operasional aktif. |
| 35 | Compliance | Memenuhi ISO 27001 | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 36 | Compliance | Memenuhi Kebijakan Keamanan Informasi Pertamina | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 37 | Compliance | Memenuhi regulasi UU PDP | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 38 | Compliance | Memenuhi ketentuan PSE (bila berlaku) | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 39 | Business Continuity | Disaster Recovery Plan tersedia | sebagian | Mekanisme restore tersedia. | Dokumentasikan pemulihan dan uji pada salinan; persetujuan produksi pending. |
| 40 | Business Continuity | Business Continuity Plan tersedia | sebagian | Belum ada BCP yang disetujui. | Dokumentasikan layanan manual/read-only, penanggung jawab dan alur komunikasi sebagai draf. |
| 41 | Business Continuity | RTO dan RPO telah ditetapkan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 42 | Business Continuity | DR Drill pernah dilakukan | sebagian | Bukti restore historis lokal tersedia. | Ulangi drill lokal dan bedakan dari DR drill produksi. |
| 43 | Exit Strategy | Mekanisme migrasi data tersedia | sebagian | Dump, file sumber dan manifest memungkinkan migrasi. | Uji transfer/restore dan dokumentasikan handover. |
| 44 | Exit Strategy | Data dapat dihapus permanen saat kontrak selesai | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 45 | Exit Strategy | Vendor menyerahkan seluruh data kepada perusahaan saat terminasi | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |

## Batas dan bukti

- Login lokal dipertahankan; SSO/MFA belum diterapkan.
- TLS, enkripsi disk/backup, vendor, kontrak, SOC/SIEM, ISO, UU PDP/PSE, owner dan RTO/RPO memerlukan verifikasi terpisah.
- Pengujian tulis memakai mock atau database uji. Tidak ada perubahan pada database operasional.
- Baseline: [Node frontend](evidence/baseline-frontend-node.txt), [React](evidence/baseline-react.txt), [backend](evidence/baseline-backend.txt).
- Panduan monitoring historis menyebut SINERGI_METRICS_ENABLED dan metrics yang tidak diimplementasikan oleh backend operasional aktif; jangan gunakan sebagai bukti monitoring aktif.

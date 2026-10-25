# Checklist keamanan SINERGI

Acuan: 01_Security_Checklist_Aplikasi_External_Hosting.xlsx, sheet Security Checklist, 45 poin. File sumber tidak diubah.

Status tahap 3: pengamanan lokal dan konfigurasi hosting teruji. **Terverifikasi lokal** bukan persetujuan produksi, sertifikasi, atau hasil penetration test. Bukti historis tidak otomatis berlaku untuk runtime sekarang.

| No | Kategori | Checklist | Status | Bukti / kondisi | Tindakan berikutnya |
|---|---|---|---|---|---|
| 1 | Governance | Business Owner dan IT Owner telah ditetapkan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 2 | Governance | Risk Assessment telah dilakukan sebelum implementasi | sebagian | Review risiko teknis/inventaris tersedia di [runbook](RUNBOOK.md). | Risk Assessment formal bisnis/IT sebelum hosting dan persetujuan risiko belum tersedia. |
| 3 | Governance | Persetujuan Enterprise IT / Cyber Security telah diperoleh | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 4 | Governance | Data Classification telah dilakukan | sebagian | Inventaris identitas/email, koordinat, IP/hostname, KML/KMZ, audit dan backup tersedia di runbook. | Owner menetapkan label klasifikasi dan persetujuan pemakaian; inventaris bukan persetujuan data publik. |
| 5 | Governance | Vendor Security Assessment telah dilakukan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 6 | Governance | SLA dan Security Requirement tercantum dalam kontrak | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 7 | Governance | Hak audit (Right to Audit) dicantumkan dalam kontrak | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 8 | Data Security | Tidak menyimpan data Rahasia/Strategis tanpa persetujuan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 9 | Data Security | Data pribadi memenuhi UU PDP | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 10 | Data Security | Data terenkripsi saat transit (TLS 1.2/1.3) | terverifikasi lokal | TLS 1.2/1.3, redirect dan HSTS diuji dengan CA/cert sintetis dipercaya eksplisit; [bukti](evidence/stage-3-stack-results.json). | Sertifikat domain publik dan konfigurasi hosting aktual tetap memerlukan verifikasi pengelola. |
| 11 | Data Security | Data terenkripsi saat disimpan (AES-256 atau setara) | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 12 | Data Security | Backup tersedia dan telah diuji restore | terverifikasi lokal | Dump, 13 digest tabel, seluruh checksum file dan runtime pemulihan login/dataset/unduhan sumber lulus pada proyek terpisah. | Tetapkan jadwal, lokasi backup terenkripsi/off-site, owner dan drill produksi. |
| 13 | Data Security | Mekanisme Data Retention & Data Deletion tersedia | sebagian | SOP retensi/penghapusan/serah terima tersedia; tidak ada penghapusan data bisnis otomatis. | Tetapkan masa simpan dan prosedur provider; penghapusan permanen dari snapshot/backup belum dibuktikan. |
| 14 | Application Security | Secure SDLC diterapkan | sebagian | Tes Node/React/browser dan CI dependency tersedia. | Tambahkan hasil paket keamanan dan review perubahan. |
| 15 | Application Security | Vulnerability Assessment telah dilakukan | sebagian | Audit dependency tersedia; bukan VA aplikasi lengkap. | Lengkapi pengujian keamanan terarah dan penilaian independen. |
| 16 | Application Security | Penetration Test telah dilakukan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 17 | Application Security | Seluruh High/Critical Vulnerability telah ditutup | sebagian | Audit 25 Oktober: root/backend/frontend nol temuan setelah undici 8.12.3; [bukti](evidence/stage-1-audit.json). | Audit dependency lulus; temuan runtime/pentest belum dinilai. |
| 18 | Application Security | Patch Management berjalan | sebagian | Lockfile dan CI audit tersedia. | Jadwal mingguan dan SOP penanganan patch. |
| 19 | Application Security | Source Code Repository aman | sebagian | .env dan backup diabaikan Git; CI contents:read. | Verifikasi repository private, MFA pengelola, proteksi branch dan secret scanning di GitHub. |
| 20 | Identity & Access | Single Sign-On (SSO) terintegrasi dengan AD/Azure AD | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 21 | Identity & Access | Multi-Factor Authentication (MFA) diterapkan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 22 | Identity & Access | Role Based Access Control (RBAC) diterapkan | terverifikasi lokal | Role Administrator/Viewer, API 401/403 serta reset password/perubahan role yang mencabut sesi diuji dengan PostgreSQL nyata dan browser. | Review pemetaan akses pengguna dan bukti operasional oleh owner. |
| 23 | Identity & Access | Tidak menggunakan shared account | sebagian | Akun individual didukung; belum ada bukti pemakaian per orang. | Owner memastikan akun tidak dibagi. |
| 24 | Identity & Access | Privileged Account dipisahkan | sebagian | Role database owner/runtime terpisah dan privilege runtime diuji; akun Administrator/Viewer didukung. | Owner menetapkan akun istimewa individual terpisah dari akun harian; membership/akses produksi perlu review. |
| 25 | Infrastructure & Cloud | Lokasi data center diketahui dan disetujui | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 26 | Infrastructure & Cloud | Cloud Provider memiliki sertifikasi ISO 27001/SOC 2 | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 27 | Infrastructure & Cloud | Firewall/WAF digunakan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 28 | Infrastructure & Cloud | Network Segmentation diterapkan | terverifikasi lokal | Compose produksi hanya memublikasikan frontend; jaringan database internal dan frontend tidak bergabung. Konfigurasi serta stack diuji. | Verifikasi firewall/routing/topologi deployment sebenarnya. Bridge loopback tambahan hanya dipakai runner database uji. |
| 29 | Infrastructure & Cloud | Security Hardening telah dilakukan | sebagian | Login limiter, proxy trust, password baru, CSP/header, non-root backend dan privilege DB terbatas telah diuji lokal. | Review baseline hardening host/container dan VA/pentest produksi masih diperlukan. |
| 30 | Infrastructure & Cloud | Endpoint Protection tersedia | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 31 | Monitoring | Audit Log aktif | terverifikasi lokal | Audit perubahan di PostgreSQL aktif/append-only; runtime ditolak UPDATE/DELETE/TRUNCATE, log autentikasi JSON diuji bebas password/token. | Tetapkan retensi/hak akses/pengiriman SIEM; bukti tidak mencakup monitoring produksi. |
| 32 | Monitoring | Log dikirim ke SIEM/SOC | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 33 | Monitoring | Alert keamanan tersedia | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 34 | Monitoring | Incident Response Procedure tersedia | sebagian | Prosedur insiden sesuai backend operasional ada di [runbook](RUNBOOK.md). | Isi kontak/owner, saluran eskalasi dan persetujuan serta latihan organisasi. |
| 35 | Compliance | Memenuhi ISO 27001 | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 36 | Compliance | Memenuhi Kebijakan Keamanan Informasi Pertamina | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 37 | Compliance | Memenuhi regulasi UU PDP | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 38 | Compliance | Memenuhi ketentuan PSE (bila berlaku) | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 39 | Business Continuity | Disaster Recovery Plan tersedia | sebagian | Prosedur pemulihan database baru + file sumber diuji lokal dan tercatat di runbook. | Tetapkan owner, RTO/RPO, lokasi pemulihan dan persetujuan DR produksi. |
| 40 | Business Continuity | Business Continuity Plan tersedia | sebagian | Runbook memuat penghentian perubahan, referensi ekspor aman, pencatatan manual dan rekonsiliasi setelah pulih. | Owner menyetujui BCP dan alur komunikasi/operasi manual aktual. |
| 41 | Business Continuity | RTO dan RPO telah ditetapkan | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 42 | Business Continuity | DR Drill pernah dilakukan | terverifikasi lokal | Drill sintetis memulihkan seluruh 13 tabel dan file, kemudian login dan source download dari container pemulihan baru. | Drill produksi dan pencapaian RTO/RPO belum dibuktikan. |
| 43 | Exit Strategy | Mekanisme migrasi data tersedia | terverifikasi lokal | Paket dump + source-storage + manifest terverifikasi dan dapat dijalankan pada target pemulihan terpisah. | Serah terima data nyata, versi kode/image dan persetujuan tujuan mengikuti runbook/kontrak. |
| 44 | Exit Strategy | Data dapat dihapus permanen saat kontrak selesai | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |
| 45 | Exit Strategy | Vendor menyerahkan seluruh data kepada perusahaan saat terminasi | belum | Belum ada bukti yang diverifikasi dalam workspace. | Memerlukan data, pelaksanaan atau persetujuan owner/IT/hosting sesuai runbook. |

## Batas dan bukti

- Login lokal dipertahankan; SSO/MFA belum diterapkan.
- TLS, enkripsi disk/backup, vendor, kontrak, SOC/SIEM, ISO, UU PDP/PSE, owner dan RTO/RPO memerlukan verifikasi terpisah.
- Pengujian tulis memakai mock atau database uji. Tidak ada perubahan pada database operasional.
- Baseline: [Node frontend](evidence/baseline-frontend-node.txt), [React](evidence/baseline-react.txt), [backend](evidence/baseline-backend.txt).
- Panduan monitoring historis menyebut SINERGI_METRICS_ENABLED dan metrics yang tidak diimplementasikan oleh backend operasional aktif; jangan gunakan sebagai bukti monitoring aktif.

## Hasil paket lokal

**7 terverifikasi lokal, 14 sebagian, 24 belum; total 45 poin.** Status sebagian tidak dihitung sebagai poin yang sudah terpenuhi. Tidak ada status tidak berlaku yang ditetapkan tanpa dasar/keputusan owner. TLS/DR lokal tidak sama dengan bukti deployment publik atau persetujuan perusahaan.

Lihat [laporan tahap 3](STAGE-3.md), [runbook](RUNBOOK.md), dan [hasil stack terisolasi](evidence/stage-3-stack-results.json).

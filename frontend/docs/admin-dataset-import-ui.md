# SINERGI Admin Dataset Import UI

Halaman import tersedia pada:

```text
/admin/datasets/import
```

Halaman ini tidak mengubah navbar atau halaman network map. Style dibatasi oleh
class `admin-import-body`.

## Integrasi API

UI memakai endpoint relative berikut:

- `GET /api/admin/import-config`;
- `POST /api/admin/imports`;
- `GET /api/admin/imports/:datasetVersionId`.

Vite meneruskan `/api` ke `SINERGI_API_TARGET`, dengan default
`http://127.0.0.1:5000`. Pada production, frontend dan API diharapkan tersedia
pada origin yang sama atau diatur oleh reverse proxy.

Token Administrator dibaca dari `sessionStorage` atau `localStorage` key
`sinergiAdminToken`. Untuk localhost saja, fallback token adalah `local-admin`.

## Progress dan cancellation

- progress upload berasal dari `XMLHttpRequest.upload`;
- progress processing berasal langsung dari `processing.progress` backend;
- nama tahap berasal dari `processing.stage`;
- jika persen belum tersedia, UI memakai progress indeterminate;
- tombol Batal dapat menghentikan upload yang belum selesai;
- setelah backend menerima file, tombol Batal hanya menghentikan polling karena
  backend belum menyediakan cancellation endpoint;
- UI menyatakan keterbatasan tersebut dan tidak mengklaim job server dibatalkan.

## Aktivasi

Import valid maupun invalid tidak diaktifkan otomatis. Dataset invalid tidak
mempunyai tindakan aktivasi. Halaman hanya menyediakan laporan validasi,
preview read-only, dan upload ulang.

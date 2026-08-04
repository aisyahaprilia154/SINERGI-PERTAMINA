# Source storage incident handling — 4 Agustus 2026

Status: `complete (current file-store adapter contract; external object storage
pending)`.

## Evidence

`backend/tests/upload-pipeline.test.js` menghapus source file setelah upload
atau mengubah isinya, kemudian memanggil source-file API. Service menghasilkan:

- `source_file_missing` dengan HTTP `404` ketika object tidak tersedia;
- `source_file_integrity_failed` dengan HTTP `409` ketika ukuran/checksum
  berubah;
- response tidak membocorkan `sourceStorageKey` atau path internal;
- audit incident mencatat kegagalan tanpa menyimpan path source sensitif.

Full verification: `157/157` test, lint `85` file, build `37` source file, dan
`git diff --check` lulus.

## Batas

Evidence ini berlaku untuk `ImportFileStore` filesystem adapter yang digunakan
workspace. Provider object storage eksternal, retry/backoff provider, versioned
retention, dan alert production belum diuji live.

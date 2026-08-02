# Manual map viewport regression

Gunakan dataset Pengapon dan ulangi pemeriksaan pada viewport 1366 × 768 serta
1536 × 864.

## Browser dan device pixel ratio

1. Uji browser zoom 80%, 100%, dan 125%.
2. Uji `devicePixelRatio` 1 dan lebih dari 1.
3. Pastikan garis, marker, dan teks tetap tajam.
4. Klik bagian tengah serta tepi marker. Pointer hit-test harus sesuai dengan
   posisi visual pada semua skala.

## Panel responsive

1. Buka dan tutup sidebar desktop.
2. Buka dan tutup sidebar mobile overlay.
3. Pilih aset untuk membuka drawer, lalu tutup drawer.
4. Setelah setiap transisi, Leaflet harus mengisi area baru tanpa clipping,
   geographic bounds harus berubah, dan marker tidak bergeser dari jalurnya.

## Level of detail

1. Low zoom: backbone dan core node dominan, line minor redup, label minor
   tersembunyi, serta point reguler rapat menjadi cluster.
2. Medium zoom: switch, OTB, NVR, server, dan junction box dapat dipilih;
   distribution line terlihat; label dibatasi pada selected, trace endpoint,
   dan core node.
3. High zoom: seluruh node relevan tampil; hover label tersedia; line detail
   tampil; marker berdekatan dapat dipilih.

## Collision

1. Klik cluster hingga high zoom.
2. Node dengan koordinat identik harus membentuk radial fan-out/spiderfy.
3. Node yang hampir identik harus mendapat displacement deterministik.
4. Leader line harus kembali ke posisi geografis asli.
5. Selected node harus tampil di lapisan paling atas.
6. Setelah pan atau zoom berhenti, label collision dan displacement harus stabil
   tanpa flicker.

## Transform stress

1. Lakukan rapid zoom dengan wheel dan kontrol selama minimal lima detik.
2. Lakukan rapid pan horizontal dan vertikal.
3. TopologyGraph tidak boleh dibangun ulang.
4. Setelah transform berhenti, periksa hasil
   `getGeographicViewportBounds()`, `getVisibleAssetIds()`, dan
   `getVisibleGeometryIds()`.
5. Subscribe melalui `subscribeViewportChange()` dan pastikan callback terjadi
   setelah transform stabil, bukan pada setiap frame.

## Tracing dan map tools

1. Mulai tracing tanpa aset fokus: banner berada di safe area map dan meminta
   titik awal.
2. Pilih node graph valid: banner berpindah ke pemilihan tujuan tanpa instruksi
   kedua di drawer.
3. Klik basemap: tidak ada aset atau endpoint yang terpilih.
4. Pilih endpoint tanpa jalur: tampil state `Jalur tidak ditemukan`.
5. Tekan Escape atau tombol close: tracing kembali idle dan URL dibersihkan.
6. Hasil tracing tetap disorot saat drawer dibuka atau ditutup sampai dihentikan.
7. Uji Import / Export, Diagram 2D, redupkan lainnya, tampilkan atau sembunyikan
   semua, focus network line-only, search, sidebar, drawer, dan kontrol zoom
   dengan keyboard.
8. Pada browser zoom 80%, 100%, dan 125%, toolbar tidak menutupi context card;
   banner tetap wrap, tombol close terlihat, dan popover tidak keluar dari map.

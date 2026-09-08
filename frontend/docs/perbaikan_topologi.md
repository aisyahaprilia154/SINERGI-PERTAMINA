booster kutawinangun
1. Seharusnya memiliki 12 JB dan 1 Server 
2. Terdapat 10 tiang
3. JB 12 sudah betul berelasi dengan C19 namun untuk tiangnya tidak perlu diberi keterangan perlu mounting dan sebagai catatan bahwa tidak semua sset ada di tiang karena beberapa CCTV langsung menempel di dinding (tidak perlu diberi keterangan nempel di dinding)
4.Asset yang perlu kamu perhatikan yaitu dari tiang 1 sd 10 beserta relasinya dengan JB dan CCTV yang berkaitan yang belum terdeteksi di topologi


JB 01 Tiang 4, di topologi masih belum menampilkan semua asset cctv, di topologi dia baru detect cctv 9 dan 10

##############################################################
JB-01
Endpoint Terhubung (6)

videocam
Cam-06
CCTV

videocam
Cam-07
CCTV

videocam
Cam-08
CCTV

videocam
Cam-09
CCTV


videocam
Cam-10

UNTUK device_hub JB-02 tidak seharusnya untuk berelasi dengan JB 01
kemudian untuk enpoint yang terhubung aku mau ui/ux nya sesuai dengan yang aku lampirkan dikarenakan untuk ui/ux yang sekarang itu cameranya misah dengan JB di luar lingkup tiang


JB 06 Endpoint Terhubung (4)
dengan 

videocam
Cam-17
LAN

videocam
Cam-18
LAN

videocam
Cam-16

UNTUK device_hub JB-06 tidak seharusnya untuk berelasi dengan JB 02
kemudian untuk enpoint yang terhubung aku mau ui/ux nya sesuai dengan yang aku lampirkan dikarenakan untuk ui/ux yang sekarang itu cameranya misah dengan JB di luar lingkup tiang

JB 2 itu relasi dengan cam 13 dan 12

LAKUKAN PERBAIKAN, UNTUK YANG LAINNYA SUDAH BETUL RELASINYA, AKU LAMPIRKAN CONTOH PELETAKKAN TOPOLOGINYA


#######################################################
Perbaikan Booster Kutawinangun
Relasi dan asset sudah lebih betul dan rapih
Revisi: 
1. hapus tulisan "Gap ke rack"
2. memag betul server berelasi dengan cam 05, namun untuk server adalah server/parent dari segala asset, jadi buat agar penempatannya disesuaikan
3. untuk asset yang terdeteksi tidak memiliki tiang, keterangan pada kotaknya beri "Area non-tiang/indoor"
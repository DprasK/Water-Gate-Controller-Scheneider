# AWGC 3 Pintu — Secure SCADA Node.js

## Profil latihan yang sekarang aktif

Gunakan **proyek yang sekarang terbuka: AWGC_REV3_BEFORE_SIM_INPUTS.smbp**.
Tidak perlu proyek atau salinan lain. `schneider-control.json` mengaktifkan kontrol
REV3 dan mematikan panel SIM ONLY. Perubahan ini hanya pada SCADA; file PLC yang
sedang digunakan tidak ditimpa atau dibuat ulang.

Proyek aktif telah diperiksa: `%M5` commissioning, `%M6=1` STOP, `%M6=0` melepas
STOP, `%MW50..52` target. Safety, OL, AUTO, limit dan encoder tetap berasal dari
input PLC. Penanda aktif `%MW110=221`, `%MW111=0` karena rung versi tidak ada.
`plc.rev3ProfileVersion=0` memilih pemetaan itu secara eksplisit dan hanya diizinkan
untuk simulator lokal 127.0.0.1:502 Unit 1. Konfigurasi produksi tetap memerlukan
marker versi 3001; tidak ada penerimaan otomatis atas versi/proyek lain.
Marker adalah pemeriksaan kompatibilitas, bukan autentikasi atau bukti safety.

SCADA web lokal untuk proyek `AWGC_3_Pintu_TM221CE24R_REV3.smbp`. Komunikasi menggunakan **Modbus TCP** dan model tag mengikuti tipe data **IEC 61131-3** (`BOOL`, `UINT`, `REAL`). Aplikasi memonitor tiga pintu, encoder absolute Omron E6CP, level 4–20 mA, alarm, request OPEN/CLOSE, tren, serta mengirim target bukaan 0–100%.

## Jalankan simulasi

Node.js 22 sudah tersedia dan proyek ini tidak membutuhkan paket npm eksternal.

```powershell
cd "C:\Users\dellB\OneDrive\Dokumen\ChatGPT\Pras\SCADA_AWGC_M221_SECURE"
npm run simulate
```

Buka `http://127.0.0.1:3100`. Atau klik `Jalankan_Simulasi.cmd`.

Dalam mode simulasi localhost, tombol **SET** langsung bisa dipakai tanpa token.
Masukkan angka 0–100 lalu tekan SET untuk menggerakkan pintu virtual. Input tidak
ditimpa polling saat sedang diedit. Kontrol ini memakai endpoint simulator tersendiri,
menolak origin asing, dan tidak tersedia dalam mode Modbus TCP. Pengaturan
`allowWrites=false` serta token wajib untuk akses PLC fisik tetap dipertahankan.

## Hubungkan ke TM221CE24R

Mode default sekarang **modbus-tcp** ke simulator Schneider **127.0.0.1:502,
Unit ID 1**, yang sudah diuji melalui pembacaan register. Tidak ada fallback data
buatan JavaScript saat koneksi gagal: dashboard menampilkan
OFFLINE / NO DATA. `npm run simulate` tetap merupakan mode demo terpisah.

Untuk monitor-only, isi `plc.host` di `config/default.json` kemudian jalankan
`npm start` atau `Jalankan_Modbus.cmd`. Alternatif: set `SCADA_PLC_HOST` ke IP
PLC yang sudah diverifikasi sebelum menjalankan server. Port default 502, Unit ID 1.
Di file proyek REV3 yang diperiksa, IP Ethernet masih 0.0.0.0 dan Modbus server
belum aktif. Hal itu bukan indikator status simulator lokal: proses M2xxBasicSIM
yang sedang berjalan telah diverifikasi melayani Modbus di port 502. Untuk PLC
fisik, konfirmasi konfigurasi perangkat aktual melalui Machine Expert Basic.

1. Salin `config/plc.example.json` menjadi `config/local.json`.
2. Ubah `plc.host` sesuai alamat IP PLC dan cek `unitId`.
3. Jalankan monitor-only lebih dahulu dengan `security.allowWrites: false`.
4. Jalankan:

```powershell
$env:SCADA_CONFIG = "config/local.json"
npm start
```

Untuk mengaktifkan penulisan target, set `allowWrites: true`, lalu buat token panjang yang tidak disimpan di source code:

```powershell
$env:SCADA_CONFIG = "config/local.json"
$env:SCADA_WRITE_TOKEN = "ganti-dengan-token-acak-minimal-20-karakter"
npm start
```

Dashboard meminta token saat operator pertama kali menekan SET. Token hanya disimpan di memori JavaScript tab dan hilang saat halaman ditutup.

## Pemetaan Modbus M221

### Kontrol target simulator Schneider

### Kontrol dan status input REV3 (versi aktif)

File yang diedit: `AWGC_REV3_BEFORE_SIM_INPUTS.smbp`, dari proyek REV3 sebelum
penambahan input simulasi. Backup sebelum edit: file yang sama dengan akhiran
`.before-scada.bak`. Proyek `AWGC_SIM_INPUTS_ONLY.smbp` tidak digunakan oleh panel ini.

- Hardware TM221CE24R, input encoder/analog dan 134 rung asli dipertahankan.
- Rung SYSTEM_PERMISSIVE tetap memakai safety `%I0.0`, overload `%I0.7..9`
  dan commissioning `%M5`, ditambah kontak NC `%M6 SCADA_STOP`.
- `%M6=1`: STOP; `%M6=0`: melepas STOP (bukan memaksa `%M0`).
- Saat first RUN, `%M6` diset 1 dan `%M5` direset 0.
- Commissioning ON membutuhkan konfirmasi pengujian dari operator melalui dialog.
- ENABLE ditolak bila commissioning, Safety atau salah satu OL belum OK.
- `%M300..313` hanya mirror READ ONLY `%I0.0..13`;
  `%M344..351` mirror READ ONLY `%I1.24..31`;
  `%M360..365` mirror READ ONLY output asli `%Q0.0..5`.
- Penulisan kontrol hanya ke `%M5` dan `%M6`. Marker `%MW110=221`, `%MW111=3001`
  wajib cocok sebelum write kontrol; marker bukan autentikasi atau bukti safety.
- Target `%MW50..52`, posisi encoder dan level `%IW2.0` tetap menggunakan REV3.

Jalankan file hasil edit di **simulator Schneider** terlebih dahulu, kemudian
`Jalankan_Kontrol_Schneider.cmd`. Dalam simulator, input fisik diatur melalui
Schneider, bukan lewat tombol bypass SCADA. Safety, overload, AUTO dan limit
ditampilkan read-only untuk menjelaskan penyebab izin gerak tertahan.
Output asli tidak dikunci OFF seperti proyek SIM ONLY; jangan download ke PLC
fisik sebelum review keselamatan dan commissioning oleh teknisi berwenang.

STOP SCADA adalah kontrol operasional, bukan E-Stop. Hilangnya komunikasi tidak
otomatis mereset izin gerak; perlu rancangan watchdog dan penghentian aman sesuai
mesin sebelum penggunaan produksi. Autentikasi web tidak mengamankan port Modbus
dari klien lain; port tersebut tetap memerlukan isolasi jaringan.

Sumber resmi: [akses I/Q dan M melalui Modbus pada M221](https://www.se.com/ph/en/faqs/FA308725/).
Input fisik I/Q tidak diperlakukan sebagai coil Modbus internal M.

Script edit: `powershell -File tools/edit-rev3-controls.ps1`. Script selalu memakai
backup sebelum edit dan memeriksa semua rung asli selain penambahan kontak STOP.

### Menjalankan sesi target

Stop server monitor sebelumnya, lalu jalankan `npm run control` atau
`Jalankan_Kontrol_Schneider.cmd`. Profil terpisah ini mengizinkan write ke simulator
lokal 127.0.0.1:502 saja. Token acak baru muncul di terminal setiap restart; masukkan
melalui **BUKA SESI KONTROL**, lalu isi target dan tekan SET. Default `npm start`
tetap monitor-only. Token tidak disimpan ke konfigurasi atau audit log.

Write target diverifikasi dengan pembacaan ulang register yang sama. Hal itu
**tidak sama dengan pintu sudah bergerak**. Izin output tetap mengikuti PLC:
`%M5 COMMISSIONING_OK`, safety `%I0.0`, overload sehat `%I0.7..9`, dan hasilnya
`%M0 SYSTEM_ENABLE`. Untuk target otomatis, selector `%I1.24 MODE_AUTO` harus aktif.
Limit dan fault juga tetap membatasi output. SCADA tidak memaksa input fisik
atau `%M0`; kontrol commissioning `%M5` dan STOP `%M6` tersedia pada versi edit.
Dalam simulator Schneider, perubahan output tidak otomatis menggerakkan encoder;
feedback encoder perlu disimulasikan di input Schneider (bukan memalsukan posisi
SCADA). Jangan menerapkan force/commissioning simulator pada PLC fisik.

M221 menggunakan zero-based protocol address: `%M0` = coil offset `0` / referensi `00001`, dan `%MW0` = holding-register offset `0` / referensi `40001`.

| Data | PLC | Referensi | Offset protokol | Akses SCADA |
|---|---:|---:|---:|---|
| Target pintu 1 | `%MW50` | `40051` | `50` | Read/write |
| Target pintu 2 | `%MW51` | `40052` | `51` | Read/write |
| Target pintu 3 | `%MW52` | `40053` | `52` | Read/write |
| Posisi % G1–G3 | `%MF60..64` | `40061..40066` | `60..65` | Read only |
| Posisi mm G1–G3 | `%MF66..70` | `40067..40072` | `66..71` | Read only |
| Level mm / % | `%MF72 / %MF74` | `40073..40076` | `72..75` | Read only |
| Status/fault/request | `%M0..%M215` | `00001..00216` | `0..215` | Read only |

Default REAL adalah `CDAB` (low word pada alamat lebih rendah). Bila angka REAL tidak masuk akal saat commissioning, ubah `floatWordOrder` ke `ABCD`; verifikasi terhadap Animation Table Machine Expert Basic.

## Hardening siber

- Default bind hanya `127.0.0.1`; aplikasi menolak bind LAN tanpa TLS.
- Default `allowWrites=false`.
- Token kontrol minimal 20 karakter, dibandingkan secara constant-time.
- Endpoint target hanya menerima gate 1–3 dan integer 0–100; endpoint kontrol REV3
  hanya BOOL commissioning dan run. Tidak ada tulis alamat arbitrer/input fisik.
- Rate limit per alamat IP, body maksimum 2 KiB, timeout HTTP, CSP, anti-frame, no-sniff, no-cache.
- Semua percobaan kontrol dicatat ke `data/audit.jsonl`.
- Jangan expose port 502 atau dashboard langsung ke internet. Gunakan VLAN OT, firewall allow-list dari IP SCADA ke PLC, VPN untuk akses jarak jauh, TLS reverse proxy, backup program, dan akun Windows non-admin.
- Modbus TCP tidak menyediakan enkripsi atau autentikasi. Keamanan sebenarnya harus dibuat pada segmentasi jaringan dan kontrol akses di luar protokol.
- OPEN/CLOSE kontaktor, E-Stop, overload, limit switch, mechanical stop, dan interlock silang tetap wajib di hardware/PLC. SCADA menulis target, commissioning dan STOP operasional yang dibatasi whitelist.

## Verifikasi

```powershell
npm run check
npm test
```

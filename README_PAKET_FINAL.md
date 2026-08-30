# AWGC 3 Pintu — Paket PLC + SCADA

## Isi paket

### PLC

- `PLC/AWGC_PRODUKSI_TM221CE24R.smbp`
  - Versi produksi.
  - Input dari terminal fisik `%I0/%I1`.
  - Output relay asli `%Q0.0…%Q0.5`.
  - Profil SCADA `%MW110 = 221`, `%MW111 = 3001`.
  - WatchList EcoStruxure: `PRODUKSI_IO_MONITOR`.

- `PLC/AWGC_ALGORITMA_COMMISSIONING.smbp`
  - Versi commissioning/simulator.
  - Input dari SCADA lewat `%M300…%M370`.
  - Output fisik `%Q0.0…%Q0.9` dikunci OFF.
  - `%M0 SYSTEM_ENABLE` dihitung ladder, bukan dipaksa SCADA.
  - Profil SCADA `%MW110 = 221`, `%MW111 = 4001`.
  - WatchList EcoStruxure: `SCADA_COMMISSIONING_INPUTS`.

### SCADA

- `SCADA/Jalankan_SCADA_PRODUKSI.cmd`
  - Untuk project produksi.
  - Tombol input virtual dimatikan.
  - Kontrol hanya target `%MW50…%MW52`, commissioning `%M5`, dan stop `%M6`.

- `SCADA/Jalankan_SCADA_COMMISSIONING.cmd`
  - Untuk project commissioning.
  - Tombol input virtual Safety/OL/AUTO/Limit/Reset/Rotary aktif.
  - Dipakai untuk latihan simulator.

## Alamat penting

- Target gate: `%MW50`, `%MW51`, `%MW52`.
- Rotary raw count: `%MW30`, `%MW31`, `%MW32`.
- Posisi persen: `%MF60`, `%MF62`, `%MF64`.
- Posisi mm: `%MF66`, `%MF68`, `%MF70`.
- Water level: `%MF72` mm, `%MF74` persen.

## Urutan pakai commissioning

1. Buka `PLC/AWGC_ALGORITMA_COMMISSIONING.smbp` di EcoStruxure.
2. Compile/download/RUN simulator.
3. Jalankan `SCADA/Jalankan_SCADA_COMMISSIONING.cmd`.
4. Buka `http://127.0.0.1:3100`.
5. Masukkan token dari terminal SCADA.

## Urutan pakai produksi

1. Buka `PLC/AWGC_PRODUKSI_TM221CE24R.smbp` di EcoStruxure.
2. Download ke PLC/simulator produksi.
3. Jalankan `SCADA/Jalankan_SCADA_PRODUKSI.cmd`.
4. Buka `http://127.0.0.1:3100`.
5. Masukkan token dari terminal SCADA jika perlu write.

Catatan: SCADA selalu bind ke `127.0.0.1` agar tidak terbuka ke jaringan. Untuk akses luar gunakan VPN/reverse proxy TLS terkontrol.

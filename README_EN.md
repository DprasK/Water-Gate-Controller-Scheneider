# AWGC 3 Gates — PLC + SCADA Package

This repository contains a Schneider Modicon M221 PLC package and a Node.js SCADA application for a 3-gate Automatic Water Gate Control system.

## Package contents

### PLC

- `PLC/AWGC_PRODUKSI_TM221CE24R.smbp`
  - Production version.
  - Uses physical terminal inputs `%I0/%I1`.
  - Uses real relay outputs `%Q0.0…%Q0.5`.
  - SCADA profile: `%MW110 = 221`, `%MW111 = 3001`.
  - EcoStruxure WatchList: `PRODUKSI_IO_MONITOR`.

- `PLC/AWGC_ALGORITMA_COMMISSIONING.smbp`
  - Commissioning/simulator version.
  - Uses SCADA virtual inputs through `%M300…%M370`.
  - Physical outputs `%Q0.0…%Q0.9` are forced OFF.
  - `%M0 SYSTEM_ENABLE` is calculated by ladder logic, not forced by SCADA.
  - SCADA profile: `%MW110 = 221`, `%MW111 = 4001`.
  - EcoStruxure WatchList: `SCADA_COMMISSIONING_INPUTS`.

### SCADA

- `SCADA/Jalankan_SCADA_PRODUKSI.cmd`
  - For the production project.
  - Virtual input buttons are disabled.
  - Control is limited to gate targets `%MW50…%MW52`, commissioning `%M5`, and stop `%M6`.

- `SCADA/Jalankan_SCADA_COMMISSIONING.cmd`
  - For the commissioning project.
  - Virtual input buttons for Safety, OL, AUTO, Limit, Reset, and Rotary are enabled.
  - Used for simulator training and commissioning tests.

## Important addresses

- Gate target: `%MW50`, `%MW51`, `%MW52`.
- Rotary raw count: `%MW30`, `%MW31`, `%MW32`.
- Position percent: `%MF60`, `%MF62`, `%MF64`.
- Position mm: `%MF66`, `%MF68`, `%MF70`.
- Water level: `%MF72` mm, `%MF74` percent.

## Commissioning startup sequence

1. Open `PLC/AWGC_ALGORITMA_COMMISSIONING.smbp` in EcoStruxure.
2. Compile/download/RUN the simulator.
3. Run `SCADA/Jalankan_SCADA_COMMISSIONING.cmd`.
4. Open `http://127.0.0.1:3100`.
5. Enter the token shown in the SCADA terminal.

## Production startup sequence

1. Open `PLC/AWGC_PRODUKSI_TM221CE24R.smbp` in EcoStruxure.
2. Download it to the PLC or production simulator.
3. Run `SCADA/Jalankan_SCADA_PRODUKSI.cmd`.
4. Open `http://127.0.0.1:3100`.
5. Enter the token from the SCADA terminal if write access is required.

Note: SCADA always binds to `127.0.0.1` so it is not exposed to the network. For external access, use a controlled VPN or TLS reverse proxy.

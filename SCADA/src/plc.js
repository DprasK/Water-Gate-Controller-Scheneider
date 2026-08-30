import { ModbusTcpClient } from './modbus-client.js';
import { decodeSnapshot, MODBUS_READ_PLAN, targetRegister } from './tag-model.js';
import { decodeSimInputs, getSimInput, hasSimProfile } from './sim-inputs.js';
import { decodeRev3Controls, hasRev3Profile, rev3ProfileFor, REV3_CONTROLS } from './rev3-controls.js';

export class M221Plc {
  constructor(config) {
    this.config = config;
    this.rev3Profile = rev3ProfileFor(config);
    this.client = new ModbusTcpClient(config);
  }

  async readStatus() {
    const p = MODBUS_READ_PLAN;
    // Sequential reads also work with servers that permit one request in flight.
    const words = await this.client.readHoldingRegisters(p.holdingStart, p.holdingQuantity);
    const coils = await this.client.readCoils(p.coilStart, p.coilQuantity);
    return { ...decodeSnapshot(words, coils, this.config.floatWordOrder), simInputs: decodeSimInputs(words, coils), rev3: decodeRev3Controls(words, coils, this.rev3Profile) };
  }

  async setTarget(gateId, percent) {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new RangeError('Target harus integer 0–100');
    const address = targetRegister(gateId);
    await this.client.writeSingleRegister(address, percent);
    const [readback] = await this.client.readHoldingRegisters(address, 1);
    if (readback !== percent) throw new Error(`Write di-ACK tetapi baca-balik %MW${address}=${readback}, bukan ${percent}. Periksa apakah program PLC menimpa target.`);
    return readback;
  }

  close() { this.client.close(); }

  async setRev3Control(name, value, confirmed = false) {
    if (!Object.hasOwn(REV3_CONTROLS, name) || typeof value !== 'boolean') throw new Error('Kontrol REV3 tidak diizinkan');
    if (name === 'commissioning' && value && confirmed !== true) throw new Error('Konfirmasi pengujian wiring dan proteksi diperlukan');
    const marker = await this.client.readHoldingRegisters(110, 2);
    const words = []; words[110] = marker[0]; words[111] = marker[1];
    if (!hasRev3Profile(words, this.rev3Profile)) throw new Error(`Pemetaan proyek aktif tidak cocok (${marker.join('/')}; perlu ${this.rev3Profile.join('/')}). Kontrol tidak ditulis.`);
    if (name === 'run' && value) {
      const coils = await this.client.readCoils(0, 366);
      if (![5,300,307,308,309].every(address => coils[address])) throw new Error('ENABLE ditolak: commissioning, Safety dan OL G1/G2/G3 harus OK dari PLC.');
    }
    const tag = REV3_CONTROLS[name];
    const raw = tag.inverted ? !value : value;
    await this.client.writeCoil(tag.address, raw);
    const [actual] = await this.client.readCoils(tag.address, 1);
    if (actual !== raw) throw new Error('Kontrol belum cocok saat dibaca balik');
  }

  async assertSimProfile() {
    if (this.config.host !== '127.0.0.1' || this.config.port !== 502) throw new Error('Input simulasi hanya untuk endpoint localhost Schneider');
    const marker = await this.client.readHoldingRegisters(110, 2);
    const words = []; words[110] = marker[0]; words[111] = marker[1];
    if (!hasSimProfile(words)) throw new Error('Buka dan RUN AWGC_SIM_INPUTS_ONLY.smbp di simulator Schneider. Input tidak ditulis ke REV3.');
  }

  async setSimInput(name, value) {
    const tag = getSimInput(name);
    if (typeof value !== 'boolean') throw new Error('Input harus BOOL');
    await this.assertSimProfile();
    await this.client.writeCoil(tag.address, value);
    const [actual] = await this.client.readCoils(tag.address, 1);
    if (actual !== value) throw new Error('Input belum cocok saat dibaca balik');
  }

  async setSimEncoder(gateId, count) {
    if (![1,2,3].includes(gateId) || !Number.isInteger(count) || count < 0 || count > 255) throw new Error('Encoder: pintu 1–3 dan count 0–255');
    await this.assertSimProfile();
    const gray = count ^ (count >> 1);
    const bits = Array.from({length:8}, (_, bit) => Boolean(gray & (1 << bit)));
    const address = 320 + (gateId - 1)*8;
    await this.client.writeCoils(address, bits);
    const actual = await this.client.readCoils(address, 8);
    if (actual.some((value,i) => value !== bits[i])) throw new Error('Encoder belum cocok saat dibaca balik');
  }
}

export class PlcSimulator {
  constructor() {
    this.targets = [25, 50, 75];
    this.positions = [0, 0, 0];
    this.lastScan = Date.now();
  }

  async readStatus() {
    const now = Date.now();
    const dt = Math.min((now - this.lastScan) / 1000, 1);
    this.lastScan = now;
    this.positions = this.positions.map((position, index) => {
      const error = this.targets[index] - position;
      return Math.abs(error) < 0.05 ? this.targets[index] : position + Math.sign(error) * Math.min(Math.abs(error), 12 * dt);
    });
    const levelPct = 54 + Math.sin(now / 12000) * 18;
    return {
      system: { enabled: true, commissioningOk: true, waterFault: false },
      water: { levelMm: levelPct * 50, levelPct, rangeMm: 5000 },
      gates: this.positions.map((positionPct, index) => ({
        id: index + 1, fault: false, reverse: false, maxHeightMm: 1000,
        targetPct: this.targets[index], positionPct, positionMm: positionPct * 10,
        autoOpenRequest: positionPct < this.targets[index] - 1,
        autoCloseRequest: positionPct > this.targets[index] + 1,
        panelOpenRequest: false, panelCloseRequest: false
      }))
    };
  }

  async setTarget(gateId, percent) { this.targets[gateId - 1] = percent; }
  close() {}
}

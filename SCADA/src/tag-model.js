export const IEC_TAGS = Object.freeze({
  systemEnable: { iecType: 'BOOL', plc: '%M0', modbus: '00001', access: 'R' },
  waterFault: { iecType: 'BOOL', plc: '%M1', modbus: '00002', access: 'R' },
  gate1Fault: { iecType: 'BOOL', plc: '%M2', modbus: '00003', access: 'R' },
  gate2Fault: { iecType: 'BOOL', plc: '%M3', modbus: '00004', access: 'R' },
  gate3Fault: { iecType: 'BOOL', plc: '%M4', modbus: '00005', access: 'R' },
  commissioningOk: { iecType: 'BOOL', plc: '%M5', modbus: '00006', access: 'RW (profil REV3 3001 + konfirmasi)' },
  scadaStop: { iecType: 'BOOL', plc: '%M6', modbus: '00007', access: 'RW (profil REV3 3001, 1=STOP)' },
  waterRangeMm: { iecType: 'UINT', plc: '%MW1', modbus: '40002', access: 'R' },
  maxHeightG1Mm: { iecType: 'UINT', plc: '%MW10', modbus: '40011', access: 'R' },
  maxHeightG2Mm: { iecType: 'UINT', plc: '%MW11', modbus: '40012', access: 'R' },
  maxHeightG3Mm: { iecType: 'UINT', plc: '%MW12', modbus: '40013', access: 'R' },
  encoderMinG1: { iecType: 'UINT', plc: '%MW20', modbus: '40021', access: 'R' },
  encoderMaxG1: { iecType: 'UINT', plc: '%MW21', modbus: '40022', access: 'R' },
  encoderMinG2: { iecType: 'UINT', plc: '%MW22', modbus: '40023', access: 'R' },
  encoderMaxG2: { iecType: 'UINT', plc: '%MW23', modbus: '40024', access: 'R' },
  encoderMinG3: { iecType: 'UINT', plc: '%MW24', modbus: '40025', access: 'R' },
  encoderMaxG3: { iecType: 'UINT', plc: '%MW25', modbus: '40026', access: 'R' },
  encoderCountG1: { iecType: 'UINT', plc: '%MW30', modbus: '40031', access: 'R', source: '%I1.0…%I1.7 Omron E6CP Gray' },
  encoderCountG2: { iecType: 'UINT', plc: '%MW31', modbus: '40032', access: 'R', source: '%I1.8…%I1.15 Omron E6CP Gray' },
  encoderCountG3: { iecType: 'UINT', plc: '%MW32', modbus: '40033', access: 'R', source: '%I1.16…%I1.23 Omron E6CP Gray' },
  targetG1Pct: { iecType: 'UINT', plc: '%MW50', modbus: '40051', access: 'RW', min: 0, max: 100 },
  targetG2Pct: { iecType: 'UINT', plc: '%MW51', modbus: '40052', access: 'RW', min: 0, max: 100 },
  targetG3Pct: { iecType: 'UINT', plc: '%MW52', modbus: '40053', access: 'RW', min: 0, max: 100 },
  positionG1Pct: { iecType: 'REAL', plc: '%MF60', modbus: '40061-40062', access: 'R' },
  positionG2Pct: { iecType: 'REAL', plc: '%MF62', modbus: '40063-40064', access: 'R' },
  positionG3Pct: { iecType: 'REAL', plc: '%MF64', modbus: '40065-40066', access: 'R' },
  positionG1Mm: { iecType: 'REAL', plc: '%MF66', modbus: '40067-40068', access: 'R' },
  positionG2Mm: { iecType: 'REAL', plc: '%MF68', modbus: '40069-40070', access: 'R' },
  positionG3Mm: { iecType: 'REAL', plc: '%MF70', modbus: '40071-40072', access: 'R' },
  waterLevelMm: { iecType: 'REAL', plc: '%MF72', modbus: '40073-40074', access: 'R' },
  waterLevelPct: { iecType: 'REAL', plc: '%MF74', modbus: '40075-40076', access: 'R' }
});

const b = (coils, address) => Boolean(coils[address]);
const w = (words, address) => Number(words[address] ?? 0);
const finite = (value) => Number.isFinite(value) ? value : null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function decodeFloat(words, address, order = 'CDAB') {
  const first = w(words, address);
  const second = w(words, address + 1);
  const buffer = Buffer.allocUnsafe(4);
  if (order === 'CDAB') {
    buffer.writeUInt16BE(second, 0);
    buffer.writeUInt16BE(first, 2);
  } else {
    buffer.writeUInt16BE(first, 0);
    buffer.writeUInt16BE(second, 2);
  }
  return finite(buffer.readFloatBE(0));
}

export function decodeSnapshot(words, coils, order = 'CDAB') {
  const pct = (address) => {
    const value = decodeFloat(words, address, order);
    return value === null ? null : clamp(value, 0, 100);
  };
  const real = (address) => decodeFloat(words, address, order);
  return {
    system: {
      enabled: b(coils, 0), commissioningOk: b(coils, 5), waterFault: b(coils, 1)
    },
    water: {
      levelMm: real(72), levelPct: pct(74), rangeMm: w(words, 1)
    },
    gates: [1, 2, 3].map((id) => ({
      id,
      fault: b(coils, id + 1),
      reverse: b(coils, id + 9),
      maxHeightMm: w(words, 9 + id),
      encoderMinCount: w(words, 18 + (id * 2)),
      encoderMaxCount: w(words, 19 + (id * 2)),
      encoderCount: w(words, 29 + id),
      encoderInputBits: `%I1.${(id - 1) * 8}…%I1.${(id * 8) - 1}`,
      encoderWord: `%MW${29 + id}`,
      targetPct: w(words, 49 + id),
      positionPct: pct(58 + (id * 2)),
      positionMm: real(64 + (id * 2)),
      autoOpenRequest: b(coils, 198 + (id * 2)),
      autoCloseRequest: b(coils, 199 + (id * 2)),
      panelOpenRequest: b(coils, 208 + (id * 2)),
      panelCloseRequest: b(coils, 209 + (id * 2))
    }))
  };
}

export const MODBUS_READ_PLAN = Object.freeze({
  holdingStart: 0,
  holdingQuantity: 112,
  coilStart: 0,
  coilQuantity: 371
});

export function targetRegister(gateId) {
  if (![1, 2, 3].includes(gateId)) throw new RangeError('gateId harus 1, 2, atau 3');
  return 49 + gateId;
}

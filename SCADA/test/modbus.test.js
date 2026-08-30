import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { ModbusTcpClient } from '../src/modbus-client.js';
import { decodeFloat, decodeSnapshot, targetRegister } from '../src/tag-model.js';

function frame(tx, unit, pdu) {
  const out = Buffer.alloc(7 + pdu.length);
  out.writeUInt16BE(tx, 0); out.writeUInt16BE(0, 2); out.writeUInt16BE(pdu.length + 1, 4); out[6] = unit; pdu.copy(out, 7);
  return out;
}

test('Modbus tanpa IP tidak menggunakan data simulasi atau menghubungi host default', async () => {
  const client = new ModbusTcpClient({ host: '' });
  await assert.rejects(client.readHoldingRegisters(72, 4), /IP PLC belum diatur/);
  assert.equal(client.socket, null);
});

test('driver membaca FC03/FC01 dan menulis hanya FC06 yang diminta', async (t) => {
  const words = Array.from({ length: 100 }, (_, i) => i + 1000);
  const coils = Array.from({ length: 220 }, (_, i) => i % 3 === 0);
  let write = null;
  const server = net.createServer((socket) => socket.on('data', (request) => {
    const tx = request.readUInt16BE(0); const unit = request[6]; const fc = request[7];
    const start = request.readUInt16BE(8); const qty = request.readUInt16BE(10);
    if (fc === 3) {
      const pdu = Buffer.alloc(2 + qty * 2); pdu[0] = 3; pdu[1] = qty * 2;
      for (let i = 0; i < qty; i++) pdu.writeUInt16BE(words[start + i], 2 + i * 2);
      socket.write(frame(tx, unit, pdu));
    } else if (fc === 1) {
      const byteCount = Math.ceil(qty / 8); const pdu = Buffer.alloc(2 + byteCount); pdu[0] = 1; pdu[1] = byteCount;
      for (let i = 0; i < qty; i++) if (coils[start + i]) pdu[2 + Math.floor(i / 8)] |= 1 << (i % 8);
      socket.write(frame(tx, unit, pdu));
    } else if (fc === 6) {
      write = { address: start, value: qty }; socket.write(frame(tx, unit, request.subarray(7, 12)));
    }
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const client = new ModbusTcpClient({ host: '127.0.0.1', port: server.address().port, unitId: 1, timeoutMs: 500 });
  t.after(() => client.close());
  assert.deepEqual(await client.readHoldingRegisters(10, 3), [1010, 1011, 1012]);
  assert.deepEqual(await client.readCoils(0, 10), coils.slice(0, 10));
  await client.writeSingleRegister(50, 77);
  assert.deepEqual(write, { address: 50, value: 77 });
});

test('decoder REAL mendukung word order Schneider CDAB', () => {
  const bytes = Buffer.alloc(4); bytes.writeFloatBE(12.5);
  const high = bytes.readUInt16BE(0); const low = bytes.readUInt16BE(2);
  const words = []; words[60] = low; words[61] = high;
  assert.equal(decodeFloat(words, 60, 'CDAB'), 12.5);
});

test('FC05 encodes BOOL ON/OFF and validates PLC echo', async (t) => {
  const seen = [];
  let badEcho = false;
  const server = net.createServer(socket => socket.on('data', request => {
    seen.push([request[7],request.readUInt16BE(8),request.readUInt16BE(10)]);
    const pdu = Buffer.from(request.subarray(7,12));
    if (badEcho) pdu.writeUInt16BE(99,1);
    socket.write(frame(request.readUInt16BE(0),request[6],pdu));
  }));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => server.close());
  const client = new ModbusTcpClient({host:'127.0.0.1',port:server.address().port,unitId:1,timeoutMs:500});
  t.after(() => client.close());
  await client.writeCoil(6,true); await client.writeCoil(6,false);
  assert.deepEqual(seen,[[5,6,0xff00],[5,6,0]]);
  badEcho=true;
  await assert.rejects(client.writeCoil(6,true));
  await assert.rejects(client.writeCoil(6,1));
});

test('snapshot mengikuti alamat PLC REV3 dan whitelist target', () => {
  const words = Array(76).fill(0); const coils = Array(216).fill(false);
  words[1] = 5000; words[10] = 1000; words[11] = 1100; words[12] = 1200; words[50] = 25; words[51] = 50; words[52] = 75;
  coils[0] = true; coils[5] = true; coils[200] = true;
  const data = decodeSnapshot(words, coils, 'CDAB');
  assert.equal(data.system.enabled, true);
  assert.deepEqual(data.gates.map((g) => g.targetPct), [25, 50, 75]);
  assert.equal(data.gates[0].autoOpenRequest, true);
  assert.equal(targetRegister(1), 50); assert.equal(targetRegister(3), 52);
  assert.throws(() => targetRegister(4));
});

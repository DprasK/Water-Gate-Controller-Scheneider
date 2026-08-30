import assert from 'node:assert/strict';
import test from 'node:test';
import { M221Plc } from '../src/plc.js';

test('target write is verified using matching holding register', async () => {
  const plc = new M221Plc({host:'127.0.0.1'});
  const calls = [];
  plc.client = {
    async writeSingleRegister(address, value) { calls.push(['write', address, value]); },
    async readHoldingRegisters(address, quantity) { calls.push(['read', address, quantity]); return [33]; }
  };
  assert.equal(await plc.setTarget(2, 33), 33);
  assert.deepEqual(calls, [['write',51,33],['read',51,1]]);
  await assert.rejects(plc.setTarget(2, 101), /Target/);
  await assert.rejects(plc.setTarget(4, 33), /gateId/);
});

test('overwritten target is not reported as a successful command', async () => {
  const plc = new M221Plc({host:'127.0.0.1'});
  plc.client = {
    async writeSingleRegister() {},
    async readHoldingRegisters() { return [0]; }
  };
  await assert.rejects(plc.setTarget(1, 50), /baca-balik/);
});

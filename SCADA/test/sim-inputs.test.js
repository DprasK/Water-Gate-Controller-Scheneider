import test from 'node:test';
import assert from 'node:assert/strict';
import { M221Plc } from '../src/plc.js';
import { decodeSimInputs, getSimInput } from '../src/sim-inputs.js';

test('simulator input guard never writes to original project or nonlocal endpoint', async () => {
  for (const host of ['127.0.0.1','192.168.0.10']) {
    const plc = new M221Plc({host,port:502});
    let writes = 0;
    plc.client = {async readHoldingRegisters(){return [0,0]}, async writeCoil(){writes++}};
    await assert.rejects(plc.setSimInput('safety',true));
    assert.equal(writes,0);
  }
  assert.throws(() => getSimInput('systemEnable'));
  assert.throws(() => getSimInput('__proto__'));
});

test('sim input writes and verifies only whitelisted coil', async () => {
  const plc = new M221Plc({host:'127.0.0.1',port:502});
  const calls = [];
  plc.client = {
    async readHoldingRegisters(){return [221,4001]},
    async writeCoil(address,value){calls.push([address,value])},
    async readCoils(){return [true]}
  };
  await plc.setSimInput('safety',true);
  assert.deepEqual(calls,[[300,true]]);
  await assert.rejects(plc.setSimInput('safety',1));
});

test('encoder is sent as Gray input bits, never as fake position REAL', async () => {
  const plc = new M221Plc({host:'127.0.0.1',port:502});
  let written;
  plc.client = {
    async readHoldingRegisters(){return [221,4001]},
    async writeCoils(address,bits){written={address,bits}},
    async readCoils(){return written.bits}
  };
  await plc.setSimEncoder(2,128);
  assert.equal(written.address,328);
  assert.deepEqual(written.bits,[false,false,false,false,false,false,true,true]);
});

test('decode simulator inputs requires exact profile marker', () => {
  const words = Array(112).fill(0); const coils = Array(371).fill(false);
  assert.equal(decodeSimInputs(words,coils).compatible,false);
  words[110]=221; words[111]=4001; coils[300]=true; coils[370]=true; coils[360]=true;
  const data=decodeSimInputs(words,coils);
  assert.equal(data.values.safety,true); assert.equal(data.values.run,true); assert.equal(data.outputs[0].open,true);
});

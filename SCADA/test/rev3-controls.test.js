import test from 'node:test';
import assert from 'node:assert/strict';
import { M221Plc } from '../src/plc.js';
import { decodeRev3Controls, rev3ProfileFor, hasRev3Profile } from '../src/rev3-controls.js';

function fixture(marker = [221,3001], settings = {}) {
  const plc = new M221Plc({host:'127.0.0.1',port:502,...settings});
  const coils = Array(371).fill(false), writes = [];
  plc.client = {
    async readHoldingRegisters(){return marker},
    async readCoils(start,length){return coils.slice(start,start+length)},
    async writeCoil(address,value){writes.push([address,value]); coils[address]=value}
  };
  return {plc,coils,writes};
}
test('REV3 guards reject wrong project, physical inputs, M0 and missing commissioning confirmation', async () => {
  for (const marker of [[0,0],[221,4001]]) {
    const {plc,writes} = fixture(marker);
    await assert.rejects(plc.setRev3Control('run',false)); assert.equal(writes.length,0);
  }
  const {plc,writes} = fixture();
  for (const name of ['safety','auto','encoder','systemEnable','__proto__']) await assert.rejects(plc.setRev3Control(name,true));
  await assert.rejects(plc.setRev3Control('commissioning',true));
  await assert.rejects(plc.setRev3Control('run',1));
  assert.equal(writes.length,0);
});

test('current BEFORE_SIM_INPUTS marker is explicit, exact and localhost-only', async () => {
  const words = Array(112).fill(0); words[110]=221;
  assert.equal(hasRev3Profile(words),false);
  const profile = rev3ProfileFor({host:'127.0.0.1',port:502,unitId:1,rev3ProfileVersion:0});
  assert.equal(hasRev3Profile(words,profile),true);
  assert.equal(decodeRev3Controls(words,Array(371).fill(false),profile).compatible,true);
  words[111]=4001; assert.equal(hasRev3Profile(words,profile),false);
  for (const settings of [
    {host:'192.168.1.10',port:502,rev3ProfileVersion:0},
    {host:'localhost',port:502,rev3ProfileVersion:0},
    {host:'127.0.0.1',port:1502,rev3ProfileVersion:0},
    {host:'127.0.0.1',port:502,unitId:2,rev3ProfileVersion:0},
    {host:'127.0.0.1',port:502,rev3ProfileVersion:4001}
  ]) assert.throws(()=>rev3ProfileFor(settings));
  const {plc,writes}=fixture([221,0],{rev3ProfileVersion:0});
  await plc.setRev3Control('run',false);
  assert.deepEqual(writes,[[6,true]]);
  const wrong=fixture([221,4001],{rev3ProfileVersion:0});
  await assert.rejects(wrong.plc.setRev3Control('run',false)); assert.equal(wrong.writes.length,0);
});
test('ENABLE requires all original safety conditions; STOP is inverted and always permitted for matching profile', async () => {
  for (const missing of [5,300,307,308,309]) {
    const {plc,coils,writes} = fixture();
    [5,300,307,308,309].forEach(bit => { coils[bit]=true }); coils[missing]=false;
    await assert.rejects(plc.setRev3Control('run',true)); assert.equal(writes.length,0);
    await plc.setRev3Control('run',false); assert.deepEqual(writes,[[6,true]]);
  }
  const {plc,coils,writes} = fixture();
  [300,307,308,309].forEach(bit => { coils[bit]=true });
  await plc.setRev3Control('commissioning',true,true);
  await plc.setRev3Control('run',true);
  assert.deepEqual(writes,[[5,true],[6,false]]);
});
test('REV3 status distinguishes missing profile, STOP, physical blockers and actual output mirrors', () => {
  const words = Array(112).fill(0), coils = Array(371).fill(false);
  assert.equal(decodeRev3Controls(words,coils).compatible,false);
  words[110]=221; words[111]=3001; coils[6]=true;
  assert.equal(decodeRev3Controls(words,coils).blockers.length,6);
  [5,300,307,308,309,360].forEach(bit => { coils[bit]=true }); coils[6]=false;
  const data=decodeRev3Controls(words,coils);
  assert.equal(data.blockers.length,0); assert.equal(data.values.run,true); assert.equal(data.outputs[0].open,true);
});

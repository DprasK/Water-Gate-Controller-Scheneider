import test from 'node:test';
import assert from 'node:assert/strict';
import { simulationAccessAllowed } from '../src/simulation-access.js';
import { PlcSimulator } from '../src/plc.js';

const request = { mode: 'simulation', listenHost: '127.0.0.1', remoteAddress: '127.0.0.1', host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100', marker: 'local-only' };
test('local simulator control enabled only for same-origin marked requests', () => {
  assert.equal(simulationAccessAllowed(request), true);
  for (const changed of [
    { mode: 'modbus-tcp' }, { listenHost: '0.0.0.0' }, { remoteAddress: '192.168.0.3' },
    { origin: 'https://foreign.example' }, { origin: undefined }, { marker: undefined },
    { host: 'foreign.example:3100', origin: 'http://foreign.example:3100' }
  ]) assert.equal(simulationAccessAllowed({ ...request, ...changed }), false);
});

test('simulated setpoint moves only the selected in-memory gate', async () => {
  const plc = new PlcSimulator();
  await plc.setTarget(1, 90);
  plc.lastScan -= 1000;
  const status = await plc.readStatus();
  assert.equal(status.gates[0].targetPct, 90);
  assert.ok(status.gates[0].positionPct > 0);
  assert.equal(status.gates[1].targetPct, 50);
});

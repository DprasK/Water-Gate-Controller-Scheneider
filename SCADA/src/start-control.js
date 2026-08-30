import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

// Separate, explicit control profile. The normal default remains read-only.
const profile = fileURLToPath(new URL('../config/schneider-control.json', import.meta.url));
const settings = JSON.parse(fs.readFileSync(profile, 'utf8'));
if (settings.listen.host !== '127.0.0.1' || settings.plc.host !== '127.0.0.1' ||
    settings.plc.port !== 502 || settings.plc.mode !== 'modbus-tcp') {
  throw new Error('Launcher kontrol ini hanya untuk simulator lokal 127.0.0.1:502.');
}
if (process.argv.includes('--simulate')) throw new Error('Launcher ini memakai Modbus, bukan simulator JavaScript.');
process.env.SCADA_CONFIG = profile;
process.env.SCADA_PLC_HOST = '127.0.0.1';
process.env.SCADA_WRITE_TOKEN = crypto.randomBytes(16).toString('hex');
console.log('CONTROL TOKEN (berubah setiap restart; jangan bagikan):');
console.log(process.env.SCADA_WRITE_TOKEN);
await import('./server.js');

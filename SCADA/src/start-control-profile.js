import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv[2] || 'config/commissioning-control.json';
const profile = path.isAbsolute(requested) ? requested : path.resolve(projectRoot, requested);
const settings = JSON.parse(fs.readFileSync(profile, 'utf8'));

if (settings.listen.host !== '127.0.0.1') {
  throw new Error('Launcher kontrol lokal harus bind ke 127.0.0.1.');
}
if (settings.plc.mode !== 'modbus-tcp' || settings.plc.port !== 502) {
  throw new Error('Launcher kontrol ini memakai Modbus TCP port 502.');
}
if (process.argv.includes('--simulate')) throw new Error('Launcher ini memakai Modbus, bukan simulator JavaScript.');

process.env.SCADA_CONFIG = profile;
process.env.SCADA_PLC_HOST = process.env.SCADA_PLC_HOST || settings.plc.host || '127.0.0.1';
process.env.SCADA_WRITE_TOKEN = crypto.randomBytes(16).toString('hex');

console.log(`CONTROL PROFILE: ${path.basename(profile)}`);
console.log('CONTROL TOKEN (berubah setiap restart; jangan bagikan):');
console.log(process.env.SCADA_WRITE_TOKEN);

await import('./server.js');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.env.SCADA_CONFIG || path.join(projectRoot, 'config', 'default.json');
const configPath = path.isAbsolute(requested) ? requested : path.resolve(projectRoot, requested);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (process.argv.includes('--simulate')) config.plc.mode = 'simulation';
if (process.env.SCADA_PLC_HOST) config.plc.host = process.env.SCADA_PLC_HOST.trim();
if (!['simulation', 'modbus-tcp'].includes(config.plc.mode)) throw new Error('plc.mode harus simulation atau modbus-tcp');
if (!['ABCD', 'CDAB'].includes(config.plc.floatWordOrder)) throw new Error('floatWordOrder harus ABCD atau CDAB');
if (!Number.isInteger(config.plc.port) || config.plc.port < 1 || config.plc.port > 65535) throw new Error('Port PLC tidak valid');
if (!Number.isInteger(config.listen.port) || config.listen.port < 1 || config.listen.port > 65535) throw new Error('Port SCADA tidak valid');
if (config.security.allowWrites) {
  const token = process.env.SCADA_WRITE_TOKEN || '';
  if (token.length < 20) throw new Error('SCADA_WRITE_TOKEN minimal 20 karakter saat allowWrites=true');
}

config.projectRoot = projectRoot;
config.configPath = configPath;
config.security.auditFile = path.resolve(projectRoot, config.security.auditFile);
for (const key of ['tlsCertFile', 'tlsKeyFile']) {
  if (config.listen[key]) config.listen[key] = path.resolve(projectRoot, config.listen[key]);
}

export default Object.freeze(config);

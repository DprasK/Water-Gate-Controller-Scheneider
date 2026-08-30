import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import config from './config.js';
import { IEC_TAGS } from './tag-model.js';
import { M221Plc, PlcSimulator } from './plc.js';
import { simulationAccessAllowed } from './simulation-access.js';
import { REV3_CONTROLS, REV3_INPUTS } from './rev3-controls.js';
import { SIM_INPUTS } from './sim-inputs.js';

const isSimulation = config.plc.mode === 'simulation';
const plc = isSimulation ? new PlcSimulator() : new M221Plc(config.plc);
const publicRoot = path.join(config.projectRoot, 'public');
const writeToken = process.env.SCADA_WRITE_TOKEN || '';
const usesTls = Boolean(config.listen.tlsCertFile && config.listen.tlsKeyFile);
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
if (!loopbackHosts.has(config.listen.host) && !usesTls) {
  throw new Error('Bind jaringan non-loopback ditolak tanpa TLS. Gunakan reverse proxy TLS/VPN atau isi tlsCertFile dan tlsKeyFile.');
}

let state = {
  connected: isSimulation,
  mode: config.plc.mode,
  writeEnabled: Boolean(config.security.allowWrites),
  simulationControlEnabled: isSimulation && loopbackHosts.has(config.listen.host),
  rev3ControlEnabled: config.security.allowRev3Controls === true && !isSimulation,
  rev3ControlMeta: REV3_CONTROLS,
  rev3InputMeta: REV3_INPUTS,
  simulatorInputPanelEnabled: config.security.allowSimulatorInputs === true && !isSimulation && config.plc.host === '127.0.0.1' && config.plc.port === 502,
  simulatorInputMeta: SIM_INPUTS,
  source: { mode: config.plc.mode, host: isSimulation ? null : (config.plc.host || null),
    port: config.plc.port, unitId: config.plc.unitId },
  timestamp: null,
  latencyMs: null,
  error: null,
  data: null,
  alarms: [{ code: 'NO_DATA', severity: 'warning', message: 'Menunggu data PLC' }]
};
let polling = false;
const writeBuckets = new Map();

await fsp.mkdir(path.dirname(config.security.auditFile), { recursive: true });

async function poll() {
  if (polling) return;
  polling = true;
  const started = performance.now();
  try {
    const data = await plc.readStatus();
    state = {
      ...state, connected: true, timestamp: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started), error: null, data,
      alarms: buildAlarms(data)
    };
  } catch (error) {
    state = {
      ...state, connected: false, data: null, timestamp: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started), error: safeError(error),
      alarms: [{ code: 'PLC_OFFLINE', severity: 'critical', message: 'Komunikasi PLC terputus' }]
    };
  } finally { polling = false; }
}

function buildAlarms(data) {
  const alarms = [];
  if (!data.system.enabled) alarms.push({ code: 'SYSTEM_DISABLED', severity: 'warning', message: 'SYSTEM_ENABLE tidak aktif' });
  if (!data.system.commissioningOk) alarms.push({ code: 'COMMISSIONING', severity: 'critical', message: 'Commissioning PLC belum OK' });
  if (data.system.waterFault) alarms.push({ code: 'WATER_SENSOR', severity: 'critical', message: 'Fault sensor level 4–20 mA' });
  for (const gate of data.gates) if (gate.fault) alarms.push({ code: `GATE_${gate.id}`, severity: 'critical', message: `Fault pintu ${gate.id}` });
  return alarms;
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  if (usesTls) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function json(res, status, body) {
  securityHeaders(res);
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function safeEqual(candidate, expected) {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function clientIp(req) { return req.socket.remoteAddress || 'unknown'; }

function rateAllowed(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = writeBuckets.get(ip) || { since: now, count: 0 };
  if (now - bucket.since >= windowMs) { bucket.since = now; bucket.count = 0; }
  bucket.count += 1;
  writeBuckets.set(ip, bucket);
  return bucket.count <= config.security.writeRatePerMinute;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2048) throw new Error('Payload terlalu besar');
    chunks.push(chunk);
  }
  const contentType = String(req.headers['content-type'] || '').split(';')[0];
  if (contentType !== 'application/json') throw new Error('Content-Type harus application/json');
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function audit(req, event, details, ok) {
  const record = { time: new Date().toISOString(), ip: clientIp(req), event, details, ok };
  await fsp.appendFile(config.security.auditFile, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function handleWrite(req, res, gateId) {
  const ip = clientIp(req);
  if (!config.security.allowWrites) return json(res, 403, { ok: false, error: 'Kontrol SCADA dinonaktifkan pada konfigurasi' });
  if (!rateAllowed(ip)) return json(res, 429, { ok: false, error: 'Terlalu banyak perintah; coba lagi nanti' });
  const auth = String(req.headers.authorization || '');
  const candidate = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!safeEqual(candidate, writeToken)) {
    await audit(req, 'AUTH_DENIED', { gateId }, false);
    return json(res, 401, { ok: false, error: 'Token kontrol tidak valid' });
  }
  try {
    const body = await readJson(req);
    if (!Number.isInteger(body?.targetPct) || body.targetPct < 0 || body.targetPct > 100) throw new Error('targetPct harus bilangan bulat 0–100');
    // An audit failure prevents the command, instead of silently losing the record.
    await audit(req, 'SET_TARGET_REQUEST', { gateId, targetPct: body.targetPct }, true);
    await plc.setTarget(gateId, body.targetPct);
    await audit(req, 'SET_TARGET', { gateId, targetPct: body.targetPct, register: `%MW${49 + gateId}` }, true);
    await poll();
    return json(res, 200, { ok: true, gateId, targetPct: body.targetPct,
      verified: !isSimulation,
      motionInhibited: !state.data?.system.enabled || !state.data?.system.commissioningOk });
  } catch (error) {
    await audit(req, 'SET_TARGET', { gateId, error: safeError(error) }, false);
    return json(res, 400, { ok: false, error: safeError(error) });
  }
}

async function handler(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { ...state, appName: config.appName });
  if (req.method === 'GET' && url.pathname === '/api/tags') return json(res, 200, IEC_TAGS);
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, state.connected ? 200 : 503, { ok: state.connected, mode: state.mode });
  if (req.method === 'POST' && url.pathname === '/api/schneider-inputs') {
    if (!state.simulatorInputPanelEnabled || !config.security.allowWrites) return json(res,403,{ok:false,error:'Input simulator tidak diaktifkan'});
    if (!rateAllowed(clientIp(req))) return json(res,429,{ok:false,error:'Batas perintah tercapai'});
    const auth = String(req.headers.authorization || '');
    if (!safeEqual(auth.startsWith('Bearer ') ? auth.slice(7) : '',writeToken)) {
      await audit(req,'SIM_INPUT_AUTH_DENIED',{},false);
      return json(res,401,{ok:false,error:'Token kontrol tidak valid'});
    }
    try {
      const body = await readJson(req);
      if (!body || typeof body !== 'object') throw new Error('Payload tidak valid');
      if (body.kind === 'encoder') {
        if (![1,2,3].includes(body.gateId) || !Number.isInteger(body.count) || body.count<0 || body.count>255) throw new Error('Encoder harus integer 0–255');
        await audit(req,'SIM_ENCODER_REQUEST',{gateId:body.gateId,count:body.count},true);
        await plc.setSimEncoder(body.gateId,body.count);
      } else {
        if (!Object.hasOwn(SIM_INPUTS,body.name) || typeof body.value !== 'boolean') throw new Error('Input tidak diizinkan');
        await audit(req,'SIM_INPUT_REQUEST',{name:body.name,value:body.value},true);
        await plc.setSimInput(body.name,body.value);
      }
      await audit(req,'SIM_INPUT_CONFIRMED',body.kind === 'encoder' ? {gateId:body.gateId,count:body.count} : {name:body.name,value:body.value},true);
      await poll(); return json(res,200,{ok:true,verified:true});
    } catch(error) {
      await audit(req,'SIM_INPUT_FAILED',{error:safeError(error)},false);
      return json(res,400,{ok:false,error:safeError(error)});
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/rev3-controls') {
    if (!state.rev3ControlEnabled || !config.security.allowWrites) return json(res,403,{ok:false,error:'Kontrol REV3 tidak diaktifkan'});
    if (!rateAllowed(clientIp(req))) return json(res,429,{ok:false,error:'Batas perintah tercapai, tunggu sebentar'});
    const auth = String(req.headers.authorization || '');
    if (!safeEqual(auth.startsWith('Bearer ') ? auth.slice(7) : '', writeToken)) {
      await audit(req,'REV3_CONTROL_AUTH_DENIED',{},false);
      return json(res,401,{ok:false,error:'Token kontrol tidak valid'});
    }
    try {
      const body = await readJson(req);
      if (!body || !Object.hasOwn(REV3_CONTROLS, body.name) || typeof body.value !== 'boolean') throw new Error('Kontrol tidak ada di whitelist atau bukan BOOL');
      await audit(req,'REV3_CONTROL_REQUEST',{name:body.name,value:body.value,confirmed:body.confirmed === true},true);
      await plc.setRev3Control(body.name,body.value,body.confirmed);
      await audit(req,'REV3_CONTROL_CONFIRMED',{name:body.name,value:body.value},true);
      await poll();
      return json(res,200,{ok:true,verified:true});
    } catch(error) {
      await audit(req,'REV3_CONTROL_FAILED',{error:safeError(error)},false);
      return json(res,400,{ok:false,error:safeError(error)});
    }
  }
  const simulationMatch = req.method === 'POST' && url.pathname.match(/^\/api\/simulation\/gates\/([1-3])\/target$/);
  if (simulationMatch) {
    if (!simulationAccessAllowed({ mode: config.plc.mode, listenHost: config.listen.host,
      remoteAddress: clientIp(req), host: req.headers.host, origin: req.headers.origin,
      marker: req.headers['x-scada-simulation'] })) {
      return json(res, 403, { ok: false, error: 'Kontrol simulator hanya tersedia dari halaman localhost dalam mode simulation' });
    }
    if (!rateAllowed(clientIp(req))) return json(res, 429, { ok: false, error: 'Terlalu banyak perintah; coba lagi nanti' });
    try {
      const body = await readJson(req);
      if (!Number.isInteger(body?.targetPct) || body.targetPct < 0 || body.targetPct > 100) throw new Error('targetPct harus bilangan bulat 0–100');
      const gateId = Number(simulationMatch[1]);
      await audit(req, 'SIMULATION_TARGET', { gateId, targetPct: body.targetPct }, true);
      await plc.setTarget(gateId, body.targetPct);
      await poll();
      return json(res, 200, { ok: true, simulation: true, gateId, targetPct: body.targetPct });
    } catch (error) { return json(res, 400, { ok: false, error: safeError(error) }); }
  }
  const match = req.method === 'POST' && url.pathname.match(/^\/api\/gates\/([1-3])\/target$/);
  if (match) return handleWrite(req, res, Number(match[1]));
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'Method tidak diizinkan' });
  return serveStatic(url.pathname, req, res);
}

async function serveStatic(urlPath, req, res) {
  const requested = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  const resolved = path.resolve(publicRoot, requested);
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) return json(res, 404, { error: 'Not found' });
  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new Error('Not a file');
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream', 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(resolved).pipe(res);
  } catch { return json(res, 404, { error: 'Not found' }); }
}

function safeError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[\r\n\t]/g, ' ').slice(0, 240);
}

function dispatch(req, res) {
  handler(req, res).catch(() => {
    if (!res.headersSent) json(res, 500, { ok: false, error: 'Permintaan gagal diproses' });
    else res.destroy();
  });
}
const server = usesTls
  ? https.createServer({ cert: fs.readFileSync(config.listen.tlsCertFile), key: fs.readFileSync(config.listen.tlsKeyFile), minVersion: 'TLSv1.2' }, dispatch)
  : http.createServer(dispatch);
server.requestTimeout = 10_000;
server.headersTimeout = 8_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

await poll();
const timer = setInterval(poll, config.plc.pollIntervalMs);
timer.unref();
server.listen(config.listen.port, config.listen.host, () => {
  const scheme = usesTls ? 'https' : 'http';
  console.log(`${config.appName}\nDashboard : ${scheme}://${config.listen.host}:${config.listen.port}\nPLC mode  : ${config.plc.mode}\nWrites    : ${config.security.allowWrites ? 'ARMED' : 'DISABLED'}`);
});

async function shutdown() {
  clearInterval(timer);
  plc.close();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

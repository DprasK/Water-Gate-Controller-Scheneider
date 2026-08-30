// This guard applies only to the in-memory simulator, never to the Modbus writer.
export function simulationAccessAllowed({ mode, listenHost, remoteAddress, host, origin, marker }) {
  const local = new Set(['127.0.0.1', '::1', 'localhost']);
  if (mode !== 'simulation' || !local.has(listenHost)) return false;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)) return false;
  if (marker !== 'local-only') return false;
  try {
    const authority = new URL(`http://${host}`);
    if (!local.has(authority.hostname.replace(/^\[|\]$/g, ''))) return false;
    const source = new URL(origin);
    return ['http:', 'https:'].includes(source.protocol) && source.host === authority.host;
  } catch { return false; }
}

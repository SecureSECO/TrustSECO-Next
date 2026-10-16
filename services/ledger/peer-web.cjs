// Network protocol minor version .1 adds only this optional RPC; the existing handshake and
// consensus wire formats stay unchanged. Never probe minor .0 peers: unknown RPCs ban.
const PROCEDURE = 'trustseco_getWebInterface';
function webURL(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) return null;
    return url.href;
  } catch { return null; }
}
function install(network) {
  const raw = process.env.TRUSTSECO_WEB_URL;
  const local = webURL(raw);
  if (raw && !local) throw Error('TRUSTSECO_WEB_URL must be a public HTTPS URL without credentials, query or fragment');
  network.registerEndpoint(PROCEDURE, () => Buffer.from(JSON.stringify({webURL: local})));
  const cache = new Map();
  network._endpoint.getWebInterfaces = async () => {
    const peers = network._p2p.getConnectedPeers();
    const active = new Set(peers.map(p => `${p.ipAddress}:${p.port}`));
    for (const id of cache.keys()) if (!active.has(id)) cache.delete(id);
    const results = await Promise.all(peers.map(async peer => {
      const id = `${peer.ipAddress}:${peer.port}`;
      if (!/^\d+\.1$/.test(peer.networkVersion || '')) return {address: peer.ipAddress, port: peer.port, webURL: null};
      let entry = cache.get(id);
      if (!entry || entry.expires <= Date.now()) {
        entry = {expires: Date.now() + 60000, value: (async () => {
          try {
            let timer;
            const response = await Promise.race([network._p2p.requestFromPeer({procedure: PROCEDURE}, id),
              new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Web metadata timeout')), 2000); })]).finally(() => clearTimeout(timer));
            if (!Buffer.isBuffer(response.data) || response.data.length > 4096) return null;
            return webURL(JSON.parse(response.data.toString('utf8')).webURL);
          } catch { return null; }
        })()};
        cache.set(id, entry);
      }
      return {address: peer.ipAddress, port: peer.port, webURL: await entry.value};
    }));
    return {local: {webURL: local}, peers: results};
  };
}
module.exports = {install, webURL, PROCEDURE};

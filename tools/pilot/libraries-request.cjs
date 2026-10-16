// Responses stay inside one contributor's process. Only traffic-control state is shared.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const timestamps = new WeakMap();
const observedAt = value => timestamps.get(value) ?? Math.floor(Date.now() / 1000);
function deferred(ms, status) {
  const error = Error(status ? 'Libraries.io access cooldown (HTTP ' + status + ')' : 'Libraries.io request budget; retry later');
  error.retryAfterMs = Math.max(100, ms); error.providerDeferred = true; error.status = status;
  error.rateLimited = status === 429;
  return error;
}
function createLibrariesRequest({directory, now = Date.now, interval = 5000, ttl = 60000, maxEntries = 64, maxBytes = 8*1024*1024, fetcher = (...args) => fetch(...args)} = {}) {
  let memory = {}; const cache = new Map();
  function state(update) {
    if (!directory) return update(memory);
    fs.mkdirSync(directory, {recursive:true, mode:0o700});
    const lock = path.join(directory, 'libraries.lock'), file = path.join(directory, 'libraries.json');
    try { fs.mkdirSync(lock); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // The lock covers synchronous filesystem operations only, never network IO.
      try { if (now() - fs.statSync(lock).mtimeMs > 30000) fs.rmdirSync(lock); } catch {}
      throw deferred(1000);
    }
    try {
      const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      const result = update(current);
      fs.writeFileSync(file + '.tmp', JSON.stringify(current), {mode:0o600});
      fs.renameSync(file + '.tmp', file);
      return result;
    } finally { fs.rmdirSync(lock); }
  }
  return async function request(url, scope, notBefore = 0) {
    const key = crypto.createHash('sha256').update(String(scope) + '\n' + url).digest('hex');
    const hit = scope && cache.get(key);
    if (hit && now() - hit.at < ttl && Math.floor(hit.at/1000) >= notBefore) { const value = structuredClone(hit.value); timestamps.set(value, Math.floor(hit.at/1000)); return value; }
    if (hit) cache.delete(key);
    state(s => {
      if (s.blockedUntil > now()) throw deferred(s.blockedUntil - now(), s.status);
      if (s.nextAt > now()) throw deferred(s.nextAt - now());
      s.nextAt = now() + interval;
    });
    let response;
    try { response = await fetcher(url, {redirect:'error', signal:AbortSignal.timeout(20000)}); }
    catch { state(s => { s.nextAt = Math.max(s.nextAt || 0, now() + 60000); }); throw deferred(60000); }
    if (!response.ok) {
      const status = response.status;
      const retry = response.headers?.get?.('retry-after');
      const retryMs = retry ? (/^\d+$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-now()) : 0;
      let delay;
      state(s => {
        s.failures = Math.min(10, (s.failures || 0) + 1);
        const base = [401,403].includes(status) ? 1800000 : status === 429 ? 60000 : 30000;
        delay = Math.max(Math.min(21600000, base * 2**(s.failures-1)), Number.isFinite(retryMs) ? Math.max(0,retryMs) : 0);
        s.blockedUntil = Math.max(s.blockedUntil || 0, now() + delay); s.status = status;
      });
      // Discard the error body rather than caching it or including credential URLs in logs.
      await response.body?.cancel?.();
      const error = deferred(delay, status); error.providerDeferred = false; throw error;
    }
    let value;
    try { value = await response.json(); if (!value || typeof value !== 'object') throw Error(); }
    catch { throw Error('Invalid JSON from libraries.io'); }
    const at = now(); timestamps.set(value, Math.floor(at/1000));
    state(s => { if (!(s.blockedUntil > now())) { s.failures=0; s.status=undefined; } });
    if (scope) {
      for (const [k,v] of cache) if (now()-v.at >= ttl) cache.delete(k);
      const bytes = Buffer.byteLength(JSON.stringify(value));
      let total = [...cache.values()].reduce((sum,v)=>sum+v.bytes,0);
      while (cache.size && (cache.size >= maxEntries || total + bytes > maxBytes)) { const oldest=cache.keys().next().value; total-=cache.get(oldest).bytes; cache.delete(oldest); }
      if (bytes <= maxBytes) cache.set(key, {at, bytes, value:structuredClone(value)});
    }
    return value;
  };
}
module.exports = {createLibrariesRequest, observedAt};

#!/usr/bin/env node
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { entropyEvent, canObserve, expiredEnvelope } = require('./assignment.cjs');
const miningContext = new (require('node:async_hooks').AsyncLocalStorage)();
const librariesRequests = require('./libraries-request.cjs').createLibrariesRequest({directory:process.env.LIBRARIES_REQUEST_STATE_DIR});
const credentialContext = new (require('node:async_hooks').AsyncLocalStorage)();
const credentials = () => credentialContext.getStore() || {github:process.env.GITHUB_TOKEN,libraries:process.env.LIBRARIES_IO_API_KEY};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sshKey(pem) {
  const x = crypto.createPublicKey(pem).export({ format: "jwk" });
  if (x.crv !== "Ed25519") throw Error("Ed25519 required");
  const parts = [Buffer.from("ssh-ed25519"), Buffer.from(x.x, "base64url")];
  return (
    "ssh-ed25519 " +
    Buffer.concat(
      parts.flatMap((b) => {
        const n = Buffer.alloc(4);
        n.writeUInt32BE(b.length);
        return [n, b];
      })
    ).toString("base64")
  );
}
function baseURL(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" &&
    !(
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
  )
    throw Error("HTTPS required except on localhost");
  return u.origin;
}
async function json(url, options = {}) {
  if (new URL(url).hostname === "libraries.io") { const scope=miningContext.getStore(); return librariesRequests(url, scope?.id || scope, scope?.notBefore || 0); }
  const r = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  }).catch(() => { throw Error('Could not reach ' + new URL(url).hostname); });
  if (!r.ok) {
    const e = Error("HTTP " + r.status + " from " + new URL(url).hostname);
    e.status = r.status;
    e.rateLimited = r.status === 429 || r.headers?.get?.("x-ratelimit-remaining") === "0";
    const reset = Number(r.headers?.get?.("x-ratelimit-reset")) * 1000;
    if (e.rateLimited && reset > Date.now()) e.retryAfterMs = Math.min(3600000, reset - Date.now() + 1000);
    throw e;
  }
  return r.json().catch(() => { throw Error('Invalid JSON from ' + new URL(url).hostname); });
}
async function github(p) {
  return json("https://api.github.com" + p, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TrustSECO-pilot",
      ...(credentials().github
        ? { Authorization: "Bearer " + credentials().github }
        : {}),
    },
  });
}
async function pages(p) {
  const out = [];
  for (let i = 1; i <= 100; i++) {
    const data = await github(
      p + (p.includes("?") ? "&" : "?") + "per_page=100&page=" + i
    );
    if (!Array.isArray(data)) throw Error("Invalid GitHub page");
    out.push(...data);
    if (data.length < 100) return out;
  }
  throw Error(
    "GitHub pagination bound exceeded; no partial measurement submitted"
  );
}
const sign = (payload, key, domain = "TrustSECO-community-v1") =>
  crypto
    .sign(null, Buffer.from(domain + "\n" + payload), key)
    .toString("base64");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
function privateFile(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
}
async function snapshot(url) {
  return json(baseURL(url) + "/api/pilot/snapshot");
}
// Bounded, per-origin/member/request cache. The projection content hash detects
// changes, including same-height forks; time and finality refresh every poll.
const workCache = new Map();
async function work(url, member, round) {
  const query = new URLSearchParams({member,...(round ? {round} : {})});
  const endpoint = baseURL(url) + '/api/pilot/work?' + query;
  const cached = workCache.get(endpoint);
  const state = await json(endpoint + (cached?.revision ? '&since=' + cached.revision : ''));
  if (state.unchanged && (!cached || state.revision !== cached.revision)) throw Error('Work revision mismatch; retry with a fresh projection');
  const result = state.unchanged ? {...cached,...state,unchanged:undefined} : state;
  if (workCache.size >= 16 && !workCache.has(endpoint)) workCache.delete(workCache.keys().next().value);
  workCache.set(endpoint,result);
  return result;
}
async function status(url) { return json(baseURL(url) + '/api/pilot/status'); }
async function receipt(url, id) {
  return (await json(baseURL(url) + '/api/pilot/event?id=' + encodeURIComponent(id))).event;
}
async function submit(url, identity, event) {
  const s = await status(url);
  const payload = JSON.stringify({
    ...event,
    id: event.id || crypto.randomUUID(),
    actor: identity.id,
    network: s.network,
  });
  const envelope = { payload, signature: sign(payload, identity.privateKey) };
  return sendEnvelope(url, envelope);
}
async function recorded(url, state, id) {
  return state.audit.find(a => a.id === id) || (state.policy?.collection ? (await json(baseURL(url) + '/api/pilot/event?id=' + encodeURIComponent(id))).event : null);
}
async function sendEnvelope(url, envelope) {
  const e = JSON.parse(envelope.payload);
  for (let i = 0; i < 90; i++) {
    const record = await receipt(url, e.id);
    if (record) {
      if (
        record.payload !== envelope.payload ||
        record.signature !== envelope.signature
      )
        throw Error("Event ID collision");
      return e.id;
    }
    try {
      await json(baseURL(url) + "/api/pilot/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      break;
    } catch (error) {
      if (error.status !== 429) throw error;
      if (i === 89) throw error;
      await sleep(1000);
    }
  }
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const record = await receipt(url, e.id);
    if (record) {
      if (
        record.payload !== envelope.payload ||
        record.signature !== envelope.signature
      )
        throw Error("Event ID collision");
      return e.id;
    }
  }
  throw Error(
    "Submission not observed yet; retain the same signed envelope for retry"
  );
}
// A recovered fork can contain the same logical opening under an earlier event ID.
// Reconcile only byte-equivalent fields (except the ID), signed and finalized; never transfers.
async function finalizedOpening(url, state, envelope) {
  const pending=JSON.parse(envelope.payload);
  if(pending.kind!=='open'||!state.rounds?.some(r=>r.id===pending.round)||!Number.isSafeInteger(state.ledger?.finalizedHeight))return null;
  const find=events=>events.find(a=>a.kind==='open'&&JSON.parse(a.payload).round===pending.round);
  let existing=find(state.audit),before=state.auditOffset;
  while(!existing&&state.policy?.collection&&before>0){const page=await json(baseURL(url)+'/api/pilot/audit?before='+before);existing=find(page.events);before=page.nextCursor;}
  if(!existing||existing.height>state.ledger.finalizedHeight)return null;
  const body=JSON.parse(existing.payload),key=body.actor==='governor'?state.governorKey:state.members.find(m=>m.id===body.actor)?.key;
  const comparable=e=>JSON.stringify(Object.keys(e).filter(k=>k!=='id').sort().map(k=>[k,e[k]]));
  if(!key||comparable(body)!==comparable(pending)||!crypto.verify(null,Buffer.from('TrustSECO-community-v1\n'+existing.payload),key,Buffer.from(existing.signature,'base64')))return null;
  return existing;
}
async function durableEvent(url, keyfile, body) {
  const file = keyfile + ".event-outbox";
  if (!fs.existsSync(file)) {
    const identity = read(keyfile),
      s = await snapshot(url);
    const payload = JSON.stringify({
      ...body,
      id: body.id || crypto.randomUUID(),
      actor: identity.id,
      network: s.network,
    });
    privateFile(file, {
      body,
      envelope: { payload, signature: sign(payload, identity.privateKey) },
    });
  }
  const pending = read(file);
  if (JSON.stringify(pending.body) !== JSON.stringify(body))
    throw Error(
      "A different event is pending in " + file + "; retry that event first"
    );
  const state=await snapshot(url),event=JSON.parse(pending.envelope.payload);
  if(!await recorded(url,state,event.id)){
    const existing=await finalizedOpening(url,state,pending.envelope);
    if(existing){
      const archive=file+'.superseded-'+crypto.randomUUID();
      privateFile(archive+'.receipt',{canonicalEvent:existing.id,canonicalHeight:existing.height,reason:'Identical opening finalized under another event ID after fork recovery'});
      fs.renameSync(file,archive);
      return existing.id;
    }
  }
  const id = await sendEnvelope(url, pending.envelope);
  fs.unlinkSync(file);
  return id;
}
async function collect(repository, metric, target) {
  if(metric === 'vs_virus_ratio') {
    const scope=miningContext.getStore(), identityFile=scope?.id || scope;
    return require('./clamav.cjs').collectMalware(target,json,undefined,undefined,{directory:identityFile ? path.join(path.dirname(identityFile),'scan-diagnostics') : undefined});
  }
  if(metric === 'security_advisories') return require('./security.cjs').collectSecurity(target,json);
  if(metric === 'so_popularity') return require('./security.cjs').collectStackOverflow(target,json);
  if (require("./libraries.cjs").metrics.includes(metric)) return require("./libraries.cjs").collectProject(repository, metric, target, credentials().libraries, json);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error("Invalid repository");
  const [owner] = repository.split("/");
  let raw, value, source;
  if (metric === "lib_contributor_count") {
    if (!credentials().libraries) throw Error("Save a Libraries.io API key in Settings to collect this metric");
    source = "https://libraries.io/api/github/" + repository;
    raw = await json(source + '?api_key=' + encodeURIComponent(credentials().libraries));
    if (raw.full_name?.toLowerCase() !== repository.toLowerCase() || raw.private === true) throw Error('Libraries.io repository mismatch');
    value = raw.contributions_count;
  } else if (metric === "gh_contributor_count") {
    source = "/repos/" + repository + "/contributors?anon=1";
    raw = await pages(source);
    value = raw.length;
  } else if (metric === "gh_open_issues_count") {
    source =
      "/search/issues?q=" +
      encodeURIComponent("repo:" + repository + " is:issue is:open");
    raw = await github(source);
    if (raw.incomplete_results) throw Error("Incomplete GitHub search");
    value = raw.total_count;
  } else if (metric === "gh_yearly_commit_count") {
    source = "/repos/" + repository + "/stats/commit_activity";
    raw = await github(source);
    if (!Array.isArray(raw) || raw.length !== 52)
      throw Error("GitHub statistics pending or incomplete");
    value = raw.reduce((n, w) => n + w.total, 0);
  } else if (metric === "gh_owner_stargazer_count") {
    const ownerData = await github("/users/" + owner);
    source =
      (ownerData.type === "Organization" ? "/orgs/" : "/users/") +
      owner +
      "/repos?type=owner";
    raw = await pages(source);
    value = raw
      .filter((r) => !r.private)
      .reduce((n, r) => n + r.stargazers_count, 0);
  } else throw Error("Unsupported collector");
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error("Invalid measurement");
  return {
    value,
    observedAt: require("./libraries-request.cjs").observedAt(raw),
    evidence: source.startsWith("https://libraries.io/") ? source : "https://api.github.com" + source,
    evidenceHash: crypto
      .createHash("sha256")
      .update(JSON.stringify(raw))
      .digest("hex"),
  };
}
function mineOnce(url, keyfile, saved, options = {}) { return credentialContext.run(saved || credentials(), () => miningContext.run(path.resolve(keyfile), () => mineOnceInner(url,keyfile,options))); }
const collectorRetry = new Map();
async function mineOnceInner(url, keyfile, options) {
  const identity = read(keyfile),
    outbox = keyfile + ".outbox";
  if (fs.existsSync(outbox)) {
    const pending = read(outbox), event = JSON.parse(pending.payload), current = await work(url, identity.id, event.round);
    if (options.testNetwork && current.testNetwork !== true) throw Error('Local test network required');
    if (event.network !== current.network) throw Error('Pending event belongs to another network');
    if (!await receipt(url, event.id) && expiredEnvelope(event, current)) {
      fs.renameSync(outbox, outbox + '.expired-' + crypto.randomUUID());
    } else {
      await sendEnvelope(url, pending);
      fs.unlinkSync(outbox);
      return true;
    }
  }
  const s = await work(url, identity.id),
    m = s.members.find((m) => m.id === identity.id);
  if (options.testNetwork && s.testNetwork !== true) throw Error('Local test network required');
  if (!m || m.revoked || m.suspended || m.standing === "suspended")
    throw Error("Contributor is not admitted or is suspended/revoked");
  const entropy = await require('./availability.cjs').assignmentEvent(s,identity) || entropyEvent(s, identity, keyfile);
  if (entropy) {
    const payload = JSON.stringify({...entropy,id:crypto.randomUUID(),actor:identity.id,network:s.network});
    privateFile(outbox, {payload,signature:sign(payload,identity.privateKey)});
    await sendEnvelope(url, read(outbox));
    fs.unlinkSync(outbox);
    return true;
  }
  const activeRounds = new Set(s.rounds.map(r=>r.id));
  for (const id of collectorRetry.keys()) if (!activeRounds.has(id)) collectorRetry.delete(id);
  const candidates = s.rounds.filter(
    (r) =>
      !r.closed &&
      canObserve(r, s, identity.id) &&
      r.closesAt > s.at + 45 &&
      !r.observations.some((o) => o.member === identity.id) &&
      (collectorRetry.get(r.id) || 0) <= Date.now()
  );
  let r, measurement, failure, unavailable;
  for (const candidate of candidates) {
    try {
      const assignment = candidate.assignment;
      const notBefore = assignment?.version === "availability-beacon-v1"
        ? Math.max(0, ...assignment.slots.filter(slot => !slot.replaced && slot.member === identity.id).map(slot => slot.from))
        : assignment?.revealUntil || 0;
      measurement = await miningContext.run({id:path.resolve(keyfile),notBefore}, () => collect(
        candidate.escrow.repository,
        candidate.metric,
        candidate.escrow
      ));
      r = candidate;
      break;
    } catch (error) {
      failure = error.message;
      if (!error.providerDeferred && s.policy.collection && !candidate.escrow.failures?.[identity.id] && !unavailable) {
        const reason = /API key|credentials/i.test(failure) ? 'credentials-missing' : error.code === 'SCAN_INCONCLUSIVE' ? 'source-incomplete' : error.rateLimited || error.status===429 ? 'rate-limited' : [401,403].includes(error.status) ? 'access-denied' : /incomplete|missing|invalid|not in|mismatch|does not match|unavailable/i.test(failure) ? 'source-incomplete' : 'source-unavailable';
        unavailable = {kind:'unavailable',round:candidate.id,reason};
      }
      collectorRetry.set(candidate.id, Date.now() + (error.retryAfterMs || 60000));
      console.error(
        "Collector " +
          candidate.metric +
          ": " +
          error.message +
          "; next attempt in " + Math.ceil((error.retryAfterMs || 60000)/1000) + " seconds"
      );
    }
  }
  if (!r) {
    if (unavailable) {
      const payload=JSON.stringify({...unavailable,id:crypto.randomUUID(),actor:identity.id,network:s.network});
      privateFile(outbox,{payload,signature:sign(payload,identity.privateKey)});
      await sendEnvelope(url,read(outbox)); fs.unlinkSync(outbox); return true;
    }
    if (failure) throw Error('Collection needs attention: ' + failure + '; next attempt follows collector cooldown');
    if (s.rounds.some(candidate => !candidate.closed && (collectorRetry.get(candidate.id) || 0) > Date.now())) throw Error('Waiting to retry a failed collector');
    return false;
  }
  const e = {
    id: crypto.randomUUID(),
    actor: identity.id,
    network: s.network,
    kind: "observe",
    round: r.id,
    source: r.source,
    method: r.method,
    ...measurement,
  };
  // Never claim a future observation time relative to the node's current block.
  for (let i = 0; i < 60 && (await status(url)).at < e.observedAt; i++)
    await sleep(1000);
  const payload = JSON.stringify(e);
  privateFile(outbox, {
    payload,
    signature: sign(payload, identity.privateKey),
  });
  await sendEnvelope(url, read(outbox));
  fs.unlinkSync(outbox);
  return true;
}
async function verifiedAdmission(url, request, operator, automatic = false) {
  const s = await snapshot(url),
    j = JSON.parse(request.payload);
  if (
    (!automatic && !operator) ||
    j.network !== s.network ||
    !Number.isSafeInteger(j.expiresAt) || j.expiresAt < Math.floor(Date.now() / 1000) || j.expiresAt > Math.floor(Date.now() / 1000) + 86400
  )
    throw Error("Operator attestation and current join request required");
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(j.login)) throw Error("Invalid login");
  if (
    !crypto.verify(
      null,
      Buffer.from("TrustSECO-join-v1\n" + request.payload),
      j.publicKey,
      Buffer.from(request.signature, "base64")
    )
  )
    throw Error("Invalid join signature");
  const profile = await github("/users/" + j.login);
  if (profile.type !== "User" || profile.login.toLowerCase() !== j.login)
    throw Error("A personal GitHub account is required");
  const created = Math.floor(Date.parse(profile.created_at) / 1000);
  if (!Number.isSafeInteger(created) || created > s.at - 180 * 86400)
    throw Error("GitHub account must be at least 180 days old");
  const keys = await pages("/users/" + j.login + "/ssh_signing_keys");
  const expected = sshKey(j.publicKey);
  if (!keys.some((k) => k.key.split(" ").slice(0, 2).join(" ") === expected))
    throw Error(
      "Publish the contributor public key as a GitHub SSH signing key first"
    );
  if (!Number.isSafeInteger(profile.id) || profile.id <= 0) throw Error("Invalid GitHub account ID");
  return {
    kind: "enrol",
    member: j.login,
    key: j.publicKey,
    githubId: String(profile.id),
    operator: automatic ? "github:" + profile.id : operator,
    accountCreatedAt: created,
    evidence:
      automatic ? "GitHub account age and signing-key ownership verified automatically; one numeric account ID per identity, not proof of distinct humans" : "GitHub profile and public SSH signing key verified via REST; operator independence attested by governor",
    joinPayload: request.payload,
    joinSignature: request.signature,
  };
}
async function admission(url, request, governor, operator) {
  return submit(url, governor, await verifiedAdmission(url, request, operator));
}
async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === "init") {
    const [id, file] = a;
    if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(id) || !file)
      throw Error("init <github-login|governor> <private-file>");
    const k = crypto.generateKeyPairSync("ed25519");
    const publicKey = k.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    privateFile(file, {
      id,
      publicKey,
      privateKey: k.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    });
    console.log(sshKey(publicKey));
    return;
  }
  if (cmd === "join") {
    const [url, file, out] = a;
    const k = read(file),
      s = await snapshot(url);
    const payload = JSON.stringify({
      network: s.network,
      login: k.id,
      publicKey: k.publicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 43200,
      nonce: crypto.randomUUID(),
    });
    privateFile(out, {
      payload,
      signature: sign(payload, k.privateKey, "TrustSECO-join-v1"),
    });
    console.log("Share the join request, never the private identity file.");
    return;
  }
  if (cmd === "admit") {
    console.log(await admission(a[0], read(a[1]), read(a[2]), a[3]));
    return;
  }
  if (cmd === "event") {
    console.log(await durableEvent(a[0], a[1], read(a[2])));
    return;
  }
  if (cmd === "mine") {
    do {
      try {
        if (await mineOnce(a[0], a[1]))
          console.log("Signed mining event recorded");
      } catch (e) {
        console.error(e.message);
        if (a.includes("--once")) throw e;
      }
      if (a.includes("--once")) return;
      await sleep(15000);
    } while (true);
  }
  throw Error("Commands: init, join, admit, event, mine");
}
module.exports = {
  sshKey,
  collect: (repository, metric, saved, target) => credentialContext.run(saved || credentials(), () => collect(repository, metric, target)),
  admission,
  verifiedAdmission,
  sign,
  submit,
  mineOnce,
  baseURL,
  durableEvent,
};
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });

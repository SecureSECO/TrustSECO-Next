#!/usr/bin/env node
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
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
  const r = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const e = Error("HTTP " + r.status + " from " + new URL(url).hostname);
    e.status = r.status;
    throw e;
  }
  return r.json();
}
async function github(p) {
  return json("https://api.github.com" + p, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TrustSECO-pilot",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: "Bearer " + process.env.GITHUB_TOKEN }
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
async function submit(url, identity, event) {
  const s = await snapshot(url);
  const payload = JSON.stringify({
    ...event,
    id: event.id || crypto.randomUUID(),
    actor: identity.id,
    network: s.network,
  });
  const envelope = { payload, signature: sign(payload, identity.privateKey) };
  return sendEnvelope(url, envelope);
}
async function sendEnvelope(url, envelope) {
  const e = JSON.parse(envelope.payload);
  for (let i = 0; i < 90; i++) {
    const s = await snapshot(url),
      record = s.audit.find((a) => a.id === e.id);
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
    const record = (await snapshot(url)).audit.find((a) => a.id === e.id);
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
  const id = await sendEnvelope(url, pending.envelope);
  fs.unlinkSync(file);
  return id;
}
async function collect(repository, metric) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error("Invalid repository");
  const [owner] = repository.split("/");
  let raw, value, source;
  if (metric === "gh_contributor_count") {
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
    observedAt: Math.floor(Date.now() / 1000),
    evidence: "https://api.github.com" + source,
    evidenceHash: crypto
      .createHash("sha256")
      .update(JSON.stringify(raw))
      .digest("hex"),
  };
}
const collectorRetry = new Map();
async function mineOnce(url, keyfile) {
  const identity = read(keyfile),
    outbox = keyfile + ".outbox";
  if (fs.existsSync(outbox)) {
    await sendEnvelope(url, read(outbox));
    fs.unlinkSync(outbox);
    return true;
  }
  const s = await snapshot(url),
    m = s.members.find((m) => m.id === identity.id);
  if (!m || m.revoked || m.standing === "suspended")
    throw Error("Contributor is not admitted or is suspended/revoked");
  const candidates = s.rounds.filter(
    (r) =>
      !r.closed &&
      r.closesAt > s.at + 45 &&
      !r.observations.some((o) => o.member === identity.id) &&
      (collectorRetry.get(r.id) || 0) <= Date.now()
  );
  let r, measurement, failure;
  for (const candidate of candidates) {
    try {
      measurement = await collect(
        candidate.escrow.repository,
        candidate.metric
      );
      r = candidate;
      break;
    } catch (error) {
      failure = error.message;
      collectorRetry.set(candidate.id, Date.now() + 60000);
      console.error(
        "Collector " +
          candidate.metric +
          ": " +
          error.message +
          "; retry in 60 seconds"
      );
    }
  }
  if (!r) {
    if (failure) throw Error('Collection needs attention: ' + failure + '; retrying in 60 seconds');
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
  for (let i = 0; i < 60 && (await snapshot(url)).at < e.observedAt; i++)
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
async function admission(url, request, governor, operator) {
  const s = await snapshot(url),
    j = JSON.parse(request.payload);
  if (
    !operator ||
    j.network !== s.network ||
    j.expiresAt < Math.floor(Date.now() / 1000)
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
  return submit(url, governor, {
    kind: "enrol",
    member: j.login,
    key: j.publicKey,
    githubId: String(profile.id),
    operator,
    accountCreatedAt: created,
    evidence:
      "GitHub profile and public SSH signing key verified via REST; operator independence attested by governor",
    joinPayload: request.payload,
    joinSignature: request.signature,
  });
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
          console.log("Signed observation recorded");
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
  collect,
  admission,
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

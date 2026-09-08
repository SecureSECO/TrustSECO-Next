const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { collect, admission, sign, sshKey, baseURL } = require("./client.cjs");
test("uncertain transfer retries retain the exact signed event and reject replacement work", async () => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path"),
    { durableEvent } = require("./client.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trustseco-client-")),
    file = path.join(dir, "identity.json"),
    original = global.fetch;
  const k = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(
    file,
    JSON.stringify({
      id: "tester",
      privateKey: k.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    })
  );
  const body = { kind: "transfer", recipient: "other", amount: "5" };
  let included = false,
    record,
    writes = 0;
  try {
    global.fetch = async (url, options) => {
      if (options?.method === "POST") {
        writes++;
        record = JSON.parse(options.body);
        throw Error("Network timeout");
      }
      return {
        ok: true,
        json: async () => ({
          network: "n",
          audit: included
            ? [{ id: JSON.parse(record.payload).id, ...record }]
            : [],
        }),
      };
    };
    await assert.rejects(
      durableEvent("http://localhost", file, body),
      /timeout/
    );
    const pending = fs.readFileSync(file + ".event-outbox", "utf8");
    await assert.rejects(
      durableEvent("http://localhost", file, { ...body, amount: "6" }),
      /different event/
    );
    assert.equal(fs.readFileSync(file + ".event-outbox", "utf8"), pending);
    included = true;
    assert.equal(
      await durableEvent("http://localhost", file, body),
      JSON.parse(record.payload).id
    );
    assert.equal(writes, 1);
    assert.equal(fs.existsSync(file + ".event-outbox"), false);
  } finally {
    global.fetch = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("remote contributor connections require HTTPS", () => {
  assert.throws(() => baseURL("http://remote.example"), /HTTPS/);
  assert.equal(baseURL("http://localhost:3005/"), "http://localhost:3005");
  assert.equal(baseURL("https://example.org"), "https://example.org");
});
test("collectors reject pending statistics and incomplete search rather than invent a zero", async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({}) });
    await assert.rejects(
      collect("pallets/flask", "gh_yearly_commit_count"),
      /pending/
    );
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ incomplete_results: true, total_count: 10 }),
    });
    await assert.rejects(
      collect("pallets/flask", "gh_open_issues_count"),
      /Incomplete/
    );
  } finally {
    global.fetch = original;
  }
});
test("complete issue measurement includes source hash and observation time", async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ incomplete_results: false, total_count: 10 }),
    });
    const m = await collect("pallets/flask", "gh_open_issues_count");
    assert.equal(m.value, 10);
    assert.match(m.evidenceHash, /^[a-f0-9]{64}$/);
    assert.ok(m.observedAt > 0);
    assert.match(m.evidence, /api.github.com/);
  } finally {
    global.fetch = original;
  }
});
test("admission verifies actual profile age and published signing key before any submission", async () => {
  const original = global.fetch,
    k = crypto.generateKeyPairSync("ed25519"),
    publicKey = k.publicKey.export({ type: "spki", format: "pem" }).toString(),
    at = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
      login: "tester",
      publicKey,
      network: "n",
      expiresAt: at + 100,
      nonce: crypto.randomUUID(),
    }),
    request = {
      payload,
      signature: sign(payload, k.privateKey, "TrustSECO-join-v1"),
    };
  let young = false,
    writes = 0;
  try {
    global.fetch = async (url, options) => {
      if (options?.method === "POST") {
        writes++;
        throw Error("Unexpected admission");
      }
      return {
        ok: true,
        json: async () =>
          url.includes("/snapshot")
            ? { network: "n", at }
            : url.includes("ssh_signing_keys")
            ? []
            : {
                type: "User",
                login: "tester",
                id: 123,
                created_at: new Date(
                  (at - (young ? 10 : 200 * 86400)) * 1000
                ).toISOString(),
              },
      };
    };
    await assert.rejects(
      admission("http://localhost", request, {}, "operator"),
      /Publish/
    );
    young = true;
    await assert.rejects(
      admission("http://localhost", request, {}, "operator"),
      /180/
    );
    assert.equal(writes, 0);
    assert.match(sshKey(publicKey), /^ssh-ed25519 /);
  } finally {
    global.fetch = original;
  }
});

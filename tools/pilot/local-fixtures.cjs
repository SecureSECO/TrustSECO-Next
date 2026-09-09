// Explicit local-network integration fixture. Not an admission command for real deployments.
const fs = require("node:fs"),
  crypto = require("node:crypto"),
  { submit, sign } = require("./client.cjs");
(async () => {
  const url = "http://localhost:3000",
    root = "/fixtures";
  const s = await (await fetch(url + "/api/pilot/snapshot")).json();
  if (s.testNetwork !== true || s.network !== (process.env.PILOT_NETWORK || "trustseco-73657033"))
    throw Error("Local test network required");
  const governor = JSON.parse(
    fs.readFileSync("/governor/identity.json", "utf8")
  );
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const ids = process.env.PILOT_FIXTURE_COUNT === "6" ? ["test-a", "test-b", "test-c", "test-d", "test-e", "test-f"] : ["test-a", "test-b", "test-c"];
  for (const id of ids) {
    const directory = root + "/" + id;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = directory + "/identity.json";
    let identity;
    if (fs.existsSync(file)) identity = JSON.parse(fs.readFileSync(file));
    else {
      const k = crypto.generateKeyPairSync("ed25519");
      identity = {
        id,
        publicKey: k.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
        privateKey: k.privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      };
      fs.writeFileSync(file, JSON.stringify(identity), {
        flag: "wx",
        mode: 0o600,
      });
    }
    if (s.members.some((m) => m.id === id)) continue;
    const at = Math.floor(Date.now() / 1000),
      joinPayload = JSON.stringify({
        network: s.network,
        login: id,
        publicKey: identity.publicKey,
        expiresAt: at + 3600,
        nonce: crypto.randomUUID(),
      });
    console.log(
      await submit(url, governor, {
        kind: "enrol",
        member: id,
        key: identity.publicKey,
        operator: "local-fixture-" + id,
        githubId: String(900000000000 + id.charCodeAt(5)),
        accountCreatedAt: at - 200 * 86400,
        evidence:
          "LOCAL TEST FIXTURE: no GitHub ownership or independent operator asserted",
        joinPayload,
        joinSignature: sign(
          joinPayload,
          identity.privateKey,
          "TrustSECO-join-v1"
        ),
      })
    );
  }
  console.log(ids.length + " explicitly labelled local test identities admitted.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

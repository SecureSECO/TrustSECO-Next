const fs = require("node:fs"),
  crypto = require("node:crypto"),
  c = require("@klayr/cryptography");
(async () => {
  const out = process.argv[2];
  if (!out) throw Error("Output directory required");
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const key = await c.ed.getPrivateKeyFromPhraseAndPath(
    crypto.randomBytes(32).toString("hex"),
    "m/44'/134'/0'"
  );
  fs.writeFileSync(
    out + "/relayer.json",
    JSON.stringify({ privateKey: key.toString("hex") }),
    { flag: "wx", mode: 0o600 }
  );
  fs.writeFileSync(
    out + "/relayer-public.json",
    JSON.stringify({
      publicKey: c.ed.getPublicKeyFromPrivateKey(key).toString("hex"),
    }),
    { flag: "wx", mode: 0o644 }
  );
  console.log("Created separate relayer key; share only relayer-public.json.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

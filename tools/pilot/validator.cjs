// Run in the ledger image. Each operator runs this locally and shares ONLY public.json.
const fs = require("node:fs"),
  crypto = require("node:crypto"),
  c = require("@klayr/cryptography");
(async () => {
  const out = process.argv[2];
  if (!out) throw Error("validator.cjs <private-output-directory>");
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  if (fs.existsSync(out + "/keys.json"))
    throw Error("Refusing to overwrite validator keys");
  const privateKey = await c.ed.getPrivateKeyFromPhraseAndPath(
    crypto.randomBytes(32).toString("hex"),
    "m/44'/134'/0'"
  );
  const publicKey = c.ed.getPublicKeyFromPrivateKey(privateKey),
    bls = c.bls.generatePrivateKey(crypto.randomBytes(32));
  const blsKey = c.bls.getPublicKeyFromPrivateKey(bls),
    address = c.address.getKlayr32AddressFromPublicKey(publicKey);
  const publicData = {
    address,
    generatorKey: publicKey.toString("hex"),
    blsKey: blsKey.toString("hex"),
    proofOfPossession: c.bls.popProve(bls).toString("hex"),
  };
  fs.writeFileSync(
    out + "/keys.json",
    JSON.stringify({
      keys: [
        {
          address,
          plain: {
            generatorKey: publicData.generatorKey,
            generatorPrivateKey: privateKey.toString("hex"),
            blsKey: publicData.blsKey,
            blsPrivateKey: bls.toString("hex"),
          },
        },
      ],
    }),
    { flag: "wx", mode: 0o600 }
  );
  fs.writeFileSync(out + "/public.json", JSON.stringify(publicData, null, 2), {
    flag: "wx",
    mode: 0o644,
  });
  console.log("Created validator public bundle: " + out + "/public.json");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

// Local test only: generates four keys on ONE host. Production operators run validator.cjs separately.
const fs = require("node:fs"),
  crypto = require("node:crypto"),
  { execFileSync } = require("node:child_process");
const root = "/runtime";
if (fs.existsSync(root + "/shared"))
  throw Error("Existing runtime; refusing to replace genesis or keys");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
for (let i = 1; i <= 4; i++)
  execFileSync(
    process.execPath,
    ["/tools/validator.cjs", root + "/validator" + i],
    { stdio: "inherit" }
  );
execFileSync(process.execPath, ["/tools/relayer.cjs", root + "/relayer"], {
  stdio: "inherit",
});
fs.mkdirSync(root + "/governor", { mode: 0o700 });
const key = crypto.generateKeyPairSync("ed25519"),
  publicKey = key.publicKey.export({ type: "spki", format: "pem" }).toString();
fs.writeFileSync(
  root + "/governor/identity.json",
  JSON.stringify({
    id: "governor",
    publicKey,
    privateKey: key.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  }),
  { mode: 0o600, flag: "wx" }
);
fs.writeFileSync(root + "/governor/public.pem", publicKey);
execFileSync(
  process.execPath,
  [
    "/tools/genesis.cjs",
    root + "/shared",
    "73657033",
    root + "/governor/public.pem",
    root + "/relayer/relayer-public.json",
    ...[1, 2, 3, 4].map((i) => root + "/validator" + i + "/public.json"),
  ],
  { stdio: "inherit" }
);
console.log(
  "Local test keys prepared. Governor private key is not mounted into any service."
);

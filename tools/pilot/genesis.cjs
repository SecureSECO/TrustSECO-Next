// Assemble ONLY public validator bundles. Private keys never enter this process.
const fs = require("node:fs"),
  c = require("@klayr/cryptography"),
  crypto = require("node:crypto");
(async () => {
  const [out, chainID, governorFile, relayerPublicFile, ...bundles] =
    process.argv.slice(2);
  if (
    !/^[a-f0-9]{8}$/.test(chainID) ||
    ["73657030", "73657031", "73657032"].includes(chainID) ||
    bundles.length !== 4
  )
    throw Error(
      "genesis.cjs <output> <fresh-8hex-chain-id> <governor-public.pem> <relayer-public.json> <four-validator-public.json files>"
    );
  if (fs.existsSync(out + "/genesis_assets.json"))
    throw Error("Refusing to overwrite a genesis");
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const governor = fs.readFileSync(governorFile, "utf8");
  if (
    governor.includes("PRIVATE") ||
    crypto.createPublicKey(governor).asymmetricKeyType !== "ed25519"
  )
    throw Error("Public Ed25519 governor key required");
  const publicValidators = bundles.map((p) =>
    JSON.parse(fs.readFileSync(p, "utf8"))
  );
  for (const v of publicValidators) {
    if (Object.keys(v).some((k) => /private|plain|keys/i.test(k)))
      throw Error("Public bundles only");
    if (
      c.address.getKlayr32AddressFromPublicKey(
        Buffer.from(v.generatorKey, "hex")
      ) !== v.address
    )
      throw Error("Validator address mismatch");
    if (
      !c.bls.popVerify(
        Buffer.from(v.blsKey, "hex"),
        Buffer.from(v.proofOfPossession, "hex")
      )
    )
      throw Error("Invalid BLS ownership proof");
  }
  for (const key of ["address", "generatorKey", "blsKey"])
    if (new Set(publicValidators.map((v) => v[key])).size !== 4)
      throw Error("Distinct validator keys required");
  const assets = JSON.parse(
      fs.readFileSync("config/default/genesis_assets.json", "utf8")
    ),
    pos = assets.assets.find((a) => a.module === "pos").data;
  const validators = publicValidators
    .map((v, i) => ({ ...pos.validators[0], ...v, name: "validator_" + i }))
    .sort((a, b) =>
      Buffer.compare(
        c.address.getAddressFromKlayr32Address(a.address),
        c.address.getAddressFromKlayr32Address(b.address)
      )
    );
  pos.validators = validators;
  pos.stakers = validators.map((v) => ({
    address: v.address,
    stakes: [
      {
        validatorAddress: v.address,
        amount: "1000000000000",
        sharingCoefficients: [],
      },
    ],
    pendingUnlocks: [],
  }));
  pos.genesisData.initValidators = validators.map((v) => v.address);
  const relayer = JSON.parse(fs.readFileSync(relayerPublicFile, "utf8"));
  if (
    typeof relayer.publicKey !== "string" ||
    Object.keys(relayer).length !== 1
  )
    throw Error("Public relayer key only");
  const address = c.address.getKlayr32AddressFromPublicKey(
    Buffer.from(relayer.publicKey, "hex")
  );
  const addresses = [...validators.map((v) => v.address), address].sort(
    (a, b) =>
      Buffer.compare(
        c.address.getAddressFromKlayr32Address(a),
        c.address.getAddressFromKlayr32Address(b)
      )
  );
  if (new Set(addresses).size !== 5)
    throw Error("Relayer must not share a validator key");
  const token = assets.assets.find((a) => a.module === "token").data,
    tokenID = chainID + "00000000";
  token.userSubstore = addresses.map((address) => ({
    address,
    tokenID,
    availableBalance:
      address ===
      c.address.getKlayr32AddressFromPublicKey(
        Buffer.from(relayer.publicKey, "hex")
      )
        ? "100000000000000"
        : "99000000000000",
    lockedBalances: validators.some((v) => v.address === address)
      ? [{ module: "pos", amount: "1000000000000" }]
      : [],
  }));
  token.supplySubstore = [{ tokenID, totalSupply: "500000000000000" }];
  fs.writeFileSync(out + "/genesis_assets.json", JSON.stringify(assets));
  fs.writeFileSync(out + "/governor.pem", governor);
  const base = JSON.parse(
    fs.readFileSync("config/default/config.json", "utf8")
  );
  base.genesis.chainID = chainID;
  base.genesis.blockTime = 15;
  base.genesis.bftBatchSize = 4;
  base.modules.pos = {
    failSafeInactiveWindow: 144000,
    numberActiveValidators: 4,
    numberStandbyValidators: 0,
  };
  base.genesis.block.fromFile = "/pilot/genesis_block.blob";
  base.generator.keys.fromFile = "/validator/keys.json";
  base.network.seedPeers = [];
  fs.writeFileSync(out + "/config.json", JSON.stringify(base, null, 2));
  fs.writeFileSync(
    out + "/manifest.json",
    JSON.stringify(
      {
        chainID,
        network: "trustseco-" + chainID,
        blockTime: 15,
        validators: publicValidators,
        governorSHA256: crypto
          .createHash("sha256")
          .update(governor)
          .digest("hex"),
        assetsSHA256: crypto
          .createHash("sha256")
          .update(JSON.stringify(assets))
          .digest("hex"),
      },
      null,
      2
    )
  );
  console.log(
    "Public genesis assembled; distribute identical genesis, governor and network configuration to all operators."
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

// Run on each validator with its own key mounted; never collect these private keys centrally.
const fs = require("node:fs"),
  { createWSClient } = require("@klayr/api-client");
(async () => {
  const k = JSON.parse(fs.readFileSync("/validator/keys.json", "utf8")).keys;
  if (k.length !== 1)
    throw Error("Exactly one locally held validator key required");
  const c = await createWSClient("ws://127.0.0.1:7887/rpc-ws");
  try {
    const current = await c.invoke("pos_getValidator", {
      address: k[0].address,
    });
    const existingStake = BigInt(current.selfStake || "0");
    const eligible = await c.invoke("pos_getValidatorsByStake", { limit: -1 });
    if (existingStake > 0n && eligible.validators.some(v => v.address === k[0].address)) {
      console.log("Validator already self-staked and indexed as eligible");
      return;
    }
    // This SDK seeds genesis stakes without populating its eligibility index.
    // A normal additional stake transaction updates that index without rewriting chain state.
    const tx = {
      module: "pos",
      command: "stake",
      params: {
        stakes: [{ validatorAddress: k[0].address, amount: existingStake > 0n ? "1000000000" : "1000000000000" }],
      },
      fee: 100000000n,
    };
    tx.fee = c.transaction.computeMinFee(
      await c.transaction.create(tx, k[0].plain.generatorPrivateKey)
    );
    const signed = await c.transaction.create(
      tx,
      k[0].plain.generatorPrivateKey
    );
    await c.transaction.send(signed);
    console.log("Self-stake submitted: " + signed.id);
  } finally {
    await c.disconnect();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

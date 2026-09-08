const { createWSClient } = require("@klayr/api-client"),
  crypto = require("node:crypto");
(async () => {
  const c = await createWSClient(
    process.argv[2] || "ws://127.0.0.1:7887/rpc-ws"
  );
  try {
    const n = await c.node.getNodeInfo(),
      s = await c.invoke("pilot_snapshot");
    const { at, ...state } = s;
    console.log(
      JSON.stringify({
        height: n.height,
        finalizedHeight: n.finalizedHeight,
        chainID: n.chainID,
        members: s.members.length,
        events: s.audit.length,
        rounds: s.rounds.length,
        stateHash: crypto
          .createHash("sha256")
          .update(JSON.stringify(state))
          .digest("hex"),
      })
    );
  } finally {
    await c.disconnect();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

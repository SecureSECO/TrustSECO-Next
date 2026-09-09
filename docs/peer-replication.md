# Local two-node replication experiment

Historical first experiment: the replica has since been promoted to a validator as described in [distributed-validation.md](distributed-validation.md). Its collector remains disabled.

The primary portal is on localhost:3002. The replica portal is on localhost:3003, in public/read-only UI mode with collection disabled. Both ledgers run the same application/genesis and communicate over the existing Docker network. Each replica service has its own persistent volumes. Only the public genesis is copied; ledger databases, miner credentials and validator private keys are not copied.

The replica uses an empty generator key file. This tests block validation, replication and transaction forwarding, not independent validator quorum or agreement between miners about measurement accuracy. The original node retains its existing development validator configuration.

From the repository root, with Docker on PATH and the primary stack running:

```sh
python3 deploy/prepare-replica.py
docker compose -f deploy/compose.replica.yaml up -d --build
```

The replica seed points to `trustseco-next-dlt-1:8000`. Its coordinator uses `DLT_ENDPOINT=ws://dlt-replica:7887/rpc-ws`; the original default remains unchanged. Genesis and runtime configuration are ignored by Git and can be recreated with the script. If the primary network/genesis changes, do not reuse an incompatible replica database.

Run the integration check:

```sh
docker cp tests/peer-sync.cjs trustseco-next-web-1:/tmp/peer-sync.cjs
docker exec trustseco-next-web-1 node /tmp/peer-sync.cjs
```

This compares all packages, Requests facts, a common block hash, chain IDs and peer connectivity. On the first run it submits Requests 2.31.0 through the replica using the existing development transaction signer, then checks that the primary includes it and both nodes expose the same package. Subsequent runs skip that mutation if the version exists. No new measurement is fabricated.

## Observed September 7, 2026

- The primary's seed-peer list was empty. A fresh replica with matching genesis and a seed connection successfully caught up without application consensus changes.
- Both nodes reported height 267, finalized height 182 and the same block ID on the first comparison.
- All packages and Requests signed facts matched exactly.
- Requests 2.31.0 submitted through the replica was recorded on both nodes.
- After stopping the replica while the primary advanced, restarting it restored equal current heads at height 276, finalized height 183, with neither node syncing. Packages and signed facts still matched.
- The replica portal returned HTTP 503 after ledger restart because of its cached WebSocket. Restarting the replica web service restored access; the ledger recovered without database intervention.

This establishes local peer replication. It does not diagnose the historical Utrecht servers, which have not been inspected or changed.

## Restarting

```sh
docker compose -f deploy/compose.replica.yaml restart dlt-replica
```

The ledger compiles on startup, as the current development image requires. Wait for it to catch up before checking. The coordinator currently caches its ledger WebSocket client; after a ledger restart it may also require `docker compose -f deploy/compose.replica.yaml restart web-replica`. That is a separate connection-recovery limitation, not a need to resynchronise the database manually.

To stop the experiment while preserving its data:

```sh
docker compose -f deploy/compose.replica.yaml stop
```

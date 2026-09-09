# Distributed validation on the local development chain

Validation is split across four ledger processes on one Mac. This tests process failure, not independent operators or host failure, and does not add agreement on the accuracy of miner observations.

| Ledger | Portal | Assigned development keys | Active voting weight at setup |
|---|---|---:|---:|
| trustseco-next-dlt-1 | localhost:3002 | 26 | 12 |
| trustseco-replica-dlt-replica-1 | localhost:3003 | 26 | 12 |
| trustseco-validators-ledger3-1 | none | 26 | 12 |
| trustseco-validators-ledger4-1 | none | 25 | 12 |

The existing chain has 103 development keys but reported 48 active equal-weight validators at setup. Prevote, precommit and certificate thresholds were 33. Losing any one group therefore leaves 36 active votes at this snapshot. This arithmetic must be rechecked when the active set changes; the reason other development validators are inactive has not been diagnosed here.

## Migration and startup safety

Both original ledgers were stopped before migration. Offline backups remain in `trustseco-validation-backup-primary` and `trustseco-validation-backup-replica`. The two new ledger volumes were seeded from the stopped primary. Generator signing history was preserved, and persisted key records were trimmed per assignment using `deploy/split-validator-store.cjs`.

The development CLI's `--overwrite-config` recopies bundled validator files. Initial verification caught the full key set being reloaded during startup. All four nodes were stopped again, maximum signing-history watermarks were preserved across them, and disjoint stored keys were reapplied. Subsequent runtime verification found no overlapping enabled signing identities. This is not a forensic proof that the initial startup produced no conflicting signatures.

Each node now has its own `/root/.klayr/validator-keys.json` and `/root/.klayr/validator-config.json` in its persistent volume. Normal primary/replica Compose startup detects this config and avoids development config overwrite. The two additional nodes use it directly. Do not manually start these volumes with the old all-keys development config or roll back signing history while other nodes remain active.

The ignored `deploy/validation-runtime/` directory contains local migration material and private development key assignments. Do not commit it. These development keys are not suitable identities for a public production network.

## Running

With Docker on PATH, from the repository root:

```sh
docker compose --env-file .env -f deploy/compose.yaml up -d
docker compose -f deploy/compose.replica.yaml up -d
docker compose -f deploy/compose.validators.yaml up -d
```

These commands operate on the already prepared volumes; this is not a generic fresh-network bootstrap. `prepare-replica.py` describes the earlier observer experiment and does not distribute validators. Nodes have seed addresses for other validators, so the original is not the sole discovery point.

Verify current heads, voting weight and disjoint enabled identities:

```sh
docker cp tests/validator-status.cjs trustseco-next-web-1:/tmp/validator-status.cjs
docker exec trustseco-next-web-1 node /tmp/validator-status.cjs
```

## Failover result

With the original ledger stopped, `tests/validator-failover.cjs` submitted Requests 2.30.0 through a survivor. All three survivors agreed on the resulting chain and exposed the new version. Height advanced from 297 to 298 and finalized height from 227 to 233. See `validator-failover-result.json`.

This establishes transaction inclusion and advancing finality during the outage. It does **not** assert that the new transaction itself reached finality during the short experiment. Only loss of the original node was exercised; loss of every other node, prolonged outages, partitions and machine failure remain separate tests.

The original node was then restarted and caught up to the same head at height 301; the package/fact replication test passed again. Portal coordinators still require a web-service restart after their ledger WebSocket disconnects; automatic connection recovery is a separate known limitation.

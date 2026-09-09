# Community storage layout v1

The Community module now supports individually keyed members, rounds, observations, incidents and signed audit events. A small metadata record stores the governor and collection counts. Numeric key positions preserve canonical order; signed identifiers and payload bytes remain unchanged. A normal observation writes its own record, its audit event, the affected round metadata and collection counts. Unchanged records are not rewritten.

This is the first storage-layout change: legacy trust-fact lists, job lists and package lists remain unchanged. Payouts already use individual records. Nothing is moved off-ledger. The policy still loads and assembles the full community state for validation and snapshots, so reads/CPU remain proportional to history and more small database reads may cost time. Targeted reads and indexes need a subsequent policy-access refactor. The existing 10,000-event cap remains.

## Upgrade

`COMMUNITY_STORAGE_CONFIG` points to JSON containing `activationHeight`; alternatively `COMMUNITY_STORAGE_HEIGHT` supplies it. Zero disables migration. Both nodes must use the same configuration and build, installed before the agreed future height. At the end of that block, the existing state is split into records and the old aggregate key is removed in the block's atomic state transition. Genesis and pre-activation storage writes remain unchanged, allowing replay with the same activation configuration. Preserve this configuration as part of the network definition for future nodes and restores; do not change its height after activation or roll back to an incompatible binary.

The local Compose stack mounts `deploy/community-runtime-15s/storage-layout.json` on both nodes. Fresh preparation writes zero; an existing checkout needs that file created before using the updated Compose file. Activation requires an explicit shared future height. An already-passed height must not be used to retrofit a running node.

Migration is a one-time full rewrite. Large established states require sizing its execution time before choosing a production activation. Existing database files may not shrink until compaction; additional keys also add index/tree overhead. No reset or irreversible evidence deletion is required: removing the aggregate value follows writing its exact contents as individual records.

## Verification and benchmark

`node test/community-storage.cjs` replays 312 signed events through both storage layouts, checks exact reconstructed state and policy-view equality after each event, exercises observations/closures/incidents/appeals/overturn/reinstatement, checks migration idempotence, fails on missing records, and reproduces identical physical key/value state on replay. Ordinary observations write exactly four records. The other 14 community policy tests, 3 payout tests and 10 implemented legacy Jest tests pass; 43 legacy TODO tests remain.

For post-migration updates in this deterministic fixture, serialized values passed to `store.set` totalled 21,949,388 bytes with the aggregate layout and 225,151 bytes with individual records: about 99% less. This excludes the one-time migration, record keys, Merkle-tree changes, transaction/block data and database compaction. It is not a claim of 99% less total disk usage or faster replay. Test keys are generated per run; timings are not used as a correctness assertion.

## Local activation, 8 September 2026

Chain `73657032` activated this layout at height **283**, configured identically in both nodes' mounted storage-layout file. At height 285 (finalized 284), both existing nodes and a temporary node started with an empty database reported `individual-records-v1`. Their community snapshots, excluding current time and the new layout indicator, matched the complete pre-upgrade snapshot exactly: all nine original signed events and every policy decision were preserved. The temporary node synchronized from genesis and crossed the upgrade with the same configuration. No chain reset was performed.

After migration, a signed fixture round, observation and closure were processed successfully (`demo/storage-layout`). With only one contributor it correctly closed unverified/expired. All three nodes agreed on the resulting 12-event state. The temporary replay container was then removed; the two persistent nodes continue running.

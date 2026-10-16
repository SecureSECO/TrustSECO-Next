# Targeted mining reads

The mining client no longer downloads `pilot_snapshot` to find assignments, wait
for a block timestamp, or check whether a signed event was recorded. The full
snapshot remains available for diagnostics and existing portal/publisher callers.
These changes do not alter consensus state, assignment rules, verification,
rewards, or the physical storage layout. No genesis reset is required.

## Read APIs

- `GET /api/pilot/work?member=<id>` / `pilot_work`: contributor admission state,
  own availability lease, relevant live assignments, exact collector targets,
  own observation markers and own collector failure diagnostics. Beacon work is
  included even before a committee has been drawn. Historical observations,
  other contributors' measurement values, balances, payouts and audit history
  are excluded. This is a partial projection, never an input to a state transition.
- Optional `round=<id>` includes a pending envelope's round, even when closed,
  so durable retry/expiry handling is preserved after restart or reassignment.
- Optional `since=<revision>` returns a small `unchanged` response if the projected
  work is identical. The SHA-256 revision hashes the actual projection, not block
  height. Same-height fork changes, revocation and changed assignments invalidate
  it. Chain time, height, finalized height and the test-network flag refresh on
  every response; finality-dependent assignment checks still run in the client.
- `GET /api/pilot/status` / `pilot_status`: small network/clock metadata for the
  observation timestamp wait. An optional member selects a signing identity for
  the relay's admission/signature check.
- `GET /api/pilot/event?id=<id>`: direct event receipt. Both the mining client and
  the relay now use this for inclusion polling instead of fetching snapshots.
  Byte-equivalent payload/signature collision checks and durable envelopes remain.

The client projection cache is capped at 16 origin/member/pending-round entries.
Collector retry entries are removed when the round leaves the relevant work set.
Local fixture miners still reject non-test networks before signing or collecting;
that check uses the work response instead of a separate full snapshot request.

## Storage and remaining limits

The work query reads member metadata and scans round headers in the existing
layout. It only loads escrows for live work (or the explicit pending round), and
only reads observations for relevant assignments. It does not load historical
observations, incidents, audits, balances or payouts. `since` avoids retransmitting
unchanged work; it does **not** skip computing that projection on the validator.
An active-round index/off-chain read model is still needed to eliminate the
O(total rounds) header scan without an unsafe in-memory cache across forks.

The governor's package publisher, some setup reads and portal projections still
use the full snapshot. Those are follow-up targets for dedicated read APIs and
pagination. Block execution itself still loads full policy state; this change is
not a claim that all history-dependent memory/CPU costs have been removed.

## Local verification, 13 October 2026

- 47 ledger/storage/client regression tests passed, including historical pending
  envelopes, duplicate observation suppression, revoked/suspended contributors,
  legacy assignment behavior, signature retries, conditional reads and same-height
  state changes. Two coordinator tests also passed, covering relay behavior,
  targeted HTTP routes, input validation and finalized-height bounds.
- Consensus policy, community and scoring modules were byte-identical to the
  running validator image before rollout (only read endpoint/storage code changed).
- Full snapshot baseline: 2,114,283 bytes, 603 rounds and 1,455 observations.
- Live work responses for six miners: 702–5,426 bytes; unchanged polls: 217 bytes.
  That is at least 99.74% less response data than one full snapshot, before also
  counting removal of the duplicate fixture snapshot and inclusion-wait snapshots.
- Individual targeted reads measured 69–823 ms, unchanged reads 72–247 ms in a
  brief sequential sample. These are diagnostic samples, not a sustained benchmark.
- After worker/web/serving-validator restart, workers used approximately 64–71 MiB
  each. Restart and warm-up affect RAM readings; sustained memory improvement has
  not yet been established.

## Local rollout / rollback

The local serving validator2 uses `trustseco-pilot-ledger:targeted-work`, and web
uses `trustseco-pilot-web:targeted-work`, through the ignored
`deploy/pilot-runtime/recovery.override.yaml`. Keep that override when operating
this network while validator1 catches up. Existing volumes/identities were retained.
Other validators can still execute the identical consensus rules, but do not yet
serve the new read endpoints. Upgrade a node before routing new clients to it.

The previous `trustseco-pilot-ledger` and `trustseco-pilot-web` image tags were not
changed. A rollback also needs the matching old `client.cjs` and
`local-test-miner.cjs`, since fixture workers bind-mount the working-tree tools.
Do not reset or remove ledger volumes as part of rollback.

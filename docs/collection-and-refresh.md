# Full collection, refresh and audit capacity

The `scheduled-v1` collection extension activates through a signed governor event after all existing rounds close. All validators and relays must upgrade together. Historical rounds, signatures, balances and validator signing history remain intact.

## Collection

The shared collection plan covers four GitHub metrics and eight Libraries.io metrics. Forty configured packages therefore produce 480 metric targets. Invalid or missing registry mappings are unavailable targets, not zero-valued facts. Existing attempts are matched by repository, version and metric, including rounds made before this publisher existed. New round IDs are deterministic; an uncertain signed opening is reconciled before another job can be selected.

The publisher opens at most four concurrent rounds, with 15-minute response slots. Each provider gets at most two slots, and only one round per metric runs at a time; less-covered metrics are prioritized so a slow provider or metric does not monopolize publication. The ledger independently caps active rounds at twelve. New work waits for three finalized availability leases, a sufficient bounty balance and advancing finality. A lag over twenty blocks or no finalized-height advancement for three minutes pauses publication. Existing protocol deadlines do not change during an outage.

The observer-assignment protocol still chooses three observers plus a fixed reserve order using a verified future drand beacon. A source failure never becomes a numeric observation or a misconduct incident. Assigned observers can report one signed diagnostic per round: missing credentials, denied access, rate limiting, unavailable source or incomplete source data. They may still submit a successful observation before their slot expires. Failed sources back off; other eligible jobs remain collectable. Provider rate-reset information is respected when supplied.

Packages displays target counts, successful agreement, insufficient contributors, disputes and reported source problems. A reported error is an observer's diagnostic claim, not community-confirmed evidence that the upstream service is faulty. Public GitHub access can hit unauthenticated limits; independent operators should configure their own tokens in Settings.

## Daily refresh and failed-round retry

Every subsequent attempt must link the latest round for that repository/version/metric and start at least 86,400 seconds after its opening. The rule is identical for successful, disputed and expired attempts. There is no immediate redraw after failure. Each new round still commits to a future beacon, keeps its own observations and receives its own escrow. Previous observations and payouts remain inspectable. Existing score policy uses the latest finalized closed round per metric; an unsuccessful new round can therefore remove that metric from the current confirmed score.

The publisher prioritizes untouched metrics before daily refreshes. Repeated source failures are visible and may be retried in the next daily window; they are never replaced by fabricated values. A 24-hour minimum limits repeat selection but does not eliminate strategic withholding, governor admission bias or the need for independent operators.

## Audit capacity

After activation, routine state loads include only the latest 256 audit records. The full append-only audit remains at its original ledger keys. A permanent hash-indexed event lookup rejects replays of older signed events in both command verification and execution. Archived events remain available through `/api/pilot/event?id=...`, and `/api/pilot/audit?before=...` provides pages of up to 200 records. Durable clients use that lookup instead of assuming an event absent from the recent window never happened.

Member review heights are persisted before older audit entries leave the working window. Archived reviews therefore continue to affect confirmation and rewards. The previous 10,000-event rejection threshold no longer stops an activated network, because routine processing no longer materializes the whole audit. Activation is also permitted at that old boundary.

This does not make storage infinite: rounds, observations and payout state still grow and are loaded in memory. Capacity monitoring and testing at the intended workload remain necessary. Future partitioning of historical rounds needs a separate, replay-safe migration; no history is deleted in this change.

## Validator connectivity

The local compose network explicitly lists its four validator services in `TRUSTSECO_FIXED_PEERS`. Startup resolves that operator-controlled list before configuring the SDK, which does not resolve fixed-peer hostnames itself. The installed SDK exempts those fixed peers from its IP ban list and retries their connections. Ordinary seeds are not automatically trusted. If an operator endpoint changes address, restart peers to resolve the updated configuration; independent deployments should use stable endpoints and an explicitly reviewed list.

## Upgrade and acceptance

1. Pause the publisher, let existing rounds close, then stop miners and validators.
2. Back up all four volumes, including generator signing state, plus the current image identifiers and public network configuration. Keep these backups private.
3. Upgrade every validator and relay, retaining the same volumes and signing keys. Confirm a common finalized block.
4. Submit `activate-collection` with the governor key. Wait for finality before restarting publication.
5. Verify that all 480 targets are represented, old attempts are retained, and new rounds cover both providers. Missing API data must appear as a diagnostic, not a zero fact.
6. Check actual observations, agreement, confirmed scores, finality progress, validator outage/rejoin, and remaining work counts. A queue launch alone is not a completed 480-target acceptance test.

## Retry recovery after a fork

The relay may replace a native transaction occupying its next nonce only when it is a mining-availability lease whose expiry is at or before the finalized block's timestamp. Replacement preserves the new signed contributor envelope and the nonce, uses the SDK's ten-unit replacement increment, and caps the increment over the new transaction's minimum fee at 1,000,000 native base units. Unexpired leases, payments and other event kinds are not displaced. A replacement outside this bound fails visibly for operator investigation.

A governor opening left in the durable outbox can also be reconciled against an identical opening finalized under another event ID. The client verifies all signed fields except the ID, the signature and finality; it archives the original envelope with a receipt identifying the canonical event. It does not reinterpret transfers or discard uncertain, different or unfinalized requests.

## Local acceptance — 9 September 2026

[Machine-readable results](collection-acceptance-2026-09-09.json) cover the preserved `8b7bb864` chain on port 3005. The coordinated upgrade activated successfully. A pre-upgrade backup of all four volumes and image identifiers is retained privately.

- 75 ledger tests and 63 coordinator/client tests passed, including the 10,500-event archive case, refresh rules, diagnostic semantics, expired-lease replacement and durable opening reconciliation. Builds passed; ledger lint has one pre-existing warning.
- The UI presents all 480 targets, with at most four concurrent collection rounds. Six local fixture miners are running. Libraries.io is authenticated; GitHub is currently public/unauthenticated.
- Three observers agreed on Black's release count (74, Libraries.io) and open issues (268, GitHub). Both results finalized. Their opening-to-agreement times were 390 and 360 seconds respectively, before the additional finality wait. These are two observations of performance, not a throughput benchmark.
- Archived event lookup returned the original event outside the 256-entry recent window.
- With validator 4 stopped, the remaining three advanced finalized height from 2026 to 2034 during mining. After restart, all four had tip 2041, the same finalized block at 2034, three peers each and no recorded peer bans at the check.
- At the acceptance snapshot: 27 verified targets, 3 collecting, 433 queued and 17 pre-existing attempts without enough contributors. Collection continues; this is not completion of all 480 targets. The old unsuccessful attempts obey the same daily retry interval.

The local upgrade also exposed expired leases in the native transaction pool and a redundant opening after prior fork recovery. The narrowly scoped recovery paths above resolved them without resetting chain data or validator signing safety. Fixed peers restored connectivity, but a longer soak remains necessary to establish reliability under sustained load.

UU deployment, independent operators/hosts, authenticated high-volume GitHub collection and a live 24-hour reward cycle remain release gates in [the deployment checklist](uu-deployment-readiness.md).

> Current upgrade: [availability-aware assignment](availability-aware-assignment.md) adds expiring availability, a verified future beacon and fixed reserves. The commit/reveal description below remains relevant to historical rounds.

# Random observer assignment: experimental policy v2

Implementation branch: `feature/random-observer-assignment`. Original base:
`19e842a3`; integrated collector checkpoints: `4bbf6f9a` and `b2be380f`.
This document describes implemented behavior, not a deployment or a claim of
production-ready unbiased randomness. The legacy community demo is unchanged.

## What changes

After explicit activation, the pilot ledger accepts observations only from three
assigned distinct admitted operators. All three must supply pairwise-compatible,
eligible observations under the existing metric tolerances. Two never suffice.
Assignment and agreement are distinct from the misconduct policy: **three
substantiated incidents trigger review; five trigger suspension within 30 days**.
Disagreement, silence and a failed draw do not automatically create incidents.
Evidence review, appeals, reinstatement, score finality and reward accounting
retain their existing rules.

The initial design favors a small, continuously online pilot. Although only three
operators measure a round, **every active operator in its frozen pool must help
produce entropy**. An offline or malicious participant can prevent completion.
This is an explicit availability limitation, not a threshold randomness beacon.

## State machine and exact timing

1. The governor signs `open` with the usual repository, version, metric, collector,
   duration and bounty. The ledger requires at least three non-suspended,
   non-revoked admitted identities, rejects duplicate operator identities, and
   freezes the full eligible pool, sorted by member ID. Standing `review` remains
   eligible. Later admissions, suspension or revocation never change this pool.
2. The ledger records an assignment context and fixed deadlines. For opening time
   `T`, commitments are accepted at `T <= blockTime < T+300`; reveals are accepted
   at `T+300 <= blockTime < T+600`. Each frozen member submits one signed
   `entropy-commit`, then one signed `entropy-reveal` (32-byte lowercase hex in
   the `contribution` field). No reveal is accepted unless **all** pool members
   have committed. Commitments and reveals cannot be replaced.
3. The final valid reveal determines the only possible seed and committee. No
   caller-supplied seed, committee, nonce or client shuffle is trusted. The ledger
   runs the derivation itself. The output is visible and auditable.
4. Observations are accepted from the assigned three only during
   `T+600 <= blockTime <= T+600+duration`, with `observedAt` in this measurement
   window. A second observation from the same member is rejected. Revoked or
   suspended selected members cannot contribute eligible observations and get
   no substitute. A suspended entropy participant can still reveal an existing
   commitment; a revoked key cannot sign anything.
5. The first block after the close deadline automatically closes unresolved work.
   Missing entropy or fewer than three eligible observations expires the round;
   three incompatible observations dispute it. There are no replacement draws,
   deadline extensions or reduced quorums. Transaction retries within their
   original windows retain the same signed envelope.
6. Existing settlement waits 86,400 seconds after closure. If the current reviewed
   result is verified, the bounty is divided equally among its three supporters;
   the integer remainder returns to the sponsor. Otherwise the bounty is fully
   refunded. No entropy-only payment, withholding penalty, clawback or new mint
   is introduced. Settlement and scores still require their existing finality
   checks; later review does not retroactively reverse an already paid bounty.

The existing 10–3,600 second `duration` is now the measurement duration, following
ten minutes of entropy collection. The existing 10,000 audit-event capacity
also remains: a successful round costs two entropy events per pool operator,
plus opening and observations. Scaling and entropy rewards are future work.

## Randomness derivation and verification

Each honest miner uses `crypto.randomBytes(32)`, saves the secret in a private
`identity.json.entropy/<context>.json` file **before** submitting its commitment,
and reuses it across restarts. These files must survive until reveal completes.
A lost or mismatched secret aborts participation rather than changing the draw.

All hashes below are SHA-256 of UTF-8 `JSON.stringify` arrays, in the listed
order. Numbers are ledger integers; IDs sort by binary JavaScript string order,
not locale. Hex is lowercase.

- Context: `["TrustSECO-assignment-context-v1", network, roundID,
  [lowercaseRepository, exactVersion, metric], [{id,operator},...], T, openHeight]`.
- Member commitment: `["TrustSECO-entropy-v1", contextHash, memberID, secretHex]`.
- Seed: `["TrustSECO-seed-v1", contextHash,
  [[memberID,secretHex],...]]`, in frozen pool order.
- Draw stream block: `["TrustSECO-draw-v1", seedHex, counter]`, starting at zero.

The stream drives the first three steps of Fisher–Yates sampling without
replacement. A 256-bit sample greater than or equal to
`2^256 - (2^256 mod remainingPoolSize)` is rejected before taking the remainder,
so there is no modulo bias. The ledger recomputes every commitment and the
committee. Reordering commit/reveal transactions cannot change the seed.
Replay is deterministic; the hash is a derivation function, **not the source of
unpredictability**. Unpredictability requires at least one honest pool participant
whose securely generated secret remains hidden until commitments are fixed.

The standard miner waits for a finalized opening before committing and for all
commitment heights to be finalized before revealing. It needs a **trusted
validating node** for snapshot/finality information; HTTP JSON is not a finality
proof. These checks are an honest-client security requirement, not a ledger ban
on malicious early disclosure. The ledger enforces phase ordering and commitment
binding, but cannot prove a participant kept a secret. If finality is too slow
for the fixed deadlines, the round fails rather than extending them. Consensus
safety and correct node timestamps remain assumptions. Catastrophic finalized
reorganizations, or an endpoint lying about finality, defeat these guarantees.

## Manipulation and remaining assumptions

**Selective abort is possible.** The last revealer can learn the unique outcome
and withhold its contribution. A block producer can censor a reveal or observation.
They cannot choose a fallback contribution or force an alternative committee for
that same locked fact. Nonetheless, an adversary can ensure that only favorable
rounds finish. The distribution *conditioned on successful completion* must not
be called unbiased. This protocol does not solve the last-revealer problem.

**Same-fact grinding is blocked at the ledger key, with zero redraws.** Once any
round exists for `(lowercase repository, exact version string, metric)`, no new
assigned round for that tuple can open, even after expiry, dispute, settlement,
revocation, or a different round ID. Existing pre-activation attempts count too.
There is intentionally no administrative reset event. This also prevents
legitimate remeasurement of that tuple, including changing current statistics.
Changing the source, registry mapping, package display name, bounty or duration
cannot bypass that key. Transport retries are allowed; fresh measurement rounds
for that exact tuple are not. A scheduled retry/remeasurement policy needs a new
protocol version; do not add ad hoc governor redraws.

**Semantic aliases remain a governance boundary.** A governor can invent another
version string, repository alias or metric target, creating a different ledger
key. The ledger does not resolve registry versions, pin repository numeric IDs,
or prove that two labels describe different scientific facts. Scores remain
scoped to the requested exact repository/version and established metric types;
reporting only favorable aliases or versions is still possible. The implementation
therefore prevents syntactic same-key redraws, not arbitrary semantic grinding
or selective publication. It must not be claimed that a malicious governor
cannot influence the study dataset.

**Governor and Sybil trust remain substantial.** The governor controls admission,
attests operator distinctness, opens work, and reviews/revokes identities. It can
shape the pool before opening, admit Sybils under different operator labels,
suppress work, or revoke selected members to destroy quorum. It cannot replace
them mid-round. GitHub account age (180 days), stable account ID and key ownership
are retained; they do not establish independence by themselves. If all eligible
participants collude, they can precompute/grind their entropy. There must be at
least one honestly random, confidential contribution, credible operator
attestations, and a non-compromised finalized chain.

For a fixed genuinely independent pool of `n` operators with `c` colluders,
a draw in which everyone reveals irrespective of the result selects three
colluders with probability
`C(c,3)/C(n,3)`. This is a model, not measured security. With three colluders among
six operators it is 1/20; with only those three admitted it is 1. Selective abort,
Sybil admissions, malicious finality endpoints and copied observations invalidate
naive use of this probability as the success rate among reported rounds.

**Visible observations can be copied.** Measurements remain plaintext signed
events. An assigned operator can repeat a visible value without independently
querying GitHub or Libraries.io. Assignment prevents unassigned accounts from
piling onto a chosen fact; it does not prove independent measurement or source
truth. Observation commit–reveal could hide values until all three commit, but
would still allow off-chain sharing and common-source errors; it is not implemented.
Do not describe three agreeing signatures as three independently executed
collectors. Review still needs independent evidence, not disagreement alone.

Threshold beacons such as [drand's specified BLS scheme](https://docs.drand.love/docs/specification/)
are a possible future alternative, requiring pinned chain parameters, actual
signature verification, a future beacon round fixed before output disclosure,
and an explicit availability/fork/activation policy. Merely fetching an API
randomness field or hashing a predictable block/round ID is insufficient. See
also the [distributed randomness beacon survey](https://eprint.iacr.org/2023/728.pdf)
for the distinction between bias resistance and liveness.

## Activation and integration: no running-network action performed

This branch changes consensus event semantics. **Do not hot-deploy one validator**
or replay a historical chain with a different genesis policy. Production
`PilotModule` still constructs the identical legacy genesis state. Absent
`assignmentVersion` metadata loads as legacy; existing rounds retain their original
validation, evaluation and settlement behavior. New metadata is stored only on
explicit activation. Assignment records live with their escrow and survive the
existing normalized storage layout without deleting history.

Recommended sequence, to be authorized separately by the network owner:

1. Review/merge this branch into an integration branch containing `b2be380f`.
   Run the tests below and back up a finalized state snapshot and validator
   configuration. Exercise historical replay and activation on a disposable
   network before any real deployment; those multi-validator checks have not
   been performed in this task.
2. Choose and communicate a maintenance/activation checkpoint. Stop new work and
   let all old rounds close and settle, including the 24-hour review interval.
   Upgrade **all** validators and contributor clients together, retaining the
   legacy genesis and network identifier. At this stage opens remain legacy;
   operationally keep publishing paused. Old binaries must not stay as voters:
   they do not understand activation or entropy events.
3. After confirming old settlement finality, submit one governor-signed event
   with body `{"kind":"activate-assignment"}` using the existing durable `event`
   command. The ledger rejects a non-governor signer, unsettled escrow, or repeat
   activation. Wait until this event is finalized. There is no deactivate event.
4. Check `/api/pilot/snapshot`: `policy.assignment` must be `commit-reveal-v1`
   and `policy.version` must be `pilot-assignment-v2` on every validator. Ensure
   at least three genuinely distinct, online, admitted operators have upgraded
   miners. Resume publishing only for unused fact tuples.
5. Confirm an isolated canary reaches commitment, reveal, assigned measurement,
   closure, finality and settlement. Do not replace unavailable pool participants
   or reopen failed work. A rollback after activation requires coordinated
   protocol governance, not simply running the old binary on new state.

Example **for an isolated, separately prepared network only** (URLs and files
must be supplied by its owner; this task did not execute it):

```sh
node tools/pilot/client.cjs event http://localhost:3015 /isolated/governor.json /isolated/activate-assignment.json
node tools/pilot/client.cjs mine http://localhost:3015 /isolated/operator/identity.json
```

Keep entropy files private and backed up until their rounds finish. Expired mining
outboxes are archived beside the identity instead of blocking every future job.
Private files and archived envelopes are not automatically uploaded. Reveals
intentionally publish their secret in the audit trail; automatic pruning of local
files is not implemented.

## Validation

Run from the repository root after installing the normal project dependencies:

```sh
cd services/ledger
npm run lint
npm run build
npm test -- --runInBand
node --test test/pilot.cjs test/assignment.cjs
node test/community.cjs
node test/community-storage.cjs
cd ../..
node --test tools/pilot/client.test.cjs tools/pilot/assignment.test.cjs tools/pilot/libraries.test.cjs
```

Adversarial fixtures exercise signed submissions, duplicate operator/account
admission, pool immutability, commit/reveal deadlines and replay, governor-provided
seed/committee rejection, deterministic reproduction across ordering, withheld
entropy, unauthorized/duplicate observations, no-redraw expiry, incompatible
measurements, refunds/rewards, score finality, revocation, evidence review and
appeals, activation and storage reload. Client tests cover private persisted
secrets, restart/uncertain submission, finality gating, expired-outbox handling,
and refusing provider work when unassigned. Deterministic fixture secrets are
**test-only**. Tests validate code paths; they are not an independent cryptographic
audit, proof of operator independence, or a production liveness measurement.

### Recorded validation for this implementation

- Ledger TypeScript build and lint passed (one pre-existing community non-null
  assertion warning).
- 27 pilot/assignment tests passed, including a six-miner client-to-ledger test
  that produced exactly three collector calls and three rewards.
- Eight Jest suites passed: 10 tests and four snapshots; 43 pre-existing TODOs
  remain and are not counted as completed tests.
- Community policy (14), normalized community storage (2), payout history (3),
  and the score-subset regression script passed.
- Portal production build and coordinator TypeScript build passed; 39 combined
  coordinator, provider, identity and client tests passed.

Tests ran in disposable `trustseco-observer-assignment-test` and
`trustseco-observer-assignment-web-test` images, with container networking disabled
at runtime, no host ports, no production volumes and no Compose services. The web
build used dependency retrieval; it did not run the application. The integration
test uses signed miner events against the actual policy with a mocked provider
and finality snapshot, not a four-validator deployment. No live-network
activation, historical full-chain replay, browser interaction or independent
cryptographic audit was performed.

# Community verification prototype

Open http://localhost:3004/community/. This is an isolated, populated experiment on chain `73657032` (15-second blocks), with fresh keys and its own Docker volumes. Existing nodes on ports 3002/3003 remain on their original chain. The feature is opt-in (`TRUSTSECO_COMMUNITY_PROTOTYPE` in the ledger and `COMMUNITY_DEMO` in the coordinator); ordinary deployments do not register the module or expose its API.

## What it demonstrates

Contributors sign exact, domain-separated event payloads. The ledger validates signatures, identities, replay protection, observation windows and review authority before recording events. Replicas execute the same deterministic policy. Ledger finality is displayed separately from community agreement.

The provisional policy requires three admitted contributors with comparable source/method and observations inside one round. Every pair in a supporting group must differ by at most the larger of 5 stars or 2% of the larger value (rounded down). Exactly one maximal compatible group is required; competing groups, including overlapping groups, are disputed. The representative value is the upper median. An open round's agreement remains provisional until closure. A later measurement belongs in a new round; the tolerance does not grow with elapsed days.

An outlier alone never creates an incident. A reviewer must sign a substantiation referencing an observation in a closed round and supply a root cause, evidence and reason. Three substantiated incidents in 30 days flag a contributor for review; five suspend their verification participation. The same root cause or round counts at most once. Suspension persists until explicit reinstatement. Appeals, overturned incidents and reinstatements remain in the audit history. There are no automatic permanent bans and no changes to validator voting rights.

Suspended contributors may submit observations, but those submissions cannot support verification or earn prototype contribution credits. Current results also exclude observations covered by active substantiated incidents and contributors currently suspended. Closed rounds retain their original result as `recordedResult`; the displayed result is recalculated under current standing. Reinstatement does not retroactively qualify observations submitted while suspended. Credits are an eligibility count, not a payment history.

## Trust assumptions and unfinished integration

All four contributors and the reviewer are simulated. The local coordinator holds their keys to make the demo interactive. Admission uses a trusted reviewer's attestation of GitHub account age (180 days), account identity and distinct operator identifiers; it does not contact GitHub or establish independent people. This does not solve Sybil resistance.

The reviewer is a single trusted governor. Requiring evidence text does not mechanically establish its truth. Distributed review authority, independent evidence checking, key rotation, abuse limits and governance rules remain future work. The two nodes replicate policy state, but the prototype producer controls all four fresh validator keys; this experiment does not demonstrate independent validator operators or host-failure resilience.

This iteration supports star-count fixtures. It does not connect live spider jobs to rounds, replace the existing Trust Score inputs, or issue DAO rewards. Those integrations should follow agreement on the policy and adversarial tests. The entire prototype state is stored as one JSON value, capped at 10,000 events; production needs indexed stores, bounded processing and an explicit upgrade strategy.

Only expose the demo on localhost. The API's origin/header checks prevent ordinary cross-site browser submissions; they are not production user authentication. Do not publish the simulated private keys or reuse them in a shared network.

## Reproduce on a fresh checkout

Run from the repository root with Docker available. The preparation command refuses to replace an existing validator identity. Keep `deploy/community-runtime-15s/` private and ignored by Git.

```sh
docker build --platform linux/amd64 -t trustseco-community-ledger services/ledger
mkdir -p deploy/community-runtime-15s
chmod 700 deploy/community-runtime-15s
docker run --rm --platform linux/amd64 \
  -v "$PWD/deploy/prepare-community.cjs:/usr/src/app/prepare.cjs:ro" \
  -v "$PWD/deploy/community-runtime-15s:/prototype" \
  trustseco-community-ledger node prepare.cjs
docker run --rm --platform linux/amd64 \
  -e TRUSTSECO_COMMUNITY_PROTOTYPE=true \
  -e COMMUNITY_GOVERNOR_FILE=/prototype/governor.pem \
  -v "$PWD/deploy/community-runtime-15s:/prototype" \
  trustseco-community-ledger sh -c 'npm run build && ./bin/run genesis-block:create --config /prototype/config.json --assets-file /prototype/genesis_assets.json --output /prototype'
docker compose -f deploy/compose.community.yaml up -d --build
python3 tests/community-demo.py
```

The population test requires an empty audit and refuses to overwrite an existing experiment. On subsequent starts, just run the Compose command. Use `docker compose -f deploy/compose.community.yaml stop` to stop the experiment while retaining its data.

## Validation, September 8, 2026

- Fourteen policy tests passed (`npm run build && node test/community.cjs` in `services/ledger`). Ledger lint passed with one non-null assertion warning; coordinator TypeScript and portal production builds passed.
- The existing ledger Jest suite also passed: 8 suites, 10 implemented tests, with 43 existing TODO tests still unimplemented.
- The live population test recorded 43 signed events: four enrolments, five rounds with three compatible observations and an outlier, five substantiated incidents, an appeal, and an excluded suspended submission.
- Both ledger nodes returned identical snapshots at height 91, finalized height 90. The last fixture event was at height 61, so all fixture events were finalized.
- Restarting the replica preserved all 43 events and recovered identical policy state. The API rejected a cross-site mutation with HTTP 403.
- Simulated Dana reached review after incident three, suspension after five and zero eligible credits. Alice, Bob and Carol each had five eligible contributions.

These tests demonstrate implemented behaviour, not that the chosen trust policy is empirically justified. See [paper notes](paper-notes.md) for the research questions.

## 15-second experiment

The original three-second chain (`73657031`) is retained in Docker volumes `trustseco-community_ledger` and `trustseco-community_replica`, with identities in `deploy/community-runtime/`. The current Compose deployment uses separate `ledger15` and `replica15` volumes and `deploy/community-runtime-15s/`. This avoids changing consensus timing midway through an existing history. The 43-event results above describe the original experiment.

The form now defaults to a 180-second observation window. The full population script uses 120-second rounds and longer inclusion waits; it takes longer with 15-second blocks. Three contributors are still required. Two compatible observations remain pending until closure, then expire without verification. Do not lower the quorum automatically for a small network: fewer nodes or identities must not silently weaken the claim. Additional nodes under the same contributor identity do not add votes.

The fresh-chain smoke test is `python3 tests/community-small-network.py` (choose this or the full population script on an empty chain). It checks the transition from two pending observations to three compatible observations and a closed verified round. Measured consecutive block intervals on the new chain were 15 and 15 seconds.

# Live community verification and TrustCOIN

This is a separate network and application entry point. It preserves the existing community demonstration at port 3004. The local integration network uses port 3005, chain ID `73657033`, four separately keyed validator processes and 15-second blocks. All local test identities are explicitly labelled: separate processes on this Mac are not independent operators.

## What is connected

`tools/pilot/client.cjs` collects public GitHub repository data, signs observations using the contributor's own Ed25519 key and submits signed envelopes. The relay holds only a separate transaction-fee key. It cannot impersonate contributors or the governor. Its entry point is `dist/pilot.js`; legacy account, token and demo-actor write routes are unavailable.

Four collector types are supported: repository contributors (including anonymous contributors), open issues excluding pull requests, GitHub's last 52 weeks of commit activity, and the sum of stars across the owner's public repositories. The latter deliberately matches the existing score's owner-star metric; it is not the star count of just one repository. Failed/incomplete sources do not become zero-valued facts. A failing collector backs off without blocking the other collectors.

These are current repository measurements associated with a package version. They do not reconstruct historical repository statistics for that version. The signed observation includes its source URL, timestamp and response hash; full GitHub responses are not archived by this client, so the hash alone does not guarantee later source availability.

The governor publishes a funded round specifying repository, version, metric, collector method, window and bounty. Contributors each submit at most one observation per round. All three-or-more members of an agreeing group must be pairwise compatible. Ambiguous overlapping groups remain disputed. Current metric tolerances are:

| Metric | Absolute tolerance | Relative tolerance |
| --- | ---: | ---: |
| Owner stars | 5 | 2% |
| Contributors | 1 | 1% |
| Open issues | 1 | 1% |
| Yearly commits | 2 | 2% |

The larger absolute/relative bound applies. These are explicit initial policy choices, not empirically validated thresholds. Rounds last 10–3,600 seconds. Measurements two days apart belong to different rounds. Two contributors never lower the quorum. An outlier receives no automatic misconduct strike: the governor must substantiate a review with evidence. Existing appeals and reinstatement remain available.

## Identity admission

Use Node 18 or newer on the contributor's machine:

```sh
node tools/pilot/client.cjs init YOUR_GITHUB_LOGIN /private/operator/identity.json
node tools/pilot/client.cjs join https://YOUR_PORTAL /private/operator/identity.json /private/operator/join.json
```

`init` prints only the public SSH signing key. The contributor adds it as a GitHub **SSH signing key**, then shares `join.json` with the governor. Never share `identity.json`. The admission tool fetches GitHub's public profile and SSH signing keys, checks the account is at least 180 days old, verifies possession of the matching private key through a network-bound signed join request, and records the stable numeric GitHub ID. The governor attests operator independence:

```sh
node tools/pilot/client.cjs admit https://YOUR_PORTAL join.json /private/governor/identity.json OPERATOR_ID
node tools/pilot/client.cjs mine https://YOUR_PORTAL /private/operator/identity.json
```

Optional `GITHUB_TOKEN` is read from the worker's environment for API rate limits; it is never sent to the relay. Put each operator's identity and outboxes in a private directory. Production containers must mount only that operator's directory. GitHub age and key ownership do not prove distinct people. Admission is permissioned, with one accountable governor; validators verify the governor's signed attestation rather than contacting GitHub during block execution.

## Funded work and payments

Fresh genesis creates exactly 1,000,000 integer TrustCOIN in the governor treasury. These are application-ledger balances, separate from Klayr's native transaction-fee token and the older DAO's credit balances. No legacy balances are imported and no enrolment bonus is minted.

To publish work, save this JSON and use `client.cjs event PORTAL GOVERNOR_IDENTITY FILE`:

```json
{"kind":"open","round":"flask-issues-1","package":"pallets/flask","repository":"pallets/flask","version":"3.1.2","metric":"gh_open_issues_count","source":"GitHub REST","method":"github-rest-v1","duration":300,"bounty":"300"}
```

The bounty leaves the sponsor's available balance immediately and enters escrow. Expired rounds close automatically in block execution. At least **86,400 seconds after closure**, eligible supporters share the bounty equally, using integer division. Remainders and unresolved bounties return to the sponsor. Block timestamps govern the delay; a halted chain does not execute payouts until block production resumes. The settlement block must itself finalize before payment is final.

Balances, escrow and payment records change atomically in chain state. A settled escrow cannot pay twice. There are no external payment side effects. Contributors can transfer earned balances with a signed event such as `{"kind":"transfer","recipient":"OTHER_LOGIN","amount":"10"}`. The CLI retains the exact signed event in a durable outbox across timeouts. Do not delete an uncertain transfer's outbox and create a new event: reconcile the existing event first.

Review before settlement changes eligibility. Review after settlement preserves payment history and does not automatically claw back balances. Revocation disables a compromised contributor key; it does not erase observations or transfers. Key rotation/recovery and compensating-payment governance still need a release policy.

Confirmed scores use only closed, currently corroborated rounds whose closure has finalized. The latest closed round per metric wins; a newer disputed round suppresses the older value. Unfinalized review events conservatively suppress confirmed inputs until finality catches up. The score uses the existing formula, with coverage shown. Four implemented metrics do not represent complete software trust or all legacy collectors. The standalone portal currently focuses on this pipeline; it does not replace every legacy portal feature.

## Genesis and independent validator custody

Each validator operator runs `validator.cjs` locally inside the ledger image and shares **only** `public.json`. `genesis.cjs` assembles four public bundles, checks distinct addresses/generator/BLS keys and BLS proof of possession, and requires a separately generated public relayer key. It assigns equal native self-stakes and corresponding locked token balances. Without positive stakes, the SDK's initial four-validator bootstrap does not preserve four active validators after its initial rounds. The assembly process never reads validator private keys. Operators must compare the common genesis blob hash, manifest, governor public key, network ID and reviewed image digests out of band.

`prepare-local.cjs` is explicitly a local integration helper that creates all test keys on one machine. Do not use it to claim independent custody. The governor private key is not mounted into a service. Each validator mounts its own validator key directory.

For a fresh local test, build the images, then run:

```sh
docker build --platform linux/amd64 -t trustseco-pilot-ledger services/ledger
docker build --platform linux/amd64 -t trustseco-pilot-web --build-arg PILOT=true --build-arg PORTAL_HOST=localhost:3005 -f deploy/web.Dockerfile .
docker run --rm --platform linux/amd64 -e NODE_PATH=/usr/src/app/node_modules \
  -v "$PWD/tools/pilot:/tools:ro" -v "$PWD/deploy/pilot-runtime:/runtime" \
  trustseco-pilot-ledger node /tools/prepare-local.cjs
docker run --rm --platform linux/amd64 \
  -e TRUSTSECO_PILOT=true -e PILOT_NETWORK=trustseco-73657033 \
  -e PILOT_GOVERNOR_FILE=/pilot/governor.pem \
  -v "$PWD/deploy/pilot-runtime/shared:/pilot" trustseco-pilot-ledger \
  sh -c 'npm run build && ./bin/run genesis-block:create --output /pilot --assets-file /pilot/genesis_assets.json --config /pilot/config.json'
docker compose -f deploy/compose.pilot.yaml up -d
```

For explicitly labelled local fixture identities only, run `local-fixtures.cjs` in the web container's network namespace, mounting `pilot-runtime/governor` at `/governor` and `pilot-runtime/contributors` at `/fixtures`. Then `docker compose -f deploy/compose.pilot.yaml --profile mining-test up -d` starts workers, each with only its own identity directory. Real operators use the admission flow above instead.

Preparation refuses to overwrite keys/genesis. Preserve the existing network if the directory already exists. The new module is opt-in through `TRUSTSECO_PILOT`; never enable it on an existing production chain without an agreed migration. This implementation deliberately selects a fresh genesis, with old networks retained separately.

## UU rollout and remaining gates

`deploy/compose.pilot-operator.yaml` describes one operator with one validator. It exposes HTTPS and P2P, not raw RPC; Caddy terminates TLS and the relay accepts signed writes only. It requires explicit image references, DNS, public genesis, local validator keys and a funded relayer key. Supply reviewed immutable digests. The template is preparation, not evidence of deployed UU certificates, firewall rules or independently held keys. A second relay needs its own funded native-fee account; coordinate those accounts before the production genesis rather than copying a fee key between servers.

Four equal validators target a three-validator quorum. Losing one process should permit progress; losing two should halt finality. Placing two validators on each of two hosts does not tolerate losing either host. Select operators and failure domains accordingly. Seeds are discovery contacts, not a permanent head node.

`backup-local.sh` stops one validator for a consistent archive and restarts it afterward. The backup includes public network configuration and an image identifier. **The SDK also persists private signing keys in `data/generator.db`, so the archive is secret material.** Store archives privately, encrypt off-host copies, and maintain operator-controlled key backups.

An empty keys file does not disable restored keys: SDK startup adds file keys to its database and then loads the database. The first local restore test caught this and was stopped. `restore-observer.sh` now explicitly excludes `generator.db` during extraction into a new volume. Start that observer with an empty keys file and verify `generator_getStatus` returns no keys. Never apply this stripping procedure to an active signing validator, run two copies of the same validator, or resume signing from a rolled-back generator database without preserving anti-double-signing state and checking the SDK's recovery procedure.

Remaining rollout work: real operators and UU SSH access (deferred by the owner), approved production genesis and funded relay accounts, actual DNS/HTTPS/access-control verification, encrypted off-site key/archive custody, key-recovery governance, operational alerts, and a real 24-hour payout plus failure/rejoin test across independent hosts. The current policy also has a 10,000-event capacity and reconstructs state in memory; it needs a capacity/retention design before sustained public mining. This local test does not establish production readiness.

## Local verification — 8 September 2026

- Ledger TypeScript build and lint pass (one pre-existing non-null assertion warning in the shared community policy).
- Policy/storage/payout/score regression run: 32 passing Node test entries. Client admission, incomplete-source and durable-transfer-retry checks: five passing tests. Existing Jest suite: 10 passing tests and four passing snapshots; its 43 pre-existing TODO tests remain TODO.
- Three locally generated signers each fetched all four live Flask metrics: 864 contributors, one open issue, 55 commits in the GitHub yearly statistics and 119,174 owner-wide stars. All 12 observations reached the ledger. At height 88/finalized height 82, all four rounds were closed and corroborated. The existing formula returned **52.55**, based on four verified metric types out of 21 possible formula inputs.
- Legacy unsigned demo writes return HTTP 404 on the separate relay; a forged governor signature returns HTTP 403. The UI labels the test identities and shows real on-chain results.
- The initial zero-stake configuration failed the outage check after bootstrap. Equal self-stakes were submitted on the running test chain; the future-genesis generator now includes them from genesis and passes SDK genesis validation. On the corrected network, stopping validator 4 left the chain progressing from height 69/finalized 64 to height 73/finalized 66. Validator 4 was restarted afterward.
- The initial restore exposed persisted generator keys and was stopped. The corrected observer had **zero generator keys** and matched the live node at height 73/finalized 66, with identical application-state hash `5a50c8d784bb3bcf58f7eb9651bd29a4b3e67d95c5ff8ab2aa15e4cbe6375d9b`.
- Live payouts remain zero until the actual 24-hour review period elapses. The boundary, conservation, refunds, spendable balances and duplicate-settlement prevention are exercised with deterministic clocks in tests; this is not a claim that a real 24-hour payout has already occurred.

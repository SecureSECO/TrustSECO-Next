# TrustSECO server deployments — 14 October 2026

Live portal: https://trustseco1.science.uu.nl/ . Reviewer installation: https://trustseco1.science.uu.nl/reviewer/ . The existing `trustseco-8b7bb864` network, genesis, evidence and signing identities were migrated with the owner's explicit approval, including shared API credentials. No friends' credentials are needed for the demo.

## Runtime

SSH through `slinger@up.science.uu.nl` to `root@science-vs396.science.uu.nl`. Runtime directory: `/datadisk/trustseco/deployment-20261014/runtime`, Compose project `trustseco-uu1`. Run Compose commands there. Source template: `deploy/compose.uu1.yaml`; runtime copy is `compose.yaml`. Private files are root-owned, directories mode 700 and files mode 600. Never publish the runtime archive or backups.

Ledger image: `sha256:406d2d7376873e596fdcbc40c95265209b9a666e0e3b083b3a8f2a27fbc16972`. Web image: `sha256:f96f743782b958d7d9956b19baa1e464527a0a1ecdc38237d872581e24106635`. Immutable IDs are in `.env`. Reviewer tag: `trustseco-reviewer:uu-20261014`; published archive SHA256: `dd51d23e39fc16bae76bb8fc429bb6ddb8d0db9776e2750481f06e7c923caf4d`. The reviewer archive contains code, not operator runtime data. It is Linux AMD64; Apple Silicon requires Docker emulation.

One ledger process holds all four original bootstrap signing identities. Three labelled operator fixture contributors, publisher, automatic admission, portal, Caddy and ClamAV run independently of the laptop. Governor publisher/admission outboxes use separate directories. Ports 80/443 serve the site, 8000 serves peers; web port 3000 is loopback-only and ledger RPC is not published. Caddy renewed the certificate successfully: 14 October 2026–12 January 2027, Let's Encrypt YE2; HTTP redirects to HTTPS. Keep Caddy's persistent data for automatic renewal.

## Migration evidence

Stopped local signing before taking four offline volume backups in ignored `deploy/uu-runtime-20261014/backups/`; checksums are recorded there. The node2 chain snapshot was restored with generator keys stripped, and checked as an observer before enabling signing. Maximum signing-history watermarks from all four nodes were merged using `deploy/merge-signing-history.cjs` and restored with the four original keys. This avoids rolling back the anti-double-signing history.

Original preserved checkpoint: height 40322, block `c8857e48acce63fd1363a6a4c923fa4b7d5b17d7849d9e77ff8887cc6e125e36`. Voting activation event `activate-github-voting-uu-20261014` was recorded at 40342 and finalized. Post-activation server and laptop both matched finalized block 40370: `5453cfd722e34736e24652237c389dd9c2c599c14f5efc406f3a37dec23a0201`. Server advanced to height 40384/finalized 40379 during verification, with four enabled generators; the laptop had no enabled generator.

Local `keys.json` files are empty; retired originals have suffix `.moved-to-uu-20261014`. Stored generator keys were removed from all four local volumes while preserving signing histories. Do not restore or run those retired keys. Only local validator2 is running, as a non-signing replica, using the private `deploy/pilot-runtime/uu-observer.override.yaml` override with the UU peer configured. Resume it from the repository with:

```sh
docker compose -f deploy/compose.pilot.yaml -f deploy/pilot-runtime/uu-observer.override.yaml up -d --no-deps validator2
```

Do not launch the entire old local demo stack. Historical archives and the stopped migration observer are retained for recovery. The old UU application remains archived under `/datadisk/legacy-archive-20261013T140843Z`.

## Demo and reviewer acceptance

All five target packages have local and confirmed scores: Requests 2.34.2, pandas 3.0.5, NumPy 2.5.3, HTTPX 0.28.1 and cryptography 50.0.1. Readiness is checked with:

```sh
docker exec trustseco-uu1-web-1 node tools/pilot/demo-readiness.cjs http://localhost:3000 /queue/packages.json
docker compose ps
docker compose logs --tail 30 publisher worker-a worker-b worker-c
docker stats --no-stream
```

The publisher opened new collection rounds after migration (645 restored rounds grew to 651). GitHub authenticated successfully (HTTP 200). Libraries.io currently returns HTML HTTP 403 from UU; workers record/retry provider failures instead of fabricating values. Existing evidence is preserved, but future refresh coverage may decline until that upstream access issue is resolved.

Equal voting weight is active: four seats, each weight one, threshold three, rotating every 16 blocks. GitHub eligibility requires a personal account at least 180 days old and publishing the reviewer's generated SSH signing key; admission and voting then require no administrator intervention or reviewer API token. Optional collection credentials remain separate. The live portal links the installer. Real external GitHub reviewer admission has not yet been exercised end-to-end on UU; isolated admission/rotation/leave/resume tests passed before rollout.

## Operations and remaining limits

The 4GB host runs the bounded services, with roughly 0.85GB available and 0.14GB swap used during initial collection. ClamAV is healthy and consumes about 1GB. This is initial verification, not a long load soak. The requested RAM upgrade remains useful.

Server2 is deployed as a non-signing replica with its own portal. All bootstrap voting identities currently share Server1, so consensus still has one failure domain. Operator fixture contributors are labelled and do not represent independent humans. Abrupt loss of two active voters can halt the four-seat committee; rotation does not remove that limitation.

For a web update, preserve `.env`, load the image, update `WEB_IMAGE`, stop admission/publisher/workers, then recreate web and those sidecars together: they share web's network namespace. The ledger need not restart. `.env.before-web-final` records the previous web image. Do not roll back to a ledger without the activated voting module or restore stale signing history. Before moving signing again, stop the current signer, capture its latest chain and signing history, verify a non-signing restore, then transfer the identity once. Encrypted off-site backup and full recovery exercises remain release gates.

## Node-owned web interface discovery

Each ledger node optionally sets `TRUSTSECO_WEB_URL` to its own public HTTPS interface. Leave it unset on nodes without a public web client, including the laptop. No shared directory or hostname list is required. The ecosystem page places an “Open web interface” link directly on each connected node's card only when it advertises a valid URL. Disconnected peers leave this view; it is not a global directory.

The SDK adapter (`services/ledger/prepare-peer-web.cjs` and `peer-web.cjs`) adds an optional peer RPC, `trustseco_getWebInterface`, and local RPC `network_getWebInterfaces`. Protocol minor version .1 signals support while retaining the configured major version (this deployment uses 2.1). The existing handshake codec and consensus state are unchanged. Older .0 nodes remain compatible and are never queried for the unsupported RPC. The adapter is applied during ledger builds and fails if its SDK integration point changes.

Metadata is cached for at most one minute, requests time out after two seconds, disconnected entries are discarded, and absent, malformed or unavailable metadata produces no link. URLs must use HTTPS without embedded credentials, query or fragment. They are node-advertised links, not verified endorsements; the server never fetches them. Future public nodes only need to configure their own URL and join the network using a build with this capability.

TrustSECO1 advertises `https://trustseco1.science.uu.nl/`. The laptop advertises no interface. TrustSECO2 advertises `https://trustseco2.science.uu.nl/`; the hardwired TrustSECO1/2 directory and “Coming soon” entries have been removed.

Verified after rollout: the upgraded laptop remained connected to the older 2.0 server and synchronized to block 40725 before server upgrade. After upgrade, its `network_getWebInterfaces` discovered `https://trustseco1.science.uu.nl/` from the server peer; the public server API showed its own URL and `null` for the laptop. The laptop's generator remained disabled. Three adapter/compatibility tests and all 12 existing portal API tests passed. The published reviewer image remains compatible using protocol 2.0 and has no public web interface; future ledger builds include the optional capability.

## Homepage overview snapshot

The homepage now uses `/api/dlt/overview` instead of a package-list request followed by 24 measurement/score requests. `pilot_overview` loads ledger state once, projects observations and scores at a common block/finality boundary, and returns score pairs for collected package versions. The coordinator shares an in-flight read between visitors and caches the snapshot for five seconds; search filtering is applied independently per request. Failed refreshes do not silently serve an expired cache. Catalogue entries without observations retain null scores.

Measured over HTTPS after deployment: 0.603 seconds for the initial overview and 0.078 seconds for a cached request, compared with 12.701 seconds for the previous homepage request sequence. These are data-loading measurements, not full browser navigation timing. Thirteen portal tests passed, including concurrent snapshot sharing, filtering and finality-aware observations. The previous runtime image IDs are retained in `.env.before-overview`.


## TrustSECO2 deployment

Live portal: https://trustseco2.science.uu.nl/ . SSH through the same stepping stone to `root@science-vs397.science.uu.nl`. Runtime: `/datadisk/trustseco/deployment-20261014/runtime`; Compose project `trustseco-uu2`. Source templates are `deploy/compose.uu2.yaml` and `deploy/Caddyfile.uu2`. The ledger image is the same immutable ID as Server1; the Server2-specific web image is `sha256:6dbcad25cca337caa5f62ab34bd8d78cccc5c42081ecd3fc63219f918fb388c7`.

Server2 has its own synchronized ledger and serves reads locally. Its sanitized snapshot came from the stopped laptop replica, with generator keys removed and all copied configuration, logs and temporary files discarded before transfer. Only clean public configuration and an empty validator key list were installed. No API credentials, private governor/contributor/relayer keys or validator signing keys were transferred. Moving one validator identity remains subject to separate approval; Server1 has four enabled generators and Server2 has zero.

The coordinator supports `PILOT_READ_ONLY=true` without a relayer key and rejects direct signed-event submissions with HTTP 503. Public Caddy forwards submission/admission POSTs and reviewer downloads to Server1, where the authorized credentials and collection workers remain. Thus these features depend on Server1 even though Server2 reads independently. The package catalogue was copied at deployment; it is not a continuously synchronized queue file.

Server2 retains its own existing Let's Encrypt YE1 certificate, valid 3 September–2 December 2026. Its previous Caddy data and configuration were copied into the new persistent runtime directories, preserving automatic renewal. External verification returned HTTPS 200 with successful certificate verification and HTTP 308 redirecting to HTTPS. Caddy is pinned to `sha256:685ae3d7c34d9b5f8caeddc5d14051db7bbd88ff1f5a2fa0c16bd8ca328fb7af`.

Both nodes reported height 41399, finalized height 41394 and identical block 41390: `6de976fe57f93484448fe1158ba9c1b670e0136532efcb4649533182a3399d83`. Server2 reported `syncing=false`. Both public peer APIs discovered the other server's web URL automatically. All five demo packages passed the readiness check on Server2. Initial overview requests took approximately 0.52 seconds on Server1 and 0.58 seconds on Server2. Fourteen coordinator tests passed, including rejection of writes in read-only mode.

Server2 containers used approximately 278 MiB (ledger), 116 MiB (web) and 13 MiB (Caddy) during verification; the host had about 1.8 GiB available RAM. Limits are 1024/512/128 MiB respectively. Ports 80/443 and peer port 8000 are public; web port 3000 is loopback-only and ledger RPC is internal.

The old Server2 application remains at `/datadisk/SecureSECO`, with a root-only backup and original container metadata at `/datadisk/trustseco/legacy-backup-20261014/`. Old containers were stopped and their restart policies disabled; their volumes remain intact. Never start both stacks together because they compete for public ports. Any rollback must first stop the new stack and explicitly restore the intended old restart policies from the saved metadata. An old application rollback does not constitute a rollback of the current network's consensus state.

Verify Server2 with:

```sh
cd /datadisk/trustseco/deployment-20261014/runtime
docker compose ps
docker exec trustseco-uu2-web-1 node tools/pilot/demo-readiness.cjs http://localhost:3000 /queue/packages.json
docker compose logs --tail 30 ledger https
```

## Libraries.io request budget (14 October)

The three Server1 mining workers now use worker-only overlay image `sha256:c5861bf21f6fb052ffe26465c5c864c784a3588b3c5b288f55ee6bdc350be42f`, built with `deploy/Dockerfile.worker-budget` on the existing worker image. `WORKER_IMAGE` pins it in runtime `.env`; ledger/web images are unchanged. The build context is `/datadisk/trustseco/worker-budget-20261014`. Runtime `compose.yaml.before-libraries-budget` and `.env.before-libraries-budget` preserve rollback configuration. To rebuild, use a local tag of the intended base image as `WORKER_BASE_IMAGE` (a bare `sha256:` ID is not a Dockerfile image reference).

Libraries.io responses are cached in memory for 60 seconds per contributor/credential/URL, bounded to 64 entries and 8 MiB of serialized payloads. Fetch timestamps are retained; a response predating the contributor's assignment window is fetched again. Response data is never shared between contributors. Restarts clear response caches.

All three workers mount `./provider-state:/provider-state` and set `LIBRARIES_REQUEST_STATE_DIR=/provider-state`. A synchronous filesystem lock coordinates request starts (one every five seconds, at most 12/minute across these workers), with persistent provider-wide cooldown state. This is a conservative operator setting, not a claimed Libraries.io quota. HTTP 401/403 starts a 30-minute cooldown; 429 starts at one minute and honours Retry-After; repeated HTTP errors increase the delay up to six hours (a longer Retry-After is honoured). The already-observed 403 was used to initialize a 30-minute cooldown during rollout. Provider-budget deferrals do not submit failed-observation events. GitHub traffic is unaffected. Other processes/hosts are not included in this shared budget unless explicitly configured with the same state directory; Settings credential checks remain separate.

Validation: 23 mocked tests across libraries-request, libraries, credentials, collection-client and client passed in a network-disabled container. Tests cover independent contributor caches, persisted cross-instance cooldowns, request spacing, Retry-After, expiry, original timestamps, assignment-window freshness, bounded cache size and sanitized network errors. This change does not remove Libraries.io's IP restriction.

## Server2 mining and top-50 collection

With explicit approval, dormant fixture identities `test-d`, `test-e`, and `test-f` and the configured GitHub credential were transferred over SSH to Server2, stored under private runtime `contributors/` and `credentials/` directories. Libraries.io credentials were deliberately omitted pending investigation of the Server1 IP restriction. The local worker containers are stopped with restart disabled; their source identity directories were renamed `test-*.moved-to-uu2-20261014` to prevent accidental duplicate execution. These remain operator-controlled test identities, not independent people. No governor, relayer or validator signing keys were transferred.

Three Server2 workers run `tools/pilot/server-test-miner.cjs` against `https://trustseco2.science.uu.nl`, which serves local reads and forwards signed submissions to Server1. Worker image `sha256:f0461f25f3e7132c8f84ef061406c7e9e873445d309fff3c7614e502271b86df` is pinned as `WORKER_IMAGE`. Build recipe: `deploy/Dockerfile.server-worker`; source staging `/datadisk/trustseco/server-workers-20261014`. Backups: runtime `compose.yaml.before-workers` and `.env.before-workers`. Each worker is limited to 224 MiB with a 96 MiB JS heap and polls every 15 seconds. A private ClamAV service uses the same pinned image/config as Server1, limited to 1400 MiB and half a CPU. Its port is not published. The module-load and syntax smoke checks passed; all six contributors had live availability leases after startup.

`deploy/top50-pypi-20261014.json` records the top 50 PyPI projects from the October 1 hugovk download ranking, with current exact versions resolved from PyPI on October 14. Source links came from project metadata, with pluggy resolved from its package description and protobuf from its official documentation. The list contains 49 distinct repositories because pydantic-core and pydantic share a repository. Both runtime queues were merged with this list, preserving prior targets: 48 additions, 53 version targets, 50 registry projects. `demo` was set false for balanced collection; the existing four-active-round bound remains. Queue backups are named `packages.json.before-top50-*`. The single publisher stays on Server1; Server2 is a collection/submission node, not the publisher. Initial new jobs for boto3 security, malware and Stack Overflow metrics appeared on the replicated ledger.

At 10:19 UTC Server2 had 3969 MiB total RAM, 674 MiB available and 198 MiB swap used. ClamAV was healthy and used about 955 MiB; the three workers used 29–33 MiB each, ledger 560 MiB and web 80 MiB. A short vmstat sample showed negligible swap activity. Ledger height 41561/finalized 41556, six available contributors. These are initial samples, not evidence of a long-term plateau. Read-only heartbeat `monitor-trustseco2-package-collection` checks every 30 minutes until October 15 10:30 UTC, reporting actionable pressure or progress. Samples are stored in ignored `deploy/pilot-runtime/uu2-resource-monitor.jsonl`.

## Inconclusive ClamAV scans

All six UU mining workers now persist artifact-level diagnostics for ClamAV limits, encrypted-content and broken-executable warnings. These are recorded as `source-incomplete`, never as clean observations or malware detections. Records include registry package/version, release filename, SHA-256, engine/signature version, warning and retry time. Each contributor retains its own records under its existing private `/identity/scan-diagnostics` mount, bounded to 200 entries. The cache key covers artifact hash, engine/signature version and scan-policy identifier. Workers defer the affected round for six hours; a subsequent eligible collection with changed content or engine does not match the saved diagnostic. Records survive worker restarts. The entire release's saved diagnostics are checked before any artifact download. Unexpected scanner replies have a five-minute backoff and identify the artifact. UI copy was checked: it already states that zero detections does not prove safety.

Live reproduction on Server2 identified `packaging-26.3.tar.gz`, SHA-256 `94edc256424af38762eb31306eed28beb9f0efc50a8837492c9d6fd6004aed79`, as the release archive triggering `Heuristics.Broken.Executable`. This identifies the archive, not an internal member or root cause; it is not proof of malicious code. The diagnostic-only reproduction made no ledger submission. Tests: 23 collector/cache tests passed offline, including persistence, expiry, changed signatures, partial-clean rejection and whole-release preflight.

Worker-only overlays use `deploy/Dockerfile.scan-diagnostics` and retain each server's prior image. Final Server1 image: `sha256:c339921e6b66d2ab959ff6b1da9811bec2550f728d41f7f207421e15db005a30`; Server2: `sha256:e88b3b75a6776cccd4b69d8f40eb7681b6f2f5ba50591e3d62eab5e09954e146`. Runtime `.env.before-scan-diagnostics` records the original image; `.env.before-scan-diagnostics-v2` records the intermediate image. Only worker containers were recreated. No consensus schema, scanner configuration or ledger history was changed.

## Additional 100 Python projects

At the user's request, both UU runtime queues were expanded by exactly 100 distinct registry projects to **150 projects / 153 version targets**, preserving existing versions and the four-active-round concurrency limit. `deploy/next100-pypi-20261014.json` records the exact selection, pinned versions and nine skipped ranking entries. The selection proceeds through ranks 51–159 of the same October download ranking, skipping absent GitHub mappings and repository/version collisions that the current identity model cannot represent separately. `sortedcontainers` was mapped from its PyPI description. Backup files are `packages.json.before-next100-*`; no containers were restarted. Resource monitoring continues on its existing schedule and end date with the expanded scope.

## Last confirmed assessments — 15 October 2026

Both servers now expose historical confirmed assessments from finalized ledger
history. The homepage includes six dated, version-specific cards above the newest
collection entries and falls back to a historical label in score cells. Package
details retain the historical score alongside current missing/stale evidence
reasons. No expiry, quorum, recovery or consensus rules changed.

The ledger update overlays only scoring engine/projection files on the previous
image; web updates overlay compiled portal assets and the overview handler on each
server's previous coordinator image. Ledger ID on both hosts:
`sha256:5581c6125c636698da37280a13e9f6da354c536282c4d4b5407ecc43c84c3d33`.
Server1 web: `sha256:2f435ec822ba0d75d1b8f2f8323069f776e56256adfaa7dcd28a1c2914987d95`.
Server2 web: `sha256:07b5fa24f7a2fa811c496eafa1e6c9c4b8cccc5cbbd7ea4070335cf8a5fb2100`.
Runtime `.env.before-last-confirmed-20261015` preserves the prior image settings.
The existing Server2 collection workers and each server's worker image settings
were preserved. Caddy/certificate storage was untouched. Server1 web-dependent
sidecars were recreated together after the ledger/web restart.

Validation: 21 scoring tests and 13 coordinator portal tests passed; both frontend
builds succeeded. The public APIs agreed on six historical cards, including all
five demo packages. Server2's rendered homepage displays explicit historical
labels, versions and dates. Historical assessments are replayed under the reported
policy version, not stored screenshots or claims of present confirmation.

### Tracked-package table follow-up

The homepage now prioritizes packages with current confirmed scores, then historical
confirmed assessments, then provisional scores. Within a group the existing
collection-round order is retained. Each row shows the latest version's provisional
score and weighted evidence coverage, or an explicit awaiting-evidence state.
Historical confirmations can refer to an older version, which is labelled and
linked separately; these never become confirmations of the latest release.
Missing confirmations have a brief reason instead of an unexplained dash.

Both live APIs returned 12/12 tracked packages with confirmed score history after
rollout. Both portal builds and 13 coordinator tests passed. Browser verification
confirmed version-specific links, numeric history and accessible coverage bars.
Web image IDs: Server1 `sha256:0ac64f652760164902b4339133f6eae36f4900b60f463f2504e7ad7fb4cce7e8`;
Server2 `sha256:0d0e9f515e8a9217958a7486fed58462488259600ce845f952106b314dee4699`.
Prior runtime settings are in `.env.before-tracked-20261015`. No ledger restart
or scoring-policy change was needed.

### Freshness policy trust-v2.1.1

Both UU ledgers now use doubled evidence-validity windows: 48 hours for security
and latest-release data, 14 days for weekly indicators, 730 days for release origin.
The public policy endpoints match exactly. All five original demo versions again
had numeric current confirmations in the post-update overview. Collection eligibility
remains daily; no worker loop or quorum changes were made. The live queue check
reported 1,571 queued metric targets and four active rounds, with four contributors
available. Server1 worker loops wait two seconds between work checks; Server2 waits
15 seconds. They remain running but can idle when no eligible work is available.

22 scoring regression/boundary tests passed. Only policy JSON in source/dist was
overlaid on each current ledger image. Server1 image:
`sha256:983c5f37d3616142c180db3154f6431e40e734f141c6b5fb40bad9d3b99ea535`;
Server2 image: `sha256:5784b9ef2149c460203385ff45ee1c6a22e651419a14e0a6c2d4f08164436ab7`.
Runtime rollback settings: `.env.before-freshness-20261015`. Web and worker services
were left running. Older laptop/reviewer images retain their prior read-time policy
until upgraded; consensus and recorded evidence are unchanged.

### Package explorer redesign

The `/packages/` route now uses responsive package cards, latest-version provisional
scores, evidence-coverage bars, current or historical confirmations with separate
version links, observation counts and a compact collection activity strip.
Search, evidence-history filtering, sort order and 24-item pagination use the
existing shared overview snapshot. The server clamps page size to 48; its default
of 12 preserves the homepage. Detailed provider failures remain in collapsed
collection diagnostics. Non-pilot builds retain the legacy package list.

Both builds and 13 coordinator tests passed, including pagination/filter/cache
checks. Live browser checks verified the desktop layout, pandas search, combined
history/name filtering, and page 2 (25–25) of the 25 historically assessed packages.
Server2 public pagination also returned the requested second 24-item page of the
full 166-package catalogue. No ledger, mining or freshness changes were made.

Server1 web image: `sha256:c7b4e0a2eb1a1cbbf5ee0cc37cbce84c4d82376742582fc61d3d37f8b4bf8124`.
Server2 web image: `sha256:778676f035bd1cc50369ecfde0a1b21e91939898456d45469bf7d1d89e06d15b`.
Runtime backups: `.env.before-catalogue-20261015`. Rollouts overlay only compiled
portal assets and the overview handler on the current web image; Server1's
web-dependent sidecars were recreated together.

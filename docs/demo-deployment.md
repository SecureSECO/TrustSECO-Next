# Single-operator demo

**Live on TrustSECO1 since 14 October 2026.** See the [deployment record](uu-deployment-2026-10-14.md) and [reviewer installer](https://trustseco1.science.uu.nl/reviewer/). All five target packages have local and confirmed scores. Libraries.io refresh currently encounters HTTP 403 from UU.

This demo uses three or more explicitly labelled test contributors, controlled by one operator. Their signatures exercise agreement, not independent verification. Keep PILOT_TEST_NETWORK enabled; never represent fixture GitHub identities as real people. Real participants can continue using the existing admission/client workflow with their own signing keys and private credentials.

No friends' accounts or API keys are required. The existing local fixture workers already share the operator's private credentials file. Libraries.io requires the operator's existing API key; GitHub can be attempted anonymously, with much smaller shared IP quotas and possible endpoint limitations. This is not a guarantee of full scores without a GitHub token. OSV/CISA and the unkeyed Stack Exchange collector are separate sources. Never invent missing data or raise coverage by treating source failures as zeros. Optional visitors' credentials must remain under their custody and must not replace the shared demo file.

For the UU migration, preserve the existing network, genesis, collected evidence and validator identities. Restore an observer first, verify common finalized block hashes, then move each signing identity with its latest signing-history database and stop the old copy before starting the replacement. Distribute the existing operator API credential only to operator-controlled worker hosts, outside git and images. The local Compose fixture uses loopback HTTP inside the web network namespace; it is not by itself a complete two-host deployment. No server access or key provisioning is performed by these scripts.

## Automatic reviewer admission and rotation

Reviewers qualify with a personal GitHub account at least 180 days old and a published SSH signing key. The admission service checks ownership automatically; one numeric GitHub ID can register one validator. Requests bind the contributor key to the generator key and a BLS proof of possession. Private keys stay on the reviewer's machine. GitHub account age/ownership are admission-service attestations, not proof of distinct humans. Consensus never calls GitHub.

The existing chain supports four active voting seats. All four votes have weight one and finalization requires three. Eligible identities, including the original server validators, rotate through an ordered on-chain queue: one seat changes every 16 blocks, at the next SDK round boundary (about four minutes with the existing 15-second blocks, longer if blocks are missed). New reviewers join the tail. The registration limit is 101 identities including the bootstrap validators; this is not 101 simultaneous votes. Rotation gives each continuously eligible identity the same number of turns over a complete cycle.

`tools/pilot/reviewer.cjs` fetches and pins the public network bundle, creates local keys, synchronizes, and requests admission automatically. The reviewer publishes the displayed public key as a GitHub **Signing Key** once; no administrator approval, GitHub API token, or native fee-token funding is needed to vote. The relay pays transaction fees. API credentials for optional data collection remain separate.

Build `deploy/Dockerfile.reviewer` against the exact upgraded ledger image (`--build-arg LEDGER_IMAGE=...`) and publish a versioned reviewer image before distributing installation instructions. The eventual command is:

```sh
docker run --name trustseco-reviewer --init --stop-timeout 300 \
  -v trustseco-reviewer:/reviewer \
  REVIEWED_REVIEWER_IMAGE https://trustseco1.science.uu.nl YOUR_GITHUB_LOGIN
```

`REVIEWED_REVIEWER_IMAGE` is a placeholder until an image has been published. Keep the same volume on restart. Never run two copies of its signing identity. The node makes outbound peer connections; the advertised server peer port must be publicly reachable. It does not need an inbound port mapping. Stop with `docker stop trustseco-reviewer`: the wrapper signs its departure and waits for finality before shutting down. Restarting the same container automatically rejoins after synchronization. Force-killing a container or losing connectivity can leave it scheduled; the protocol tolerates only one unavailable voter in a four-seat committee. Rotation is not a guarantee of recovery after quorum is lost.

`deploy/compose.auto-admission.yaml` overlays the operator deployment on **one** admission host. Set `REVIEWER_IMAGE` to the reviewed reviewer image: admission uses the ledger's native BLS cryptography runtime, which is unavailable in the web image. Its private governor identity/outbox is writable only by the admission service, and its existing operator credential file can supply the GitHub token. Do not run duplicate admission workers on the same identity/outbox. Public genesis/configuration and public peers are exposed by the relay; private keys are not. The test GitHub fixture preload under `tests/` must never be enabled in a real service.

The module remains inactive until a governor-signed `activate-github-voting` event. Deployment requires upgrading every validator, replaying/comparing the existing historical state, preserving signing histories, verifying public reachability, and then activating on the common chain. The isolated tests use fresh identities and do not activate the local demo or either UU server. These rollout steps were completed on TrustSECO1 on 14 October 2026; activation at block 40342 is finalized. TrustSECO2 was also deployed on 14 October as a synchronized non-signing replica with its own HTTPS portal; submissions and reviewer downloads use Server1. Moving a voting identity to Server2 awaits separate approval.

Validated on 13 October 2026: ledger, coordinator, portal and reviewer image builds; 19 policy/admission/identity/relay tests; automatic enrollment and validator registration on a disposable chain; four equal votes with threshold three; a reviewer-produced finalized block; rotation out and back; matching finalized block IDs on both nodes; finalized graceful departure; and restart with the same volume producing finalized block 175. The integration GitHub profile/key response was mocked; actual GitHub authentication and public UU connectivity still require rollout verification. Policy tests cover fair turns for pools of 4, 5, 10 and 101 identities; the real two-process consensus test used five identities.

The disposable test configuration is `tests/compose.github-voting.yaml`. Prepare a fresh `/runtime` using `tests/github-voting-prepare.cjs` inside the candidate ledger image, then create its genesis using the generated shared config/assets mounted at `/pilot`. Start bootstrap and web first, run `tests/github-voting-activate.cjs`, then start reviewer and admission. Run `tests/github-voting-rotation.cjs` in the web container's network namespace with the runtime mounted read-only at `/runtime`; it checks actual finalized reviewer blocks and a complete out/back turn. Stop and restart the reviewer with its volume intact, then run `tests/github-voting-resume.cjs` in the same namespace. Stop the reviewer before the remaining services so its departure can finalize. These test scripts never use live deployment credentials.

## Focused catalogue

`deploy/demo-packages.json` selects Requests, pandas, NumPy, HTTPX and cryptography at exact versions from the existing local catalogue. It is a target list, not a claim that evidence has already been collected. In demo scheduling mode, security and scoring inputs for earlier packages precede auxiliary metrics and broad collection. Daily refresh, signed observations, reserves, finality and provider concurrency limits remain unchanged. Existing failed rounds still obey their daily retry window.

After coordinating with any running recovery work:

```sh
node tools/pilot/prepare-demo.cjs deploy/pilot-runtime/package-queue/packages.json
```

The script backs up the previous queue, preserves the network ID and does not delete ledger history. The publisher reads the file each cycle. Restart/redeploy the publisher with the updated collection-plan code; rebuild the web image to update package-detail text. Preserve any active recovery Compose override.

```sh
node tools/pilot/demo-readiness.cjs http://localhost:3005 deploy/pilot-runtime/package-queue/packages.json
```

This checks fresh live scores and exits unsuccessfully until all targets have local and confirmed numbers. Run before presenting. A pending or failed package is not presentation-ready. Keep collection running to maintain the 24-hour freshness window; no static score snapshots are relabelled as live. Package details display weighted evidence coverage while incomplete.

## Local activation — 13 October 2026

The existing GitHub token was copied from the private project `.env` into the private worker credentials file; the Libraries.io credential was retained. GitHub authenticated `/user` validation succeeded. No credential is stored in this document or the image. All six fixture workers read the shared file on each mining loop.

The five-package queue is active; the previous queue is saved beside it as `packages.json.before-demo-1791897608659`. The publisher was restarted and opened Requests yearly commit collection. This is evidence of active collection, not completed scores. Earlier signed rounds and their normal retry windows remain intact.

Use all three Compose files to retain the repaired ledger endpoint and the updated demo portal:

```sh
docker compose -f deploy/compose.pilot.yaml -f deploy/pilot-runtime/recovery.override.yaml -f deploy/pilot-runtime/demo.override.yaml --profile mining-test --profile bulk-test up -d
```

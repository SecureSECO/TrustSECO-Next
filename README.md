# TrustSECO-Next

**Open source powers our world. Trust should be part of its foundation.**

We depend on an extraordinary universe of software, built and shared by people
all over the world. But deciding what to trust is still too often a guessing
game. TrustSECO is a long-held dream to change that: make the evidence behind
software trust open, visible and something we can build together.

We collect software measurements, bring them into community verification, and
record signed observations on a shared ledger. The ambition is to help people
make better-informed decisions about the software they depend on—and give back
to the open source ecosystem that makes all of this possible. A score is a
starting point for asking better questions, not a promise that software is safe.

**Long live the open source universe. Let's make it more trustworthy together.**

## Current pilot

The UU pilot is available at [TrustSECO1](https://trustseco1.science.uu.nl/)
and [TrustSECO2](https://trustseco2.science.uu.nl/). The current application uses
the signed community pipeline, with a local integration portal on port **3005**.
The root Makefile and `deploy/compose.yaml` start the **legacy port-3002 stack**;
they are not the entry point for the current pilot.

The portal includes Overview, Packages, Activity, Most recent payouts, Community,
Settings and About. Activity includes node status. SearchSECO is not part of the
current portal navigation.

Deployment status recorded on **16 October 2026**: the UU installation remains a
single-operator pilot. TrustSECO1 hosts the publisher and bootstrap voting keys;
TrustSECO2 is a non-signing replica with miners. The labelled test contributors
exercise the protocol but do not represent independent people. A second portal
and replica do not, by themselves, provide validator failover.

See the [UU deployment record](docs/uu-deployment-2026-10-14.md) for deployed
configuration and recovery history, and the
[release readiness checklist](docs/uu-deployment-readiness.md) for outstanding gates.

## Try it or run a node

To explore packages, measurements and scores, use either public portal above.
To join ledger validation, follow the
[reviewer installation page](https://trustseco1.science.uu.nl/reviewer/).
The repository's [reviewer installer](deploy/install-reviewer.sh) requires a
running Docker installation, downloads the published image, and creates a
persistent local reviewer volume. It displays a public SSH signing key to add
to a personal GitHub account at least 180 days old. Keep the volume and stop the
container cleanly; do not run simultaneous copies of a signing identity.
Reviewer validation and data mining are separate roles.

For development, use the [local signed-network guide](docs/live-community-pilot.md)
and `deploy/compose.pilot.yaml`. It documents image builds, key/genesis preparation,
validator initialization and fixture miners. Preparation is explicit: Compose alone
does not create a new network. The
[demo deployment guide](docs/demo-deployment.md) describes the demo scheduler and
reviewer admission. These guides include dated experiments and historical sections;
use the UU deployment record for the running servers rather than replaying old
migration commands.

On a configured local pilot, open `http://localhost:3005/user/settings/` for
identity setup, source credentials and the mining switch. The current contributor
identity uses an **Ed25519 SSH signing key**, not the legacy GPG-registration flow.
A GitHub API token authenticates collection requests; it does not replace that
signing identity. Libraries.io collection requires its own API key and working
provider access. Public GitHub collection can run without a token, subject to
lower quotas and endpoint limitations.

Private keys and API credentials belong in the node's private runtime directory,
never in source control. Local setup routes are deliberately unavailable on public
relays; public visitors cannot configure server credentials through Settings.
Do not enable those local routes on an internet-facing deployment.

## What is collected and confirmed

The current miner is `tools/pilot/client.cjs`. Its collectors cover GitHub,
Libraries.io, OSV/CISA security evidence and explicitly mapped Stack Overflow tags,
with optional ClamAV artifact scanning. Provider failures and missing data must
remain unavailable rather than become zero-valued facts. See
[collection and refresh](docs/collection-and-refresh.md) for scheduling and scope.
Not every metric applies to every package, and repository-wide measurements are
current observations associated with a version, not historical release snapshots.

The [availability-aware assignment protocol](docs/availability-aware-assignment.md)
uses expiring contributor availability, a verified future drand beacon and a fixed
reserve order for unavailable observers. Three compatible eligible observations
are required for community agreement; two available contributors do not reduce
that threshold. The earlier
[commit/reveal assignment](docs/random-observer-assignment.md) describes historical
rounds and has been superseded on upgraded, activated networks.

A blue measurement check requires community agreement and ledger finality, not
merely a submitted transaction. Local estimates can use incomplete, unconfirmed
evidence; confirmed scores use eligible verified inputs. The
[scoring policy](docs/scoring-v2.md) describes positive evidence, security penalties,
coverage and recovery. Agreement and finality do not prove an upstream claim true
or establish that contributors are independent humans.

TrustCOIN rewards use application-ledger escrows with a 24-hour review/settlement
delay. They are separate from Klayr transaction-fee tokens and older DAO balances.
See [community verification and rewards](docs/live-community-pilot.md) for the
protocol and identity limitations.

## Known operational limitations

The 14–15 October monitoring run found conflicting event IDs blocking two miner
outboxes, unavailable Libraries.io requests occupying retry slots, and repeated
scan-size-limit failures. These findings remain release follow-up work; a passing
build is not evidence that all live collectors are healthy. Libraries.io access
from UU has returned HTTP 403, so supported collectors do not guarantee fresh
Libraries.io facts. Consult the deployment record for subsequent operational changes.

Independent operator participation, validator custody and failure-domain testing
remain necessary before claiming decentralized operation. Preserve ledger data,
private keys and validator signing histories during upgrades. Stopping containers
does not require deleting volumes; `docker compose down -v` destroys volume data.
Never reset a live network or copy an active validator identity as an upgrade shortcut.

## Repository map

| Directory | Responsibility |
| --- | --- |
| `apps/portal` | Vue interface, package evidence and local/confirmed scores |
| `apps/coordinator` | Signed pilot relay, portal read APIs and local setup; retained legacy coordinator |
| `tools/pilot` | Current signed miners, collectors, scheduling, admission and reviewer tooling |
| `services/ledger` | Klayr ledger, community verification, rewards, voting and scoring |
| `services/spider` | Retained legacy collection service |
| `deploy` | Local/pilot/operator Compose files, images and deployment tooling |
| `docs` | Protocol descriptions, deployment records and historical validation |
| `tests` | Integration and network acceptance scenarios |

## Validation and releases

The root [GitHub Actions workflow](.github/workflows/ci.yml) runs coordinator,
portal, ledger and legacy spider checks. Use its commands for the complete current
CI suite; `make test` targets the older local stack and is not a full pilot check.
Protocol changes also need the applicable multi-node acceptance scenarios and
coordinated validator rollout. A green CI run does not replace live collection,
recovery, resource-use and reward-settlement acceptance.

Publish a release from a reviewed, tested commit with matching deployment images
and documented limitations. Do not treat the historical
[port-3004 release candidate](docs/release-candidate.md) as certification of the
current pilot.

## Licences

The original licences and attribution remain with every imported component.
Consult apps/coordinator/LICENSE, apps/portal/LICENSE, services/spider/LICENSE,
and services/ledger/LICENSE. Importing them here does not relicense their code.

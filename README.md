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

## Start locally

Requirements: Git, Docker with Compose, and Make. Component dependencies are
installed in Docker images, not temporary host directories.

```sh
cp .env.example .env
# Set GH_USERNAME, GITHUB_TOKEN and LIBRARIESIO_TOKEN in .env.
chmod 600 .env
make up
```

Open http://localhost:3002. Complete GPG registration in Settings for a new signing
identity. A GitHub API token and a published GPG public key serve different roles.
Never publish the private key. The local stack is isolated from public ledger peers.

```sh
make status
make logs
make test
make stop
```

On macOS, Docker Desktop's CLI must be on PATH. Alternatively use
`make DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker up`.
Change TRUSTSECO_PORT in .env before building to choose another local port.
The web frontend is built with that port, so port changes require rebuilding.

## Repository map

| Directory | Responsibility |
| --- | --- |
| apps/portal | Vue UI, live measurement status and Local/Confirmed scores |
| apps/coordinator | API, collection orchestration, signing, durable observations |
| services/spider | GitHub, Libraries.io and other measurement collectors |
| services/ledger | Current Klayr ledger and scoring formula |
| deploy | Canonical local Compose stack and web image build |
| docs | Migration history, boundaries, and validation |
| tests | End-to-end local smoke test |

Use deploy/compose.yaml and this README as the entry point. Older component-level
Compose files and READMEs are retained as migration context, not additional setup steps.
The only active GitHub Actions workflow is the one at the repository root.

## Data and scope

Each Compose project has independent ledger, GPG and measurement volumes. Stopping
or rebuilding does not erase them. Do not use `docker compose down -v` unless you
intend to delete that instance's data. Credentials in .env and runtime data are
ignored by Git and excluded from build contexts.

The portal shows measurements immediately; blue checks require ledger finality.
Local and Confirmed scores share the same formula but use different eligible
inputs. Ledger finality does not prove that the collector or upstream source is
correct. Current repository-wide measurements are not historical release snapshots.

This is a consolidation of working code, not a ledger replacement or a completed
separation from SearchSECO. Existing SearchSECO navigation and coordinator hooks
are retained pending a scoped removal. The SecureSECO organisation and any shared
DAO/rewards responsibilities are not renamed, migrated, or archived by this work.
See [migration notes](docs/migration.md) and [validation](docs/validation.md).

## Licences

The original licences and attribution remain with every imported component.
Consult apps/coordinator/LICENSE, apps/portal/LICENSE, services/spider/LICENSE,
and services/ledger/LICENSE. Importing them here does not relicense their code.

### Experimental observer assignment

The pilot has an opt-in, ledger-enforced three-operator assignment protocol.
Its commit–reveal draw deliberately fails closed on missing entropy; it does not
provide an always-available unbiased beacon. See the [protocol, threat model,
activation plan and tests](docs/random-observer-assignment.md). Existing networks
stay on legacy behavior until a coordinated upgrade and signed activation.

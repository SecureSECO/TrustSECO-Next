# TrustSECO-Next

TrustSECO collects software measurements, signs them, records them on a ledger,
and presents local and finalized trust scores. This repository brings the
working components together so a feature can be reviewed and tested in one PR.

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

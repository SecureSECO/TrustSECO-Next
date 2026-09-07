# Migration record

The monorepo retains the full reachable history of each selected source branch
through a merge commit and a prefixed tree import. The original commit IDs remain
ancestors. Historical paths before the import use the original repository layout;
use the import commit's second parent to inspect that history.

| Component | Source | Imported commit |
| --- | --- | --- |
| Coordinator | SecureSECO/SecureSECO, fix/live-measurements | 60051529c4734c7d8f11368cdb7f9fb97a71d8b6 |
| Portal | SecureSECO/SecureSECO-Portal, fix/live-measurements | 8c6f10b578fa6696867a961027a2dda5ac30aa97 |
| Ledger | SecureSECO/TrustSECO-DLT, fix/github-key-registration | d217279df0505304018c36872fdbcbf68ededbf3 |
| Spider | SecureSECO/TrustSECO-Spider, final-spider-fixes | 2c98174ac4eacbb35df5c9485d917e993c4be6fc |

The ledger import fixes the eight lint errors reported by the old CI run: async
OpenPGP parsing and narrowing unknown score inputs before accessing their fields.

The previous localhost:3001 deployment remains available. TrustSECO-Next uses
localhost:3002 and the trustseco-next Compose project with fresh ledger and
measurement volumes. For the local migration test only, the existing GPG identity
was copied into a separate volume and credentials copied into the ignored .env.
No private keys, credentials, local observations or diagnostic reports are in the
monorepo tree. A fresh clone generates its own signing identity.

## Boundaries and follow-up

TrustSECO owns measurement jobs, collection, provenance, scores and its UI.
SearchSECO mining and the organisation-wide DAO need separate decisions. Do not
archive the SecureSECO repository until shared work and its active branches have
been reviewed. The existing three draft PRs remain open and unmerged:

- https://github.com/SecureSECO/SecureSECO/pull/27
- https://github.com/SecureSECO/SecureSECO-Portal/pull/56
- https://github.com/SecureSECO/TrustSECO-DLT/pull/209

Next milestones: establish a two-node coordination experiment; remove unrelated
SearchSECO UI/services deliberately; replace conservative first-observed finality
anchors with proven inclusion blocks; improve transaction throughput and job
queue durability. None of these is silently bundled into the repository move.

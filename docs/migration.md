# Migration record

The monorepo preserves the source commit graph, authorship and messages through
merge commits and prefixed tree imports. GitHub push protection detected old
personal access tokens in upstream history. The imported history was sanitized
before publication; token text is replaced with REDACTED_HISTORICAL_TOKEN.
Consequently, affected commit IDs differ. Original repositories were not rewritten.
Historical paths before import use the original repository layout.

The following are the original source heads, for traceability:

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

## Sanitized history mapping

| Original source head | Monorepo equivalent |
| --- | --- |
| d217279df0505304018c36872fdbcbf68ededbf3 | f48c740cb0aba9a29eb2531ccefa5dcd46b0fae9 |
| 8c6f10b578fa6696867a961027a2dda5ac30aa97 | cda097ba2dfb54459598753a95c4195128dd5236 |
| 2c98174ac4eacbb35df5c9485d917e993c4be6fc | 54998b94eac74afb26336c37bc1bef44e20aab4c |
| 60051529c4734c7d8f11368cdb7f9fb97a71d8b6 | fb3fba3d29419b9dd9c031c046ba4debf42dea31 |

# TrustSECO scoring v2

`trust-v2.0.0` implements “trust comes on foot and leaves by horse.” It is an explicit heuristic policy, not a probability of safety or an empirically calibrated trust model. The authoritative constants are in `services/ledger/src/app/modules/scoring/policy.json`. The ledger exposes them through `pilot_scorePolicy`; the portal reads this endpoint rather than maintaining a second table.

## Calculation

For each positive indicator, normalize with `x/(x+a)`; use `a/(x+a)` for time since the latest release. References and units are in the policy. The weights sum to one. Commit activity, release recency, contributors, project age, dependent packages and Stack Overflow receive 35%, 25%, 20%, 10%, 5% and 5% respectively. Raw issue/dependency counts, owner-wide stars and duplicate contributor measurements remain available as evidence but do not increase the score.

The baseline is `B = 100 Σ(w z)`. Missing positive metrics produce a range `[B, B + 100(1-C)]`, where `C` is the sum of available weights. Do not renormalize the remaining weights. With at least 80% weighted coverage, use the lower bound as the target baseline.

For each distinct applicable vulnerability, multiply by its severity factor. None/low/medium/high/critical factors are 1/.95/.85/.5/.25. High caps the target at 49, critical at 24, and CISA known exploitation at 9. Use the strictest ceiling. Thus a baseline of 80 becomes 40 with one high advisory or 20 with one critical advisory; one known-exploited critical advisory gives at most 9. These examples are policy arithmetic, not experimental results.

A fresh, complete exact-version security snapshot with known severities is mandatory. Missing/stale security or unknown severity means **unavailable**, never “no vulnerabilities.” An empty successful scan means no applicable advisories were returned by the queried sources; it does not prove safety. Positive evidence and security expire after 24 hours. Missing, disputed or unfinalized newer rounds suppress their old confirmed input. Unsupported registry ecosystems and unmapped Stack Overflow tags stay unavailable.

Under `trust-v2.0.2`, the first numeric score is available immediately when evidence coverage and security requirements are met. Confirmed scores additionally require community verification and finality. The UI reports accumulated evidence-supported history separately; it does not invent a full day for the first snapshot. Once initialized, decreases apply immediately. Increases are limited to one point per supported day. Only time covered by the preceding fresh snapshot earns recovery; a later clean scan cannot credit an unobserved gap. This is accumulated supported time, not elapsed calendar age. History is replayed across all version labels for the same repository. Fixed advisories leave the new version's current risk target, while previous loss of trust still limits recovery. Querying the score does not persist or manufacture observations. Local and confirmed histories are separate; a local result is provisional.

A signed governor `score-correction` event must reference the latest closed, corroborated security round for the project and contain a reason and evidence. It is an explicitly privileged factual correction, not automatic remediation. After finality it may restore that evidence-supported target immediately; it cannot lift current vulnerability ceilings. It cannot initialize a score without the minimum supported history. Later evidence still takes precedence. Governance review remains necessary to prevent misuse of this exception.

## Collection and representation

`security_advisories` / `osv-kev-v1` queries OSV with an explicit ecosystem, package name and exact version. Query pagination must finish; failed responses and bounds exceeding 100 records or the signed-event size produce a source failure, never a truncated clean scan. Withdrawn records are excluded. Existing Libraries.io queue spelling `Pypi` is accepted as OSV `PyPI`, including comparison with already stored registry mappings; no records are rewritten. PyPI package identities use standard case/separator normalization, not fuzzy name matching. OSV determines affected-version applicability; this collector does not invent version-range unions. It assesses the named package, **not its transitive dependency graph**.

CVE/GHSA/PYSEC alias-connected records are merged once. Package-specific severity takes precedence over advisory-wide severity. The collector prefers CVSS 4.0, then 3.1, then 3.0 within a record; among duplicate records it conservatively retains the highest available numeric score. Records with only unsupported or absent severity remain unknown. CISA KEV adds a known-exploitation flag. EPSS and deployment reachability are not implemented.

Signed observations contain the canonical advisory list, IDs/aliases, CVSS vector/version/score and KEV flags. Validators recompute the vector score. Security corroboration requires the same complete canonical snapshot from the existing eligible quorum; agreement on a count alone is insufficient. Signatures and agreement do not establish upstream truth. Provider response hashes remain evidence references, not archived copies of full responses.

`so_popularity` / `stackoverflow-share-ppm-v1` uses an explicitly reviewed `stackOverflowTag` in the package queue. It measures the tagged share of all Stack Overflow questions during the last 30 complete UTC days. One percentage point is stored as 1,000,000 integer units, so 0.05% is 50,000 and normalizes to 0.5. Fractions below one remain positive and monotone. Nonexistent tags, provider errors, rate limits or invalid totals produce unavailable evidence. Unauthenticated Stack Exchange quotas can limit collection throughput.

The pinned `@pandatix/js-cvss` 0.4.4 distribution requires a build-time CommonJS conversion because it ships ESM without an ESM package declaration. `prepare-cvss.cjs` in each consuming service changes module syntax only; run the service's `npm run build` before running collectors. Ledger and coordinator images perform this step.

## Upgrade and history

This change adds optional observation/escrow fields and new event/metric types. It does not alter the existing store schema, genesis, assignment policy, settlement delay, token supply or block interval. Existing event histories use the same legacy verification/reward branches. Existing metric/reward regression tests cover these paths. New security rewards use exact-snapshot corroboration with the existing quorum, eligibility and delayed settlement rules. A score correction does not create an observation, transfer funds or change a reward.

All validators must run this version **before** any new metric or correction events are published. There is no separate scoring activation transaction. Old binaries cannot process the new events, so binary rollback after their inclusion is not a supported procedure. Preserve chain volumes and signing history; never roll signing state back. A conservative local upgrade pauses the publisher, drains existing rounds, stops workers and validators, backs up stopped volumes, upgrades validators together, verifies finality, then recreates the matching web/namespace-sharing workers and publisher. Do not change the 15-second block interval.

Full drain is conservative, not a data-schema requirement for old metrics. A cross-binary check generated twelve in-flight availability/beacon rounds on the previous ledger image (two signed observations each), then applied the same third observation, closure and delayed settlement on the new binary. Complete resulting observations, escrow, audit and payout state matched for every old metric. `tools/scoring/upgrade-fixture.cjs --generate <beacon.json>` runs in the old built ledger directory; its JSON output is consumed by `--verify <fixtures.json>` in the new built ledger directory. This check uses ephemeral test identities and never writes their private keys. Existing deadlines still advance normally through downtime, so operational timeout outcomes remain possible.

The active portal now uses `pilot_score`, including exact version and the coordinator's actual finalized height. Old `trustfacts` scoring endpoints remain historical v1 interfaces; `calculateScoreForFacts` explicitly labels its result `legacy-v1`. They are not used by the active TrustSECO portal. Previously published v1 values must not be relabelled as v2. Fresh security is not backfilled: existing packages may initially display unavailable when evidence is incomplete or stale. Existing observations are replayed under the explicitly labelled new policy without a chain reset. Queue capacity and upstream quotas may prolong that state; extending freshness merely to hide backlog is not a validated solution.

## Reproducing validation and paper constants

After building the ledger and coordinator:

```sh
cd services/ledger
node --test test/*.cjs
# Collector tests require the ledger or coordinator dependencies on the module search path.
node --test ../../tools/pilot/*.test.cjs
cd ../../apps/coordinator
node --test test/*.cjs
```

The regression suite covers normalization, severity factors and caps, unknown/stale inputs, supported recovery intervals, release continuity, exact snapshot agreement, signed exact-target validation, CVSS vectors, OSV pagination and alias deduplication, Stack Overflow fractions, and pre-existing ledger/reward behavior. It does not validate real-world trust outcomes or independent-host operation.

To regenerate the paper's parameter include from the policy:

```sh
node tools/scoring/export-paper-policy.cjs > ../TrustSECO-Tool-paper---Next/scoring-policy.tex
```

Historical v1 results must not be interpreted as validation of v2. Controlled v2 arithmetic and public-source read checks are distinct from a longitudinal deployment evaluation.

Release-candidate verification: 133 ledger/collector tests and 23 coordinator tests passed, both images built successfully, and full ledger ESLint passed with only the pre-existing non-null-assertion warning. All eight existing Jest suites passed (10 implemented tests and four snapshots; 43 existing TODO tests remain unimplemented). The built methodology page was inspected in a browser. A public-source check successfully queried Flask 3.1.1 with OSV/CISA and verified the explicit Stack Overflow tag `flask`; no observations were submitted by that check.

Sources: [FIRST CVSS specification](https://www.first.org/cvss/v4.0/specification-document), [FIRST calculator-validation guidance](https://www.first.org/cvss/faq), [OSV API](https://google.github.io/osv.dev/api/), [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog), [PyPA name normalization](https://packaging.python.org/en/latest/specifications/name-normalization/).

ClamAV integration: confirmed malware detections now make the score unavailable until a complete confirmed rescan reports no detections. Failed or pending scans cannot erase a detection; clean scans add no points. See [platform collection](platform-collection.md).

### Immediate first assessment (`trust-v2.0.2`)

The minimum supported-history duration is now zero. Evidence quality, freshness, community verification, finality, vulnerability penalties and recovery limits are unchanged. Package details show the supported duration separately for local and confirmed scores. Regression coverage includes immediate initialization with zero accrued history, rejection of incomplete/stale/unfinalized evidence, and immediate deterioration followed by gradual recovery. No ledger reset or observation backfill is required.

## Policy trust-v2.1.0: provisional estimates and explicit freshness

Local estimates use available positive inputs even if old, normalized by their
combined weight (`baselineLower / coverage`), before vulnerability multipliers
and ceilings. They do not wait for quorum, ledger finality, 80% coverage or recovery
history. No usable scoring input means no estimate; an observed zero remains a
valid input. Coverage, missing inputs, oldest observation and stale-input count
are returned and displayed. A new pending/failed collection does not erase a
previously available local observation.

Known advisory penalties continue to apply locally when the security snapshot is
old. Missing/stale checks and unknown severity remain explicit warnings, never a
claim of clearance. Unconfirmed clean responses cannot erase earlier known risks;
a confirmed clean malware rescan can clear a detection. A local malware finding
gives a provisional zero when positive scoring inputs exist. SourceRank is shown
as a separate, dated Libraries.io reference; it is not silently added to the
weighted formula.

Confirmed scores retain the fixed-weight lower baseline, 80% coverage threshold,
known-severity complete security evidence, community verification, finality and
history-supported recovery. Indicator freshness is now explicit in the policy:
latest release 1 day; commits, contributors, dependent packages and Stack Overflow
7 days; first-release date 365 days. Security evidence still expires after 24 hours.
These durations are initial policy choices to evaluate, not empirically calibrated
claims. They govern eligibility of observations, not automatic mining frequency.

This is a read-time scoring-policy update. Recorded observations, assignments,
payouts and consensus state are not rewritten. Nodes serving scores must use the
same published policy version to produce comparable outputs.

Local activation (13 October 2026): validator2 and web use the `provisional-scores` image tags via `deploy/pilot-runtime/scoring.override.yaml`, appended after the base, recovery and demo Compose files. Preserve all four files for local restarts. The previous image tags remain available for rollback; no volumes were reset. Scoring and ledger regression suite: 36 passing tests.

## Historical confirmed display

The confirmed projection includes `lastConfirmed: {score, assessedAt, policyVersion}`
(or null). It replays finalized recorded assessment frames under the reported
policy, preserving project-wide recovery limits, and selects the most recent
numeric assessment for the exact requested version. Synthetic current-time
frames never advance its date. This is reconstructed history, not proof that a
visitor saw that number at that time.

When the current confirmed score is unavailable, the homepage and package detail
page show this value as **Last confirmed**, with a localized date/time and an
explicit historical label. Current scores take precedence. Current evidence
requirements, warnings, coverage and expiry are unchanged; a historical value is
not counted as a current confirmed score. Packages without a qualifying historical
assessment retain the empty state. The projection is computed in the existing
single overview snapshot, without per-package HTTP requests or browser storage.

The overview response also includes up to six most recent historical assessments
whose current confirmed score is unavailable, across the filtered catalogue. The
homepage displays these above the latest-collection table, so newer, unconfirmed
versions do not push all historical results out of view. Each card links to its
exact version. It uses the same cached ledger snapshot and adds no extra RPC reads.

## Policy trust-v2.1.1: doubled evidence-validity windows

From 15 October 2026, security and latest-release evidence remain eligible for
48 hours, commits/contributors/dependents/Stack Overflow for 14 days, and first-release
dates for 730 days. All freshness windows are twice v2.1.0. The weighted coverage
threshold, agreement/finality checks, security penalties and one-point-per-day
recovery rate are unchanged. Longer valid intervals can earn more supported
recovery time when replayed under this version; historical assessments explicitly
report the active policy version.

This changes score eligibility, not collection frequency. The publisher still
checks every five seconds and makes a metric eligible for refresh 24 hours after
its previous round opened; eligibility is not a completion-time guarantee.
Server1 worker loops wait two seconds between work checks and Server2 loops wait
15 seconds. Only assigned, eligible rounds trigger collection, with provider retry
controls; availability/assignment events may still occur without a new measurement.
Four concurrent rounds are allowed. Workers can idle or wait for provider access,
contributors, finality, funding or the next scheduled window.

Boundary/regression validation: 22 scoring tests pass. Older nodes using v2.1.0
will display different score eligibility until upgraded, though this read-time
policy change does not change ledger consensus or rewrite evidence.

# Paper notes: what constitutes community trust?

Recorded September 7, 2026, following the project owner's direction: the deeper questions about what constitutes trust belong in the paper. They should be explicit research questions and discussion points, rather than hidden implementation assumptions or questions treated as settled by a working prototype.

## Distinguish the claims

- **Provenance:** a signature binds an observation to a signing identity; it does not establish truth or an independent human operator.
- **Ledger agreement:** validators agree on accepted history and finality under the network's assumptions. This does not independently corroborate an external measurement.
- **Community corroboration:** sufficiently independent contributors produce compatible observations under a stated, versioned policy. Agreement can still reflect a shared source error, collusion or a common collection bug.
- **Software trust:** a formula interprets evidence for a purpose. A corroborated star count does not itself establish that software is secure or suitable for a particular use.

## Questions for the paper

1. What exactly is being trusted: the source, collector, observation, ledger, verification policy, or resulting software score? Which guarantees does each layer supply?
2. What makes contributors independent? Distinguish accounts, signing keys, processes, machines and operators. A six-month GitHub account-age rule adds friction for fresh-account attacks but does not establish one-person-one-vote or solve Sybil resistance.
3. When should observations agree? Define comparable source/method versions and observation windows. A changing star count measured two days later may be a new observation, not a contradiction.
4. How should tolerances be justified? Evaluate metric-specific absolute/relative tolerances, timing variation and group-wide agreement rules. Avoid transitive chains of pairwise agreement and arbitrary thresholds presented as established facts.
5. How should disagreement affect trust? Separate an outlier from evidence of misconduct; account for bugs, timing, sparse participation, conflicting groups and shared-source failures. Consider transparent review and contestability before reputation penalties.
6. What should happen with insufficient evidence? Preserve an explicit unverified state; examine the trade-off between timely results and stronger corroboration.
7. What do incentives encourage? Delaying rewards until corroboration may discourage unsupported claims, but rewarding agreement alone may encourage copying, collusion or suppression of legitimate dissent.
8. Who governs admission and policy changes? Record policy versions and assumptions so results remain reproducible and auditable.

## Evaluation and limits

A prototype can demonstrate signed submissions, deterministic verification rounds, separate ledger/community states, and consistent results across nodes. Simulated contributors demonstrate mechanism behaviour, not independent community participation. Local containers demonstrate process redundancy, not resilience to losing the host.

Evaluate agreement, strong outliers, competing groups, duplicate identities, late observations and time-varying values. Report evidence coverage and time to verification alongside error rates under explicit scenarios. Empirical tolerance selection and adversarial evaluation remain research work; implementation success alone does not validate the trust policy.

Candidate framing: **Under what assumptions can a distributed community produce trustworthy software measurements despite faulty or dishonest contributors?** Establish the novelty relative to earlier TrustSECO papers and related work rather than assuming either the formula or distributed architecture is new.

Community-verification implementation is tracked in [issue #2](https://github.com/SecureSECO/TrustSECO-Next/issues/2). An isolated [prototype](community-prototype.md) now demonstrates signed rounds, tolerance-based corroboration, reviewed incidents, suspension and appeals with simulated contributors. Its thresholds are hypotheses to evaluate, not validated conclusions. Literature and citations still need to be assembled for the paper.

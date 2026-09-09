# UU deployment readiness — 9 September 2026

This checklist concerns the signed network on local port 3005. The older port-3004 demonstration and its release notes are historical. Local fixture identities all run on one Mac and do not constitute independent operators.

## Implemented and locally exercised

- Contributor-signed collection, tolerance-based agreement, reviewed misconduct and appeals, and separate local/confirmed scores.
- Four GitHub and eight Libraries.io numeric collectors. Missing upstream data does not become a zero-valued fact.
- Four separately keyed validator processes on one shared chain, fifteen-second blocks and per-fact finality. Local finality recovery and common finalized-block checks are documented in [the investigation](finality-investigation-2026-09-08.md).
- Availability-based observer selection with a fixed reserve order. Live tests covered two available contributors waiting, three online contributors reaching finalized agreement and an offline selected observer being replaced automatically. See [acceptance results](availability-aware-assignment.md).
- Guided local identity/key creation, GitHub identity checks, private API credential settings and a mining switch.
- Escrow-backed TrustCOIN rewards, a 24-hour review delay, conservation and exactly-once settlement tests. This is not evidence of a completed live 24-hour payout experiment across independent hosts.
- Operator deployment templates, private local backups and a tested non-signing restore procedure. These are not evidence of working UU certificates or off-site recovery.

The [full collection and daily refresh extension](collection-and-refresh.md) adds the expanded scheduler, signed source diagnostics, timed refresh, permanent event lookup and a bounded recent-audit working set. The local upgrade and two-provider/outage acceptance passed; see its recorded results. The complete 480-target run and long soak remain outstanding.

## Remaining release gates

| Gate | Acceptance evidence required |
| --- | --- |
| Full package run | All 40 configured packages have an outcome for every applicable supported metric. Distinguish finalized facts, source unavailability, disputes and insufficient contributors. Check both GitHub and Libraries.io; do not promise a fixed fact count where upstream data is absent. |
| Sustained operation | Complete a load run, verify finality continues, measure resource growth, and alert on stalled finality or publication. Removing an audit threshold is not proof of unlimited capacity. |
| Independent identities | Name the real operators, admit their identities, verify their GitHub signing-key bindings, and keep contributor and validator keys under their respective custody. Local fixtures must not be presented as independent humans. |
| UU configuration | Obtain SSH access, choose hostnames and image digests, agree on the production genesis/upgrade, fund distinct relay fee accounts, verify HTTPS, restrict RPC/admin access and configure peer ports. |
| Failure domains | Demonstrate the chosen quorum's failure tolerance. Four equal validators require three: putting two on each of two machines does not tolerate losing either machine. |
| Recovery | Verify encrypted off-site backups, restore a non-signing observer, prove common finalized state after rejoin, and establish safe validator-key recovery without rolling back signing safety records. |
| Full reward loop | Let actual verified work pass the real 24-hour delay, check the resulting payout and balances on independent hosts, and exercise disagreement/review handling. |
| Release artifact | Run checks at the release commit, review/merge changes, tag the tested commit and publish immutable images plus configuration and limitations. |

UU access and real operator assignment were deferred by the owner. Continue local implementation and acceptance testing; do not infer those deployment details or copy fixture secrets to UU.

## Operational boundaries

This is a permissioned research network. GitHub account age helps admission but does not solve Sybil resistance, collusion or observation copying. Agreement and ledger finality are separate claims.

Backups contain private signing material, including the SDK generator database. Do not publish them. Restoring an observer strips generator keys; restoring a signing validator requires preserving anti-double-signing history and avoiding duplicate active copies.

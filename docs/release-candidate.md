> Historical notes for the earlier port-3004 implementation. For the current signed network and release gates, use [UU deployment readiness](uu-deployment-readiness.md). Statements below about disconnected collection/scores/rewards do not describe the current port-3005 implementation.

# Research preview release candidate

This candidate builds on the home-dashboard branch. It adds local distributed-validator tooling and seed discovery, a separate 15-second community experiment, TrustCOIN display naming, and durable mining payout history.

## Included

- Signed community observation rounds, tolerance-based corroboration, auditable reviewed incidents, suspension and appeals using simulated contributors.
- Permanent per-payout ledger records written during the same block execution as balance credits, with persistent job/recipient receipts to prevent duplicates. Cursor-based history pages retain exact integer amounts and distinguish recorded from finalized payments.
- A Most recent payouts page and clear separation of reward-eligible observations from paid TrustCOIN. Existing balance field names and values remain compatible.
- Separate local chains and preserved earlier experiment data. Existing shared/UU deployments have not been upgraded.

## Scope and upgrade requirements

The Community screen uses simulated identities and a trusted reviewer; it is not ready to accept real independent users. Community corroboration is not yet connected to live spider collection, ordinary scores or actual payments. The old mining reward formula remains in place, as does its delay of more than 5,760 blocks (about 24 hours at 15 seconds).

Payout history starts with the updated code. It does not reconstruct old payouts or initial account grants. Recording payouts changes ledger state transitions; use a fresh pilot genesis or an explicit coordinated protocol upgrade before running this code against a chain with historical payouts. Do not perform a rolling mixed-version upgrade.

The current local community chain had no legacy mining payouts before this update; its existing signed community events can be retained. No fictitious payout was added to populate the UI. An empty page is expected until an actual legacy mining job pays out.

## Release steps

1. Review this branch against `feature/home-dashboard`, with the existing dashboard PR as a dependency.
2. Run CI at the exact release commit and resolve blocking failures. The existing ledger suite contains 43 TODO tests; passing it is not complete coverage.
3. Merge reviewed changes, choose a release version and tag the tested commit. Publish pinned build artifacts and these limitations as research-preview notes.
4. Complete the acceptance gates in [UU deployment readiness](uu-deployment-readiness.md) before calling a UU deployment fully functional. A staging preview can precede them only with simulated identity controls kept private and clearly documented.

Payout tests exercise the block threshold, record-to-balance agreement, duplicate prevention, no-fact jobs, exact large amounts and pagination beyond 200 entries. Community tests and the legacy Jest suite provide additional regression coverage. Live local checks cover API availability, the page's empty state and replica agreement; they do not constitute a real 24-hour payout experiment.

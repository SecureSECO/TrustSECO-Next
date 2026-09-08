# Fresh local assignment test, 8 September 2026

The owner authorized resetting port 3005 and including random observer assignment.
The integration branch is `integration/observer-assignment-local-test`. The old
`73657033` chain remains in its original volumes and in the private backup at
`deploy/pilot-runtime/backups/before-clean-test-20260908`. That backup includes
validator signing material and must not be published. Credentials and operator
keys were preserved; the new `8b7bb864` chain uses separate volumes and a fresh
genesis. Its initial TrustCOIN treasury was 1,000,000 with no observations.

Four validator processes and six explicitly labelled fixture contributors run on
one Mac. The `mining-test` profile gives each fixture its own signing-key directory
and a read-only mount of the node's API credential file. This tests code paths,
not operator independence. Real identity admission and UU deployment remain separate.

## Integration fixes found by this run

- The web relay's event allowlist omitted activation and entropy events. Those
  signed event types are now accepted; invalid signatures and unknown kinds are
  still rejected by HTTP regression tests.
- A detached relay cleanup promise could crash the web process when the SDK timed
  out while disconnecting. Cleanup now catches that failure. The regression test
  deliberately throws disconnect errors after successful submissions.
- The SDK derives stakes from genesis but leaves its eligible-validator index
  empty. The network eventually retained a single producer. The stake helper now
  checks eligibility as well as stake and submits a small normal additional stake
  from each validator's own key when needed. No ledger database was edited.
  Once the stake snapshots rotated, all four produced blocks. Setup documentation
  now requires this check before publishing work.
- Backup tooling now resolves the running validator's volume instead of assuming
  the old volume name. Fixtures support an explicit network and six identities.

## Recorded checks

Activation was governor-signed and finalized before opening assigned work.

The first Flask 3.1.2 dependent-count round was interrupted by a roughly three-hour
host-clock gap and the relay disconnect failure. It retained five commitments,
no reveals and no observations, and expired without selecting a committee or
creating a verified score. It was not redrawn or erased.

A separate real-version case, Flask 3.1.1, completed six commitments and six reveals.
The committee was `test-e`, `test-c`, `test-d`. A restart of `test-a` after committing
did not lose its entropy; it later revealed successfully. The three assigned
members supplied matching Libraries.io dependent-count observations of 12,105.
The round closed at height 115 and was confirmed by finalized height 116; local
and confirmed scores both became 25.952861958835182, based on this single
scoring input. A correctly
signed observation from unassigned `test-a` was rejected, with no record inserted.

The initial validator-4 outage stalled height 74, exposing the eligibility bug.
After repairing eligibility with standard stake transactions, the repeated outage
advanced height 106 to 110 and finalized height 99 to 102 while validator 4 was
stopped. Validator 4 was then restarted.

Ledger build/lint and 27 pilot/assignment tests passed. The 39 existing combined
client/coordinator tests, new HTTP relay test, and three stake-helper tests passed
(70 targeted tests total). Portal/coordinator builds passed. This is not a
historical replay migration test or a cryptographic audit.

The 24-hour review delay remains unchanged. No real-time payout is claimed before
that delay; settlement, conservation, refunds and assignment reward eligibility
are covered by the deterministic policy tests. The expired round must refund,
while the successful round remains subject to the normal review/eligibility rules.

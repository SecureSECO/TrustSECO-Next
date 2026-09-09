# Availability-aware assignment

Protocol: `availability-beacon-v1`. This supersedes the all-miner commit/reveal protocol only after a signed governor activation and coordinated binary upgrade. Existing rounds retain their original rules, evidence and escrows.

## Behaviour

Admitted, non-suspended contributors publish signed availability leases lasting at most 900 seconds. Standard miners renew with 300 seconds left; turning off a miner stops renewals, and a signed expiry of zero can withdraw availability immediately. A lease is a willingness declaration, not proof of connectivity or independence. New work waits for at least three available distinct admitted operators; it does not take a bounty with fewer. Clients also wait for the relevant opening and assignment to finalize.

Opening a round freezes that pool and commits to the first drand Quicknet round at least 180 seconds in the future. The public key, network hash, scheme, genesis time and three-second period are pinned in the binary. A contributor relays the proof; all validators verify its BLS signature synchronously using pinned `@noble/curves` 1.9.7. Consensus execution does not access HTTP. The client can fetch the same proof from either relay. A different beacon round, signature, seed or committee cannot replace the draw. If the fixed proof does not arrive within 600 seconds of its scheduled time, the round expires and its bounty follows the normal refund delay. The external beacon adds an availability dependency.

The context and verified randomness determine one permutation of the frozen pool, with rejection sampling to avoid modulo bias. First three observers receive slots. Every slot has a fixed response deadline; the default batch uses 300 seconds. Only a missing observation permits replacement. The next unused reserve in the original permutation takes the slot after its deadline; their window follows that deadline. The ledger applies transitions during event handling and block settlement. Late originals and prematurely responding reserves are rejected. Renewals, withdrawals and later admissions never redraw a frozen pool.

An accepted observation occupies its slot even if its value disagrees, is later reviewed, or its contributor is subsequently revoked. Those cases affect agreement/reward eligibility using existing policy; they do not activate reserves to search for a preferred answer. Three compatible eligible observations are still required. With three received observations, or no possible third slot remaining, block execution closes the round. Exhausted reserves yield insufficient contributors, with no automatic misconduct incident. The existing 24-hour review/settlement delay and conservation rules remain.

## Interface and operations

Activity shows available contributors, current observers, unused reserves, received observations and missed deadlines. Packages reports when fewer than three contributors are available. Community supports both old entropy rounds and new beacon assignments. The fixed committee remains inspectable in ledger snapshots.

New signed events: `activate-availability` (governor; no open rounds), `availability` (active contributor; `until`), and `assignment-beacon` (active contributor; `round`, `beaconRound`, `beaconSignature`). Legacy activation cannot downgrade the new policy. Private contributor keys stay with their respective operators. Local fixture workers are still six identities on one machine, not independent people.

Before upgrading: pause publication, let existing rounds close, back up each validator including signing history, upgrade all validators/coordinators, compare finalized state, then submit activation. Existing unsettled escrows need not be discarded. Old binaries cannot read the activated metadata and must not remain validators. Do not reset generator safety counters or silently create a fresh genesis.

## Security and scope boundaries

This removes the requirement that every miner contribute entropy. It does not solve dishonest identity admission, observation copying, collusion or selective withholding. A contributor can withhold an answer and thereby permit a precommitted reserve to act; completion-conditioned outcomes are not claimed to be bias-free. The permissioned governor still controls admission and work publication. Underlying consensus and finality must fix the opening before the future beacon is disclosed; pathological finality delays/reorganizations can violate that assumption. The client checks finality but cannot make an unfinalized fork immutable.

Availability is measured using ledger time. If block production or the host pauses, measurement deadlines can pass without useful work. Slot activation never extends deadlines based on observed values. Beacon expiry does not select another seed. Same package/version/metric retries remain prohibited by the existing anti-redraw rule; scheduled remeasurement needs a separate protocol policy. No new collector types, batch expansion, reward economy or automatic misconduct penalties are introduced here. The existing 10,000-event cap is also unchanged and remains an operational limit for a longer-running release, including lease renewal traffic.

## Verification

On 2026-09-09, the ledger suite passed 41 tests and the coordinator/portal/miner suite passed 53 tests. Both Docker images built successfully. Ledger lint reported no errors and one pre-existing non-null assertion warning in the community policy.

The regression suite verifies a real Quicknet round-10,000,000 signature and rejects tampering/wrong rounds. It exercises signed availability expiry and withdrawal; six admitted/three online; fixed-pool protection; a missing selected observer; all three initial observers missing; disagreement without replacement; exhausted reserves; unavailable beacon; legacy activation/replay/storage compatibility; confirmed scoring and exactly-once conserved payouts. An integrated test drives the standard miner through the signed ledger policy and collector responses with an offline selected identity.

`tools/pilot/local-availability-acceptance.py` performs two additional local service tests using live Libraries.io values: three online miners collect SourceRank, then a deliberately offline selected observer is replaced while collecting release count. It requires the explicitly labelled local test network and restores workers/publication afterwards. Results are written under ignored `deploy/pilot-runtime`; public verification summaries can be copied into `docs/diagnostics` after inspection.

### Live acceptance result, 2026-09-09

The existing local chain `8b7bb864` was backed up and upgraded in place, preserving history and balances. The signed activation succeeded. [Public acceptance evidence](diagnostics/availability-acceptance-2026-09-09.json) records these results:

| Case | Observed result |
| --- | --- |
| Two contributors online | Activity displayed waiting for contributors; no collection round opened. The signed-policy test separately verified rejection of an attempted opening without taking a bounty. |
| Six admitted, only three online | The frozen pool contained only test-a/b/c. All three collected live Flask SourceRank **28**; agreement finalized at confirmation height **1279**. |
| Selected observer offline | The draw selected test-d/c/f, with test-a first in reserve. Test-d stayed stopped; c/f collected release count **64**. After d's five-minute deadline, a automatically took the slot and also collected **64**. Agreement finalized at confirmation height **1332**. |

The Activity interface was checked during the two-contributor wait, beacon wait, original assignment and reserve handover. It showed the missed original deadline, retained observations and new reserve deadline. After the test, all four validators agreed on finalized block **1338**, each had three peers, and all six workers plus the normal package publisher were running again.

The publisher subsequently opened `aio-libs/aiohttp` version `3.14.3`. Flask `3.1.1` displayed three confirmed facts and nine observations (including its pre-existing dependent-count fact), with local and confirmed scores both **31.3** and coverage **3/21**.

These are local service tests with live source data and real beacon signatures. All fixture identities and validators still run on one Mac; they do not establish independent operators or UU deployment readiness. The 24-hour payout path was covered by simulated-time regression tests, not by waiting a full day in this acceptance run. Expanding the package batch to all supported metrics remains separate work.

References: [drand specification](https://docs.drand.love/docs/specification/), [drand cryptography](https://docs.drand.love/docs/cryptography/), [noble-curves source](https://github.com/paulmillr/noble-curves). Public Quicknet parameters were retrieved from its official `/info` endpoint; the signature vector is public test data. No production key or API credential belongs in a test fixture.

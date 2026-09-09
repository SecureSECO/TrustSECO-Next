# Per-fact confirmation and the local finality outage

This investigation concerns the local four-validator network `8b7bb864` behind port 3005. It does not establish anything about the UU deployments. All four validators and six test contributor identities are operated on one Mac, not by independent community members.

## Implemented: confirmation follows relevant state

Previously, `verifiedInputs` and the portal withheld every confirmed fact whenever **any** audit event exceeded the node's finalized height. Mining a different package could therefore remove an already finalized score.

The ledger now calculates `confirmationHeight` for each round: its closing height, or the latest relevant contributor review height, whichever is greater. Relevant events are substantiation, overturn, reinstatement and revocation. All observers count, including previous non-supporters: their eligibility can change the result. Reviews in another round are conservatively included when they concern the same observer, because suspension is contributor-wide. Appeals alone do not change eligibility.

A closed round must have verified agreement and this height must be final before its agreed value enters confirmed score inputs. Selection of the latest finalized closed round happens before applying the review gate, so a pending review cannot silently substitute an older score. The portal consumes the same height; it keeps the conservative global gate only for older ledger endpoints lacking the new field.

This is a read-side change. It does not change stored observations, admission, selection, quorum, tolerances, block timing, reward amounts, the 24-hour reward delay, or consensus rules. No genesis reset or signing-history reset was performed.

Validation: ledger TypeScript build and lint passed (one existing non-null assertion warning in community policy), 30 ledger/assignment tests passed, and 47 coordinator/collector/relay tests passed. Regressions cover unrelated work, contributor reviews and reversals, cross-round effects, reinstatement, and avoiding stale-score fallback. In the browser, Flask 3.1.1 shows one confirmed fact, three observations and a confirmed score of 26.0, matching its local estimate; coverage remains only 1/21 scoring types.

## Observed: the validators had become isolated

At about 21:47 UTC, before deployment:

| Validator | Block height | Finalized height | Connected peers |
| --- | ---: | ---: | ---: |
| 1 | 757 | 650 | 0 |
| 2 | 699 | 589 | 0 |
| 3 | 743 | 650 | 0 |
| 4 | 757 | 650 | 0 |

Validators 1 and 4 had different block IDs despite equal heights. Every generator was enabled; the stake index contained all four eligible validators; none was PoS-banned. Each process was producing on its own branch. The Docker health check reported healthy because it only checked that the node-info RPC responded.

This is a connectivity failure, not evidence that the BFT quorum should be reduced. A disconnected validator can produce blocks in its slots but cannot finalize its branch alone. The archived [Lisk-BFT specification](https://github.com/LiskArchive/lips/blob/main/proposals/lip-0014.md) describes why finalization needs prevotes/precommits and why the highest prevoted height matters in fork choice. Exact behavior here was checked against the installed Klayr code, not assumed from the older specification.

Public before-state evidence: `docs/diagnostics/finality-before-2026-09-08.json`.

## Peer-ban finding and limits of attribution

Validator 1's preserved log contains peer bans at 18:17:10 and 18:57:09 UTC. Inspection of installed `klayr-framework` 0.12.3 and `@klayr/p2p` 0.10.1 shows:

- `p2p/constants.js`: the default peer ban is **86,400,000 milliseconds (24 hours)**. This is unrelated to the application's 24-hour reward review period.
- `peer/base.js`: low-level message/discovery rate penalties directly reduce reputation and can emit a ban. This path is distinct from `peer_pool.js`'s trusted-peer exemption for externally applied penalties.
- `peer_book/peer_book.js`: seed peers can be IP-banned; fixed/whitelisted peers are excluded from the banned-IP list. Seed discovery alone is therefore insufficient protection for a four-member validator mesh.
- `peer_pool.js` and `p2p.js`: seed discovery is periodic; fixed peers are explicitly retried. The framework only resolves hostnames for **seed** peers, so copying Docker service names directly into `fixedPeers` is not a verified solution; address resolution must be handled explicitly.
- `engine/network/network.js`: the framework does not forward every low-level P2P tuning option. Simply adding `peerBanTime` or a rate-limit option to application config would not necessarily take effect.

The existing info-level logs do **not** identify the exact penalty that initiated each ban. Burst traffic, discovery retries and reconnection behavior are candidates, not established causes. UI polling uses the separate RPC server and is not by itself evidence of excess peer-protocol traffic. The proof so far is isolation plus recorded bans, the long default ban, and recovery after a process restart. We have not proved every lost connection was caused by a ban.

## Recovery performed

Paused the package publisher and miners, stopped all four validators and backed up each complete volume privately under `deploy/pilot-runtime/backups/before-finality-fix-20260908/`. These backups include signing state and must not be committed or published. Deployed the tested read-side fix using the existing volumes and keys.

After restart all four nodes regained three peers, converged through the SDK's normal fork choice/synchronizer and resumed finalization. At 21:54 UTC they shared height 772, finalized height 767 and the same finalized block ID. All four validators had produced one of the last four blocks and had zero consecutive missed blocks. No peer bans had occurred since restart. The miners and publisher resumed and the next package, NetworkX, opened.

A second measurement at 22:31 UTC found all four nodes at height 805 / finalized 799, three peers each, zero new peer bans and identical common finalized block IDs. Public evidence is saved in `docs/diagnostics/finality-recovered-2026-09-08.json`.

This interval was not uninterrupted uptime: block execution had two gaps of roughly 15 minutes (21:55:30–22:10:35 and 22:10:45–22:26:00 UTC), consistent with host/VM suspension but not enough to attribute its cause. NetworkX expired with four of six entropy commitments and no observations; scikit-learn then opened and all six commitments arrived. Healthy finality does not rescue a round whose wall-clock deadline passes while the host is paused. Overnight testing needs an awake host; these observations are not a completed sustained-load or sleep/wake acceptance test.

Unfinalized branches may be replaced during normal convergence. Backups preserve their prior contents; this is not a claim that tentative records are irrevocable. Already-finalized data was not manually rolled back.

## Recommended next implementation

1. Add network readiness alongside process liveness: peer count, common finalized block ID, finality advancement over time, and recent production by each eligible validator. A growing tip alone is not success. Surface a stall in Activity and pause *new* assignments during a sustained stall. Existing assignment deadlines remain protocol deadlines; pausing the publisher cannot extend them.
2. Instrument the actual penalty reasons, reputation and disconnect/reconnect events, then reproduce loss/recovery in an isolated test network. Include sustained mining, one-validator outage/rejoin, temporary partition and sleep/wake or delayed-message bursts. Establish which penalty occurs before changing limits.
3. Trial an explicit, operator-configured fixed-peer mesh for the known validator endpoints, with correct address resolution and no automatic trust of discovered peers. Keep ordinary peers subject to normal protection. Fixed transport connections do not grant validator keys or bypass block/signature checks, but exempting peers from transport bans is still an operational trust decision to test deliberately.
4. Require sustained recovery: three surviving validators continue finalizing, a rejoining fourth catches up without resetting signing safety counters, all agree on finalized block hashes, and mining rounds finish under load. Do not lower quorum, mark merely recorded blocks final, zero generator safety heights or automate repeated resets to hide an outage.

The restart is a successful recovery, **not yet a durable prevention fix**. No peer-ban policy or networking dependency was changed in this implementation.

## Repeating the diagnostic

From the repository root, with Docker on PATH:

```sh
docker exec -i trustseco-pilot-validator1-1 node - \
  ws://validator1:7887/rpc-ws ws://validator2:7887/rpc-ws \
  ws://validator3:7887/rpc-ws ws://validator4:7887/rpc-ws \
  < tools/pilot/finality-report.cjs
```

The script is read-only, has a 45-second timeout and prints public consensus/peer metadata only. Compare reports at different times: a single snapshot cannot demonstrate advancement. Equal tips are useful but can differ during sampling; the common finalized block hash is the stronger consistency check. This command does not schedule a monitor.

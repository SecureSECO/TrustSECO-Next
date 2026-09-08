# Grouped facts and the local package sample

The package page uses `/api/dlt/fact-groups/:name` to show one card per metric,
version and verification round. The existing raw measurements endpoint and score
calculation remain unchanged. Grouped cards use the round's agreed value when
available, retain every contributor value/timestamp/status, and only show a blue
check when the underlying supported observations satisfy the existing finality
checks. A disputed round does not become confirmed by grouping. Different rounds,
versions and sources are not merged. The summary distinguishes facts from observations.

Forty real Python package targets were sampled by randomly shuffling a curated
pool, resolving Libraries.io package/version/GitHub mappings, and retaining distinct
repositories with available SourceRank metadata. This is a UI test sample, not an
unbiased sample of all open-source software. The exact batch is in
`test-data/package-batch-2026-09-08.json`. Together with Flask, the catalogue has
41 repositories.

`PILOT_PACKAGE_QUEUE_FILE` points to the local catalogue/queue. Catalogue entries
are not signed observations and do not acquire fabricated facts or scores. Each
entry schedules one initial SourceRank round with a 300 TrustCOIN bounty and a
180-second measurement window, following the existing ten-minute assignment phase.
The governor-operated publisher waits for the current round to close and ledger
state to finalize before opening the next. It does not retry an expired round with
a new ID. At least roughly ten hours of awake, healthy operation are needed for
40 sequential jobs; sleep/outages can expire an active round under existing policy.

The explicit local profile runs the publisher in a separate container, with the
governor key mounted there, never in the web service:

```sh
docker compose -f deploy/compose.pilot.yaml --profile mining-test --profile bulk-test up -d
```

Stop new publishing with `docker compose -f deploy/compose.pilot.yaml stop
package-publisher`; existing rounds retain their deadlines. The queue validates its
network ID before publishing. The six local test miners still share this Mac and
API credentials; they do not constitute independent community operators.

Validation: 46 coordinator/client/provider tests passed, including grouping of
slightly different supported values, retention of unverified observations, disputed
and unfinalized states, version separation, and browsing queued packages without
creating facts. Portal/coordinator builds passed. Browser checks showed one card,
`1 fact · 3 observations`, expanded contributor details, 41 catalogue entries and
39 queued/one collecting after the publisher opened the first job for `psf/black`.

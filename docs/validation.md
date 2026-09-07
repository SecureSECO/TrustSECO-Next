# Migration validation — 7 September 2026

- All three Docker images built from the monorepo paths.
- Isolated stack runs on localhost:3002 with fresh ledger and measurement volumes;
  localhost:3001 remains the earlier deployment.
- GPG account registration succeeded on the new ledger with 50,000,000 initial
  slingers, using a separately copied local signing identity.
- A Requests 2.32.3 language job was signed, collected as Python, and stored on
  the new ledger. An open-issues job subsequently collected 149 and produced a
  Local score of 29.3012; Confirmed correctly remained unavailable on the new chain.
- Measurement records survived a coordinator restart. The restarted worker resumed
  collection and the API exposed the existing signed language observation.
- Coordinator: 9 lifecycle and score-input tests passed.
- Ledger: lint and TypeScript build passed; 8 Jest suites passed (10 implemented
  tests, 4 snapshots, 43 existing TODOs). GPG and subset-scoring regressions passed.
- Spider: 103 pytest tests passed. Two invalid-key tests previously reached real
  APIs and hung on retries; these now mock HTTP 401 responses.

A connectivity interruption during validation exposed an existing coordinator
limitation: a stale ledger WebSocket can require restarting the web service.
Restarting restored access and GitHub subsequently returned HTTP 200. This is
recorded as follow-up coordination work, not concealed by the repository migration.

No two-node synchronization or finality redesign is claimed. The old repositories
and draft PRs remain available; no repositories have been renamed or archived.

## Repeat the live smoke test

After setting credentials, registering the public GPG key and starting the stack:

```sh
docker compose --env-file .env -f deploy/compose.yaml cp tests/smoke-job.cjs web:/tmp/smoke-job.cjs
docker compose --env-file .env -f deploy/compose.yaml exec -T web node /tmp/smoke-job.cjs
```

This performs external collection and writes test jobs/results to that local ledger.
The automated CI jobs require no API credentials; they do not run this live test.

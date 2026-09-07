# Bootstrap peers

Seed peers are initial discovery contacts, not leaders or privileged validators. The same startup code runs on every node.

For a shared deployment, set these values in `.env` (forwarded to the ledger by the primary Compose file):

```dotenv
TRUSTSECO_NETWORK=shared
TRUSTSECO_NODE_ADDRESS=trustseco1.science.uu.nl:8000
```

The default seed list is `trustseco1.science.uu.nl:8000,trustseco2.science.uu.nl:8000`. The node's own declared endpoint is removed, so trustseco1 contacts trustseco2, trustseco2 contacts trustseco1, and newcomers contact both. Endpoint comparison is case-insensitive and includes the port; DNS aliases for the same machine are not automatically detected. Use the canonical advertised endpoint.

Override the default with `TRUSTSECO_SEED_PEERS=host1:8000,host2:8000`. An empty override uses the selected profile's defaults. Bracket IPv6 addresses, for example `[2001:db8::1]:8000`.

The default profile remains `TRUSTSECO_NETWORK=local`: it preserves the existing genesis-specific Docker peer configuration. These changes do not connect the current local development chain to the Utrecht servers.

Before enabling a shared network, verify identical genesis/chain configuration, supported software versions, appropriate validator-key assignments, and reachability of TCP peer port 8000. Publish that peer port explicitly in the server deployment; the current local Compose configuration does not expose it to the host. Do not expose the unrestricted RPC port 7887 or deploy the bundled development keys publicly. The Utrecht endpoints are configured defaults, not servers verified or deployed by this change.

The seed policy is applied in `services/ledger/src/app/app.ts` after the CLI reads its configuration. `TRUSTSECO_SEED_PEERS` takes precedence over configured/CLI seeds; in shared mode the Utrecht defaults replace the configured seeds unless this override is set. In local mode, configured/CLI seeds remain in effect. Duplicate endpoints and the declared self endpoint are removed in all cases.

Tests: after the ledger TypeScript build, run `node test/seed-peers.cjs`.

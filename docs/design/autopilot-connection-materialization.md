# Autopilot connection materialization

Flight Deck consumes Tower's canonical `autopilot_connection` and
`workspace_agent` record-delta families through TowerSyncService. The worker
validates and writes those records to the `autopilot_connections` and
`workspace_agents` Dexie tables. Consumers read the tables through the exported
query helpers inside Dexie `liveQuery`; components do not fetch Tower directly.

The Tower list envelopes are plural (`autopilot_connections` and
`workspace_agents`), while delta family names remain singular. Archived rows
remain as canonical tombstones in the record-delta journal/cache and are removed
from the rendered Dexie tables. Cursor replay, SSE-triggered delta sync, fallback
polling, authority reset, snapshot omission reconciliation, and workspace cache
teardown use the same materialization path.

## Legacy launcher compatibility

Compatible flat `{agent_npub, url}` settings migrate to local-only compatibility
rows. Migration is deterministic and idempotent:

- normalized public HTTP(S) endpoints deduplicate to one connection;
- several agents may reference that connection and retain their original order;
- each agent retains its launcher URL in public compatibility metadata;
- invalid or credential-bearing URLs are ignored by this migration and remain
  available in their original settings surface;
- compatibility rows have `installation_id`, `fips_endpoint`, and `agent_id`
  unset, `row_version: 0`, and `installation_identity_verified: false`;
- no migration write is sent to Tower.

This deliberately does not infer a verified Autopilot installation from a
launcher URL. Canonical Tower rows supersede compatibility data only after a
later command proves and persists that identity. Connect packages, NIP-98
events, tokens, private keys, bunker/NWC material, and raw discovery responses
are rejected rather than stored.

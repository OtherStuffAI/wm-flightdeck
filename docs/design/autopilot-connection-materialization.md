# Autopilot connection materialization

Flight Deck consumes Tower's canonical `autopilot_connection` and
`workspace_agent` record-delta families through TowerSyncService. The worker
validates and writes those records to the `autopilot_connections` and
`workspace_agents` Dexie tables. Consumers read the tables through the exported
query helpers inside Dexie `liveQuery`; components do not fetch Tower directly.

Canonical v2 connections retain the public installation signer in metadata,
Tower's canonical `fips_transport_npub`, and the exact signed
`http://<fips_transport_npub>.fips:<port>` origin. The origin is never
rewritten to `fips://`. Installed-agent metadata retains only public display
data, `can_instruct`, and the four signed read paths; raw packages, discovery
responses and NIP-98 events are never persisted. One connection may own several
stable installed-agent rows.

Agent Space cards are projected from Dexie and therefore survive reload and
offline startup. Opening a card performs a native FIPS read for Overview,
Pipelines, Schedules or Triggers. `can_instruct` is descriptive only; WP4
exposes no runtime mutation.

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
launcher URL. The raw compatibility rows remain local and distinct from Tower
installation identity. The workspace-agent query suppresses a compatibility
launcher only when the canonical journal has an active or archived agent with
the exact same npub and normalized public endpoint. This is presentation
precedence, not an identity merge: it prevents repeated bundle migration from
rendering a duplicate or resurrecting an archived canonical launcher while
retaining the legacy row for compatibility and recovery. Connect packages,
NIP-98 events, tokens, private keys, bunker/NWC material, and raw discovery
responses are rejected rather than stored.

## Command and transaction ownership

Agent Connect creates the connection and each selected workspace agent through
`TowerSyncService.command`. Tower transport and materialization-worker promises
are explicitly detached from any ambient Dexie transaction. Each typed
acknowledgement may then perform its own local write, and each authoritative
record-delta bundle retains one atomic worker-side Dexie transaction. This
prevents a live-query or UI write transaction from auto-committing while the
command waits on Tower or the worker, without changing command coalescing,
stale-acknowledgement suppression, or record-delta authority.

# PG Workspace Cursor Sync

Tower PG workspaces synchronize through the bundled Tower endpoint documented
in `wingman-tower/docs/design/flightdeck_pg_workspace_sync.md`.

Flight Deck persists an opaque cursor in the workspace Dexie `sync_state`
table under a workspace-and-viewer-specific key. A missing cursor starts a
bounded snapshot. Snapshot pages carry opaque Tower cursors and are applied
incrementally until `snapshot_complete` is true. Subsequent manual, background,
and SSE-triggered refreshes send the terminal event cursor and receive only
affected channel bundles and typed tombstones.

The cursor and snapshot seen-manifest are saved inside the same Dexie
transaction that applies each bundle. They must never advance before the
materialized rows commit. Intermediate snapshot pages only upsert; omission
reconciliation is deferred until the terminal authoritative boundary. A retry
therefore resumes from the committed opaque cursor without clearing browser
storage, and replaying a page is idempotent.

Each sync request has a 30-second abort timeout. A timeout leaves the committed
cursor and manifest intact, surfaces the retryable `Update stalled` state, and
never leaves `Receiving changes...` active indefinitely.

The browser no longer performs a full synchronization by walking scopes,
channels, threads, messages, tasks, comments, documents, and media through
separately signed requests. Those list endpoints remain available for explicit
navigation and targeted reads.

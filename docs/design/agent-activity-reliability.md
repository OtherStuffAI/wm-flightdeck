# Reliable agent working updates

The v4 suite design keeps TowerSyncService as the sole network/update owner.
Its PG hydrator materializes activity snapshots and commentary into Dexie;
existing live queries project those records into Alpine. Components request
bounded coverage through registered service families and keep only pagination
intent, expansion, loading, and error state.

## Retention and connection state

Received activity survives transport failure, freshness expiry, and list
omission. None of those confirms completion. The worker begins its first
reconnect immediately; the panel displays Reconnecting for the first 60 seconds,
then Connection lost—status unknown. Successful scoped fallback reconciliation
can restore known state even while SSE remains unavailable. Confirmed completed,
failed, and cancelled lifecycles remain collapsed and can be expanded after a
refresh. Newer runs do not replace earlier history in the selector.

Tower retains activity snapshots and commentary independently of expires_at.
The existing FK still implements intentional parent/workspace deletion; routine
reads no longer delete expired parents. Local explicit removal remains a
separate action from freshness pruning.

## Recovery and paging

The backward-compatible Tower agent-activities endpoint accepts:

- channel_id, optional thread_id or activity_id, and a bounded snapshot cursor;
- history_limit (default 50, maximum 200, zero omits commentary);
- before_sequence with activity_id for older commentary;
- after_commentary_cursor with activity_id for forward missed-commentary recovery;
- after_sequence remains supported for older-server compatibility.

Each list page includes retained terminal and expired runs. Snapshot pagination
uses immutable creation time and ID. Older commentary pagination uses sequence. Forward recovery uses an independent
monotonic delivery cursor, so late retries with lower producer sequences remain
recoverable after terminal completion and SSE replay expiry. Bigint cursors stay
strings across transport and use exact comparisons. Forward recovery never marks
older history as completely loaded.

Initial channel/thread coverage loads a bounded latest page. Reconnect recovery
runs even when the workspace delta is still fresh, and fallback uses the same
service timer. Known turns recover at most ten scoped pages of 200 entries per
pass, retaining their cursor only after materialization succeeds. Additional
pages continue on the existing background schedule. The UI can request earlier
commentary or earlier thread runs without hydrating an entire channel history.
The open Inbox thread is recovered using its actual channel/thread, regardless
of another selected chat channel.

Activity read failures remain visible. There are two short background retry
intervals (one and two seconds); further failures use normal background cadence.
The service coalesces requests and rejects disposed workspace completions. The
worker's existing bounded SSE materialization retry/acknowledgement protocol is
retained. Every received commentary delta is merged before current-snapshot
coalescing, ordered and deduplicated by workspace/backend/turn/sequence. Terminal
snapshots can carry late commentary without regressing their lifecycle state.

Autopilot owns durable publication claims and transcript recovery. Every unseen
explicit user-visible commentary has a stable source identity and sequence;
accepted delivery is the checkpoint. Pending payloads and failed final transcript
reads remain recoverable after restart, including terminal paths. Credentials,
internal reasoning, and tool output are not publication payloads.

## Validation and activation

Regression coverage includes the 60-second boundary, confirmed terminal,
expiry/reload retention, SSE burst/replay ordering, duplicate and out-of-order
entries, scoped paging, a 450-entry interrupted forward recovery, and workspace,
thread, and service-generation isolation. Both thread and channel UI use the
same persisted commentary.

Source checks and exact final validation results are recorded with the
implementation handoff. The existing public-source check reports preexisting
tracked handoff documents; those documents are not cleaned up as part of this
change. The unrelated 20,000-row worker responsiveness test times out both in
this working tree and in an isolated archive of unchanged HEAD.

Activation is Tower first (rebuild/restart so its runtime schema index and API
are active), then Flight Deck build, then an operator-controlled Autopilot
restart. No deployment branches are pushed and Autopilot is not restarted from
this agent session. A browser smoke pass against the activated local Tower is
still required: interrupt connectivity below/above 60 seconds, recover a burst,
finish a turn, reload, and open earlier updates/runs in both Chat and Inbox while
checking scroll position. Source tests do not substitute for that runtime pass.

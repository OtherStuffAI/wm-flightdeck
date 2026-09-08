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

## Final implementation evidence

Tower commits: `af94b9f7f670bdcd8d627fd5d15a05c277a359d6` and
`a8d1885c9e6dc7395451730b62114f3968b41aa4`. Its 58 relevant tests pass against an
isolated database (1,990 assertions); Bun bundle and whitespace checks pass.
Repository-wide TypeScript configuration/type errors and the existing privacy
check finding remain documented in Tower's turn-contract design note.

Autopilot commit: `4c516063691539ed14f812f64bdbe3880088ffc9`. Its 61 focused tests
and typecheck pass. A full isolated run passed 2,410 tests with 23 skipped; the
final expanded run passed 2,412 with one baseline native-runtime timeout. That
exact test passed on isolated recheck. Public-source findings match unchanged
HEAD. The Autopilot handoff also records that backfilling pre-upgrade latest-only
turns appends newly recovered earlier text in publication order; it does not
retroactively resequence existing accepted history.

Flight Deck's shared checkpoint `f192948` contains this implementation alongside
a concurrent open-thread reply fix. Final recovery-state guards keep stale
channel and older-history completions from clearing the displayed conversation's
warnings, and avoid overwriting the service's bounded retry schedule. The final
build is `20260908-0616-10-1908` (build 1908). Build and dist verification pass;
generated dist output is not committed.

Validation: the complete native command was run and exposed the unchanged-HEAD
20,000-row worker timeout plus timing-sensitive failures under concurrent load.
A controlled run (`bun run test --maxWorkers=2 --testTimeout=20000 --exclude
tests/pg-materialization-responsiveness.test.js`) passed all 3,659 tests in 265
files. The final guard/release/hydrator pass added one regression and passed all
113 tests in its three files; transport/cursor checks passed all 53 tests. The
remaining benchmark was independently reproduced in an archive of unchanged
HEAD. No benchmark assertion or timeout was changed to conceal it.

`check:public-source` remains failing on unrelated tracked handoffs and operator
context. Manager review removed deployment-specific paths, names and routing
from this change's implementation brief; that brief no longer appears in the
check findings. Unrelated supplied documents remain preserved. This tree is
not claimed to pass public-source publication checks.

No external task/comment/chat reporting, deployment push, or Autopilot restart
was performed. Broker context had no inherited task routing; the complete local
brief supplied the implementation context. The manager must accept the source
handoff before changing tracking state and must own runtime activation/browser
validation. Tower still has unrelated WApp scope files dirty for their owner;
Autopilot is clean.

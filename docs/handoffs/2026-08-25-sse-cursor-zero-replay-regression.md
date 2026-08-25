# Flight Deck SSE cursor-zero replay regression

## Goal

Repair the build-1825 inbound-sync starvation introduced by the durable Agent Direct SSE acknowledgement cursor, without restoring replay loss.

Track this as the next implementation slice of Flight Deck task `14bfc7f7-9968-436c-a7b5-094d5310fcc8`. The originating regression report is message `e2c52eaa-7571-4535-b50b-52a343ed9f03` in channel `0617d526-88dc-4dc2-9876-08349ab60eca`, thread `a65d6608-3bc7-448f-b27a-ec9e3f2e7bc1`.

Work on current `main` in `/Users/mini/code/wm/flightdeck`. Preserve concurrent work. Commit all nonignored tested state in the worktree. Do not push, deploy, or restart services.

## Confirmed cause

Build 1825 added a new SSE acknowledgement cursor key. On the first reload that key is absent, even though `tower_pg_sync_cursor:<workspace>:<viewer>` already has a valid materialised workspace cursor. The worker opens SSE without a cursor, and Tower interprets absence as row 0.

Pete could see 20,420 historical outbox events at reload. Tower streams 50 events per one-second poll, so replay alone required at least 409 polls (6m49s) before live events, excluding hydration. Pete reported broken syncing 7m45s after the build-1825 test instruction. Every page also exceeds the 25-event burst threshold, causing sustained targeted hydration and periodic workspace deltas.

This is client-side inbound starvation. Tower persistence and outbound writes remained healthy.

Current HEAD includes `b05e239`, which already fixes the secondary lifecycle-status bug by preventing `pull-complete` and `cursor-acknowledged` from demoting a healthy `connected` stream. Preserve and extend that fix.

## Required implementation

1. When `sse_pg_ack_cursor:v1:<backend>:<workspace>:<owner>:<viewer>` is absent, seed the initial SSE cursor from the compatible, already-materialised Tower PG workspace cursor used by `towerPgSyncCursorKey` / `syncTowerPgWorkspace`. Do not overwrite a present acknowledgement cursor. Scope and validate the fallback so a cursor from another backend, workspace, owner, or viewer cannot be reused.
2. Keep the durable acknowledgement contract: never advance past a batch until Dexie materialisation commits.
3. Preserve acknowledgement metadata for same-context batches across connection-generation changes, or otherwise make an already-committed batch safely acknowledgeable exactly once after reconnect. Context switches must still discard/cancel old-context work.
4. Prevent one permanently failing batch from head-of-line blocking all later batches or crossing a workspace/context switch. Use bounded, context-scoped retry/isolation with diagnostics; do not silently acknowledge failed materialisation.
5. Preserve the lifecycle-status correction already in `b05e239`.

If items 3–4 materially expand risk, implement the cursor bootstrap first only if it is independently safe and leave precise follow-up coverage/notes. Do not weaken replay durability to get a passing test.

## Deterministic acceptance tests

- Existing workspace cursor plus missing SSE-ack key signs the first stream from that workspace cursor, never row 0.
- A present SSE-ack cursor wins over the workspace cursor.
- Backend/workspace/owner/viewer scope mismatch cannot seed the cursor.
- A simulated 20k historical backlog followed by one live event reaches the live event without hundreds of replay polls.
- Disconnect after batch dispatch but before acknowledgement, reconnect, then successful commit advances the cursor exactly once.
- One permanently failing batch does not block later batches or cross a workspace switch.
- `pull-complete` and `cursor-acknowledged` preserve `connected` and the 120-second heartbeat cadence.
- Existing disconnect-before-debounce, replay-during-delta, >25-event activity, terminal ordering, and authoritative-absence tests remain green.

Run the focused SSE/activity suites, then the full test suite, production build, dist verification, public-source check, and `git diff --check` in proportion to repository conventions.

## Handoff

Return the exact root fix, files changed, commit(s), build ID, focused/full validation counts, remaining risks, and whether Pete must reload. Move the existing task to `review` only when the fix is ready for browser testing. Do not post directly to the originating chat; return through the supervised dispatch callback so Rick can review and report.

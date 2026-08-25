# Agent Direct SSE reconnect/replay materialisation repair

## Goal

Fix the Flight Deck browser path that can permanently lose Agent Direct thinking/commentary when the PG SSE transport disconnects during a turn. Implement and validate the repair in `/Users/mini/code/wm/flightdeck` only unless new evidence proves a contract defect elsewhere.

This implementation was authorised by Pete in Flight Deck message `192abfd6-e8c3-4886-87e9-ece9fc7ada15`. The originating investigation thread is `a65d6608-3bc7-448f-b27a-ec9e3f2e7bc1` in channel `0617d526-88dc-4dc2-9876-08349ab60eca`. The parent Flight Deck task is `14bfc7f7-9968-436c-a7b5-094d5310fcc8` (Make Agent Direct thinking lifecycle durable and visible).

Do not post to Flight Deck or change the task directly. Return results through the supervised dispatch callback so Rick can review and publish the handoff.

## Confirmed evidence and diagnosis

- Affected running commits were Tower `ce40e4a`, Autopilot `fa085e2`, and Flight Deck `55fb0c0`.
- Tower accepted and persisted the affected commentary/activity rows, including outbox row `23298`; Autopilot publication was monotonic.
- Pete's browser SSE subscription disconnected at about `10:36:32` and reconnected at about `10:37:37`. The Agent Direct message arrived at `10:36:49`, within the gap.
- The roughly 65-second outage is consistent with five failed reconnects followed by Flight Deck's fixed 60-second fallback probe. Retained runtime evidence did not establish why each attempt failed.
- Flight Deck currently advances the SSE cursor when an event is received, before the debounced Dexie materialisation commits. If the connection closes during the 300 ms debounce, the buffer is cleared while the advanced cursor survives; reconnect therefore starts after data that was never committed.
- Tower emits `connected` before replay. Flight Deck starts a workspace delta on `connected`, then clears replay events received while that delta is running.
- The workspace bundle cannot replace discarded agent activities: those require targeted SSE handling or `/agent-activities` hydration.
- Replay bursts over the targeted-event threshold (currently 25) collapse into the same incomplete workspace delta.
- Current focused tests pass while one test explicitly asserts that replay events received during an in-flight reconnect delta are dropped. That contract is wrong and must be replaced.
- The earlier authoritative-absence repair at commit `cadfb94` is not present in the current `55fb0c0` history. Preserve/recreate its guarded behavior as part of this slice rather than assuming it exists.

This is best supported as a Flight Deck reconnect/replay materialisation defect. It is not evidence of a Tower/Autopilot publication failure or a strict semantic-URL authentication regression.

## Required implementation

1. Introduce an acknowledgement cursor for PG SSE: advance/persist the replay cursor only after the corresponding Dexie materialisation batch commits successfully. Scope cursor ownership sufficiently to prevent reuse across backend, workspace, viewer/session, or stale connection generations.
2. Preserve unacknowledged work across transport failure. Do not clear received-but-uncommitted PG events merely because EventSource closes. Reconnect from the last committed cursor and retry failed materialisation/hydration with bounded backoff.
3. Repair reconnect replay coalescing. Partition workspace-bundle entities from targeted-only entities. A reconnect may run one workspace delta, but it must also compact and apply the newest `agent_activity` per activity/turn. Remove the unconditional replay-queue clear, including the large-burst path.
4. Harden signing liveness without weakening exact semantic-URL signing. Add a bounded token-request timeout and explicit stale/failure handling so a missing, rejected, or stale signing response resumes retry/backoff instead of leaving the worker indefinitely in `token-needed`. Never log tokens or full signed URLs.
5. Restore authoritative absence reconciliation equivalent to the accepted intent of `cadfb94`: only a complete, explicitly shaped, non-paginated channel activity hydration may remove local PG activities absent from Tower; remove their commentary too; guard against a request-start snapshot deleting a newer concurrent SSE turn; never clear on malformed, partial, paginated, or failed responses.
6. Add correlated but non-secret diagnostics covering connection/retry id, requested/received/acknowledged cursor, materialisation batch id, receipt/commit timing, and render-observable state. Do not log transport tokens or full signed URLs.

Preserve terminal ordering semantics: the final assistant response remains a normal thread message, never commentary/history, and the owning working activity is removed after authoritative terminal state or guarded absence reconciliation. An old turn's terminal event must never delete a newer working turn.

## Required regression coverage

Add deterministic focused tests for:

- disconnect after event receipt but before the debounce/materialisation commit;
- cursor advancement only after successful Dexie commit and replay from the last committed cursor after failure;
- replay events arriving while the reconnect workspace delta is blocked/in flight;
- replay bursts over 25 events containing working and terminal agent activity;
- targeted agent-activity hydration after a workspace delta that omits agent activities;
- signing request timeout, explicit failure, and stale response handling while preserving exact semantic-URL signing;
- normal final-message/terminal ordering, old-terminal isolation, and missed-terminal recovery;
- authoritative empty hydration, including malformed/partial/paginated/failure and concurrent-newer-turn guards;
- cleanup of owning commentary with a removed activity.

Run the narrow affected Vitest suites first, then the full repository test suite, release/public-source checks used by this repo, `bun run build`, `bun run verify:dist` if available, and `git diff --check`.

If practical without starting/restarting managed services, add or run a deterministic integration/Playwright interruption test covering publish -> disconnect -> replay -> Dexie -> visible thinking -> final reply -> cleanup. Do not restart, deploy, or alter running services. If live testing requires a managed restart, report the exact remaining step to Rick.

## Repository and Git constraints

- Work on `main` in `/Users/mini/code/wm/flightdeck`.
- The worktree is shared and already dirty with concurrent changes. Inspect all status/diffs before editing; preserve and integrate them. Do not reset, revert, discard, overwrite, rebase, force-push, or create a merge commit.
- Per Pete's repository-state convention, when ready, commit all nonignored tested state in the worktree unless there is a clear safety reason to pause. Explain any files included that predated this slice and any validation implications.
- Do not push, deploy, restart Flight Deck/Tower/Autopilot, or start an ad hoc Vite/preview server.

## Callback handoff

Return:

- root cause confirmed or revised;
- files and behavior changed;
- focused/full validation with exact pass/fail counts;
- build/dist/release-check evidence;
- commit hash and final git status;
- whether a live managed restart is required before Pete can test;
- remaining risks or blockers.

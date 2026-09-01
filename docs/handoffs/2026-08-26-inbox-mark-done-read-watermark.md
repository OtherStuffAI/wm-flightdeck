# Inbox `Mark done` must complete the task and mark the resulting activity read

## Goal

Implement Pete's corrected Inbox interaction for review tasks: `Mark done` moves the source task to `done` and marks the resulting current task activity read, while retaining the task in Inbox with read styling.

## Live retest correction — 2026-08-26 16:34 AWST

Build 1843 / commit `be2b541` did not satisfy the real actor-aware rule. Pete's live retest still produced both a task-comment activity and an unread done-task card after Pete, the logged-in person, made the change himself.

The governing product rule is broader than the `Mark done` button sequence:

- Activity authored by the logged-in actor must not create unread attention for that same actor.
- A self-authored task state transition must not produce or promote an unread done-task Inbox item.
- A task comment/status activity created as part of that same self-authored action must not appear as a separate Inbox attention item for the actor who caused it.
- Preserve the earlier intent that the canonical task can remain in Inbox only as a read item; the self-authored update/comment must not reinsert, promote, or mark it unread.
- Activity authored by a different actor must remain eligible to mark the task unread.

Treat this as an actor-aware unread/projection invariant, not another post-click timing patch. Use the real logged-in human identity even when browser writes are signed by a workspace key. Resolve `created_by_actor_id` / `updated_by_actor_id` through the hydrated workspace actor/member map when the record lacks a direct actor npub. Add matching-actor and different-actor regressions for task state updates and task comments.

Corrective origin: Flight Deck message `07ead74b-8508-42ef-8acd-37e812faad1e`.

## Second live retest — 2026-08-26 19:41 AWST

Pete reproduced the unread done-task card again while the running managed app was definitively serving build 1847 (`20260826-0848-14-1847`). This rules out a stale deployment and means commit `b05b13e` did not cover the actual normal task-close path or its hydration/event ordering.

Investigate with live Tower evidence rather than relying only on synthetic projection inputs:

- Identify a recent task Pete closed and compare the task's `activity_version`, `updated_by_actor_id`, Pete's `viewer_actor_id`, and `viewed_activity_version`.
- Trace whether task state, resource view state, members, and comments are materialized in a different order. A self-authored task must not be permanently marked unread merely because its task/member row was absent when view-state aggregation first ran.
- Trace every close/done entry point, not only Inbox `markDeckReviewTaskDone`; Pete reproduced this by closing a task through normal task interaction.
- Verify whether later task/member/comment hydration recomputes actor-aware unread state, and whether SSE or Dexie live-query updates can overwrite a correct read projection with a stale unread snapshot.
- Add regression coverage for the exact ordering/path found: same actor remains read at task and channel level, while a different actor still creates unread attention.

Second corrective origin: Flight Deck message `118b684c-684f-42bc-9bcb-071948316623`.

Flight Deck task: `cb0f6871-1865-4648-924b-35cfbf05b678` (`Make Inbox Mark done complete the task and mark it read`).

Originating Flight Deck surface:

- workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`
- channel: `0617d526-88dc-4dc2-9876-08349ab60eca`
- thread: `de4e423b-3bf1-4316-ae08-f7ec93cb0e91`
- message: `49ac756b-1c96-47ef-9af4-8843d55adeb3`

## User report and intended behaviour

Inbox represents the latest activity for a source task. When a review task is completed, that status transition becomes the newest activity. If the card is removed/dismissed or its read watermark only covers the pre-transition activity, an older comment or attachment can then become the visible unread row. That makes the same task appear to return as a different Inbox item.

Pete wants `Mark done` to behave as one coherent operation:

1. Move the source task to `done`.
2. Mark the task's resulting current activity read.
3. Keep the task in Inbox; do not dismiss or remove it.
4. Allow normal ordering/content updates, but render it read after completion.

This follows the earlier card routing/label fix in task `a16be0bb-d653-4e1b-bc77-bf33ff05cdca` and commit `28396b242d7478a4d600de190ac14c03df27d374`; preserve that work.

## Confirmed current code path

- `index.html` renders `Mark done` for unread review-task Inbox cards and calls `markDeckReviewTaskDone(item.recordId)`.
- `src/unread-store.js` implements `markDeckReviewTaskDone` by awaiting `applyTaskPatch(...state: done...)`, then calling `markTaskRead(id)`.
- In Tower PG mode, `markTaskRead` re-reads the task from `this.tasks` and forwards `task?.activity_version` to `markTowerPgResourceViewed`.
- `markTowerPgResourceViewed` advances `viewed_activity_version` only to the supplied/current local activity version.
- Existing tests in `tests/deck-card-mark-read.test.js` verify call order and failure messages, but they do not prove that the read watermark covers the activity version created by the done transition or that the card remains visible and read after projection recomputation.

Strong hypothesis: the accepted `done` write is followed by a read write using a stale pre-transition task/activity version from `this.tasks`. The status activity then remains newer than the view state, or projection falls back to an older unread task attachment/comment. Prove or disprove this against the current task write return shape and Inbox projection before editing.

## Acceptance criteria

- For an unread Inbox card whose source task is in `review`, `Mark done` persists task state `done` first.
- The read-state write targets at least the accepted post-transition task `activity_version`, not the stale pre-transition version.
- After normal local/Tower materialization and Inbox recomputation, the same task remains in Inbox and is not unread.
- No older comment, audio note, or attachment for that task appears as a newly unread replacement after the action.
- The action never locally dismisses or filters the task out.
- A failed task-state write does not attempt the read-state write or claim success.
- A failed read-state write after a successful state transition reports the partial result honestly and remains retryable; do not claim atomic server behaviour unless a Tower endpoint actually provides it.
- Non-review tasks and non-task Inbox rows keep their existing behaviour.
- Preserve the attachment source labels/routing introduced by commit `28396b2`.

## Implementation boundary

Start in `/Users/mini/code/wm/flightdeck` on `main`. Prefer a Flight Deck-only fix if the accepted task write already exposes the authoritative post-transition activity version. If it does not, document the exact missing Tower contract before expanding scope; do not silently implement a cross-repo workaround.

Likely files include:

- `src/unread-store.js`
- the task write path returning the accepted PG task
- Inbox projection code in `src/autopilot-overview-manager.js`
- `tests/deck-card-mark-read.test.js`
- focused Inbox/projection tests if required
- release metadata per `agents.md`

## Validation and handoff

Run focused tests first, then the repository baseline:

```bash
bun run check:public-source
bun run test
bun run build
bun run verify:dist
git diff --check
```

Add/update release notes and build metadata for the user-visible change. Commit all compatible nonignored tested state on `main` with a Conventional Commit. Preserve the concurrent untracked `docs/handoffs/2026-08-26-long-document-save-truncation.md`. This manager handoff is coordination material: commit it only if `check:public-source` accepts it; if the repository gate rejects `docs/handoffs`, preserve it untracked and report that fact.

Do not push, deploy, start a preview server, or restart the managed Flight Deck process.

Post meaningful investigation and completion comments to the Flight Deck task. The completion comment must include validation evidence, commit/build identifiers, any remaining manual check, and the originating thread/message reference. Move the task to `review` only when the implementation is genuinely ready for Pete.

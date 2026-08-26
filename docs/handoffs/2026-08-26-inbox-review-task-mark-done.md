# Inbox review tasks: replace Mark read with Mark done

## Goal

When an unread task card in Flight Deck Inbox represents a task whose current board state is `review`, replace the card's **Mark read** action with **Mark done**.

Using **Mark done** must move the task to `done`, clear its unread/view-state aspect, and remove it from Inbox. Other task states, chats, and documents retain their existing **Mark read** behavior.

## Source and evidence

- Flight Deck task and reporting target: @[Replace Mark read with Mark done for review tasks in Inbox](mention:task:f24522f7-cd39-430b-bda6-d7acfde0721a).
- Pete's request: @[Message](mention:message:7de3b794-915a-4011-909b-ff681130f969) in the Flight Deck features channel.
- Originating thread: `83cf8466-a1f5-4a90-98ca-63a8a1c48653`.
- Screenshot storage object: `5789110f-958e-4f01-8c04-da53465f466f`.
- The screenshot shows pink unread Inbox cards labelled `TASK · REVIEW` with the actions **Mark read** and **Open task**.

## Current implementation pointers

- `index.html` renders Inbox task actions through `markDeckResourceRead('task', item.recordId)`.
- `src/unread-store.js` owns the per-resource read action.
- `src/attention-feed.js` supplies task state and excludes terminal task states from active Inbox candidates.
- `tests/deck-card-mark-read.test.js` covers the current generic Mark read templates and handlers.

Treat these as pointers, not a prescribed design. Inspect the current task-state mutation path and reuse it instead of introducing a parallel API implementation.

## Required behavior

1. An unread Inbox task card whose actual current state is `review` shows **Mark done**, not **Mark read**.
2. Selecting **Mark done** persists the task state as `done` through the established Tower PG task-state path.
3. The same action clears the task's unread/view-state aspect. Once successful, the card is no longer present in Inbox and the task appears in the Done column on the task board.
4. Do not optimistically claim success if the state write fails. Preserve or restore a coherent visible state and surface the error using the nearest existing Inbox/task error pattern.
5. Unread task cards in states other than `review` retain **Mark read**.
6. Chat and document cards retain **Mark read** unchanged.
7. The card remains keyboard accessible and the action must not open the task as a side effect.
8. Avoid changing the bulk **Mark all ... as read** menu unless current code requires a narrowly justified adjustment; Pete asked for the individual review-task action.

## Validation

- Add focused regression coverage for template/action selection in review versus non-review task states.
- Add focused behavioral coverage proving the done-state write and read/view-state clearing occur, including failure behavior.
- Run the focused tests, the appropriate full test suite, and `bun run build`.
- Ensure generated `dist/` matches source if this repository tracks or ships it.
- Where the managed app can be checked without a restart, verify the Inbox card behavior against a review task. Do not restart the managed Flight Deck process.

## Repository and reporting rules

- Work in `/Users/mini/code/wm/flightdeck` on `main`.
- This is a shared worktree. Preserve concurrent work; do not discard, reset, or overwrite changes you do not understand.
- Before committing, inspect the entire worktree and commit all nonignored tested state unless a clear safety conflict requires escalation.
- Do not deploy and do not restart any managed process.
- Post investigation, implementation, validation commands/results, commit hash, and any remaining manual check to the linked Flight Deck task. Rick will mirror meaningful milestones to the originating thread.

Begin by reading the task and its latest comments directly. When the investigation identifies the concrete implementation path, add a concise progress comment before editing. Re-read recent task comments before handoff in case the brief changed, then move the task to `review` only after the implementation is committed and validated.

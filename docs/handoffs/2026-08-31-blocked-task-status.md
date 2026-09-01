# Add a first-class blocked task status

## Goal

Make `blocked` a normal Flight Deck task state so agents and people can set it, see it, filter it, and understand it consistently instead of recording blockage only in prose.

Origin: Pete's feature request in Flight Deck message `2e7947c9-a4cf-4ed9-996c-1431f5c6ba91`, thread `4b379a5f-a710-4418-91cc-c5de1899d59d`, channel `0617d526-88dc-4dc2-9876-08349ab60eca`, workspace `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`. Reference screenshot storage object: `4bfb3f24-fb4e-41a3-95a6-54b739295756`.

## Confirmed current evidence

- `src/attention-feed.js` already includes `blocked` in its active task-state set.
- `src/task-board-state.js` currently constructs board columns from `new`, `ready`, `in_progress`, `review`, and `done`, omitting `blocked`.
- `src/translators/tasks.js` state ordering, colour mapping, and label formatting omit `blocked`.
- Existing tests encode the five-column board and need to be updated deliberately.

These observations suggest a Flight Deck presentation/interaction gap, but inspect the current Tower task-state validation before assuming the server contract already accepts `blocked`.

## Required behaviour

- `blocked` is available anywhere a user or agent can select/change a task state.
- Kanban displays a clearly labelled Blocked column in a sensible workflow position, preserving manual ordering, drag/drop, collapsed-column behaviour, counts, and narrow/mobile behaviour.
- List rows, task detail, quick actions, filters, status badges, colour consumers, activity/inbox projections, parent/subtask-derived state, and any other task-state presentation render `blocked` consistently.
- Use a distinct accessible status colour that works in light and dark themes and remains separate from generic non-task state utilities.
- Existing tasks whose state is already `blocked` appear correctly; unknown historical states still degrade safely.
- Task writes through the PG state endpoint accept and round-trip `blocked`. If Tower validation or shared contracts do not yet support it, document the exact evidence and required cross-repo change before editing another repository.
- Agent-facing task status semantics and any local documentation/types that enumerate states include `blocked`.
- No migration should rewrite existing task states merely to introduce the new option.

## Validation

- Add focused tests for state ordering, label, colour, board column membership, grouping/counts, and state writes/round-trips.
- Cover an existing blocked task returned by PG hydration and drag/drop or selector transition into and out of Blocked.
- Run the focused tests, the appropriate full test suite, and `bun run build`; keep generated `dist/` aligned if this repo's current build tracks it.
- Perform a representative visual check at desktop and narrow/mobile widths, including light/dark themes if status styling varies.

## Repository and Git constraints

- Work in `/Users/mini/code/wm/flightdeck` on `main`.
- Preserve concurrent work. Inspect the full worktree before committing and include all compatible nonignored tested state, per repository policy; do not discard or overwrite changes you do not understand.
- Do not push, deploy, start a preview server, or restart the managed Flight Deck/Autopilot process.
- Use a Conventional Commit.

## Reporting

- The Flight Deck task is the durable technical record. Post investigation, implementation, test/build, visual-check, and commit evidence there.
- Rick will mirror meaningful milestones and the final handoff to the originating chat thread.

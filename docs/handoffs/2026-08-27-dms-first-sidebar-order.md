# Flight Deck: place Direct Messages above scope channels

## Goal

Move the Direct Messages section to the top of Flight Deck's left sidebar so it appears immediately below Home and before all scope/channel groups.

## Source and reporting

- Originating Flight Deck message: `@[Message](mention:message:50f23e5b-6613-48dd-9fb5-54bcacc13180)`
- Originating channel: `@[features](mention:channel:0617d526-88dc-4dc2-9876-08349ab60eca)`
- Tracking task: `@[Move Direct Messages to the top of the left sidebar](mention:task:bd7a7148-748c-4322-abf2-15aed0708c9c)`
- Originating thread: `f54f8dec-c4ec-47dc-bae6-560add0d655f`
- Screenshot storage object: `8e1d6048-979b-4f7f-9369-f2e916a1f885`
- Flight Deck workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`
- Rick will relay meaningful milestones and the final handoff to the originating thread. Put durable technical evidence on the linked task.

The screenshot shows the current desktop sidebar order as Home, multiple scope/channel groups, then DMs near the bottom. Pete asked to put DMs at the top of the channel list.

## Repository and worktree rules

- Work in `/Users/mini/code/wm/flightdeck` on `main`.
- Treat this as a shared worktree. Preserve concurrent changes and do not revert, reset, overwrite, or hide work you do not understand.
- Before committing, inspect the complete worktree and commit all nonignored tested state unless there is a clear safety reason to pause.
- Use a Conventional Commit.
- Do not push, deploy, start a preview server, or restart the managed Flight Deck process.

## Required behavior

1. Render the DMs section immediately below Home and before every scope/channel group in the left sidebar.
2. Preserve the current ordering of DM entries within the DMs section.
3. Preserve scope ordering and channel ordering within each scope; this request changes only the section placement.
4. Preserve the existing DM New action, unread state/indicators, selection state, permissions, and navigation behavior.
5. Ensure the order is correct in both desktop and narrow/mobile sidebar presentations that share or duplicate the navigation markup.
6. Avoid new empty dividers, spacing gaps, scroll traps, or sticky-position regressions around Home, DMs, the first scope, and the workspace footer.
7. Keep the implementation minimal and source-driven. Do not edit generated `dist` files by hand.

## Acceptance tests

- With one or more DMs and one or more scopes, the visible order is Home -> DMs -> scope/channel groups.
- With no DMs, the sidebar remains intentional and does not leave a blank block or spacing artifact; follow the existing empty-section product behavior unless evidence requires a small adjustment.
- Selecting a DM, creating a DM, unread indication, and normal scope/channel navigation continue to work.
- Desktop and narrow/mobile layouts show the same intended information hierarchy.
- Add or update focused regression coverage for the structural order and any shared rendering helper changed.

## Validation and handoff

- Run the narrowest focused tests that cover sidebar/DM structure.
- Run `bun run test` if the repository's current scope and duration make it practical; otherwise report the exact broader test command used and any unrelated pre-existing failures.
- Run `bun run build` so `dist/` matches source.
- Report the diagnosis, changed files, test/build evidence, commit hash, and any remaining manual browser check on the task.
- Add useful milestones to the tracking task after the implementation path is confirmed and again after tests/build complete. Do not post directly to the chat thread; Rick owns the chat handoff.
- Move the task to `review` only when implementation is committed and validation evidence is present.

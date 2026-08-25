# Remove the divider above Home in the active Flight Deck repo

## Goal

Remove the horizontal divider immediately above the Home button in the left navbar of the active Flight Deck repository.

## Authoritative correction

- Active repo/workdir: `/Users/mini/code/wm/flightdeck`
- Branch: `main`
- The earlier work in `wm-fd-2` was performed in a superseded checkout and does not satisfy this task.
- Do not modify, revert, or otherwise touch the superseded checkout during this worker run.

## Flight Deck source

- Task: `c22e75db-9de3-4466-8678-ca9eb540b179`
- Originating thread: `6780ed97-ff7e-4663-a5cf-079d080390f4`
- Original request: `36e8c587-7d94-4e0c-9cc1-2cf4d12e95a9`
- Repository correction: `27091d80-f227-42e0-b3e5-f17dce72f094`
- Screenshot storage object: `79342737-6dfa-465c-9717-0e92da67d081`

The active repo currently contains `sidebar-workspace-navigation-divider` in `index.html` and matching source CSS. Remove only the line immediately above Home.

## Scope and acceptance

- Remove the dedicated divider markup and its now-unused CSS selectors.
- Preserve Home itself, click/current-page behavior, surrounding spacing, responsive/mobile sidebar behavior, and unrelated separators.
- Update focused regression coverage so the divider cannot return accidentally.
- Follow this repo's release-note and build metadata process.
- Do not hand-edit generated `dist/index.html`.
- Do not push, deploy, start a standalone server, or restart a managed process.

Acceptance:

- No horizontal line appears immediately above Home in expanded desktop or mobile sidebar layouts.
- Home remains aligned and usable.
- Source, tests, release metadata, and generated ignored `dist/` output agree.

## Shared-tree and validation requirements

This is a shared `main` worktree. Existing `docs/handoffs/` files were already untracked before this handoff was added. Inspect them, preserve all concurrent work, and commit all compatible nonignored tested state as the repository's state. If existing changes are unsafe or incompatible, stop and report rather than discarding them.

Run the repository-required checks, including:

- focused sidebar navigation tests;
- `bun run check:public-source`;
- `bun run test`;
- `bun run build`;
- `bun run verify:dist`;
- `git diff --check`.

## Reporting

Read the latest task and comments before work and before handoff. Add a completion comment that clearly states this implementation is in `/Users/mini/code/wm/flightdeck`, lists changed files, validation and commit SHA, and references the repository-correction message. Move the task to `review`. The manager agent owns the originating chat reply.

# Avatar receive-progress indicator

## Goal

Make long workspace receive/materialisation runs feel like background work. Replace the automatically appearing bottom-right `Receiving changes…` status with an orange/yellow activity ring around the signed-in user's top-right avatar. Activating the avatar reveals the receive progress and current page information on demand.

Flight Deck task: @[Move receiving-changes progress behind the profile avatar](mention:task:a7827802-5ea1-418d-8352-436f91cb790f)

Origin: @[Pete's request](mention:message:5f34cf31-ed62-441b-8228-32cf107071f9) in @[features](mention:channel:0617d526-88dc-4dc2-9876-08349ab60eca), thread `1c53a665-8244-4e70-b1b1-89d4061c2cae`.

Screenshot source: `storage://664242d0-7812-43a2-9241-7204e609184e`. A broker-authorised local copy is available at `/Users/mini/wingmen/wingman21/data/avatar-sync-indicator/source.png`. It shows the current dark `Receiving changes…` status floating over the bottom-right of the Flight Deck content on a narrow viewport.

## Confirmed current seams

- `index.html:74` renders the automatically visible `.startup-sync-status` status.
- `src/sync-manager.js` owns `startupSyncProgress`, including delayed visibility, receive/apply/page state, completion, error and retry.
- `tests/sync-manager.test.js` covers the current delayed-visible behaviour and receive labels.
- The top-right `.avatar-chip` in `index.html` already opens `.avatar-menu`.
- `.avatar-menu` already contains backend/sync status, making it the likely smallest on-demand detail surface without taking away profile controls.
- `src/styles.css` already has an animated `.avatar-chip` ring for generic syncing. The requested receive indicator is specifically orange/yellow and must rotate independently of the avatar image.

## Required interaction

1. Do not auto-open an active receive-progress popup/status over workspace content.
2. After the existing long-sync visibility threshold (or an equivalently non-flickering threshold), show an orange-to-yellow rotating gradient ring around the stationary avatar while startup workspace receive/materialisation is active.
3. Clicking/tapping the avatar continues to open the avatar menu and, while this operation is active, that menu shows the existing startup progress label/state, including page number when page > 1. Reuse `startupSyncProgress`; do not create a parallel progress model.
4. Closing the avatar menu/detail is respected. Starting the next receive page must not reopen anything automatically. The ring continues while the operation remains active, so progress can be reopened.
5. When inactive, preserve today's avatar/profile menu interaction and connected/error status presentation.
6. Completion removes the active ring. Preserve actionable error visibility and retry. It is acceptable for the existing error status to remain automatically visible if that is the clearest way not to hide a failure; active non-error progress must be on demand.
7. On narrow/mobile layouts, no receive-progress overlay appears until the user activates the avatar.
8. `prefers-reduced-motion: reduce` retains a clearly visible static orange/yellow ring and disables continuous rotation.
9. Use an accessible label/title/state such as “Receiving updates — open progress”. Keep the existing native button keyboard and touch behaviour.

## Suggested implementation shape (verify against live code)

- Separate “indicator is eligible/visible after the delay” from “details are open”. The current `startupSyncProgress.visible` conflates delayed eligibility with popup visibility; rename or add a separate detail-open flag if needed.
- Bind a receive-specific class/ARIA label to `.avatar-chip`. Ensure it wins over the current generic multi-colour syncing ring while startup receive progress is eligible.
- Add a compact startup-progress section to `.avatar-menu` so clicking the already-established profile control reveals `startupSyncProgressLabel()`, the cached-workspace explanation, page/applied state where useful, and error/retry state.
- Remove or restrict the top-level `.startup-sync-status` rendering to actionable errors. Do not touch the separate manual full-sync modal or catch-up sync overlay unless live behaviour proves they are the same requested surface.

## Acceptance and validation

- Focused tests prove the long-running receive state produces the avatar activity state without auto-opening a content overlay.
- Activating the avatar exposes current receive/apply progress and page information; closing and later-page progress do not force it open again.
- Fast syncs below the current delay do not flicker the indicator unnecessarily.
- Inactive profile/menu behaviour and generic connection/error states remain intact.
- Reduced-motion CSS disables ring rotation while retaining the ring.
- Check desktop and narrow/mobile layout against the supplied screenshot scenario.
- Follow `AGENTS.md` and `docs/release-notes.md`: focused tests, `bun run check:public-source`, `bun run test`, required release note/build version update and tests, `bun run build`, `bun run verify:dist`, and `git diff --check`.
- Work on `main`, preserve concurrent changes, commit all compatible nonignored tested state with a Conventional Commit, and report commit/evidence on the Flight Deck task.

## Constraints

- Do not change Tower contracts, workspace sync semantics, pagination or reconciliation.
- Do not refactor unrelated avatar/profile UI.
- Do not deploy, push, start a standalone preview server, or restart the managed Flight Deck process.

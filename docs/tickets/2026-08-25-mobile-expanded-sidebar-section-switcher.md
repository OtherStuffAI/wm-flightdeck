# Mobile expanded-sidebar section switcher

## Work record

- Flight Deck task: `1544a4e5-be6b-4b2c-9fd2-e0cb8efd4201`
- Task mention: @[Refine mobile selectors for expanded left sidebar](mention:task:1544a4e5-be6b-4b2c-9fd2-e0cb8efd4201)
- Originating message: @[Pete's request](mention:message:2bdcb489-3e92-4691-bfb2-9946911e9f32)
- Originating thread: `768e9aca-b8f4-4c47-aab1-46dd65c4086a`
- Screenshot storage object: `8f26e9ba-8163-4739-bbf1-9f1b453d0bb0`
- Manager screenshot copy: `/Users/mini/wingmen/wingman21/data/attachments/8f26e9ba-8163-4739-bbf1-9f1b453d0bb0.png`

## Goal

Make the narrow/mobile navigation selector layout change according to whether
the left sidebar is collapsed or expanded, without changing Pete's approved
collapsed mobile layout.

## Required behavior

### Collapsed left sidebar

- Keep the current horizontal Scope / Channel selector.
- Keep the current compact sidebar section switchers for Chat, Tasks, Files,
  Docs, and any existing peers.
- Preserve the current mobile behavior and presentation in this state.

### Expanded left sidebar

- Remove the compact/icon-only Chat / Tasks / etc switcher row from inside the
  sidebar; do not leave a duplicate or empty spacer.
- Reuse the top horizontal-selector area that normally contains Scope / Channel
  controls.
- In that area, render the Chat / Tasks / etc section switchers with visible
  text labels and the existing icons where appropriate.
- The labelled section selector replaces, rather than accompanies, the Scope /
  Channel selector while the sidebar is expanded.
- Collapsing the sidebar must restore the original Scope / Channel strip and
  compact section switchers.

## Constraints

- Reuse the existing section navigation actions/state so the new labelled
  controls cannot drift from the compact controls.
- Preserve active state, unread behavior, focus-visible styling, keyboard
  navigation, touch target sizing, horizontal overflow/scrolling, swipe/drawer
  behavior, and section destination semantics.
- Preserve desktop/wide layout unless the existing responsive architecture
  necessarily shares the same branch.
- Do not make Tower, Autopilot, or shared-contract changes without first posting
  evidence that the boundary is outside this repo.
- Work on `main`, preserve concurrent changes, and commit all compatible
  nonignored tested state as required by repo instructions.
- Do not deploy, push, run a standalone preview server, or restart the managed
  Flight Deck runtime.

## Validation

1. Add focused coverage for narrow viewport + collapsed sidebar.
2. Add focused coverage for narrow viewport + expanded sidebar, including the
   absence of the compact row and presence of labelled section controls in the
   top selector strip.
3. Exercise section selection and the expanded-to-collapsed transition.
4. Run the focused tests.
5. Follow `agents.md` and `docs/release-notes.md` for release metadata.
6. Run:

   ```bash
   bun run check:public-source
   bun run test
   bun run build
   bun run verify:dist
   git diff --check
   ```

7. Confirm `dist/version.json` contains the final build version.

## Reporting

Post the investigation path, implementation summary, changed files, validation
results, final build version, and commit SHA on the Flight Deck task. Leave the
task in `review`. Rick will post milestone and completion updates to the
originating chat thread.

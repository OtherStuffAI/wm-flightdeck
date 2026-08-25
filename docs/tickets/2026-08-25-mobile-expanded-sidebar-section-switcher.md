# Mobile expanded-sidebar section switcher

## Work record

- Flight Deck task: `1544a4e5-be6b-4b2c-9fd2-e0cb8efd4201`
- Task mention: @[Refine mobile selectors for expanded left sidebar](mention:task:1544a4e5-be6b-4b2c-9fd2-e0cb8efd4201)
- Originating message: @[Request](mention:message:2bdcb489-3e92-4691-bfb2-9946911e9f32)
- Originating thread: `768e9aca-b8f4-4c47-aab1-46dd65c4086a`
- Screenshot storage object: `8f26e9ba-8163-4739-bbf1-9f1b453d0bb0`
- Manager screenshot copy: available in the out-of-repo task attachment cache.
- Corrective message: @[Review correction](mention:message:03c2d602-19fe-4ee7-9047-7f5cd72fce16)
- Corrective screenshot storage object: `f22c9680-0890-4360-b1cd-ba5f2e31f7af`
- Manager corrective screenshot copy: available in the out-of-repo task attachment cache.

## Review correction (2026-08-25)

The first implementation was rejected because Deck / Chat / Tasks / Docs /
Files remained visible as a vertical navigation list in the expanded left
column. The intended result is a literal position swap, not an additional or
restyled navigation surface.

In expanded mobile mode:

- move the labelled Deck / Chat / Tasks / Docs / Files picker into the top
  horizontal bar that normally contains Scope / Channel;
- remove those same section controls entirely from the expanded left column;
- retain the full-screen control at the right of the top bar;
- do not leave a duplicate row, duplicate vertical list, or empty spacer in the
  left column.

The corrective screenshot is authoritative for this composition. Validation
must include a rendered narrow/mobile visual check showing the entire expanded
layout, not only DOM-presence assertions.

## Goal

Make the narrow/mobile navigation selector layout change according to whether
the left sidebar is collapsed or expanded, without changing the approved
collapsed mobile layout.

## Required behavior

### Collapsed left sidebar

- Keep the current horizontal Scope / Channel selector.
- Keep the current compact sidebar section switchers for Chat, Tasks, Files,
  Docs, and any existing peers.
- Preserve the current mobile behavior and presentation in this state.

### Expanded left sidebar

- Remove every Deck / Chat / Tasks / Docs / Files navigation control from the
  expanded left column; do not leave a duplicate vertical list, compact row,
  or empty spacer.
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
   absence of all section navigation from the left column and presence of one
   labelled section-control set in the top selector strip.
3. Exercise section selection and the expanded-to-collapsed transition.
4. Render or inspect the full expanded mobile composition against the
   corrective screenshot, including the retained full-screen control.
5. Run the focused tests.
6. Follow `agents.md` and `docs/release-notes.md` for release metadata.
7. Run:

   ```bash
   bun run check:public-source
   bun run test
   bun run build
   bun run verify:dist
   git diff --check
   ```

8. Confirm `dist/version.json` contains the final build version.

## Reporting

Post the investigation path, implementation summary, changed files, validation
results, final build version, and commit SHA on the Flight Deck task. Leave the
task in `review`. The coordinator will post milestone and completion updates to the
originating chat thread.

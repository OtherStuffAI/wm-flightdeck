# Mobile expanded selector: restore Setup / Settings

## Goal

Correct the existing mobile expanded-left-column selector swap by including the omitted Setup / Settings destination in the relocated labelled horizontal section picker.

## Source context

- Flight Deck task: `1544a4e5-be6b-4b2c-9fd2-e0cb8efd4201` — **Refine mobile selectors for expanded left sidebar**.
- Originating thread: workspace `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`, channel `0617d526-88dc-4dc2-9876-08349ab60eca`, thread `768e9aca-b8f4-4c47-aab1-46dd65c4086a`.
- Pete's latest correction: message `968e3abb-15e8-4d92-8573-34f59fcabd06`: “you are missing the setup / settings option”.
- Prior corrective implementation: commit `b9538df`, build `1816`.
- Prior rendered check: storage object `b0c1686e-ab75-43c6-a634-f761383182a3`.

## Required behavior

On mobile with the left column expanded:

- The top horizontal strip contains one labelled section picker for Deck, Chat, Tasks, Docs, Files, and Setup / Settings.
- Use the product's existing canonical Settings/Setup label, icon, route/action, active-state logic, visibility/permission rules, and unread/status behavior. Inspect the pre-swap section navigation rather than inventing a second settings destination.
- The expanded left column contains Scope / Channel navigation only. It must not contain Deck, Chat, Tasks, Docs, Files, or Setup / Settings.
- The full-screen control remains at the right of the top bar.
- There is no duplicated section picker, compact row, empty spacer, or clipped/unreachable Settings option.
- Horizontal overflow must keep every section, including Settings, reachable with appropriate touch targets.

On mobile with the left column collapsed:

- Preserve the current Scope / Channel horizontal strip and compact section controls unchanged, including its existing Setup / Settings access.

Desktop behavior must remain unchanged.

## Validation

- Add or update focused regressions proving the expanded top strip includes exactly one canonical Setup / Settings control and the expanded left column contains none.
- Cover collapsed/expanded transitions, section selection, active state, routing/deep-link behavior, touch targets, and horizontal overflow.
- Perform a rendered narrow/mobile visual check that shows Settings is present and reachable while the full-screen control remains visible.
- Run focused tests, the full test suite, public-source check, production build, distribution verification, and git diff/status checks required by this repo.

## Work and reporting constraints

- Work in `/Users/mini/code/wm/flightdeck` on `main`.
- Preserve concurrent work. Before committing, inspect the full shared worktree and commit all nonignored tested state unless there is a clear safety reason to pause.
- Do not revert, reset, overwrite, or discard work you did not create.
- Do not push, deploy, start a standalone preview, or restart the managed Flight Deck runtime.
- Post diagnosis, implementation, rendered evidence, validation totals, build number, and commit to the Flight Deck task. Rick will update Pete in the originating thread.

## Implementation handoff

Diagnosis: commit `b9538df` relocated the labelled expanded-state picker into the shared top bar but copied only Deck, Chat, Tasks, Docs, and Files. The existing canonical destination is the sidebar's `Setup` control: gear icon, `navigateTo('settings')`, and `navSection === 'settings'` active/current-page state, with no additional permission, visibility, unread, or status gating.

Resolution: the mobile-open top picker now includes that canonical Setup control. It is mobile-only, so the existing desktop five-item strip is unchanged. The expanded sidebar remains Scope / Channel-only, and selection closes the mobile drawer without changing the collapsed navigation mode.

Rendered evidence: `tests/e2e/mobile-expanded-sidebar-section-switcher.spec.cjs` renders the 720px-wide composition and saves `expanded-mobile-composition.png` in its Playwright test-results directory. The captured end-scroll state shows Setup reachable beside Files while the fixed full-screen control remains visible; the left column shows only Home, scopes, and channels.

Validation:

- Focused source regression: 7/7 passed.
- Focused rendered Playwright regression: 1/1 passed in local Google Chrome with video disabled.
- Public-source check: passed for 551 tracked files.
- Full Vitest suite: 3,168/3,168 passed across 236 files.
- Release-note/dist focused checks: 11/11 passed.
- Production build: build 1818 (`20260825-0637-4-1818`).
- Distribution verification: 2 asset references verified.
- `git diff --check`: passed.

Task-record note: this terminal session had no Flight Deck dispatch/broker context, so the scoped task comment/state tools and broker-aware CLI could not reach Tower. Post this handoff to task `1544a4e5-be6b-4b2c-9fd2-e0cb8efd4201` when a routed context is available; do not post to the originating thread because Rick owns that update.

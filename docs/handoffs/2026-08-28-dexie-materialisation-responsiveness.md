# Dexie materialisation responsiveness fix

## Goal

Eliminate the confirmed main-thread stall during large Tower PG bundle
materialisation in `/Users/mini/code/wm/flightdeck`, while preserving the
bundle-plus-cursor atomicity contract and current SSE recovery/cadence behavior.

Flight Deck task:
`7bb908d2-0a7c-4348-8def-2bfdbff56a45` — **Eliminate recurring Flight Deck UI
freezes during typing and startup**.

Originating Flight Deck context:

- workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`
- channel: `0617d526-88dc-4dc2-9876-08349ab60eca`
- thread: `d2b49b19-6ce9-48ed-ab43-ac119e990efe`
- Pete's implementation/restart approval: `03201352-8e89-42f5-81b2-aeb5e8bf2a0a`
- related Autopilot delivery task: `f1391578-de8e-40ce-b918-e02068444c71`

Read the full investigation handoff first:
`docs/handoffs/2026-08-28-flightdeck-recurring-ui-freezes.md`.

## Architecture contract

The latest Wingman Suite Architecture artifact is `v4` (parent `v3`, updated by
Pete on 2026-08-04), not the previously known `v3`:

`https://pale-log-tank.rick.runwingman.com/artifacts/Wingman_Suite/wingman-suite-arch/v4/`

Its saved scene states this UI update chain:

```text
Tower
  -> TowerSyncService (sole network/update owner)
  -> materialisation transactions
  -> Dexie
  -> Dexie liveQuery
  -> Alpine components
```

It assigns TowerSyncService SSE/cursor recovery, fallback polling, initial
workspace hydration, targeted `ensureLoaded`, request coalescing/deduplication,
and materialisation transactions. Preserve that ownership even if the service's
heavy execution moves behind a dedicated browser Worker boundary.

Also read completely before editing:

- `agents.md`
- `README.md`
- `docs/checkout_semantics.md`
- `docs/design/target_alpine_dexie_archi.md`
- `docs/runtime_ownership.md`
- nearest worker/sync/materialiser tests

The target design explicitly requires a real dedicated Web Worker for
sync/materialisation and says that the currently imported
`src/worker/sync-worker.js` module is not itself that browser boundary.

## Confirmed evidence

The production `hydrateTowerPgSyncBundle` path, exercised with fake IndexedDB,
measured approximately:

- 500 rows: 24 ms total, 3 ms maximum event-loop delay;
- 5,000 rows: 208–213 ms total, 27 ms maximum event-loop delay;
- 20,000 rows: 992–1,038 ms total, 101–102 ms maximum event-loop delay.

Mapping 20,000 rows without Dexie writes took only about 11.5 ms. The dominant
cost is the atomic Dexie materialisation transaction, not translation.

Other paths were not reproduced as current causes:

- chat input stayed near 0.1 ms median with up to 5,000 retained fixtures and
  an 80-row render window;
- representative TipTap typing stayed below long-task thresholds;
- 100 navigation cycles stopped all 491 created live queries;
- the focused SSE/subscription suites passed, and the managed build preserved
  `connected` state and the 120,000 ms fallback cadence across
  `pull-complete`/`cursor-acknowledged`.

## Required implementation

1. Inspect current worker bootstrap, `TowerSyncService`, bundle hydration,
   Dexie ownership, and browser bundling/test constraints before choosing the
   seam.
2. Move heavy PG bundle materialisation off the UI thread through a real
   dedicated Worker boundary, or implement another architecture-compatible
   mechanism that proves the UI event loop remains responsive.
3. Keep one authoritative transaction for a bundle page and its cursor. Do not
   expose partial materialisation or advance the cursor independently.
4. Preserve TowerSyncService as the sole network/update owner and keep UI reads
   Dexie/liveQuery-first. Do not render direct API responses.
5. Preserve current SSE lifecycle, cursor recovery, request coalescing,
   `ensureLoaded`, pending-write/outbox, checkout preparation, error/status,
   workspace switching, and teardown behavior.
6. Define a narrow worker message protocol and explicit error/termination
   semantics. Avoid cloning non-serializable signing/session state into the
   worker; keep signing/checkout intent at its documented boundary.
7. Add deterministic coverage proving:
   - large-bundle work no longer creates long UI-thread stalls;
   - bundle rows and cursor remain atomic on success and failure;
   - workspace switches/teardown cannot apply stale worker results;
   - existing SSE 120-second healthy cadence remains protected;
   - ordinary pending-write and targeted-load paths remain correct.
8. Follow release metadata/release-note rules, run focused tests, full tests,
   `check:public-source`, build, `verify:dist`, and `git diff --check`.
9. Commit all compatible nonignored tested state on `main` with a Conventional
   Commit. Preserve all pre-existing untracked handoffs; do not make private or
   operator material public merely to satisfy `check:public-source`.

## Acceptance

- The deterministic large-bundle proxy proves main-thread responsiveness
  materially improves.
- Atomic cursor/data behavior is covered on success, failure, and cancellation.
- Full Flight Deck tests/build/dist validation pass, with any pre-existing
  public-source baseline failure reported accurately.
- The worker comments the task with implementation, commit, measurements,
  validation, remaining browser trace, and originating message mention.
- The worker returns a supervised callback. It must not start a standalone
  server, restart the managed app, push, deploy, or change Autopilot/Tower.
  The manager owns Pete's approved final managed-app restart and smoke test.

## Shared-tree rules

Work on `main`. Preserve concurrent tracked and untracked files. Do not reset,
restore, clean, stash, revert, rebase, force-push, push, deploy, or start/restart
managed processes. Before committing, inspect the whole worktree and include
all compatible nonignored tested state unless a concrete safety conflict needs
manager direction.

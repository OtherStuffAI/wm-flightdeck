# Flight Deck recurring UI freeze investigation and repair

## Goal

Find and eliminate the current cause of Flight Deck repeatedly becoming non-responsive during typing and initial app load. Treat startup delivery latency and browser main-thread freezes as separate hypotheses until evidence connects them.

## Source and reporting

- Flight Deck workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`
- Scope: `76d518f7-c477-4374-bf74-5d36fda570ed`
- Channel: `0617d526-88dc-4dc2-9876-08349ab60eca`
- Thread: `d2b49b19-6ce9-48ed-ab43-ac119e990efe`
- Trigger message: `c0a6d030-e871-4090-860b-e7c993079797`
- Task: `7bb908d2-0a7c-4348-8def-2bfdbff56a45` (`Eliminate recurring Flight Deck UI freezes during typing and startup`)
- Prior performance task: `1c4113b6-f8da-4d02-b7f9-ea4f519cfbbc` (`Investigate Flight Deck severe access slowdown`)

Pete's report on 2026-08-28: "I’m getting regular non responsive states again in the app when trying to type or loading up the app ... the app grinds to a halt."

Read the task and its latest comments directly before acting. Post durable investigation, implementation, and validation evidence to the task. Report to Rick through the supervised dispatch callback; do not reply to Pete's chat thread directly.

## Manager evidence already collected

At the start of this investigation:

- Managed app `honest-ivory-thicket-app-wm-flight-deck` was online with zero PM2 restarts, zero sampled CPU, about 33 MB memory, and empty recent stdout/stderr logs.
- Local runtime `http://127.0.0.1:41045/` returned the index with approximately 5-7 ms TTFB and 11-14 ms total compressed transfer.
- Public `https://long-tin-knob.rick.runwingman.com/` returned the index with approximately 1.03-1.16 seconds TTFB and 1.69-1.73 seconds total compressed transfer.
- The public index was about 117 KB compressed. The current main JS was about 606 KB compressed / 2.3 MB on disk. The main CSS was about 60 KB compressed. The TipTap adapter was about 142 KB compressed.
- Sampled hashed assets advertised `cache-control: max-age=30` and returned `cf-cache-status: MISS`; each had roughly 1.06-1.16 seconds TTFB through the public route. This is a confirmed initial-load contributor but does not by itself explain typing freezes.
- The server-side process showed no evidence of CPU or crash pressure, so browser main-thread/reactive work and public proxy/cache behavior are the initial leading boundaries.
- `main` was ahead of `origin/main` by 25 commits. The worktree contained intentional untracked handoff files before this handoff was added. Preserve all of them.

## Relevant prior work

The prior severe slowdown task found that transient worker notifications (`pull-complete` and `cursor-acknowledged`) overwrote the live SSE connection state. That reduced fallback polling from 120 seconds to 15 seconds in chat or 30 seconds elsewhere, repeatedly triggering bundled workspace sync and Dexie materialisation. Commit `b05e239` fixed that lifecycle-state bug and added cadence coverage.

Confirm that repair still holds in the current source and live build. Do not assume the recurrence has the same cause.

Other recent high-risk areas include:

- document edit/autosave and canonical row reconciliation in `b05e239`, `d0b223b`, `d448a86`, `02585c6`, `137970b`, and `47508c5`;
- SSE cursor bootstrap/replay changes around `55fb0c0`, `8a31240`, `c864973`;
- Inbox reactive projections in `ba4cbf5`, `be2b541`, `b05b13e`, and `69f9590`;
- the monolithic Alpine root store/reactive surface described in `docs/design/reactive-surface-reduction.md`.

## Investigation requirements

1. Read `agents.md`, `README.md`, `docs/checkout_semantics.md`, `docs/design/reactive-surface-reduction.md`, `docs/design/pg-workspace-cursor-sync.md`, and the relevant SSE/editor docs before changing behavior.
2. Establish a repeatable proxy for both failure classes:
   - cold/reload startup from the managed app or an explicitly allowed test target;
   - sustained typing in the main chat composer and at least one rich/editor or comment composer, with representative workspace data.
3. Capture evidence appropriate to the browser problem: PerformanceObserver long tasks or equivalent trace, event-loop delay, input handler duration, Alpine expression/render activity where instrumentable, Dexie transaction/materialisation cadence, active liveQuery subscriptions/listeners, heap retention after navigation, and network requests during the freeze.
4. Inspect whether every keystroke mutates a large root-store field or causes work proportional to workspace messages/tasks/docs; inspect expensive getters used per rendered row, markdown/mention parsing, composer autosize, draft persistence/autosave, and attachment preview state.
5. Exercise repeated route/thread/workspace entry and exit to find listener, timer, liveQuery, or worker-message subscription accumulation.
6. Verify the SSE connected-state and 120-second healthy fallback cadence remain correct through `connected`, `pull-complete`, and `cursor-acknowledged` sequences. Inspect live runtime cadence if feasible without changing the running process.
7. Separate public route/cache latency from browser compute. If the dominant load fix belongs to Autopilot's proxy/static-server configuration, leave a precise cross-repo handoff with the exact headers/timings and do not edit Autopilot in this task.
8. Compare commits since 2026-08-25 with the preceding baseline and rank suspected contributors by confidence and expected impact.

## Implementation constraints

- Work in `/Users/mini/code/wm/flightdeck` on `main`.
- Preserve concurrent tracked and untracked state. Never reset, restore, clean, stash, revert, or overwrite work you do not understand.
- Implement only the smallest safe repository-local correction supported by evidence.
- Preserve local-first Dexie rendering, Tower PG cursor acknowledgement semantics, document draft/data safety, row-version conflict protection, and the prior SSE cadence repair.
- Do not start a standalone Vite/preview server. Use existing tests and the configured managed runtime/browser path only when available and safe.
- Do not restart the managed Flight Deck or Autopilot process. If a restart is needed to apply or verify a runtime change, report the exact process and reason to Rick for Pete's approval.
- Do not push or deploy.
- Follow release notes/version rules and commit all compatible nonignored tested state when ready.

## Acceptance criteria

1. The report distinguishes measured facts from hypotheses and explains both startup delay and typing stalls.
2. A proven repo-local hot path is fixed, or the correct external component is identified with enough evidence for a deterministic follow-up.
3. No recurring main-thread work proportional to full workspace size occurs on each keystroke or routine sync notification.
4. Repeated navigation does not accumulate liveQuery subscriptions, event listeners, timers, or worker handlers.
5. The healthy SSE state survives transient materialisation notifications and retains its 120,000 ms fallback cadence.
6. Add focused regression/performance-budget coverage for the proven cause where practical.
7. Run focused tests, `bun run test`, `bun run check:public-source`, release-note checks, `bun run build`, `bun run verify:dist`, and `git diff --check`; distinguish any baseline or unrelated failures.
8. Commit the complete compatible tested state with a Conventional Commit and report the hash.
9. Re-read task comments before final handoff, post validation evidence, and move the task to `review` only when ready.

## Useful Flight Deck commands

```bash
bun ~/code/wm/autopilot/clis/wingman.ts flightdeck task show 7bb908d2-0a7c-4348-8def-2bfdbff56a45 --workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9 --json
bun ~/code/wm/autopilot/clis/wingman.ts flightdeck task comments 7bb908d2-0a7c-4348-8def-2bfdbff56a45 --workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9 --json
bun ~/code/wm/autopilot/clis/wingman.ts flightdeck task comment 7bb908d2-0a7c-4348-8def-2bfdbff56a45 --workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9 --body "Status: ..." --json
bun ~/code/wm/autopilot/clis/wingman.ts flightdeck task state 7bb908d2-0a7c-4348-8def-2bfdbff56a45 --workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9 --state review --json
```

## Investigation result (2026-08-28)

### Outcome

The investigation proved a public delivery problem and a large-bundle browser
materialisation stall, but did not prove a small safe Flight Deck source fix for
Pete's recurring typing report.

No behavioral source patch was made. Normal chat and representative rich-editor
typing remained responsive in deterministic browser profiles, the managed build
retained the repaired SSE lifecycle, and repeated navigation did not accumulate
subscriptions. Changing those paths without a failing proxy would be speculative.

### Measured facts

- Three cache-disabled local browser loads reached response start in about
  8-10 ms and `DOMContentLoaded` in about 142-149 ms. Each had one browser
  initialization long task of about 87-89 ms.
- Three cache-disabled public browser loads reached response start in about
  1.56-1.87 seconds and `DOMContentLoaded` in about 3.59-4.37 seconds. Their
  browser initialization long task remained about 83-91 ms. The additional
  seconds are therefore delivery/proxy time, not extra browser compute.
- Repeated compressed public index requests transferred about 117-118 KB with
  about 1.07-1.08 seconds TTFB and 1.85-1.86 seconds total time.
- The public index correctly advertised `cache-control: no-cache`, but hashed
  JavaScript and CSS advertised only `cache-control: max-age=30`. Sampled
  hashed assets were `cf-cache-status: REVALIDATED` rather than a durable HIT.
- Deterministic chat typing with 0, 100, 1,000, and 5,000 injected messages kept
  the rendered feed window at 80 rows and produced no long tasks. Input-handler
  time stayed near 0.1 ms median and did not scale with the injected collection.
- Rich-editor input measured about 0.7 ms median for a 27 KB document, 2.7 ms
  for 270 KB, and 5.6 ms for 1 MB. A 1 MB editor mount produced two roughly
  51-52 ms long tasks; 27 KB and 270 KB mounts did not produce long tasks.
- A deterministic production-materialiser proxy applied synthetic PG channel
  bundles through the real Dexie path. Maximum event-loop delay was about 3 ms
  at 500 rows, 27 ms at 5,000 rows, and 102 ms at 20,000 rows. The 20,000-row
  apply took about 1.0 second end-to-end. Mapping without IndexedDB writes took
  only about 11 ms at 20,000 rows, locating the stall in the atomic Dexie
  materialisation boundary rather than payload translation.
- One hundred repeated section/detail navigation cycles created and stopped
  491 subscriptions, peaked at 18 active subscriptions, retained 11 for the
  final active route, and returned to zero after teardown.
- The focused SSE, TowerSyncService, section-subscription, and composer mention
  suites passed 100/100. The currently managed build was also exercised
  directly: `connected -> pull-complete -> cursor-acknowledged` remained
  `connected` and retained the 120,000 ms cadence before and after the transient
  notifications.

### Conclusions and confidence

1. **Public startup delivery — proven, high confidence.** The public route adds
   seconds before the same browser work begins. Its immutable hashed assets do
   not receive an immutable cache policy and were revalidated during sampling.
2. **Large PG snapshot/materialisation — proven stall boundary, medium confidence
   as Pete's typing trigger.** A 20,000-row atomic apply can block the main thread
   for roughly 100 ms and can visibly interrupt input if it overlaps typing.
   Current evidence does not show that Pete's healthy session is repeatedly
   receiving a bundle of that size; commit `b05e239` and the live build still
   protect the 120-second healthy SSE cadence.
3. **Ordinary chat input, representative document input, and subscription
   growth — not supported as current causes.** Their deterministic proxies did
   not reproduce a freeze. The rich editor remains linear in document size, but
   the measured 27 KB and 270 KB cases were below long-task thresholds.
4. **Recent commit ranking.** Document recovery/autosave commits have the largest
   new runtime surface but remained responsive at representative sizes. Inbox
   changes add attention projection work on task activity, not per keystroke.
   SSE cursor commits reduce replay/snapshot risk. Sidebar, avatar, and OTA
   changes have no measured typing-path signal.

### Why the materialiser was not patched here

The workspace cursor and every applied bundle page must commit in the same
Dexie transaction. Splitting a large transaction merely to yield can expose
partial materialisation or advance the cursor inconsistently. The safe
repository direction is to move physical materialisation into the dedicated
worker while keeping Dexie atomicity, as already specified in
`docs/design/target_alpine_dexie_archi.md`. That is not a smallest regression
patch and should not be attempted without a captured recurring large bundle or
an explicitly scoped architectural work package.

### Deterministic external handoff

Autopilot/public proxy ownership should:

1. serve fingerprinted `/assets/*` responses with a long immutable policy such
   as `Cache-Control: public, max-age=31536000, immutable` while keeping the
   HTML entry point revalidated;
2. identify the roughly 1.0-1.8 second origin/proxy delay before first byte and
   record per-hop timings;
3. verify cold and warm Cloudflare behavior, requiring fingerprinted assets to
   become HITs instead of repeated MISS/REVALIDATED responses;
4. rerun a cache-disabled browser profile and a warm repeat, reporting response
   start, `DOMContentLoaded`, transfer sizes, and cache status.

No Autopilot files or process state were changed in this investigation.

### Remaining manual verification

Capture one real Pete freeze with a browser performance trace plus Flight Deck
timing logs. Correlate the long task with PG bundle row counts, sync mode
(`snapshot` versus `delta`), cursor state, Dexie apply duration, and network
requests. If a recurring large snapshot/delta is confirmed, scope the worker
materialisation work around that exact bundle while preserving cursor atomicity.
No managed-process restart is required for this investigation result.

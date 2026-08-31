# Real-world Flight Deck typing responsiveness recurrence

## Goal

Pete reports on 2026-08-31 that Flight Deck responsiveness has **not improved**: typing continues to lag on both mobile and desktop browsers. Reopen the existing performance task and determine why prior synthetic/browser-harness improvements did not translate into his real sessions. Produce an evidence-backed diagnosis and implement the smallest safe Flight Deck correction when the cause is proven.

Work in `/Users/mini/code/wm/flightdeck` on `main`. This is implementation-capable work. Preserve concurrent state and follow the repository's shared-tree commit semantics.

## Authoritative Flight Deck context

- Workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`
- Scope: `76d518f7-c477-4374-bf74-5d36fda570ed`
- Channel: `0617d526-88dc-4dc2-9876-08349ab60eca`
- Thread: `d2b49b19-6ce9-48ed-ab43-ac119e990efe`
- New recurrence message: `34e0ef91-dc5b-4e67-9ec0-93191375a462`
- Existing task: `7bb908d2-0a7c-4348-8def-2bfdbff56a45` (`Eliminate recurring Flight Deck UI freezes during typing and startup`)
- Earlier mobile report: `9f0532ea-4bd7-4405-8404-1e1ef7d2bd32`
- Previous handoffs:
  - `docs/handoffs/2026-08-29-mobile-chat-typing-latency.md`
  - `docs/handoffs/2026-08-29-mobile-chat-typing-deeper-audit.md`
  - `docs/handoffs/2026-08-28-flightdeck-recurring-ui-freezes.md`

Before acting, fetch the current task and all latest comments directly from Flight Deck PG. Use the task as the durable technical record and return the terminal result through the supervised dispatch callback. Do not post directly to Pete's chat thread.

## What changed in the evidence

Do not treat the prior green harness as proof that the issue is fixed. Pete has now tested the shipped app and says there is no practical improvement on either mobile or desktop.

Current `main` includes:

- `6c60448` — heavy PG/Dexie bundle materialisation moved to a dedicated Worker;
- `a3fbbdf` — completed mention pills no longer keep workspace typeahead active;
- `65ec962` — duplicate composer scans, growing Range clones, per-key autosize layout, recent-chip churn, and small live-message array replacement were reduced;
- build 1859 was previously reported as served locally and publicly.

The prior strongest synthetic case reported good median/p95 input-to-paint and no sentence-scale backlog. Pete's real-world result contradicts that proxy. The investigation must find the missing dimension rather than repeating the same test and declaring success.

## Required investigation

1. Verify the exact build and asset/service-worker state actually served by the local and public managed Flight Deck routes. Confirm the browser can activate the expected build rather than remaining on stale HTML, service-worker, module, or mixed-build assets. Record build/version, cache headers, worker assets, service-worker controller/update state, and any console/runtime errors.
2. Reproduce in the managed/public application against the real Pete workspace and ordinary live activity, not only injected fixtures. Use read-only inspection and production-faithful browser traces. Do not expose message contents in task comments or logs; report counts, timings, record families, and stack/function attribution.
3. Capture interaction-to-next-paint/event timing and long-task stacks while typing continuously in a real thread on both a desktop browser profile and throttled/mobile profile. Compare:
   - fresh load versus a long-lived tab;
   - first thread open versus repeated navigation;
   - no mention versus a completed Rick mention;
   - quiet workspace versus incoming SSE/liveQuery/sync activity;
   - short versus large real thread/history;
   - focused composer versus other editable inputs if the symptom is broader.
4. Attribute every material stall or progressive slowdown. Inspect at least:
   - Alpine effects/watchers and root-store invalidation triggered by `threadInput`;
   - DOM mutation, layout/style, paint, selection/IME/autocorrect, autosize, and scroll anchoring;
   - message Markdown/render/projection work and keyed versus unkeyed DOM replacement;
   - liveQuery emissions, Dexie cross-context notifications, sync-worker messages, SSE events, cursor/materialisation cadence, repeated full-family refreshes, avatar/storage resolution, and background polling;
   - service-worker update/reload behavior, asset mismatch, exceptions/retry loops, detached nodes/listeners/observers/timers, heap/GC, and long-lived-tab growth;
   - any runtime difference between the test harness and the shipped managed build, including dev/test instrumentation masking production behavior.
5. Add a temporary opt-in diagnostic mechanism only if needed to capture the real stall safely. It must be bounded, redact message bodies, impose negligible cost when disabled, and be removed before commit unless a durable user-facing diagnostic is justified and tested.
6. Rank confirmed causes by measured contribution. Implement only a cause-proven repo-local correction. If the dominant cause is Tower, Autopilot, browser/device behavior, or deployment/cache state, stop before adjacent-repo mutation and leave exact evidence plus a scoped follow-up recommendation.

## Correctness constraints

- Preserve mention pills, caret/selection, IME/composition, paste, attachments, editing, keyboard send, accessibility, recent chips, draft restoration, live updates, and scroll position.
- Preserve Worker records-plus-cursor atomicity, workspace cancellation, local-first Dexie/liveQuery behavior, pending writes, targeted loads, and healthy 120-second SSE cadence.
- Do not debounce or delay visible input as a substitute for removing blocking work.
- Do not read or publish Pete's message bodies as profiling evidence.
- Do not mutate Tower or Autopilot code without a separately evidenced handoff and manager approval.
- Do not push, deploy, start a standalone server, or restart Flight Deck/Autopilot. The manager owns any approved runtime restart.

## Validation and handoff

- Add a regression or production-faithful performance test that fails on the identified path and proves the correction, including a long-lived/realistic activity dimension missing from the prior harness.
- Run focused tests, `bun run test`, `bun run check:public-source`, release-note checks, `bun run build`, `bun run verify:dist`, and `git diff --check`; distinguish known baseline failures.
- Re-read the current task/comments before the terminal handoff.
- Commit all compatible nonignored tested `main` state using a Conventional Commit, preserving and explaining intentionally dirty files.
- Post useful investigation and implementation milestones to the task, not Pete's chat.
- Return through the supervised callback with: verified served build/state, reproduction method, ranked measured causes, before/after evidence, files, tests, commit, remaining limitations, and whether a managed Flight Deck restart is required.

## Acceptance criteria

- The worker either reproduces Pete's real sentence-scale input lag in a production-faithful managed/public path or proves a specific observable mismatch between Pete's browser/runtime and the tested build that explains why prior results did not transfer.
- The dominant blocking work is attributed with timings and stack/function or subsystem evidence; a synthetic-only “cannot reproduce” result is not sufficient.
- Any fix removes the measured cause without regressing input correctness, live updates, sync atomicity, SSE cadence, or lifecycle cleanup.
- Task state and comments accurately describe what is fixed, what remains, and the exact real-device/browser verification required.

## Investigation outcome

### Served build and cache state

The managed local and public routes both served build 1860 (`20260831-0747-1-1860`) during the investigation. Their HTML, main module (`assets/index-49wsyE_q.js`), and materialisation Worker (`assets/tower-pg-materialization-worker-D55wl7Qy.js`) matched byte-for-byte. HTML was `no-cache`; the public fingerprinted module was an immutable Cloudflare cache hit; and `service-worker.js` used a 30-second public cache lifetime. Fresh Chromium profiles activated the expected worker with no waiting or installing worker after the first-load activation/reload sequence, and only the matching `wingman-fd-20260831-0747-1-1860` cache remained. Stale or mixed assets therefore do not explain the recurrence.

The unauthenticated shell does emit 14 Alpine errors because the WApp delegation/install drafts are null while their form expressions initialise. These occur at startup, not per key, and were not the measured typing stall. The scoped diagnostic identity also produced expected NIP-44, permission, and missing-image errors that are not representative of Pete's signed-in identity.

### Real-workspace reproduction and attribution

Read-only Tower inspection found a 33-page initial workspace snapshot at a 500-row page limit. Across those pages Tower returned 3,532 messages, 418 tasks, 1,720 task comments, and the other materialised families, while repeating the same 8 scopes and 30 channels on every page. The repeated navigation payload is therefore 1,254 rows per catch-up.

Flight Deck correctly materialises each page and cursor atomically in the dedicated Worker. The missing dimension was what happens afterward: every per-page Dexie commit notified the always-on scopes and channels live queries, and those two projections lacked the logical equality guard already used by the active message projection. `createLiveSubscription` consequently queued `applyScopes` and `applyChannels` in its `requestAnimationFrame` callback even when the 38 navigation rows were unchanged, invalidating the Alpine sidebar during focused typing.

A temporary, body-redacting real-workspace probe was used and removed before commit. In a quiet target thread, 558 continuous inputs produced no long tasks or long animation frames, a 36.8 ms maximum frame gap, and sampled input-to-next-paint median/p95 of 19.7/41.1 ms. With catch-up overlapping 930 inputs and the pre-fix navigation behavior restored, the partial trace produced 125 ms and 261 ms long tasks, a 239.5 ms maximum frame gap, 5,602 unrelated body mutations, and three calls each to `applyScopes` and `applyChannels`. Long-animation-frame attribution placed 122-256 ms in the `FrameRequestCallback` used by live-query delivery; the composer handlers themselves remained small.

With logical navigation equality enabled over the same partial real-workspace path, the repeated channel projection was eliminated and scope projection fell to its initial delivery. Body mutations fell to 4,928, elapsed typing time from 1,684 ms to 1,450 ms, maximum frame gap to 201.2 ms, and the largest long task to 217 ms. Genuine message pages still caused two `applyMessages` deliveries and remaining frame work; those rows were actually new to the fresh profile and were not suppressed. The correction is therefore a measured, safe contributor fix rather than a claim that every fresh-snapshot cost is gone.

The existing throttled iPhone-profile harness remained lossless after 25 thread close/open cycles, a completed mention pill, a 600-message thread, 2,000-row workspace families, and a representative live message update: 42/42 inputs arrived, no mention search or Range cloning recurred, input-to-paint median/p95 was 20/35.6 ms, and DOM size did not grow. Its one 152 ms long task overlapped the injected live update; `applyMessages` accounted for 12.1 ms directly. The harness process later required interruption during teardown, so this is trace evidence rather than a clean Playwright validation result.

### Correction and limits

`ws:scopes` and `ws:channels` now use `sameLogicalValue` at the live-query delivery boundary. Genuine changes still project immediately; Dexie remains local-first; Worker transactions, cursor atomicity, pending writes, cancellation, SSE cadence, selection, composer behavior, and scroll behavior are untouched. A regression replays the observed 33-page unchanged navigation cadence and proves one initial projection, no 32 redundant projections, and immediate delivery of a changed channel.

The remaining real-device acceptance step is to deploy/restart the managed Flight Deck onto build 1862 and have Pete retest both a long-lived tab and a fresh catch-up on desktop and mobile. A managed restart is required because the currently served build is 1860; this investigation did not restart, deploy, or mutate Tower/Autopilot.

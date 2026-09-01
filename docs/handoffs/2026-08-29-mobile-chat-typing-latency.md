# Mobile chat typing latency follow-up

## Goal

Diagnose and eliminate the persistent Flight Deck mobile chat-composer latency Pete can reproduce by opening a thread, inserting/tagging Rick, and typing continuously. The visible text may lag a whole sentence behind physical input; after it catches up, input progressively slows again.

This is a recurrence after commit `6c60448` moved large Tower PG/Dexie bundle materialisation into a dedicated Worker. Do not assume that fix failed or that the same cause remains. Prove what blocks input in this exact mobile sequence and implement the smallest robust correction supported by evidence.

## Authoritative Flight Deck context

- Workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`
- Scope: `76d518f7-c477-4374-bf74-5d36fda570ed`
- Channel: `0617d526-88dc-4dc2-9876-08349ab60eca`
- Thread: `d2b49b19-6ce9-48ed-ab43-ac119e990efe`
- New trigger: `9f0532ea-4bd7-4405-8404-1e1ef7d2bd32`
- Original report: `c0a6d030-e871-4090-860b-e7c993079797`
- Existing urgent task: `7bb908d2-0a7c-4348-8def-2bfdbff56a45` (`Eliminate recurring Flight Deck UI freezes during typing and startup`)
- Prior implementation: `6c604485079e9fd92ec482dcd3c367091d5bec07` (`fix(sync): move PG materialisation off UI thread`)

Read the current task, all recent task comments, and the authoritative thread directly before acting. The task record is the durable technical surface. Report investigation, implementation, validation, and commit evidence there. Report the terminal outcome to Rick through the supervised dispatch callback; do not post directly to Pete's chat thread.

Pete's 2026-08-29 report:

> “I’m still getting typing slow down on mobile. Eg I will open a thread tag you and then type and I’ll often get through a whole sentence before the typing on screen catches up. Even once it catches up and stabilises then the experience starts to slow down.”

## What the previous work proved—and did not prove

The earlier investigation measured desktop browser proxies:

- synthetic chat typing with up to 5,000 retained messages kept an 80-row render window, about 0.1 ms median input-handler time, and no long tasks;
- repeated navigation did not leak liveQuery subscriptions;
- a 20,000-row Dexie materialisation could block the UI loop for about 101–102 ms;
- commit `6c60448` moved that atomic materialisation into a dedicated Worker, reducing the caller-loop delay to about 3–6 ms while preserving bundle-plus-cursor atomicity;
- the managed Flight Deck was restarted on build 1853 and the Worker asset loaded.

Those measurements do not cover Pete's present sequence. In particular, they did not prove behavior under mobile WebKit/Chrome CPU constraints, soft-keyboard viewport changes, a real agent mention node in the live composer, or sustained input after opening a real thread while thread state and reactive projections settle.

## Manager code-path observation to prove or disprove

`createMentionPill` renders a completed mention token with visible `textContent`
such as `@Rick`. `handleMentionInput` currently reads the complete
contenteditable `textContent`, checks whether it contains any `@`, obtains the
caret offset by cloning/walking the range, scans backward for the nearest `@`,
and calls `searchMentions` across the local people/docs/tasks/channels/scopes/
flows/opportunities collections.

This creates a strong hypothesis: after a completed non-editable mention pill,
ordinary sentence typing may keep rediscovering the pill's visible `@` as if it
were a still-active plain-text mention. The query would become `Rick <growing
sentence>`, causing range cloning, backward scanning, mention collection scans,
and popover reactivity on every keystroke. That matches Pete's mention-specific,
progressively worsening sequence unusually well. Instrument it explicitly:
compare `mentionActive`, `mentionQuery`, `searchMentions` calls, collection rows
scanned, and input-to-paint latency after a pill versus plain text. A correct
fix would find active `@` text only within the editable caret segment and never
cross a `[data-mention-token]` boundary, while retaining typed-`@` autocomplete,
caret behavior, pill deletion, paste, and IME composition.

## Required investigation

1. Reproduce the exact sequence: open an existing thread with representative history, focus the thread composer, insert Rick through the mention UI/chip or typeahead, then type continuously for at least 30–60 seconds.
2. Exercise at least an iPhone/mobile-WebKit profile and a throttled mobile Chromium profile. Use the existing Playwright/browser infrastructure or a deterministic DOM harness; do not start an ad hoc standalone preview server. If a managed-browser route is unavailable, build a production-faithful test harness around the real composer functions and clearly label the limitation.
3. Record input delay and main-thread evidence, not just handler wall time: `beforeinput`/`input` event timestamps, paint latency, long tasks, animation-frame/event-loop gaps, layout/style work, DOM mutation counts, Alpine effects, liveQuery callbacks, network/SSE activity, and heap/DOM growth while typing.
4. Trace all work in the thread composer's input path, especially:
   - `syncMentionComposerModel` and DOM-to-model serialization;
   - `handleMentionInput`, mention-token/range detection, suggestion filtering, and recent mention projections;
   - the `$watch('$store.chat.threadInput', ...)` path back through `syncMentionComposerFromModel`, including whether it rewrites `innerHTML`, restores selection, or causes a feedback loop after every input;
   - Alpine expressions that read `threadInput` or broad root-store objects, including send-button state and composer/attachment UI;
   - contenteditable selection/range preservation and mention-chip DOM;
   - autosize, scroll-to-bottom, ResizeObserver/MutationObserver, keyboard viewport and visualViewport handlers, and layout forced by composer height changes;
   - thread-open hydration, message rendering, highlighting/Markdown transforms, image/avatar work, liveQuery refreshes, and any background sync activity that overlaps focused input;
   - listener, observer, watcher, timer, or subscription accumulation across repeated open/close cycles.
5. Compare no-mention versus Rick-mention, short versus long thread, immediate typing versus typing after settling, and first open versus repeated opens. Determine which dimension causes latency to grow.
6. Confirm commit `6c60448`'s Worker is actually active in the current build and that its cross-context Dexie updates do not trigger a full expensive thread/composer rerender per bundle. Preserve its atomicity and lifecycle guarantees.
7. Check mobile-specific CSS/layout pressure around `.thread-input-bar`, `.chat-input`, sticky/fixed panels, safe-area insets, and soft-keyboard viewport changes. A layout loop is as important as a JavaScript hot path.
8. Inspect recent commits after `6c60448`, including current `285564c`, for changes that may affect the composer or global reactive surface.

## Implementation and safety constraints

- Work in `/Users/mini/code/wm/flightdeck` on `main`.
- Preserve concurrent tracked and untracked changes. Do not reset, restore, clean, stash, revert, or overwrite work you do not understand.
- Follow the repository's applicable instructions and architecture docs before changing behavior.
- Fix only a proven cause. Do not paper over the symptom with arbitrary debouncing that drops, reorders, or delays visible user input.
- Preserve mention insertion, caret/selection behavior, plain-text and rich paste, attachments, edit mode, keyboard send controls, recent mention chips, thread draft behavior, live messages, scroll behavior, accessibility, and desktop behavior.
- Preserve TowerSyncService ownership, Dexie materialised-view semantics, cursor atomicity, and the 120-second healthy SSE fallback cadence.
- Add focused regression/performance coverage for the proven hot path. The regression should fail on the old implementation or otherwise demonstrate a meaningful before/after frequency/timing reduction.
- Do not push, deploy, start a standalone Vite/preview server, or restart the Autopilot-managed Flight Deck/Autopilot process. Report any required restart to Rick; Pete has not authorized one in this message.

## Acceptance criteria

1. The exact open-thread → insert Rick mention → sustained typing sequence has an evidence-backed diagnosis under realistic mobile constraints.
2. The composer displays input without sentence-scale backlog, including during thread-settling and steady-state background activity.
3. No input event performs work proportional to the whole thread/workspace or rewrites the complete contenteditable DOM unnecessarily.
4. No watcher/model-to-DOM feedback loop, observer/layout loop, or lifecycle accumulation occurs across repeated thread opens.
5. Mention chips/tokens and caret/selection remain correct; IME/composition behavior is not broken.
6. The prior materialisation Worker and SSE cadence regressions remain protected.
7. Focused tests, the full test suite, `bun run check:public-source`, release checks, `bun run build`, `bun run verify:dist`, and `git diff --check` are run and reported, with pre-existing failures clearly separated.
8. Regenerated `dist/` and release metadata are included when source changes ship.
9. Commit all compatible nonignored tested state on `main` with a Conventional Commit and report the hash. Do not hide required state in uncommitted files.
10. Re-read the task and recent comments before handoff, add the evidence and validation to the task, and move it to `review` only when the mobile fix is ready for Pete to test.

## Reporting checkpoints

- First meaningful milestone: reproducible input-latency trace and ranked cause, including whether mention DOM, model/DOM feedback, layout, thread rendering, or background sync dominates.
- Second milestone: implemented correction plus focused before/after evidence.
- Terminal handoff: full validation, commit, remaining device/manual verification, and whether a managed Flight Deck restart is required.

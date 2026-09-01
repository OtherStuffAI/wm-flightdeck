# Mobile chat typing deeper performance audit

## Goal

Find, measure, and correct any remaining causes of mobile Flight Deck chat-composer slowdown after the first mention-token repair. Pete explicitly asked Rick to “look for more slow down reasons” after reporting that text can lag a whole sentence behind physical input and progressively slow again.

Work in `/Users/mini/code/wm/flightdeck` on `main`. This is implementation-capable work: if another repo or runtime boundary is implicated, leave exact evidence and stop before cross-repo mutation.

## Authoritative Flight Deck context

- Workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`
- Scope: `76d518f7-c477-4374-bf74-5d36fda570ed`
- Channel: `0617d526-88dc-4dc2-9876-08349ab60eca`
- Thread: `d2b49b19-6ce9-48ed-ab43-ac119e990efe`
- Latest trigger: `c9afdd07-75ce-493a-8adf-87bbb3fb21f8`
- Mobile recurrence: `9f0532ea-4bd7-4405-8404-1e1ef7d2bd32`
- Original report: `c0a6d030-e871-4090-860b-e7c993079797`
- Existing task: `7bb908d2-0a7c-4348-8def-2bfdbff56a45` (`Eliminate recurring Flight Deck UI freezes during typing and startup`)
- Previous detailed handoff: `docs/handoffs/2026-08-29-mobile-chat-typing-latency.md`

Before acting, fetch the current task and latest comments directly from Flight Deck PG. The task is the durable technical surface. Add meaningful evidence/progress there, and return the terminal outcome through the supervised dispatch callback. Do not post directly to Pete’s chat thread.

## Current state and first fix

Current `main` contains commit `a3fbbdffe4199312b2c19b1cf0797e9975be8a63` (`fix(chat): keep mention typing responsive`). That commit proved and corrected one distinct cause:

- after inserting a non-editable mention pill, the old implementation rediscovered its visible `@Rick` as an active typeahead query;
- ordinary sentence typing then searched workspace mention collections on 45 of 46 input events in the mobile trace;
- the fix constrains the active query to editable text after the latest mention/token/block boundary;
- it added unit coverage plus `tests/e2e/mobile-chat-composer-latency.spec.cjs` and build 1856 metadata.

Do not merely re-prove that cause. Validate the fix remains active, then use the existing E2E instrumentation as the starting point for a deeper ranked audit.

Commit `6c604485079e9fd92ec482dcd3c367091d5bec07` already moved large atomic PG/Dexie materialisation into a dedicated Worker, reducing measured caller-loop delay from about 101–102 ms to 3–6 ms. Preserve its atomicity, lifecycle, and healthy 120-second SSE cadence.

Current repository state at dispatch time is `main`, ahead of `origin/main`, with multiple intentional untracked handoff documents. Preserve all concurrent state. Read `agents.md` and applicable docs. Do not reset, restore, clean, stash, revert, or overwrite work you do not understand.

## Strong remaining hypotheses to prove or disprove

The manager inspected the current input path and found several concrete candidates. They are hypotheses, not conclusions:

1. `syncMentionComposerModel` serializes the full contenteditable DOM on every input, updates the Alpine root store, parses canonical actor mentions, and schedules autosize. The `$watch('$store.chat.threadInput', ...)` callback then calls `syncMentionComposerFromModel`, which serializes the full composer again to decide whether hydration is needed. Measure duplicate full-DOM traversal and the breadth of Alpine invalidation per key.
2. Even after `a3fbbdf`, `handleMentionInput` first reads full `textContent`; because a completed pill still contains visible `@Rick`, it may call `composerMentionQueryAtSelection` on every later input. That helper currently clones the Range from composer start to caret and walks the cloned fragment. Measure its call count, cloned nodes/bytes, duration, allocation/GC pressure, and scaling with long drafts/multiple pills. A boundary-aware backward walk or a cheaper trigger gate may be appropriate only if evidence proves it.
3. The thread composer renders recent mention chips through repeated Alpine calls to `getRecentMentionChips('thread')`. Draft changes may cause `canonicalActorMentions(draft)`, result filtering/avatar mapping, and dependent template effects each key. Measure invocation count, message/person ranking cache hits, draft scan cost, DOM mutations, and whether chip visibility/list rerenders.
4. `scheduleComposerElementAutosize` runs on each input. `autosizeComposer` calls `getComputedStyle`, changes `height` to `auto`, reads `scrollHeight`, writes height/overflow, and can force layout. Measure style/layout counts and duration on mobile; determine whether height work can be skipped until a line/size boundary without breaking soft-keyboard behavior.
5. The send-button and composer-adjacent Alpine expressions read `threadInput` and several root-store collections. Measure which effects rerun on each key and whether any broad root reactive dependency causes thread/message/template re-evaluation.
6. Background `applyMessages`, liveQuery refreshes, avatar/storage-image hydration, scroll anchoring, Markdown rendering, or thread-reply projection may overlap focused input. Measure isolated typing versus scheduled representative live updates and a real settling thread. Confirm no full thread re-render, scroll/layout loop, or composer DOM rewrite.
7. Repeated open/close cycles may accumulate `$watch`, observers, RAF callbacks, viewport listeners, timers, or contenteditable nodes even though earlier liveQuery counts were healthy. Measure listener/observer/effect counts, DOM nodes, heap, and latency over at least 25–100 cycles.
8. Mobile WebKit may exhibit selection, IME/composition, autocorrect, or soft-keyboard viewport behavior not visible in Chromium’s synthetic `pressSequentially`. Add realistic `beforeinput`/composition/selection coverage where the local harness permits and clearly state any real-device limitation.

## Required work

1. Fetch current task/comments and read the previous handoff, `agents.md`, relevant composer/chat code, and existing performance tests.
2. Extend or reuse the production-faithful E2E/harness instrumentation to attribute input-to-paint latency and main-thread work across:
   - no mention versus completed Rick/agent pill;
   - short versus long drafts and one versus many pills;
   - short versus long thread history;
   - immediate versus settled typing;
   - isolated typing versus representative live message updates;
   - first open versus repeated open/close cycles;
   - throttled mobile Chromium and WebKit/iPhone profile where available.
3. Record per-input counts/durations for composer serialization, model-to-DOM comparison/hydration, mention query detection/search, recent-chip calculation, autosize, Alpine effect/template updates, DOM mutations, layout/style recalculation, frame gaps/long tasks, heap/DOM growth, and any sync/network work.
4. Rank all measured causes. Fix each proven safe repo-local cause whose cost or recurrence can plausibly contribute to the reported progressive mobile lag. Prefer coherent fixes over unrelated micro-optimizations, and do not debounce away visible user input.
5. Add focused regression/performance coverage that demonstrates the old frequency/scaling problem and the corrected behavior. Preserve mentions, caret/selection, pill deletion, paste, attachments, edit mode, recent chips, keyboard send, accessibility, IME/composition, thread drafts, live updates, scroll position, desktop behavior, Worker atomicity, and SSE cadence.
6. Run focused tests, the practical full suite, `bun run check:public-source`, required release-note checks, `bun run build`, `bun run verify:dist`, and `git diff --check`. Dist is ignored; update tracked build/release metadata for shipped behavior.
7. Re-read the task and latest comments before handoff. Commit all compatible nonignored tested state required for the checkpoint using a Conventional Commit. Preserve and explain any files intentionally left dirty. Do not push, deploy, start a standalone preview, or restart the Autopilot-managed Flight Deck or Autopilot process.

## Acceptance criteria

- At least the known mention-query regression remains fixed, and the audit provides a measured ranked list of additional hot paths or a defensible measured conclusion that none are material in the available harness.
- No ordinary input performs avoidable duplicate whole-composer DOM traversal, unnecessary mention-query cloning/search, full-workspace ranking, or forced layout proportional to draft/thread/workspace size.
- Representative live updates and repeated thread opens do not progressively increase input-to-paint latency, heap/DOM, listeners/observers, or reactive work.
- Mobile input remains lossless and immediately visible under the strongest practical local CPU profile; no sentence-scale synthetic backlog appears.
- Focused regression evidence, full validation, build metadata, commit hash, remaining real-device limits, and restart requirement are reported on the task and in the dispatch callback.

## Reporting checkpoints

1. First milestone: measurements and ranked causes, explicitly distinguishing `a3fbbdf`’s already-fixed search loop from remaining work.
2. Second milestone: implemented corrections and focused before/after evidence.
3. Terminal handoff: validation, commit, files, any intentionally dirty state, real-device verification still needed, and whether Rick should restart the managed Flight Deck.

# Instant TipTap editing while the document lease is acquired

## Work record

- Flight Deck task: @[Make TipTap document editing feel instant while acquiring the lease](mention:task:6367742a-2763-44a3-a57f-d03a0a1c9e8c)
- Originating request: @[Message](mention:message:abe95f61-55b7-4bcb-be85-c0db5798c23a) in @[Features](mention:channel:0617d526-88dc-4dc2-9876-08349ab60eca)
- Repo/workdir: `/Users/mini/code/wm/flightdeck`
- Branch: `main`
- Write scope: Flight Deck only unless evidence proves the existing Tower edit-lease API cannot support the accepted behavior. Stop and report before expanding to Tower or Autopilot.

## User problem

Pete says clicking **Edit** currently takes long enough to feel broken. Lease acquisition blocks entry into the editor, and the UI does not communicate meaningful progress. He wants documents to load in TipTap by default and to be able to click and type immediately, even when the lease request is still in flight.

Pete accepts implementing the strong single-writer experience first. True simultaneous multi-user editing is a later product slice.

## Product outcome

Use TipTap as the normal document surface. Opening or reading a document must not itself monopolize the exclusive edit lease. On edit intent, the browser should respond immediately while it acquires the lease asynchronously, without allowing any unleased write to Tower.

The intended state model is conceptually:

1. **Ready/read-only** — TipTap is rendered and the document can be read/selected. The client may asynchronously inspect the active lease so status is already available, but it does not acquire a lease merely because the document is open.
2. **Acquiring** — pointer/focus/keyboard edit intent starts lease acquisition immediately. The UI instantly says `Acquiring edit access…`. User input may update an ephemeral local editor draft while the request runs.
3. **Editing** — the lease succeeds; preserve the exact draft and caret/selection, start renewal, and permit autosave/manual save with the lease token and expected `row_version`.
4. **Blocked/error** — another actor holds the lease, the request fails, or the client is offline. Preserve the local draft without submitting it, make the editor safe/read-only, explain the state, and provide an obvious retry plus a way to copy or discard the draft.
5. **Conflict/expired** — if the base row changes or the lease expires while a dirty local draft exists, never silently replace either side. Preserve the draft and require a deliberate reload/retry/merge decision.

Exact property/function names should follow the existing code. Do not introduce a parallel document model.

## Current implementation evidence

Inspect and work from current `main`, especially:

- `src/docs-manager.js`
  - `acquireSelectedDocCheckout()`
  - `enterSelectedDocEditMode()`
  - `setDocEditorMode()`
  - `mountDocRichEditor()` and rich-editor synchronization
  - PG save/autosave, stale-version handling, lease renewal/release, document navigation/close
- `src/docs/editor/tiptap-editor-adapter.js`
- `src/docs/editor/lazy-tiptap-editor.js`
- `src/pg-edit-session.js`
- `src/api.js` edit-lease GET/acquire/renew/release calls
- `index.html` document mode/status controls and TipTap mount
- `src/styles.css` document status styling
- `tests/docs-manager-mixin.test.js`
- `tests/pg-edit-session.test.js`
- `tests/e2e/docs-rich-editor.spec.cjs`
- `docs/checkout_semantics.md`
- `docs/pg-migration/pg-edit-leases-and-offline-editing.md`

Tower already exposes active-lease inspection plus acquire/renew/release routes, and document saves require the lease token and optimistic row version. Treat Tower as authoritative; do not weaken or bypass those controls.

## Required behavior

- A selected document renders through TipTap by default. The user should not need to click a mode switch simply to get the normal rich document surface.
- Merely opening/viewing a document does not acquire or renew the edit lease.
- Start a non-blocking active-lease status lookup when appropriate so the UI can distinguish available, held-by-self, held-by-other, offline, and unknown states. Do not delay document rendering on this lookup.
- First edit intent starts lease acquisition once. Deduplicate pointer/focus/keyboard races and repeated keystrokes so only one request is active.
- Give immediate visual feedback. A slow request must never look like a dead button or frozen editor.
- Keystrokes entered during acquisition are visible immediately and remain a transient client-side draft. They must not reach Tower, Dexie canonical document state, version history, autosave, or background write queues until a valid lease is held.
- On success, preserve every character exactly once, preserve the selection/caret where practical, begin lease renewal, and continue normal editing without remount flicker.
- On denial/failure/offline, preserve the draft visibly and safely, prevent Tower submission, identify the reason/holder when available, and expose retry plus copy/discard recovery actions. Do not silently throw away the draft or pretend edit access exists.
- Remote hydration/SSE while an acquisition draft is dirty must not overwrite the draft. Track the authoritative base version and surface a conflict when needed.
- Save/autosave must continue requiring both the lease token and the correct base `row_version`. Review the existing stale retry behavior and ensure it cannot silently overwrite an intervening document body.
- Release or stop renewing the lease on successful save-and-exit, cancel/discard, document navigation/close, and inactivity according to existing policy. Pending acquisition that resolves after navigation must not attach its lease to the wrong document.
- Preserve current rich content, images, comments/anchors, source/block editor alternatives, document versions, mobile layout, offline rules, and accessibility/keyboard behavior.
- Do not implement Yjs, Hocuspocus, CRDT persistence, shared cursors, presence, or concurrent multi-writer semantics in this task.

## UX expectations

Use concise, always-visible status rather than a modal:

- `Ready to edit` or no noisy label when no active lease is known.
- `Acquiring edit access…` immediately on intent.
- `Editing · saved` / existing save-state language while the lease is held.
- `Being edited by <name>` with expiry/retry detail when another actor holds it.
- `Draft preserved — edit access unavailable` for denial/error/offline.

The existing Read/Edit control may become a status/action control, but the TipTap rendering surface should remain stable. Avoid destroying/remounting the editor simply to cross the lease boundary if the current adapter can safely toggle editability or transaction handling.

## Acceptance tests

Add focused deterministic coverage for at least:

1. Opening a synced PG document mounts the TipTap surface without acquiring a lease.
2. Background lease inspection does not block render and displays holder/availability state when it resolves.
3. With acquisition artificially delayed, first interaction immediately enters `acquiring`, visible typed text appears locally, only one acquire call occurs, and no save/write is attempted.
4. On delayed success, all pending characters appear exactly once, selection remains usable, renewal starts, and subsequent save includes the lease token and expected version.
5. On lease denial, the draft remains recoverable, the editor becomes safe, the holder/error is visible, and no Tower/Dexie canonical write occurred.
6. Navigation or document switch during acquisition cannot apply the eventual lease/draft to another document.
7. Remote hydration or stale version during a dirty acquisition/edit draft does not silently overwrite local or remote content.
8. Existing save, images, comments, source/block modes, mobile behavior, and offline gating remain green.

Run:

```bash
bun run check:public-source
bun run test
bun run build
bun run verify:dist
git diff --check
```

Follow `agents.md` and `docs/release-notes.md`: update `.build-meta.json`, add the matching release-note entry, run release-note coverage, and confirm `dist/version.json` contains the final build. Generated `dist/` is ignored and must not be committed.

Perform a browser/Playwright pass for the delayed acquisition interaction if it can be done against the permitted local test environment without starting/restarting a managed process. If not, state the exact manual verification Pete should perform.

## Shared-tree and reporting rules

- Read `agents.md` completely before editing and preserve all concurrent work.
- The current worktree already contains untracked `docs/handoffs/`; inspect all nonignored state before the checkpoint.
- Work on `main`. Do not stash, reset, revert, clean, force, or rewrite history.
- Commit the complete compatible, nonignored, tested repository state as required by Pete's shared-tree semantics. If existing state is incompatible or unsafe to include, stop and report it instead of discarding it.
- Do not push, deploy, start a standalone server, or restart the managed Flight Deck process.
- Comment on the Flight Deck task at meaningful milestones: confirmed implementation path; main change complete; validation/commit handoff.
- Completion comment must include files changed, focused/full test evidence, build/version, browser validation status, commit, limitations, and the originating message reference.
- Move the task to `review` only when the implementation and required validation are actually complete.

# Repeated document save rejection

Task: @[Fix repeated document integrity save rejection](mention:task:27393029-323c-43be-9681-c453a35cd1df)

Pete reports repeated save failure in Spiral AI Grant: Wingman after previous fixes. Screenshot storage 465b5e6c-026b-487c-a4ec-614953208337 (local /tmp/doc-repeat.png) shows Save paused because the editor could not preserve the complete document. Your draft is still open and Tower was not changed. Source @[Message](mention:message:46bb52e8-7b36-4316-bc86-4b9ae2db7464) in @[Channel](mention:channel:aa17d938-ce69-4563-a5bf-72e6b2bc8491), thread e725db84-8e2e-4f60-bd45-55aa82754d84. Goal: reproduce and fix repeated save rejection, preserve all user content and drafts, validate real editor edit/save/reopen and running build. Prior 63d1fe8 only removed reference strip; ffcad27 fixed two other serialization cases. Screenshot is original draft document 1ced25fc-03f4-4e8b-b778-9353f1861b00 (title match), not necessarily previous Clean merged copy 80e3b061-80bd-4371-84b3-12a19b8d914e. Fetch both read-only and derive minimal tests; never mutate live grant or commit private grant data. Work in /Users/mini/code/wm/flightdeck on main, preserve concurrent state, commit compatible nonignored tested state. Inspect docs/handoffs/2026-09-08-spiral-docs-save-visibility.md and correction/validation handoffs. Keep truncation/semantic-loss guard effective. No cross-repo changes unless evidence requires and manager reviews. Tests: focused adapter/save regressions, full bun run test, check:public-source (known existing handoff failures), release notes, build, verify:dist, git diff --check. Manager verifies configured runtime and reports in this originating thread; worker reports local validation and task when binding permits, no chat posts, no Autopilot restart. Ready for review only after evidence, with browser limitations stated.

Manager is fetching fresh envelopes to /tmp/doc-save-original.json and /tmp/doc-save-merged.json. Start investigation against existing /tmp/wm21-spiral-live-replay.json and screenshot; check for new envelopes shortly. Report no external posts if your task binding is missing. Do not wait on it: manager handles records. Implement and commit on main including this handoff. Do not push or deploy; manager handles runtime. Use browser component testing if possible without starting a standalone preview. Ensure actual Tiptap browser normalization is covered, not only pure adapter cycles. Return diagnosis, exact reproductions, tests, commit/build and limits.

Manager evidence 05:20 UTC: hosted https://long-tin-knob.rick.runwingman.com/version.json returns build 1901. Fresh envelopes now available at promised paths. Existing `bun scripts/validate-document-replay.mjs /tmp/doc-save-original.json` fails `Markdown changed on reopen`. Fresh original metadata title remains Spiral AI Grant — Wingman Interview Notes and Proposal Draft, v58; screenshot title differs and may be an unsaved edit or another doc. Do not assume identity solely from screenshot; exercise both and screenshot-derived mutations. Live original and merged content must not be overwritten.

## Implementation and local review evidence

The saved original and merged envelopes both pass the pre-fix guard on initial
load and after an initial Chrome/Tiptap mount. They are not the rejected unsaved
browser draft. The screenshot alone cannot establish its exact contents, and
this work does not claim to recover that draft.

A normal browser edit reproduces the same integrity rejection: open synthetic
`**Label:** ordinary prose.`, place the caret immediately after the bold colon,
and type a space. Tiptap inherits bold for the space. The old serializer emits
`**Label: ** ordinary prose.`, which Markdown reparses as literal delimiters,
losing bold. Leading/trailing block spaces also disappear under Markdown's block
parsing/trimming. Editing text boundaries in both fresh captures reproduces
these classes of rejection. The keyboard component replay rejects with the
pre-fix source from `63d1fe8` and passes with this correction.

The serializer now uses standard decimal Markdown character references for
boundary spaces, keeping the spaces inside their original marks. It also
encodes an adjacent word character where Markdown delimiter flanking requires
it. The parser decodes those references after lexing prose; escaped ampersands
and code remain literal. Ampersands in literal prose are escaped to prevent
entity-looking user text from being decoded accidentally. This changes no
shared record fields and requires no Tower change.

The old single-list-tail-space comparator exception is removed: serialization
now preserves that space, and the independent guard rejects its loss too. The
save/draft path remains intact. Existing regressions verify rejected content
stays in the local draft and does not reach Tower; a new save-store regression
verifies marked boundary spaces reach the mocked accepted save and reopen.

Reproduction commands, from this repository:

```bash
node scripts/validate-document-browser-replay.mjs --sweep /tmp/doc-save-original.json /tmp/doc-save-merged.json /tmp/wm21-spiral-live-replay.json
bun scripts/validate-document-replay.mjs /tmp/doc-save-original.json
bun scripts/validate-document-replay.mjs /tmp/doc-save-merged.json
bun scripts/validate-document-replay.mjs /tmp/wm21-spiral-live-replay.json
bun run test tests/tiptap-document-adapter.test.js tests/docs-manager-mixin.test.js tests/release-notes.test.js
```

The browser command bundles the production editor adapter and extensions into
an isolated Chrome page, with all network requests aborted. No standalone
preview or app server is started. Chrome is selected by default because this
machine lacks Playwright's bundled Chromium; the browser channel can be set
with `DOCUMENT_REPLAY_BROWSER_CHANNEL`.

Private fixture hashes (SHA-256), with no grant text committed:

- Fresh original: `da7272e78dfffaabc0e6e81e602a5a27d2ae595f1190926f68e3ecefc5ee150a`, 124,263 bytes, 97 semantic tokens.
- Fresh merged: `f51492efb0f60adb79e81c147b68de92bcf2bb84c7a67ccbe2077e1e7b4a0a74`, 118,050 bytes, 79 semantic tokens.
- Earlier capture: `971d89026aadfcc6bafc87081a82ff567482d4d292d84e77190065f5ffe5842f`, 24,545 bytes, 90 semantic tokens.

Browser results: each of the synthetic fixture and three captures passes a real
keyboard edit, 8 JSON-envelope remounts and 8 forced-Markdown remounts, intentional
deletion, and rejection of truncation and unintended deletion. Across all four,
3,990 boundary edits pass (space, text with a leading space, and a character at
every text-run start/end). Semantic content is compared across browser
normalization and all reopens. This is component save-envelope validation;
Tower transport is not exercised in that browser page.

Pure replay: all three captures pass 8 cycles each for original content,
intentional edit, and intentional deletion, plus three loss negatives. The
helper was corrected for pre-existing fixture assumptions: rich-state Markdown
can canonicalize on its first forced parse, so byte stability is checked after
that parse while semantic equality is checked throughout; an empty trailing
Tiptap paragraph must be skipped when selecting a real deletion negative.

Focused suites: 151 tests passed in 3 files. Browser evidence is in
`/tmp/repeated-doc-browser.log`; pre-fix keyboard rejection is in
`/tmp/repeated-doc-browser-baseline.log`. Fixtures and diagnostic dumps remain
outside the repository.

Build: **1902**, ID **20260908-0527-4-1902**, confirmed in `dist/version.json`.
`bun run build` and `bun run verify:dist` passed (2 asset references). Existing
bundled-schema fallback and large-chunk warnings remain. Ignored `dist/` is not
committed. `agents.md` and `claude.md` are identical.

Limits and handoff: context reports no workspace, run, or record binding. No
external task/comment/chat posts were made; the manager handles task state and
originating-thread reporting. No live documents, adjacent services, or other
repositories were modified. No push, deploy, standalone preview, or restart.
Manager still needs to verify the configured running build and authenticated
local-Tower edit/save/reopen with a synthetic document. The exact rejected
unsaved draft and desktop/mobile end-to-end acceptance remain unverified.

Final baseline validation:

- Full `bun run test`: **3,619 passed, 1 failed**, 261/262 files passed. The sole
  failure is the existing 20,000-row `pg-materialization-responsiveness.test.js`
  10-second timeout. Log: `/tmp/repeated-doc-full-test-final.log`.
- `bun run check:public-source`: fails on retained private handoffs and existing
  identity/path markers, including this explicitly requested handoff. No
  implementation/test/script/release-manifest findings. Scanner unchanged;
  no requested or concurrent state was deleted. Log:
  `/tmp/repeated-doc-public-source-final.log`.
- Focused tests, release-note tests, production build, asset verification,
  identical agent guides, and `git diff --check` pass. The known full-suite and
  public-source failures prevent an all-green acceptance claim.

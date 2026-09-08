# Spiral Docs implementation and review handoff

Task: @[Fix document save whitespace false alarms and Docs visibility](mention:task:35a57dd3-0f7c-4bdb-a5b9-5ab85f9b0363).
Origin and approved scope are in `2026-09-08-spiral-docs-save-visibility.md`.

Implemented locally:

- The first implementation tolerated one trailing ASCII space on unmarked paragraph/heading prose. Manager replay rejected that implementation; the correction and its independent replay evidence are recorded below. Visibility changes remain intact.
- The Docs live query previously selected only the newest 50 cached documents (`windowing.js`). Search and scope filtering ran after this invisible cap. Docs now subscribes to all owner documents in the active workspace Dexie partition. Inbox/Files windows remain independently bounded.
- Removed the second exact scope filter in `currentFolderContents`. PG document mapping stores the direct scope in `scope_l1_id`; Docs now resolves PG ancestry from scope metadata, rather than treating that alias as actual ancestry.
- The active scope/channel/thread label is visible. All documents explicitly selects the All board, clearing derived channel/thread filters. The editor Docs breadcrumb uses that same action. Intentional channel/thread views are preserved.

Evidence and limits:

- Inspected the supplied local screenshot. The live grant body reproduction is manager-provided evidence; this session could not repeat the remote read. Fixtures contain synthetic prose only.
- Real Alpine getters, PG document translation and Dexie subscription tests cover two representative records (v1/v58, old dates), 60 newer rows, parent/child scopes, Dialogue, Rick and thread filters, All reset, and search. Navigation is exercised as store state transitions; it is not an authenticated browser/direct-link/back acceptance pass.
- No age cutoff exists in the inspected Docs query. The proven limit was newest 50, independent of age. Workspace record sync follows opaque pages through has_more and commits mapped records to Dexie. Separate legacy/targeted channel list APIs default to 200; their completeness at that boundary is a remaining limitation, not evidence that these two records were dropped remotely.
- Search covers titles and available cached content across the complete selected view; it does not download every storage-backed document body for full-text search.
- No cross-repository or shared-contract changes, live document writes, date changes, push, deployment, standalone preview, or service restart.
- MCP context returned no workspace/dispatch binding; task/thread reads failed with “No pipeline run, document binding, or Agent Direct context found for this session”. The supported client with botCrypto:true also lacks the Tower URL/session configuration. Task progress/validation posting and moving to review therefore require the manager. No chat replies were posted.
- Pending manual acceptance: authenticated local-Tower desktop/mobile Docs layout, cold snapshot completion, actual direct-link/back from Rick, All and Dialogue search, and edit/save/reopen of a synthetic representative document. Pete's unsaved browser edits were not inspected or recovered.

Validation and final checkpoint details follow below.

Validation:

- Focused save, visibility, scope and release-note suites: 145 tests passed in 5 files.
- `bun run build`: passed, build 1899 / `20260908-0422-1-1899`; bundled schema fallback was used because the adjacent publisher schema directory is unavailable. Existing large-chunk warning remains.
- `bun run verify:dist`: passed (2 asset references). Generated dist is ignored and not staged.
- `git diff --check` and identical agents.md/claude.md: passed.
- `bun run check:public-source`: failed on existing private handoffs and personal identity/path markers, plus the handoffs explicitly requested for this checkpoint. No src/tests/HTML/release manifest findings. Preserved these requested files; did not weaken the scanner or sanitize unrelated work.
- Full suite: 3,591 passed / 1 failed across 262 files (261 passed). The existing 20,000-row PG worker responsiveness test exceeds its explicit 10-second timeout. A separate focused run also timed out. It is outside the document changes and remains unresolved; this is not an all-green acceptance claim.

The manager must post diagnosis, validation and the commit on the linked task and move it to review with these validation limits. The current session cannot mutate that task without its missing dispatch/broker configuration.

## Manager-review correction

The private envelope was read locally, without a remote document write. Inspection of node structure found that the new mismatches came from escaped punctuation splitting an ordinary paragraph's terminal text into separate text nodes: the original `prose. ` became `prose`, `.`, ` `. Broad trimming removed the expected space but left the reparsed standalone space. Those spaces must remain in the comparison. The exception now applies only to a single unmarked trailing ASCII space in the first paragraph directly inside a list/task item, matching `listMarkdown`'s line trimming. It does not apply to ordinary paragraphs, headings, marked text, code, inline separators, or spaces before hard breaks.

Forcing `editor_state: null` then revealed a second-cycle serializer defect: escaped hyphens inside bold text reparsed into adjacent nodes with the same marks. Serializing each node with independent delimiters introduced literal `**` and lost punctuation formatting. The serializer now joins adjacent text runs with identical complete mark arrays before applying Markdown delimiters, using copies to preserve the input state. No comparator relaxation hides this loss.

Minimal synthetic regressions cover both failures, repeated forced reopen, bold/italic/strike/code/link fragments, state immutability, ordinary paragraph tails, soft-line and inline separators, heading whitespace, changed link targets, list whitespace exclusions, and existing image/code/hard-break/truncation negatives. Existing Docs visibility and save-guard/draft-preservation tests remain in place.

Exact read-only private replay command (run from the repository):

```bash
bun scripts/validate-document-replay.mjs /tmp/wm21-spiral-live-replay.json
```

- Fixture SHA-256: `971d89026aadfcc6bafc87081a82ff567482d4d292d84e77190065f5ffe5842f` (24,545 bytes).
- Original state has 90 semantic tokens. Eight forced Markdown reopens each passed for the original document, an intentional prose edit, and an intentional final-block deletion (24 total cycles). Every cycle checks integrity, stable Markdown, and semantic equality with the scenario's starting state.
- Actual serialization losses rejected against the retained editor state: final-block removal, truncating Markdown halfway, and text substitution. Intentional deletion succeeds only when editor state agrees.
- The committed replay helper contains no fixture text, metadata, or private path. It accepts a local envelope path and emits only hash/count/pass evidence. The private envelope remains outside the repository.
- Latest task comments could not be read: broker returned “No pipeline run, document binding, or Agent Direct context found for this session”. Manager retains external task/chat updates; no raw-key fallback was attempted.
- Browser limits from the first handoff still apply: no authenticated desktop/mobile local-Tower save/reopen or navigation acceptance pass was performed. This is full-body adapter replay and automated store coverage, not browser acceptance. No live document mutation, push, deploy, standalone preview, or runtime restart occurred.

Correction checkpoint validation:

- Focused adapter, Docs save, visibility, scope, and release notes: 161 tests passed in 5 files. An initial table-driven whitespace test had an argument-shape error; it was corrected before the final focused and full runs.
- Final `bun run test`: 3,607 passed, 1 failed across 262 files (261 passed). The only failure is the existing `pg-materialization-responsiveness.test.js` 20,000-row worker transaction timing out at 10 seconds. Log: `/tmp/spiral-correction-full-test-final.log`.
- `bun run check:public-source`: still fails on retained private handoffs and existing identity/path markers, including the manager's correction handoff preserved for this checkpoint. No implementation/test/release manifest findings; checker unchanged. Log: `/tmp/spiral-correction-public-source-final.log`.
- `bun run build`: passed, build **1900**, ID **20260908-0432-2-1900**, confirmed in `dist/version.json`. Existing bundled-schema fallback and large-chunk warning remain.
- `bun run verify:dist`: passed, 2 asset references. `git diff --check` and identical `agents.md`/`claude.md`: passed. Generated `dist/` remains ignored and uncommitted.
- Source checkpoint includes the narrow comparator correction, adjacent-mark serializer correction, minimal regressions, read-only replay helper, release metadata, updated validation handoff, and the pre-existing manager correction handoff. Original visibility source is unchanged.

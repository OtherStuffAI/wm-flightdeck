# Spiral Docs implementation and review handoff

Task: @[Fix document save whitespace false alarms and Docs visibility](mention:task:35a57dd3-0f7c-4bdb-a5b9-5ab85f9b0363).
Origin and approved scope are in `2026-09-08-spiral-docs-save-visibility.md`.

Implemented locally:

- The integrity comparator tolerates one trailing ASCII space on unmarked paragraph/heading prose. It does not mutate the editor model, trim inline boundaries, code or marked text, or remove hard breaks. The existing save guard still persists the draft and rejects semantic loss before Tower submission.
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

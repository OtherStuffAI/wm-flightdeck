# Long document save truncation follow-up

## Goal

Prevent Flight Deck from truncating or corrupting a long Markdown document when it is opened in the TipTap editor and saved/autosaved. Prove the fix against the real Spiral AI Grant version shape and repeated round trips.

## Source and confirmed evidence

- Originating chat: @[Message](mention:message:e3282a90-b76f-44ab-8cb4-4700b7864d67) in @[Features](mention:channel:0617d526-88dc-4dc2-9876-08349ab60eca), thread `e38137cd-6b06-4a90-b0cd-39794b990ee1`.
- Affected document: @[Spiral AI Grant — Wingman Interview Notes and Proposal Draft](mention:document:1ced25fc-03f4-4e8b-b778-9353f1861b00).
- Related completed task: @[Fix repeated Markdown escaping in document bodies](mention:task:db5fe884-3072-402a-ad2a-009f793d87d1), implemented in commits `600f7f4` and `7ab2ade`.
- Tower version evidence verified on 2026-08-26:
  - v47: 26,706 body characters, 27,139 stored bytes, zero backslashes, and the 12-month timeline present.
  - v48: 9,097 characters and 1,453 backslashes; timeline absent.
  - v49: 9,091 characters and 1,447 backslashes; timeline absent.
  - v50: 9,079 characters and 1,435 backslashes; timeline absent.
  - v51-v52: 9,063 characters and 1,419 backslashes; timeline absent.
  - v53: restored to 26,706 characters, 27,139 stored bytes, zero backslashes, and the 12-month timeline present.
- v47 and v53 were written by Rick/wm21 from the clean source. v48-v52 were written by Pete through Flight Deck.
- Do not enter Edit mode on or write to the live v53 document while investigating. It is the protected restored source.

The previous task proved one list-token import bug that accumulated Markdown escapes. This follow-up is an acceptance failure with data loss: the editor-produced body was only about one third of the clean source. Do not assume the earlier list-token patch fixed the truncation; prove or disprove that with the long source shape.

## Work scope

Work in `/Users/mini/code/wm/flightdeck` on `main`.

1. Read `agents.md`, the relevant document/editor design docs, the earlier handoff, task comments, and commits `600f7f4`/`7ab2ade`.
2. Fetch/read the current task and its latest comments directly from Flight Deck PG before acting.
3. Inspect the actual v47/v53 content shape through the typed Tower document/version read route. Keep the live document read-only. If a full-content fixture is needed, keep the private source outside tracked public source and derive a minimal/synthetic regression fixture that preserves the triggering structure and length.
4. Reproduce the complete path: PG document payload and authoritative body/editor state -> Markdown import -> ProseMirror document -> serialization/content model -> autosave request -> accepted PG response -> Dexie/SSE hydration -> reopen and repeat.
5. Identify exactly where content after roughly 9,000 characters is dropped. Check unsupported token/node handling, nested lists/tables/code/link/HTML/reference sections, parser early exits, editor content extraction, serialization walkers, payload/body selection, body/content_blocks precedence, size/character limits, autosave races, stale editor_state, and save-response reconciliation. Evidence must choose the cause; these are investigation prompts, not assumptions.
6. Ensure save is fail-safe. A client must not PATCH an unexpectedly shorter or structurally incomplete serialization over a substantially longer loaded source because of an editor/parser failure. Add a deliberate guard or validation at the correct boundary, with a clear user-visible error/recovery state, while still allowing intentional deletions. Do not use a crude percentage-only rule that blocks legitimate edits.
7. Preserve legitimate Markdown, literal backslashes, supported TipTap/ProseMirror nodes, mentions, links, lists/tasks, tables, code, storage nodes, content blocks, caret/selection, lease/version conflict handling, and remote reconciliation.
8. Add focused regression coverage using a representative long fixture and at least four open/save/reload cycles. Assert byte-identical content when unchanged, full tail/timeline preservation, no added escapes, no unintended PATCH for unchanged content, and no silent save when parsing/serialization loses nodes or tail content.

## Acceptance and validation

- The clean 26,706-character document shape opens, serializes, autosaves, rehydrates, and reopens without losing content or adding backslashes.
- The tail sections and 12-month timeline survive at least four cycles.
- A proven parser/serializer failure cannot silently overwrite the authoritative document with partial content.
- Intentional user deletion remains possible through a clearly distinguishable valid-edit path.
- Focused editor/adapter/docs-manager tests pass.
- Run `bun run check:public-source`, `bun run test`, release-note tests, `bun run build`, `bun run verify:dist`, and `git diff --check` according to `agents.md`.
- State whether a manual/Playwright browser pass remains. Do not use the protected live v53 document for destructive verification.

## Git and reporting

- Preserve concurrent shared-worktree changes. Do not stash, reset, clean, discard, or overwrite unfamiliar work.
- Commit all compatible nonignored tested state on `main` with a Conventional Commit, including this handoff if repository policy permits it. If `check:public-source` rejects the existing handoff archive, report that exact pre-existing policy conflict without weakening the check.
- Do not push, deploy, start a standalone preview server, or restart Flight Deck/Autopilot.
- Post the confirmed cause, implementation, validation evidence, commit hash, and remaining manual check on the Flight Deck task. Move it to `review` only when genuinely ready.
- Do not reply directly to Pete's chat thread; Rick owns chat updates.

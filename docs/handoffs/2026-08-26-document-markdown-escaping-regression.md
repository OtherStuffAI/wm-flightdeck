# Document Markdown Escaping Regression

## Goal

Fix the Flight Deck document editor regression that repeatedly adds Markdown escape characters to document bodies during edit/autosave cycles.

## Source and evidence

- Flight Deck task: @[Fix repeated Markdown escaping in document bodies](mention:task:db5fe884-3072-402a-ad2a-009f793d87d1), currently `in_progress` and assigned to Rick/wm21 for supervision.
- Origin: @[Message](mention:message:cec9b798-26dd-42a5-bc6f-862160149d3e) in @[Features](mention:channel:0617d526-88dc-4dc2-9876-08349ab60eca).
- Pete's screenshot is Tower storage object `383e2956-dca6-48c3-8e69-23bc80884663`.
- Manager copy: `/Users/mini/wingmen/wingman21/data/attachments/383e2956-dca6-48c3-8e69-23bc80884663.png`.
- The screenshot shows rendered list items containing literal repeated escapes around Markdown punctuation, for example bold labels appearing in a form like `\\\*\\\*Uncertainty:\\\*\\\*` and sentence-ending punctuation rendered with backslashes.
- The affected document title in the screenshot is “Spiral AI Grant — Wingman Interview Notes and Proposal Draft”.

## Current code path and strongest hypothesis

The active repo is `/Users/mini/code/wm/flightdeck` on `main`.

The current rich-document round trip is:

1. `src/docs/editor/markdown-to-prosemirror.js` parses stored Markdown using `marked`.
2. `src/docs/editor/tiptap-editor-adapter.js` emits a Flight Deck content model on every editor update.
3. `src/docs/editor/prosemirror-to-flightdeck.js` serializes text back to Markdown.
4. `src/docs-manager.js` autosaves that serialized content through the PG document path.

`prosemirror-to-flightdeck.js` currently calls `escapeText()` for every plain text node and escapes backslashes plus most Markdown punctuation. Investigate whether an authoritative/persisted `editor_state`, a legacy escaped body, or a subsequent hydration/save cycle is treating already escaped Markdown as literal text and escaping it again. The fix must make the round trip idempotent; do not simply strip all backslashes, because legitimate literal Markdown punctuation and code/link content still need safe serialization.

## Required work

- Reproduce the issue with a focused fixture resembling the screenshot: ordered-list paragraphs, bold prefixes, colons, sentence-ending periods, and existing backslashes.
- Identify the exact accumulation boundary across Markdown parse, ProseMirror state hydration, serialization, PG save response, Dexie materialisation, and editor reload.
- Make repeated open/edit/autosave/reload cycles idempotent: after the first canonical serialization, later cycles must produce byte-identical Markdown unless the user changes content.
- Preserve legitimate literal punctuation/backslashes, bold/italic/strike/code/link/mention marks, lists/tasks, tables, images/files, and compatibility `content_blocks`.
- Repair already escaped document content only if a conservative, demonstrably safe canonicalisation can distinguish this regression from intentional literal backslashes. If not, fix future accumulation and report the migration/recovery boundary separately.
- Add focused regression tests, preferably around `markdownToProseMirrorDoc()` and `prosemirrorToFlightDeckContentModel()`, plus the autosave/hydration path if that is where repeated escaping enters.
- Inspect recent document-editor changes and existing shared-worktree state before editing. Preserve concurrent work; do not discard or overwrite unknown changes.

## Acceptance and validation

- A representative Markdown body with ordered-list bold labels round-trips without visible escape characters.
- Serializing, parsing, and serializing the result multiple times is stable.
- A document loaded from current PG response/editor state and autosaved unchanged does not add escapes.
- Focused document adapter/manager tests pass.
- Run the relevant broader tests and `bun run build`; keep `dist/` aligned with source.
- Inspect the complete shared worktree and commit all nonignored tested state on `main`, including pre-existing state after understanding and validating it.
- Do not push, deploy, start a preview server, or restart the managed Flight Deck process.

## Reporting

Post the diagnosis, exact data-flow boundary, files changed, tests/build output, and commit hash as a comment on task `db5fe884-3072-402a-ad2a-009f793d87d1`. Move that task to `review` only when the implementation is committed and ready for Pete to test. Do not reply directly in the originating chat thread; Rick will mirror meaningful milestones there.

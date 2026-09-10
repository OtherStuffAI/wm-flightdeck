# Rich document serialization

The rich editor saves ProseMirror JSON alongside compatibility Markdown and
content blocks. `validateDocumentContentModelRoundTrip` reparses that Markdown
and checks text, inline marks, links, images and hard breaks before a PG save
uploads content or changes Tower. Document length is not an integrity criterion.

`prosemirror-to-flightdeck.js` must preserve rich input rather than ask the
validator to excuse losses:

- Encode whitespace at prose/mark boundaries as decimal character references,
  including nonbreaking spaces from paste. Encode inline tabs and soft newlines
  as references so Markdown cannot interpret them as block syntax. Code stays
  literal, and explicit hard breaks keep their Markdown representation.
- Serialize every list-item child in order. Continuation paragraphs, nested
  lists, headings and quotes must not be omitted or moved. Indent continuation
  lines to the content column after the actual list marker; ordered markers can
  have multiple digits, while task checkboxes belong to the item content.
  When nested blocks follow an empty parent item, the parser restores an empty
  paragraph rather than duplicating those blocks' raw Markdown as parent text.
- Keep the original editor state intact. The parser decodes references after
  lexing prose; escaped literal entity text must not be decoded recursively.

Regression coverage uses a generic short timeline in
`tests/fixtures/short-rich-document.js`. Adapter tests force Markdown-only
reopen, a native Tiptap/jsdom test compares rich structure and rendered marks,
and document-manager tests exercise manual save and autosave. Truncated models
still retain the draft and prevent upload/Tower writes. These tests do not
replace an authenticated browser save/reload check against a local Tower.

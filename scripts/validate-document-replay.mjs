// Read-only local replay. Prints evidence only, never document text or metadata.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDocumentEditorState } from '../src/docs/editor/document-editor-store.js';
import { documentEditorSemanticTokens, validateDocumentContentModelRoundTrip } from '../src/docs/editor/document-content-integrity.js';

const path = process.argv[2];
assert(path, 'Usage: bun scripts/validate-document-replay.mjs <local-envelope.json>');
const bytes = readFileSync(path);
const envelope = JSON.parse(bytes);
assert(envelope.content_model, 'Expected an envelope with content_model');
const serialize = (editor_state) => createDocumentEditorState({ editor_state }).contentModel;
const validate = (model) => assert.deepEqual(validateDocumentContentModelRoundTrip(model), { ok: true });
const reject = (model) => assert.equal(validateDocumentContentModelRoundTrip(model).reason, 'semantic_content_mismatch');

function cycles(initial) {
  let model = initial;
  const expected = documentEditorSemanticTokens(initial.editor_state);
  let canonicalMarkdown;
  for (let cycle = 0; cycle < 8; cycle++) {
    validate(model);
    // A stored rich state can use equivalent noncanonical Markdown. Require
    // stability after the first forced parse, and semantic equality throughout.
    if (cycle === 1) canonicalMarkdown = model.content;
    if (cycle > 1) assert(model.content === canonicalMarkdown, 'Markdown changed on reopen');
    assert(JSON.stringify(documentEditorSemanticTokens(model.editor_state)) === JSON.stringify(expected), 'Reopen changed semantic content');
    model = createDocumentEditorState({ ...model, editor_state: null }).contentModel;
  }
  validate(model);
  return model;
}

const initial = createDocumentEditorState(envelope.content_model).contentModel;
cycles(initial);
const edited = structuredClone(initial.editor_state);
function editFirstText(node) {
  if (node.type === 'text' && !node.marks?.length && node.text?.trim()) {
    node.text = `Intentional replay edit: ${node.text}`;
    return true;
  }
  return (node.content || []).some(editFirstText);
}
assert(editFirstText(edited), 'Expected editable prose');
cycles(serialize(edited));
const deleted = structuredClone(edited);
assert(deleted.content.length > 1, 'Expected multiple blocks');
// Tiptap may append an empty paragraph; remove through the last content block.
do { deleted.content.pop(); } while (deleted.content.length
  && JSON.stringify(documentEditorSemanticTokens(deleted)) === JSON.stringify(documentEditorSemanticTokens(edited)));
assert(JSON.stringify(documentEditorSemanticTokens(deleted)) !== JSON.stringify(documentEditorSemanticTokens(edited)), 'Deletion must remove semantic content');
const smaller = serialize(deleted);
cycles(smaller);
// An intentional deletion is valid; losing the same content only in the
// serialized representation must fail against the unchanged editor state.
reject({ ...smaller, editor_state: edited });
reject({ ...initial, content: initial.content.slice(0, Math.floor(initial.content.length / 2)) });
const substituted = serialize(edited);
reject({ ...substituted, editor_state: initial.editor_state });
console.log(JSON.stringify({
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  initialSemanticTokens: documentEditorSemanticTokens(initial.editor_state).length,
  forcedReopenCyclesPerScenario: 8,
  passedScenarios: ['original', 'intentional edit', 'intentional deletion'],
  rejectedLosses: ['tail block removal', 'half Markdown truncation', 'text substitution'],
}, null, 2));

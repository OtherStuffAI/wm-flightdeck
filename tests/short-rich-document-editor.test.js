// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createTiptapEditorAdapter } from '../src/docs/editor/tiptap-editor-adapter.js';
import { markdownToProseMirrorDoc } from '../src/docs/editor/markdown-to-prosemirror.js';
import { validateDocumentContentModelRoundTrip } from '../src/docs/editor/document-content-integrity.js';
import { shortRichDocumentFixture } from './fixtures/short-rich-document.js';

it('keeps native Tiptap heading/list formatting and exact text after rich and Markdown reopens', () => {
  const element = document.createElement('div');
  document.body.append(element);
  const adapter = createTiptapEditorAdapter({ element, editorState: shortRichDocumentFixture() });
  const withoutIds = (state) => JSON.parse(JSON.stringify(state, (key, value) => key === 'fdBlockId' ? undefined : value));
  try {
    // Let Tiptap apply its normal trailing editing paragraph before comparing.
    adapter.setContent(adapter.getJSON());
    const original = withoutIds(adapter.getJSON());
    for (let cycle = 0; cycle < 3; cycle++) {
      const model = adapter.getContentModel();
      expect(validateDocumentContentModelRoundTrip(model)).toEqual({ ok: true });
      adapter.setContent(model.editor_state);
      expect(withoutIds(adapter.getJSON())).toEqual(original);
      adapter.setContent(markdownToProseMirrorDoc(model.content, { contentBlocks: model.content_blocks }));
      expect(withoutIds(adapter.getJSON())).toEqual(original);
      expect(element.querySelector('h2').textContent).toBe('Phase 1: Preparation\u00a0');
      expect(element.querySelector('ol').getAttribute('start')).toBe('10');
      expect(element.querySelector('strong').textContent).toBe('Deliverables:\u00a0');
    }
  } finally {
    adapter.destroy();
    element.remove();
  }
});

import { describe, expect, it } from 'vitest';
import { markdownToProseMirrorDoc } from '../src/docs/editor/markdown-to-prosemirror.js';
import { prosemirrorToFlightDeckContentModel } from '../src/docs/editor/prosemirror-to-flightdeck.js';
import { validateDocumentContentModelRoundTrip } from '../src/docs/editor/document-content-integrity.js';
import {
  FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT,
  PROSEMIRROR_JSON_FORMAT,
} from '../src/docs/editor/prosemirror-flightdeck-schema.js';
import {
  buildSyntheticLongDocumentFixture,
  SYNTHETIC_LONG_DOCUMENT_LENGTH,
} from './fixtures/synthetic-long-document.js';

describe('Tiptap document adapter', () => {
  it('imports Markdown into ProseMirror JSON and exports Flight Deck compatibility fields', () => {
    const source = [
      '# Spec',
      '',
      'Hello @[Operator A](mention:person:npub1operator-a) with [a link](https://example.com).',
      '',
      '- [x] Done',
      '- [ ] Todo',
      '',
      '![Diagram](storage://object-123)',
    ].join('\n');
    const contentBlocks = [
      { id: 'heading-a', type: 'heading', text: '# Spec' },
      { id: 'paragraph-a', type: 'paragraph', text: 'Hello Operator A' },
      { id: 'tasks-a', type: 'list', text: '- [x] Done\n- [ ] Todo' },
      { id: 'image-a', type: 'image', text: '![Diagram](storage://object-123)' },
    ];

    const doc = markdownToProseMirrorDoc(source, { contentBlocks });
    const model = prosemirrorToFlightDeckContentModel(doc);

    expect(model.content_format).toBe(FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT);
    expect(model.editor_state_format).toBe(PROSEMIRROR_JSON_FORMAT);
    expect(model.editor_state).toEqual(doc);
    expect(model.content).toContain('# Spec');
    expect(model.content).toContain('Hello @[Operator A](mention:person:npub1operator-a) with');
    expect(model.content).not.toContain('@@[Operator A]');
    expect(model.content).toContain('storage://object-123');
    const paragraph = doc.content.find((node) => node.attrs?.fdBlockId === 'paragraph-a');
    const mentionNode = paragraph.content.find((node) => node.marks?.some((mark) => mark.type === 'fdMention'));
    expect(mentionNode).toMatchObject({
      type: 'text',
      text: 'Operator A',
      marks: [{
        type: 'fdMention',
        attrs: {
          label: 'Operator A',
          mentionType: 'person',
          mentionId: 'npub1operator-a',
        },
      }],
    });
    expect(model.content_blocks.map((block) => block.id)).toEqual([
      'heading-a',
      'paragraph-a',
      'tasks-a',
      'image-a',
    ]);
  });

  it('exports rich pasted storage image nodes with the storage object id', () => {
    const model = prosemirrorToFlightDeckContentModel({
      type: 'doc',
      content: [{
        type: 'fdStorageImage',
        attrs: {
          src: 'blob:http://localhost/transient-preview',
          objectId: 'pasted-image-123',
          alt: 'Pasted image',
        },
      }],
    });

    expect(model.content).toBe('![Pasted image](storage://pasted-image-123)');
    expect(model.content).not.toContain('blob:http://localhost');
  });

  it('does not export transient rich upload placeholders', () => {
    const model = prosemirrorToFlightDeckContentModel({
      type: 'doc',
      content: [{
        type: 'fdUploadPlaceholder',
        attrs: {
          uploadId: 'upload-1',
          label: 'Uploading image...',
        },
      }],
    });

    expect(model.content).toBe('');
    expect(model.content_blocks).toEqual([]);
  });

  it('round-trips rich ordered-list items without accumulating Markdown escapes', () => {
    const source = [
      '1. **Uncertainty:** Sentence ending with punctuation.',
      '2. **Path:** Keep C:\\docs\\draft.md and literal \\*asterisks\\*.',
      '3. **Marks:** _italic_, ~~strike~~, `code`, [link](https://example.com), and @[Operator A](mention:person:npub1operator-a).',
    ].join('\n');
    const contentBlocks = [{ id: 'ordered-list-a', type: 'list', text: source }];

    const imported = markdownToProseMirrorDoc(source, { contentBlocks });
    const listItems = imported.content[0].content;
    const boldPrefix = listItems[0].content[0].content[0];
    expect(boldPrefix).toMatchObject({
      type: 'text',
      text: 'Uncertainty:',
      marks: [{ type: 'bold' }],
    });

    const first = prosemirrorToFlightDeckContentModel(imported);
    expect(first.content).toContain('**Uncertainty:** Sentence ending with punctuation\\.');
    expect(first.content).not.toContain('\\*\\*Uncertainty');
    expect(first.content).toContain('C:\\\\docs\\\\draft\\.md');
    expect(first.content).toContain('~~strike~~');
    expect(first.content).toContain('`code`');
    expect(first.content).toContain('[link](https://example.com)');
    expect(first.content).toContain('@[Operator A](mention:person:npub1operator-a)');
    expect(first.content_blocks).toEqual([expect.objectContaining({
      id: 'ordered-list-a',
      type: 'list',
      text: first.content,
    })]);

    let canonical = first;
    for (let cycle = 0; cycle < 4; cycle += 1) {
      const reopened = markdownToProseMirrorDoc(canonical.content, {
        contentBlocks: canonical.content_blocks,
      });
      const next = prosemirrorToFlightDeckContentModel(reopened);
      expect(next.content).toBe(first.content);
      expect(next.content_blocks).toEqual(first.content_blocks);
      canonical = next;
    }
  });

  it('preserves rich marks in task and nested list-item block tokens', () => {
    const source = [
      '- [x] **Done:** keep _detail_ and ~~old wording~~.',
      '- [ ] **Todo:**',
      '  1. Follow [the plan](https://example.com/plan).',
    ].join('\n');

    const model = prosemirrorToFlightDeckContentModel(markdownToProseMirrorDoc(source));

    expect(model.content).toContain('- [x] **Done:** keep _detail_ and ~~old wording~~\\.');
    expect(model.content).toContain('- [ ] **Todo:**');
    expect(model.content).toContain('1. Follow [the plan](https://example.com/plan)\\.');
  });

  it('keeps a representative 26,706-character document tail stable across four rich-editor cycles', () => {
    const source = buildSyntheticLongDocumentFixture();
    expect(source).toHaveLength(SYNTHETIC_LONG_DOCUMENT_LENGTH);
    expect(source).not.toContain('\\');

    const first = prosemirrorToFlightDeckContentModel(markdownToProseMirrorDoc(source));
    const firstEscapeCount = (first.content.match(/\\/g) || []).length;
    expect(first.content).toContain('## 12\\-month implementation timeline');
    expect(first.content).toContain('TAIL\\_SENTINEL: synthetic\\-long\\-document\\-complete');
    expect(validateDocumentContentModelRoundTrip(first)).toEqual({ ok: true });

    let canonical = first;
    for (let cycle = 0; cycle < 4; cycle += 1) {
      const reopened = markdownToProseMirrorDoc(canonical.content, {
        contentBlocks: canonical.content_blocks,
      });
      const next = prosemirrorToFlightDeckContentModel(reopened);
      expect(next.content).toBe(first.content);
      expect(next.content_blocks).toEqual(first.content_blocks);
      expect((next.content.match(/\\/g) || []).length).toBe(firstEscapeCount);
      expect(next.content).toContain('TAIL\\_SENTINEL: synthetic\\-long\\-document\\-complete');
      expect(validateDocumentContentModelRoundTrip(next)).toEqual({ ok: true });
      canonical = next;
    }
  });

  it('detects a serializer result that silently drops the document tail', () => {
    const full = prosemirrorToFlightDeckContentModel(markdownToProseMirrorDoc(buildSyntheticLongDocumentFixture()));
    const partialState = {
      ...full.editor_state,
      content: full.editor_state.content.slice(0, 12),
    };
    const partial = prosemirrorToFlightDeckContentModel(partialState);
    const lossy = {
      ...full,
      content: partial.content,
      content_blocks: partial.content_blocks,
    };

    expect(validateDocumentContentModelRoundTrip(lossy)).toMatchObject({
      ok: false,
      reason: 'semantic_content_mismatch',
    });
  });
});

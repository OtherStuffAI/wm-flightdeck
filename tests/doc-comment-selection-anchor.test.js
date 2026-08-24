import { Schema } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';

import {
  captureRichEditorSelectionAnchor,
  resolveRichEditorSelectionAnchor,
  revealRichEditorSelectionAnchor,
  richEditorLineAtPosition,
} from '../src/docs/editor/comment-selection-anchor.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
});

function paragraph(text) {
  return schema.node('paragraph', null, text ? schema.text(text) : undefined);
}

function documentWith(...lines) {
  return schema.node('doc', null, lines.map(paragraph));
}

function paragraphStart(doc, index) {
  let position = 1;
  for (let current = 0; current < index; current += 1) position += doc.child(current).nodeSize;
  return position;
}

describe('rich document comment selection anchors', () => {
  it('captures an exact single-line quote with its deterministic markdown line and offsets', () => {
    const doc = documentWith('First line', 'Second selected text');
    const start = paragraphStart(doc, 1) + 'Second '.length;
    const editor = { state: { doc, selection: { from: start, to: start + 'selected'.length } } };

    expect(captureRichEditorSelectionAnchor(editor)).toEqual({
      anchor_quote: 'selected',
      anchor_line_number: 3,
      anchor_end_line_number: 3,
      anchor_start_offset: start,
      anchor_end_offset: start + 'selected'.length,
    });
    expect(richEditorLineAtPosition(doc, paragraphStart(doc, 1))).toBe(3);
  });

  it('captures multi-block text as a full quote with start and end lines', () => {
    const doc = documentWith('Alpha tail', 'Beta head');
    const from = paragraphStart(doc, 0) + 'Alpha '.length;
    const to = paragraphStart(doc, 1) + 'Beta'.length;

    expect(captureRichEditorSelectionAnchor({ state: { doc, selection: { from, to } } })).toMatchObject({
      anchor_quote: 'tail\nBeta',
      anchor_line_number: 1,
      anchor_end_line_number: 3,
      anchor_start_offset: from,
      anchor_end_offset: to,
    });
  });

  it('relocates one exact moved quote and treats missing or duplicate matches as stale', () => {
    const original = documentWith('Before', 'Unique quote', 'After');
    const from = paragraphStart(original, 1);
    const comment = {
      anchor_quote: 'Unique quote',
      anchor_start_offset: from,
      anchor_end_offset: from + 'Unique quote'.length,
    };
    const moved = documentWith('Inserted', 'Before', 'Unique quote', 'After');
    const resolved = resolveRichEditorSelectionAnchor({ state: { doc: moved } }, comment);
    expect(resolved).toMatchObject({
      state: 'found',
      from: paragraphStart(moved, 2),
      relocated: true,
    });

    expect(resolveRichEditorSelectionAnchor({ state: { doc: documentWith('Changed') } }, comment)).toMatchObject({
      state: 'stale',
      reason: 'quote-not-found',
    });
    expect(resolveRichEditorSelectionAnchor({
      state: { doc: documentWith('Inserted', 'Unique quote', 'Unique quote') },
    }, comment)).toMatchObject({
      state: 'stale',
      reason: 'ambiguous-quote',
    });
  });

  it('highlights only a verified anchor range', () => {
    const doc = documentWith('Quote me');
    const setTextSelection = vi.fn();
    const run = vi.fn();
    const chain = { focus: vi.fn(() => chain), setTextSelection: vi.fn(() => chain), run };
    const editor = { state: { doc }, chain: vi.fn(() => chain), commands: { setTextSelection } };
    const comment = {
      anchor_quote: 'Quote',
      anchor_start_offset: 1,
      anchor_end_offset: 6,
    };

    expect(revealRichEditorSelectionAnchor(editor, comment).state).toBe('found');
    expect(chain.setTextSelection).toHaveBeenCalledWith({ from: 1, to: 6 });
    expect(run).toHaveBeenCalledOnce();

    const stale = { ...comment, anchor_quote: 'Missing' };
    expect(revealRichEditorSelectionAnchor(editor, stale).state).toBe('stale');
    expect(chain.setTextSelection).toHaveBeenCalledTimes(1);
  });

  it('unwraps Alpine editor proxies before dispatching a selection transaction', () => {
    const doc = documentWith('Quote me');
    const run = vi.fn();
    const chain = { focus: vi.fn(() => chain), setTextSelection: vi.fn(() => chain), run };
    const editor = { state: { doc }, chain: vi.fn(() => chain) };
    const proxy = { state: { doc: documentWith('Wrong proxy state') } };
    const previousAlpine = globalThis.Alpine;
    globalThis.Alpine = { raw: vi.fn(() => editor) };
    try {
      expect(revealRichEditorSelectionAnchor(proxy, {
        anchor_quote: 'Quote',
        anchor_start_offset: 1,
        anchor_end_offset: 6,
      }).state).toBe('found');
      expect(globalThis.Alpine.raw).toHaveBeenCalledWith(proxy);
      expect(chain.setTextSelection).toHaveBeenCalledWith({ from: 1, to: 6 });
    } finally {
      if (previousAlpine === undefined) delete globalThis.Alpine;
      else globalThis.Alpine = previousAlpine;
    }
  });
});

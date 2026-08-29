// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalActorMentions,
  createMentionPill,
  hydrateMentionComposer,
  insertMentionAtComposerSelection,
  insertPlainTextAtSelection,
  removeAdjacentMentionPill,
  serializeMentionComposer,
  serializeMentionComposerState,
} from '../src/mention-composer.js';

const testagent = 'npub1testagent';
const token = `@[Test Agent](mention:person:${testagent})`;

function composer(value = '') {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  hydrateMentionComposer(root, value);
  return root;
}

function caret(root, node, offset) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  root.focus();
}

describe('tokenized mention composer', () => {
  it('inserts a structured mention at the caret and restores focus', () => {
    const root = composer('Hello there');
    caret(root, root.firstChild, 5);
    const focus = vi.spyOn(root, 'focus');

    expect(insertMentionAtComposerSelection(root, { type: 'agent', npub: testagent, label: 'Test Agent' })).toBe(true);
    expect(serializeMentionComposer(root)).toBe(`Hello @[Test Agent](mention:agent:${testagent}) there`);
    expect(focus).toHaveBeenCalled();
  });

  it('inserts trailing prompt text with a structured mention and preserves surrounding text', () => {
    const root = composer('Before after');
    caret(root, root.firstChild, 'Before'.length);

    expect(insertMentionAtComposerSelection(
      root,
      { type: 'agent', npub: testagent, label: 'Test Agent' },
      ' update please?',
    )).toBe(true);
    expect(serializeMentionComposer(root)).toBe(
      `Before @[Test Agent](mention:agent:${testagent}) update please? after`,
    );
    expect(canonicalActorMentions(serializeMentionComposer(root))).toContainEqual({
      label: 'Test Agent',
      type: 'agent',
      npub: testagent,
    });
  });

  it('hydrates a canonical actor mention as an atomic accessible pill and serializes losslessly', () => {
    const root = composer(`Hello ${token} there`);
    const pill = root.querySelector('[data-mention-token]');

    expect(pill.textContent).toBe('@Test Agent');
    expect(pill.contentEditable).toBe('false');
    expect(pill.getAttribute('aria-label')).toBe('Mention Test Agent');
    expect(serializeMentionComposer(root)).toBe(`Hello ${token} there`);
    expect(canonicalActorMentions(serializeMentionComposer(root))).toEqual([
      { label: 'Test Agent', type: 'person', npub: testagent },
    ]);
  });

  it('keeps text before and after an inserted pill in canonical order', () => {
    const root = composer();
    root.replaceChildren(
      document.createTextNode('before '),
      createMentionPill(document, { label: 'Test Agent', type: 'agent', npub: testagent }),
      document.createTextNode(' after'),
    );
    expect(serializeMentionComposer(root)).toBe(`before @[Test Agent](mention:agent:${testagent}) after`);
  });

  it('collects pill and plain canonical mentions during the serialization pass', () => {
    const root = composer();
    root.replaceChildren(
      createMentionPill(document, { label: 'Test Agent', type: 'agent', npub: testagent }),
      document.createTextNode(' and @[Operator](mention:person:npub1operator)'),
    );

    expect(serializeMentionComposerState(root)).toEqual({
      value: `@[Test Agent](mention:agent:${testagent}) and @[Operator](mention:person:npub1operator)`,
      actorMentions: [
        { label: 'Test Agent', type: 'agent', npub: testagent },
        { label: 'Operator', type: 'person', npub: 'npub1operator' },
      ],
    });
  });

  it('removes the whole pill with one adjacent backspace', () => {
    const root = composer(`${token} after`);
    const trailing = root.lastChild;
    caret(root, trailing, 0);

    expect(removeAdjacentMentionPill(root, 'backward')).toBe(true);
    expect(serializeMentionComposer(root)).toBe(' after');
    expect(canonicalActorMentions(serializeMentionComposer(root))).toEqual([]);
  });

  it('pastes plain multiline text without importing rich HTML', () => {
    const root = composer(token);
    caret(root, root, root.childNodes.length);
    insertPlainTextAtSelection(root, '\nplain <b>text</b>');

    expect(root.querySelector('b')).toBeNull();
    expect(serializeMentionComposer(root)).toBe(`${token}\nplain <b>text</b>`);
  });

  it('hydrates an empty model after send/reset', () => {
    const root = composer(`draft ${token}`);
    hydrateMentionComposer(root, '');
    expect(root.childNodes).toHaveLength(0);
    expect(serializeMentionComposer(root)).toBe('');
  });
});

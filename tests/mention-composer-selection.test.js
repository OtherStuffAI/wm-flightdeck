// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateMentionComposer, serializeMentionComposer } from '../src/mention-composer.js';

const { alpineStartMock, alpineStoreMock } = vi.hoisted(() => ({
  alpineStartMock: vi.fn(),
  alpineStoreMock: vi.fn(),
}));

vi.mock('alpinejs', () => ({
  default: { store: alpineStoreMock, start: alpineStartMock },
}));

async function createStore() {
  vi.resetModules();
  const { initApp } = await import('../src/app.js');
  initApp();
  return alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
}

function setCaret(node, offset) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

beforeEach(() => {
  document.body.replaceChildren();
  alpineStartMock.mockClear();
  alpineStoreMock.mockClear();
});

describe('mention composer selection range', () => {
  it('does not inspect the selection range for ordinary text without an @ trigger', async () => {
    const store = await createStore();
    const root = document.createElement('div');
    root.setAttribute('contenteditable', 'true');
    root.textContent = 'ordinary mobile typing';
    document.body.append(root);
    const selection = document.getSelection();
    const getRangeAt = vi.spyOn(selection, 'getRangeAt');

    store.handleMentionInput(root);

    expect(getRangeAt).not.toHaveBeenCalled();
    expect(store.mentionActive).toBe(false);
  });

  it.each(['message', 'thread'])('preserves a long multiline %s suffix when click selection moves focus outside the composer', async (composer) => {
    const store = await createStore();
    const existing = '@[Operator A](mention:person:npub1operator-a)';
    const suffix = ' keep this first line\nand this much longer second line untouched';
    const root = document.createElement('div');
    root.setAttribute('contenteditable', 'true');
    root.dataset.chatComposer = composer;
    document.body.append(root);
    hydrateMentionComposer(root, `${existing}\n@Ric${suffix}`);

    const queryText = root.lastChild;
    setCaret(queryText, '\n@Ric'.length);
    store.searchMentions = vi.fn(() => [{ type: 'person', id: 'npub1testagent', label: 'Test Agent' }]);
    store.refreshMentionResultsFromLocalIndex = vi.fn();
    store.autosizeComposer = vi.fn();
    store.handleMentionInput(root);

    expect(store._mentionStartPos).toBe('@Operator A'.length + 1);
    expect(store._mentionEndPos).toBe('@Operator A'.length + '\n@Ric'.length);

    const popoverOption = document.createElement('button');
    popoverOption.textContent = 'Test Agent';
    document.body.append(popoverOption);
    setCaret(popoverOption.firstChild, 4);

    store.selectMention({ type: 'person', id: 'npub1testagent', label: 'Test Agent' });

    expect(serializeMentionComposer(root)).toBe(
      `${existing}\n@[Test Agent](mention:person:npub1testagent) ${suffix}`,
    );
    expect(store[composer === 'thread' ? 'threadInput' : 'messageInput']).toBe(
      `${existing}\n@[Test Agent](mention:person:npub1testagent) ${suffix}`,
    );
    expect(store.selectedAgentMentionsByComposer[composer]).toEqual([
      { label: 'Operator A', type: 'person', npub: 'npub1operator-a' },
      { label: 'Test Agent', type: 'person', npub: 'npub1testagent' },
    ]);
    expect(store._mentionEndPos).toBe(-1);
  });
});

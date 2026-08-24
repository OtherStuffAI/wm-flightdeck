// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function contenteditable(value, caretOffset = value.length) {
  const root = document.createElement('div');
  root.setAttribute('contenteditable', 'true');
  root.textContent = value;
  document.body.append(root);
  const range = document.createRange();
  range.setStart(root.firstChild, caretOffset);
  range.collapse(true);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return root;
}

function dispatchComposerKey(store, target, key, options = {}) {
  const sendAction = vi.fn();
  target.addEventListener('keydown', (event) => store.handleComposerKeydown(event, sendAction));
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return { event, sendAction };
}

beforeEach(() => {
  document.body.replaceChildren();
  alpineStartMock.mockClear();
  alpineStoreMock.mockClear();
});

describe('multiline composer keyboard handling', () => {
  it.each([
    ['ArrowUp', 'first line\nsecond line'],
    ['ArrowDown', 'a long line that can soft wrap in the browser'],
  ])('leaves unmodified %s to native caret movement', async (key, value) => {
    const store = await createStore();
    const composer = contenteditable(value);

    const { event, sendAction } = dispatchComposerKey(store, composer, key);

    expect(event.defaultPrevented).toBe(false);
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('does not consume arrows when global mention state belongs to another composer', async () => {
    const store = await createStore();
    const mentionComposer = contenteditable('@Test Agent');
    const multilineComposer = contenteditable('first line\nsecond line');
    store.mentionActive = true;
    store._mentionTargetEl = mentionComposer;
    store._mentionEndPos = '@Test Agent'.length;
    store.mentionResults = [{ type: 'person', id: 'npub1testagent', label: 'Test Agent' }];

    const { event } = dispatchComposerKey(store, multilineComposer, 'ArrowUp');

    expect(event.defaultPrevented).toBe(false);
    expect(store.mentionActive).toBe(false);
  });

  it('does not consume arrows after the caret leaves an active mention query', async () => {
    const store = await createStore();
    const composer = contenteditable('@Test Agent\nsecond line');
    store.mentionActive = true;
    store._mentionTargetEl = composer;
    store._mentionEndPos = 5;
    store.mentionResults = [{ type: 'person', id: 'npub1testagent', label: 'Test Agent' }];

    const { event } = dispatchComposerKey(store, composer, 'ArrowDown');

    expect(event.defaultPrevented).toBe(false);
    expect(store.mentionActive).toBe(false);
  });

  it('preserves arrow navigation inside the active mention autocomplete', async () => {
    const store = await createStore();
    const composer = contenteditable('@Test Agent');
    store.mentionActive = true;
    store._mentionTargetEl = composer;
    store._mentionEndPos = '@Test Agent'.length;
    store.mentionResults = [
      { type: 'person', id: 'npub1testagent', label: 'Test Agent' },
      { type: 'person', id: 'npub1operator-a', label: 'Operator A' },
    ];
    store.mentionSelectedIndex = 0;

    const { event } = dispatchComposerKey(store, composer, 'ArrowDown');

    expect(event.defaultPrevented).toBe(true);
    expect(store.mentionSelectedIndex).toBe(1);
  });

  it('preserves Enter-to-send, Shift+Enter newline, and IME composition', async () => {
    const store = await createStore();

    const enter = dispatchComposerKey(store, contenteditable('send me'), 'Enter');
    expect(enter.event.defaultPrevented).toBe(true);
    expect(enter.sendAction).toHaveBeenCalledOnce();

    const shifted = dispatchComposerKey(store, contenteditable('new line'), 'Enter', { shiftKey: true });
    expect(shifted.event.defaultPrevented).toBe(false);
    expect(shifted.sendAction).not.toHaveBeenCalled();

    const composing = dispatchComposerKey(store, contenteditable('composing'), 'Enter', { isComposing: true });
    expect(composing.event.defaultPrevented).toBe(false);
    expect(composing.sendAction).not.toHaveBeenCalled();
  });
});

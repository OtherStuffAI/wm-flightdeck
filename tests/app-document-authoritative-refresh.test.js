import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  alpineStartMock,
  alpineStoreMock,
} = vi.hoisted(() => ({
  alpineStartMock: vi.fn(),
  alpineStoreMock: vi.fn(),
}));

vi.mock('alpinejs', () => ({
  default: {
    store: alpineStoreMock,
    start: alpineStartMock,
  },
}));

beforeEach(() => {
  vi.resetModules();
  alpineStartMock.mockClear();
  alpineStoreMock.mockClear();
});

async function createStore() {
  const { initApp } = await import('../src/app.js');
  initApp();
  const store = alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
  expect(store).toBeTruthy();
  return store;
}

describe('open document authoritative refresh', () => {
  it('observes a newer row while the clean editor is in rich mode', async () => {
    const store = await createStore();
    store.selectedDocType = 'document';
    store.selectedDocId = 'doc-1';
    store.documents = [{ record_id: 'doc-1', version: 44 }];
    store.docEditorMode = 'rich';
    store.docEditDraftDirty = false;
    store.docEditingTitle = false;
    store.docEditingBlockIndex = -1;
    store.docAutosaveState = 'saved';
    store.observeSelectedDocAuthoritativeVersion = vi.fn(() => true);

    expect(store.canRefreshOpenDocFromLatestDocument()).toBe(true);
    expect(store.refreshOpenDocFromLatestDocument()).toBe(true);
    expect(store.observeSelectedDocAuthoritativeVersion).toHaveBeenCalledTimes(1);
  });

  it('preserves a dirty rich-editor draft and invokes the conflict observer', async () => {
    const store = await createStore();
    store.selectedDocType = 'document';
    store.selectedDocId = 'doc-1';
    store.documents = [{ record_id: 'doc-1', version: 44 }];
    store.docEditorMode = 'rich';
    store.docEditDraftDirty = true;
    store.docEditingTitle = false;
    store.docEditingBlockIndex = -1;
    store.docAutosaveState = 'pending';
    store.observeSelectedDocAuthoritativeVersion = vi.fn(() => true);

    expect(store.canRefreshOpenDocFromLatestDocument()).toBe(false);
    expect(store.refreshOpenDocFromLatestDocument()).toBe(false);
    expect(store.observeSelectedDocAuthoritativeVersion).toHaveBeenCalledTimes(1);
  });
});

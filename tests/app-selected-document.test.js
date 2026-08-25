import { describe, expect, it, vi } from 'vitest';
import {
  applySelectedDocumentUpdate,
  documentLinkViewState,
  preserveHydratedDocumentContent,
} from '../src/document-selection.js';

function createStore(overrides = {}) {
  const store = {
    selectedDocId: 'doc-1',
    documents: [{
      record_id: 'doc-1',
      record_state: 'active',
      title: 'Original title',
    }],
    applyDocuments: vi.fn((documents) => {
      store.documents = documents;
    }),
    loadDocEditorFromSelection: vi.fn(),
    ...overrides,
  };

  Object.defineProperty(store, 'selectedDocument', {
    configurable: true,
    get() {
      return this.documents.find((item) => item.record_id === this.selectedDocId) ?? null;
    },
  });

  return store;
}

describe('applySelectedDocumentUpdate', () => {
  it('keeps the editor state intact when the selected doc refreshes in place', () => {
    const store = createStore();

    applySelectedDocumentUpdate(store, {
      record_id: 'doc-1',
      record_state: 'active',
      title: 'Updated title',
    });

    expect(store.applyDocuments).toHaveBeenCalledTimes(1);
    expect(store.selectedDocument?.title).toBe('Updated title');
    expect(store.loadDocEditorFromSelection).not.toHaveBeenCalled();
  });

  it('resets the editor when the selected doc disappears', () => {
    const store = createStore();

    applySelectedDocumentUpdate(store, {
      record_id: 'doc-1',
      record_state: 'deleted',
      title: 'Deleted title',
    });

    expect(store.applyDocuments).toHaveBeenCalledTimes(1);
    expect(store.selectedDocument).toBeNull();
    expect(store.loadDocEditorFromSelection).toHaveBeenCalledTimes(1);
  });
});

describe('preserveHydratedDocumentContent', () => {
  it('keeps a loaded body when a same-version collection refresh is less hydrated', () => {
    const loaded = {
      record_id: 'doc-1',
      version: 4,
      title: 'Loaded document',
      content: '# Stable body',
      content_blocks: [{ id: 'block-1', raw: '# Stable body' }],
      content_storage_object_id: 'object-1',
      content_storage_status: 'loaded',
      content_storage_error: null,
    };
    const remote = {
      record_id: 'doc-1',
      version: 4,
      title: 'Loaded document',
      content: '',
      content_blocks: [],
      content_storage_object_id: 'object-1',
      content_storage_status: 'remote',
    };

    expect(preserveHydratedDocumentContent(loaded, remote)).toMatchObject({
      content: '# Stable body',
      content_blocks: [{ id: 'block-1', raw: '# Stable body' }],
      content_storage_status: 'loaded',
    });
  });

  it('accepts a less-hydrated row when its version advances', () => {
    const current = {
      record_id: 'doc-1',
      version: 4,
      content: '# Old body',
      content_storage_object_id: 'object-1',
      content_storage_status: 'loaded',
    };
    const next = {
      record_id: 'doc-1',
      version: 5,
      content: '',
      content_storage_object_id: 'object-2',
      content_storage_status: 'remote',
    };

    expect(preserveHydratedDocumentContent(current, next)).toBe(next);
  });

  it('keeps a newer locally accepted canonical row when an older hydration arrives', () => {
    const accepted = {
      record_id: 'doc-1',
      version: 44,
      title: 'Accepted title',
      content: '# Accepted body',
      content_storage_status: 'remote',
    };
    const staleHydration = {
      record_id: 'doc-1',
      version: 43,
      title: 'Older title',
      content: '# Older body',
      content_storage_status: 'loaded',
    };

    expect(preserveHydratedDocumentContent(accepted, staleHydration)).toBe(accepted);
  });
});

describe('documentLinkViewState', () => {
  it('opens an ordinary document link on the document pane', () => {
    expect(documentLinkViewState()).toEqual({
      commentId: null,
      showComments: false,
    });
  });

  it('opens an explicit document-comment link on the comments pane', () => {
    expect(documentLinkViewState('comment-1')).toEqual({
      commentId: 'comment-1',
      showComments: true,
    });
  });
});

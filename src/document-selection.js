const DOCUMENT_CONTENT_FIELDS = [
  'content',
  'content_format',
  'content_blocks',
  'editor_state',
  'editor_state_format',
  'editor_state_version',
  'content_storage_object_id',
  'content_storage_format',
  'content_storage_content_type',
  'content_size_bytes',
  'content_sha256_hex',
  'content_storage_status',
  'content_storage_error',
];

function documentVersion(document = {}) {
  const version = Number(document?.version ?? document?.row_version ?? 0);
  return Number.isFinite(version) ? version : 0;
}

export function documentLinkViewState(commentId = null) {
  const selectedCommentId = String(commentId || '').trim() || null;
  return {
    commentId: selectedCommentId,
    showComments: Boolean(selectedCommentId),
  };
}

export function preserveHydratedDocumentContent(current = null, incoming = null) {
  if (!current || !incoming) return incoming;
  if (String(current.record_id || '') !== String(incoming.record_id || '')) return incoming;
  if (documentVersion(current) !== documentVersion(incoming)) return incoming;
  if (current.content_storage_status !== 'loaded' || incoming.content_storage_status === 'loaded') return incoming;
  if (
    current.content_storage_object_id
    && incoming.content_storage_object_id
    && current.content_storage_object_id !== incoming.content_storage_object_id
  ) return incoming;

  return DOCUMENT_CONTENT_FIELDS.reduce((merged, field) => {
    merged[field] = current[field];
    return merged;
  }, { ...incoming });
}

export function applySelectedDocumentUpdate(store, document = null) {
  const recordId = String(store.selectedDocId || '').trim();
  if (!recordId) return;
  const nextDocuments = store.documents.filter((item) => item?.record_id !== recordId);
  if (document && document.record_state !== 'deleted') {
    nextDocuments.push(document);
  }
  store.applyDocuments(nextDocuments);
  if (!store.selectedDocument) {
    store.loadDocEditorFromSelection();
  }
}

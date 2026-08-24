const STORAGE_MARKDOWN_PATTERN = /(!?)\[([^\]\n]*)\]\(storage:\/\/([A-Za-z0-9-]+)(?:\s+"[^"]*")?\)/g;

export function storageAttachmentsFromMarkdown(body = '') {
  const attachments = [];
  const seenObjectIds = new Set();
  for (const match of String(body || '').matchAll(STORAGE_MARKDOWN_PATTERN)) {
    const storageObjectId = String(match[3] || '').trim();
    if (!storageObjectId || seenObjectIds.has(storageObjectId)) continue;
    seenObjectIds.add(storageObjectId);
    attachments.push({
      kind: match[1] === '!' ? 'image' : 'file',
      storage_object_id: storageObjectId,
      filename: String(match[2] || '').trim() || 'Attachment',
    });
  }
  return attachments;
}

export function mergeChatStorageAttachments(body = '', attachments = []) {
  const merged = Array.isArray(attachments) ? [...attachments] : [];
  const seenObjectIds = new Set(merged
    .map((attachment) => String(attachment?.storage_object_id || '').trim())
    .filter(Boolean));
  for (const attachment of storageAttachmentsFromMarkdown(body)) {
    if (seenObjectIds.has(attachment.storage_object_id)) continue;
    seenObjectIds.add(attachment.storage_object_id);
    merged.push(attachment);
  }
  return merged;
}

export function standaloneChatFileAttachments(message = {}) {
  const linkedObjectIds = new Set(storageAttachmentsFromMarkdown(message?.body)
    .map((attachment) => attachment.storage_object_id));
  return (Array.isArray(message?.attachments) ? message.attachments : [])
    .filter((attachment) => attachment?.kind === 'file' || attachment?.kind === 'image')
    .filter((attachment) => !linkedObjectIds.has(String(attachment?.storage_object_id || '').trim()));
}

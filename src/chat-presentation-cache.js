export const CHAT_PRESENTATION_CACHE_LIMIT = 9;
export const CHAT_PRESENTATION_ROOT_LIMIT = 80;

function timestamp(row) {
  return String(row?.updated_at || row?.created_at || '');
}

export function messagePresentationSignature(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => [
      message?.record_id,
      message?.version,
      message?.sync_status,
      message?.record_state,
      timestamp(message),
    ].join(':'))
    .join('|');
}

export function buildThreadAwarePresentationWindow(messages = [], {
  rootLimit = CHAT_PRESENTATION_ROOT_LIMIT,
  activeThreadId = '',
  focusMessageId = '',
} = {}) {
  const rows = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && String(message.record_state || 'active') !== 'deleted');
  const byId = new Map(rows.map((message) => [String(message.record_id || ''), message]));
  const requiredIds = new Set();
  const roots = rows
    .filter((message) => !String(message.parent_message_id || '').trim())
    .sort((left, right) => timestamp(left).localeCompare(timestamp(right)) || String(left.record_id).localeCompare(String(right.record_id)))
    .slice(-Math.max(1, Number(rootLimit) || CHAT_PRESENTATION_ROOT_LIMIT));
  for (const root of roots) requiredIds.add(String(root.record_id || ''));

  const includeTarget = (targetId) => {
    const target = byId.get(String(targetId || ''));
    if (!target) return;
    requiredIds.add(String(target.record_id || ''));
    const parentId = String(target.parent_message_id || '').trim();
    if (parentId) requiredIds.add(parentId);
  };
  includeTarget(activeThreadId);
  includeTarget(focusMessageId);
  const activeThread = byId.get(String(activeThreadId || ''));
  for (const messageId of Array.isArray(activeThread?.pg_effective_message_ids)
    ? activeThread.pg_effective_message_ids
    : []) {
    if (byId.has(String(messageId || ''))) requiredIds.add(String(messageId));
  }

  for (const message of rows) {
    const id = String(message.record_id || '');
    const parentId = String(message.parent_message_id || '').trim();
    if (['pending', 'failed'].includes(String(message.sync_status || ''))) {
      requiredIds.add(id);
      if (parentId) requiredIds.add(parentId);
    }
    if (parentId && (requiredIds.has(parentId) || parentId === String(activeThreadId || ''))) {
      requiredIds.add(id);
    }
  }

  return rows
    .filter((message) => requiredIds.has(String(message.record_id || '')))
    .sort((left, right) => timestamp(left).localeCompare(timestamp(right)) || String(left.record_id).localeCompare(String(right.record_id)));
}

export function createChatPresentationCache(limit = CHAT_PRESENTATION_CACHE_LIMIT) {
  const entries = new Map();
  const maxEntries = Math.max(1, Number(limit) || CHAT_PRESENTATION_CACHE_LIMIT);
  return {
    get size() { return entries.size; },
    get(key) {
      const normalizedKey = String(key || '').trim();
      const entry = entries.get(normalizedKey);
      if (!entry) return null;
      entries.delete(normalizedKey);
      entry.lastUsedAt = Date.now();
      entries.set(normalizedKey, entry);
      return entry;
    },
    peek(key) {
      return entries.get(String(key || '').trim()) || null;
    },
    set(key, entry) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return null;
      const boundedMessages = buildThreadAwarePresentationWindow(entry?.messages, entry);
      const next = {
        channelId: String(entry?.channelId || '').trim(),
        messages: boundedMessages,
        signature: entry?.signature || messagePresentationSignature(boundedMessages),
        scrollPosition: Number(entry?.scrollPosition || 0),
        scrollAnchor: entry?.scrollAnchor || null,
        expandedMessageIds: [...(entry?.expandedMessageIds || [])],
        truncatedMessageIds: [...(entry?.truncatedMessageIds || [])],
        mainFeedVisibleCount: Math.max(1, Number(entry?.mainFeedVisibleCount || CHAT_PRESENTATION_ROOT_LIMIT)),
        activeThreadId: entry?.activeThreadId || null,
        lastUsedAt: Date.now(),
      };
      entries.delete(normalizedKey);
      entries.set(normalizedKey, next);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return next;
    },
    delete(key) { return entries.delete(String(key || '').trim()); },
    clear() { entries.clear(); },
    keys() { return [...entries.keys()]; },
  };
}

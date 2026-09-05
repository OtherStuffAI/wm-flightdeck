// Membership belongs to an effective transcript, not every cached row in a channel.
export function threadHistoryLineage(thread) {
  if (!thread) return null;
  return JSON.stringify([
    thread.pg_workspace_id ?? thread.workspace_id,
    thread.channel_id,
    thread.pg_thread_id ?? thread.id ?? thread.record_id,
    thread.pg_source_message_id ?? thread.source_message_id,
    thread.pg_parent_thread_id ?? thread.parent_thread_id,
    thread.pg_branch_point_message_id ?? thread.branch_point_message_id,
    thread.pg_scope_id ?? thread.scope_id,
  ].map(value => String(value || '')));
}

// Both inputs are authorized, ordered membership metadata. Insert new page IDs
// at their next known anchor; first-page gaps precede the retained later history.
// Never load message values to merge these arrays.
export function mergeThreadHistoryIds(known = [], page = [], firstPage = false) {
  const existing = new Set(known);
  const before = new Map();
  let pending = [];
  let anchored = false;
  for (const id of new Set(page)) {
    if (existing.has(id)) {
      anchored = true;
      if (pending.length) before.set(id, pending);
      pending = [];
    } else pending.push(id);
  }
  const merged = known.flatMap(id => [...(before.get(id) || []), id]);
  return [...new Set(firstPage && !anchored && pending.length
    ? [...pending, ...merged] : [...merged, ...pending])];
}

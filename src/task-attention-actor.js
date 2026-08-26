function text(value) {
  return String(value || '').trim();
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function memberActor(member = {}) {
  return member?.actor && typeof member.actor === 'object' ? member.actor : member;
}

export function buildWorkspaceActorNpubMap(workspaceMembers = []) {
  const actors = new Map();
  for (const member of Array.isArray(workspaceMembers) ? workspaceMembers : []) {
    const actor = memberActor(member);
    const actorId = text(actor?.actor_id || actor?.id || member?.actor_id || member?.id);
    const npub = text(actor?.npub || member?.npub);
    if (actorId && npub) actors.set(actorId, npub);
  }
  return actors;
}

function activityActorId(row = {}, kind = 'task') {
  if (kind === 'comment') {
    return text(
      row.pg_created_by_actor_id
      || row.created_by_actor_id
      || row.pg_updated_by_actor_id
      || row.updated_by_actor_id,
    );
  }
  return text(
    row.pg_updated_by_actor_id
    || row.updated_by_actor_id
    || row.pg_created_by_actor_id
    || row.created_by_actor_id,
  );
}

function activityActorNpub(row = {}, kind = 'task', actorNpubById = new Map()) {
  const actorId = activityActorId(row, kind);
  const direct = kind === 'comment'
    ? text(
      row.pg_created_by_actor_npub
      || row.created_by_actor_npub
      || row.sender_npub
      || row.pg_updated_by_actor_npub
      || row.updated_by_actor_npub,
    )
    : text(
      row.pg_updated_by_actor_npub
      || row.updated_by_actor_npub
      || row.sender_npub
      || row.pg_created_by_actor_npub
      || row.created_by_actor_npub,
    );
  return direct || text(actorNpubById.get(actorId));
}

export function resolveTaskActivityViewer({
  viewState = {},
  viewerActorId = '',
  viewerNpub = '',
  workspaceMembers = [],
} = {}) {
  const actorNpubById = buildWorkspaceActorNpubMap(workspaceMembers);
  let actorId = text(viewState.viewer_actor_id || viewerActorId);
  let npub = text(viewerNpub);

  if (!actorId && npub) {
    actorId = [...actorNpubById.entries()].find(([, memberNpub]) => memberNpub === npub)?.[0] || '';
  }
  if (!npub && actorId) npub = text(actorNpubById.get(actorId));

  return { actorId, npub, actorNpubById };
}

export function isTaskActivityAuthoredByViewer(row = {}, {
  kind = 'task',
  viewState = {},
  viewerActorId = '',
  viewerNpub = '',
  workspaceMembers = [],
} = {}) {
  const viewer = resolveTaskActivityViewer({ viewState, viewerActorId, viewerNpub, workspaceMembers });
  const actorId = activityActorId(row, kind);
  if (viewer.actorId && actorId) return viewer.actorId === actorId;

  const actorNpub = activityActorNpub(row, kind, viewer.actorNpubById);
  return Boolean(viewer.npub && actorNpub && viewer.npub === actorNpub);
}

export function latestTaskActivity(task = {}, comments = []) {
  let latest = {
    kind: 'task',
    row: task,
    at: text(task.updated_at || task.created_at),
  };
  let latestTimestamp = timestamp(latest.at);

  for (const comment of Array.isArray(comments) ? comments : []) {
    const at = text(comment?.updated_at || comment?.created_at);
    const commentTimestamp = timestamp(at);
    if (commentTimestamp < latestTimestamp) continue;
    latest = { kind: 'comment', row: comment, at };
    latestTimestamp = commentTimestamp;
  }

  return latest;
}

export function withTaskActivityAuthor(task = {}, {
  actorId = '',
  actorNpub = '',
} = {}) {
  const normalizedActorId = text(actorId);
  const normalizedActorNpub = text(actorNpub);
  return {
    ...task,
    ...(normalizedActorId ? { pg_updated_by_actor_id: normalizedActorId } : {}),
    ...(normalizedActorNpub ? {
      pg_updated_by_actor_npub: normalizedActorNpub,
      updated_by_npub: normalizedActorNpub,
    } : {}),
  };
}

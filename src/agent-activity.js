const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

function text(value) {
  return String(value ?? '').trim();
}

export function isTerminalAgentActivity(activity = {}) {
  return TERMINAL_STATES.has(text(activity.state).toLowerCase());
}

export function mapPgAgentActivity(activity = {}) {
  const recordId = text(activity.id || activity.record_id);
  const activityId = text(activity.activity_id);
  const visibility = text(activity.visibility);
  const sequence = Number(activity.sequence);
  if (!recordId || !activityId || visibility !== 'user_visible' || !Number.isSafeInteger(sequence) || sequence < 0) return null;
  return {
    record_id: recordId,
    activity_id: activityId,
    turn_id: text(activity.turn_id) || null,
    pg_backend: true,
    workspace_id: text(activity.workspace_id),
    scope_id: text(activity.scope_id),
    channel_id: text(activity.channel_id),
    thread_id: text(activity.thread_id),
    trigger_message_id: text(activity.trigger_message_id),
    session_id: text(activity.session_id),
    agent_npub: text(activity.agent_npub),
    state: text(activity.state).toLowerCase(),
    label: text(activity.label),
    summary: text(activity.summary),
    body: text(activity.body),
    visibility,
    sequence,
    expires_at: text(activity.expires_at),
    terminal_at: text(activity.terminal_at),
    created_at: text(activity.created_at),
    updated_at: text(activity.updated_at),
  };
}

export function mapPgAgentActivityCommentary(commentary = {}, activity = {}, context = {}) {
  const turnId = text(commentary.turn_id);
  const activityId = text(commentary.activity_id);
  const sequence = Number(commentary.sequence);
  const body = text(commentary.body);
  const state = text(commentary.state || 'working').toLowerCase();
  const visibility = text(commentary.visibility || 'user_visible');
  if (
    !turnId
    || !activityId
    || activityId !== text(activity.activity_id)
    || turnId !== text(activity.turn_id)
    || !Number.isSafeInteger(sequence)
    || sequence < 0
    || !body
    || state !== 'working'
    || visibility !== 'user_visible'
  ) return null;
  const workspaceId = text(context.workspaceId || activity.workspace_id);
  const backendUrl = text(context.backendUrl);
  return {
    history_key: [workspaceId, backendUrl, turnId, sequence].join('\u0000'),
    workspace_id: workspaceId,
    backend_url: backendUrl,
    turn_id: turnId,
    activity_id: activityId,
    channel_id: text(activity.channel_id),
    sequence,
    summary: text(commentary.summary),
    body,
    created_at: text(commentary.created_at),
  };
}

export function isVisibleAgentActivity(activity = {}, nowMs = Date.now()) {
  if (!activity?.record_id || activity.visibility !== 'user_visible' || isTerminalAgentActivity(activity)) return false;
  return true;
}

export function agentActivityLifecycleKey(activity = {}) {
  return `${text(activity.activity_id)}\u0000${text(activity.turn_id)}`;
}

export function compareAgentActivityLifecycle(left = {}, right = {}) {
  const createdOrder = text(left.created_at).localeCompare(text(right.created_at));
  if (createdOrder !== 0) return createdOrder;
  return text(left.activity_id).localeCompare(text(right.activity_id));
}

export function getAgentActivityHealth(activity = {}, sseStatus = 'connected', nowMs = Date.now()) {
  const status = text(sseStatus).toLowerCase();
  if (['fallback-polling', 'disconnected', 'disabled'].includes(status)) {
    return { state: 'error', message: 'Live activity updates are unavailable. This work context is being kept until updates recover or you remove it.' };
  }
  if (['connecting', 'reconnecting', 'token-needed', 'catch-up-required'].includes(status)) {
    return { state: 'degraded', message: 'Reconnecting to live activity updates. This work context may be behind.' };
  }
  const expiresAt = Date.parse(activity.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    return { state: 'stale', message: 'No recent activity update was received. This work context is preserved while recovery continues.' };
  }
  return { state: 'live', message: '' };
}

export function selectVisibleAgentActivities(activities = [], sseStatus = 'connected', nowMs = Date.now()) {
  const latestByRunSlot = new Map();
  for (const activity of Array.isArray(activities) ? activities : []) {
    if (!activity?.record_id) continue;
    const slot = [activity.thread_id, activity.agent_npub].map(text).join(':');
    const current = latestByRunSlot.get(slot);
    if (!current || compareAgentActivityLifecycle(activity, current) > 0) {
      latestByRunSlot.set(slot, activity);
    }
  }
  return [...latestByRunSlot.values()].filter((activity) => (
    isVisibleAgentActivity(activity, nowMs)
    && getAgentActivityHealth(activity, sseStatus, nowMs).state === 'live'
  ));
}

export function reconcileAgentActivity(current, incoming) {
  if (!incoming?.record_id) return current || null;
  if (!current?.record_id) return incoming;
  if (agentActivityLifecycleKey(current) !== agentActivityLifecycleKey(incoming)) return current;
  return Number(incoming.sequence) > Number(current.sequence) ? incoming : current;
}

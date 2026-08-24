export function normalizeChannelOrder(order = [], channels = []) {
  const channelIds = (Array.isArray(channels) ? channels : [])
    .map((channel) => String(channel?.record_id || '').trim())
    .filter(Boolean);
  const channelIdSet = new Set(channelIds);
  const seen = new Set();
  const normalized = [];

  for (const id of Array.isArray(order) ? order : []) {
    const clean = String(id || '').trim();
    if (!clean || !channelIdSet.has(clean) || seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
  }

  for (const id of channelIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

export function sortChannelsByOrder(channels = [], order = []) {
  const input = Array.isArray(channels) ? channels : [];
  const rank = new Map(normalizeChannelOrder(order, input).map((id, index) => [id, index]));
  return input
    .map((channel, index) => ({ channel, index }))
    .sort((left, right) => {
      const leftRank = rank.has(left.channel?.record_id) ? rank.get(left.channel.record_id) : Number.MAX_SAFE_INTEGER;
      const rightRank = rank.has(right.channel?.record_id) ? rank.get(right.channel.record_id) : Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.index - right.index;
    })
    .map((entry) => entry.channel);
}

export function moveChannelInOrder(order = [], channels = [], sourceId = '', targetId = '') {
  const source = String(sourceId || '').trim();
  const target = String(targetId || '').trim();
  const normalized = normalizeChannelOrder(order, channels);
  if (!source || !target || source === target) return normalized;

  const sourceIndex = normalized.indexOf(source);
  const targetIndex = normalized.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return normalized;

  const next = [...normalized];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

function persistedPosition(channel) {
  const value = Number(channel?.position);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function fallbackChannelKey(channel) {
  return [
    String(channel?.created_at || ''),
    String(channel?.record_id || ''),
  ];
}

export function compareChannelsByScopePosition(left, right) {
  const leftPosition = persistedPosition(left);
  const rightPosition = persistedPosition(right);
  if (leftPosition !== null || rightPosition !== null) {
    if (leftPosition === null) return 1;
    if (rightPosition === null) return -1;
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  }
  const leftKey = fallbackChannelKey(left);
  const rightKey = fallbackChannelKey(right);
  return leftKey[0].localeCompare(rightKey[0]) || leftKey[1].localeCompare(rightKey[1]);
}

export function sortChannelsByScopePosition(channels = []) {
  const input = Array.isArray(channels) ? channels : [];
  const scopeRank = new Map();
  for (const channel of input) {
    const scopeId = String(channel?.scope_id || '');
    if (!scopeRank.has(scopeId)) scopeRank.set(scopeId, scopeRank.size);
  }
  return [...input].sort((left, right) => {
    const leftScope = String(left?.scope_id || '');
    const rightScope = String(right?.scope_id || '');
    return Number(scopeRank.get(leftScope)) - Number(scopeRank.get(rightScope))
      || compareChannelsByScopePosition(left, right);
  });
}

export function moveChannelToScopePosition(channels = [], channelId = '', requestedPosition = 1) {
  const input = Array.isArray(channels) ? channels : [];
  const targetId = String(channelId || '').trim();
  const target = input.find((channel) => String(channel?.record_id || '') === targetId);
  if (!target) return { channels: [...input], previousPosition: 0, position: 0, changed: false };
  const scopeId = String(target.scope_id || '');
  const siblings = input
    .filter((channel) => String(channel?.scope_id || '') === scopeId)
    .sort(compareChannelsByScopePosition);
  const previousIndex = siblings.findIndex((channel) => String(channel?.record_id || '') === targetId);
  if (previousIndex < 0) return { channels: [...input], previousPosition: 0, position: 0, changed: false };
  const numericPosition = Number(requestedPosition);
  const position = Math.min(Math.max(1, Number.isInteger(numericPosition) ? numericPosition : previousIndex + 1), siblings.length);
  const ordered = [...siblings];
  const [moved] = ordered.splice(previousIndex, 1);
  ordered.splice(position - 1, 0, moved);
  const byId = new Map(ordered.map((channel, index) => [String(channel.record_id), { ...channel, position: index + 1 }]));
  const nextChannels = sortChannelsByScopePosition(input.map((channel) => byId.get(String(channel?.record_id || '')) || channel));
  return {
    channels: nextChannels,
    previousPosition: previousIndex + 1,
    position,
    changed: previousIndex !== position - 1 || siblings.some((channel, index) => persistedPosition(channel) !== index + 1),
  };
}

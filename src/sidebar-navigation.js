import { sortChannelsByScopePosition } from './channel-order.js';
import { normalizeScopeLevel, SCOPE_LEVELS } from './translators/scopes.js';

function isVisibleRecord(record) {
  return record
    && record.record_state !== 'deleted'
    && record.can_read !== false
    && record.readable !== false;
}

function recordId(record) {
  return String(record?.record_id || '').trim();
}

function channelScopeId(channel) {
  return String(channel?.scope_id || channel?.scope_l1_id || '').trim();
}

/**
 * Build the expanded desktop sidebar projection from the workspace-filtered
 * scope and channel collections already held by the chat store.
 */
export function buildSidebarScopeChannelGroups(scopes = [], channels = []) {
  const scopeBuckets = new Map(SCOPE_LEVELS.map((level) => [level, []]));
  const scopesById = new Map();

  for (const scope of Array.isArray(scopes) ? scopes : []) {
    const id = recordId(scope);
    const level = normalizeScopeLevel(scope?.level);
    if (!id || !level || !isVisibleRecord(scope) || scopesById.has(id)) continue;
    scopesById.set(id, scope);
    scopeBuckets.get(level).push(scope);
  }

  const channelsByScope = new Map();
  const seenChannelIds = new Set();
  for (const channel of Array.isArray(channels) ? channels : []) {
    const id = recordId(channel);
    const scopeId = channelScopeId(channel);
    if (!id || !scopeId || !isVisibleRecord(channel) || seenChannelIds.has(id) || !scopesById.has(scopeId)) continue;
    seenChannelIds.add(id);
    if (!channelsByScope.has(scopeId)) channelsByScope.set(scopeId, []);
    channelsByScope.get(scopeId).push(channel);
  }

  const groups = [];
  for (const level of SCOPE_LEVELS) {
    for (const scope of scopeBuckets.get(level)) {
      groups.push({
        scope,
        channels: sortChannelsByScopePosition(channelsByScope.get(recordId(scope)) || []),
      });
    }
  }
  return groups;
}

import { sortChannelsByScopePosition } from './channel-order.js';
import { isDmScope } from './dm-scope.js';
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

  const dmGroups = [];
  const groups = [];
  for (const level of SCOPE_LEVELS) {
    for (const scope of scopeBuckets.get(level)) {
      const group = {
        scope,
        channels: sortChannelsByScopePosition(channelsByScope.get(recordId(scope)) || []),
      };
      if (isDmScope(scope)) dmGroups.push(group);
      else groups.push(group);
    }
  }
  return [...dmGroups, ...groups];
}

export function buildSidebarActiveChannelIds(workingResourceKeys = null) {
  const activeChannelIds = new Set();
  if (!workingResourceKeys?.forEach) return activeChannelIds;

  workingResourceKeys.forEach((key) => {
    const value = String(key || '').trim();
    if (!value.startsWith('channel-thread:')) return;
    const channelAndThread = value.slice('channel-thread:'.length);
    const separatorIndex = channelAndThread.indexOf(':');
    const channelId = separatorIndex >= 0 ? channelAndThread.slice(0, separatorIndex) : '';
    if (channelId) activeChannelIds.add(channelId);
  });

  return activeChannelIds;
}

export function buildSidebarUnreadChannels(groups = [], isUnread = () => false, isActive = () => false) {
  const unread = [];
  const seenChannelIds = new Set();
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const channel of Array.isArray(group?.channels) ? group.channels : []) {
      const id = recordId(channel);
      if (!id || seenChannelIds.has(id) || !isVisibleRecord(channel)) continue;
      if (isUnread(id) !== true && isActive(id) !== true) continue;
      seenChannelIds.add(id);
      unread.push(channel);
    }
  }
  return unread;
}

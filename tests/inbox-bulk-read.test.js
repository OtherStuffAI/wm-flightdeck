import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { collectUnreadViewResources, unreadStoreMixin } from '../src/unread-store.js';

function state(type, id, activityVersion = 2, viewedActivityVersion = 0) {
  return {
    record_id: `${type}:${id}`,
    resource_type: type,
    resource_id: id,
    channel_id: 'channel-1',
    activity_version: activityVersion,
    viewed_activity_version: viewedActivityVersion,
    sync_status: 'synced',
  };
}

function towerStore(initialRows) {
  let rows = initialRows;
  const writes = [];
  const store = {
    isTowerPgMode: true,
    currentWorkspace: { pgBackendMode: true, workspaceId: 'workspace-1', directHttpsUrl: 'http://tower.test', appNpub: 'npub1app' },
    _unreadThreadItems: {}, _unreadTaskItems: {}, _unreadDocItems: {}, _unreadChannels: {},
    getResourceViewStates: vi.fn(async () => rows),
    upsertResourceViewState: vi.fn(async (row) => { rows = [...rows.filter((item) => item.record_id !== row.record_id), row]; }),
    markTowerPgResourcesViewed: vi.fn(async (_workspaceId, resources) => {
      writes.push(...resources);
      return { states: resources.map((resource) => state(resource.resource_type, resource.resource_id, resource.viewed_activity_version, resource.viewed_activity_version)) };
    }),
    refreshTowerPgResourceViewStates: vi.fn(async () => unreadStoreMixin.applyTowerPgResourceViewStates.call(store, rows)),
    applyTowerPgResourceViewStates: unreadStoreMixin.applyTowerPgResourceViewStates,
  };
  unreadStoreMixin.applyTowerPgResourceViewStates.call(store, rows);
  return { store, writes };
}

describe('Inbox bulk read', () => {
  it('collects only unread resources in the requested complete families', () => {
    const rows = [state('thread', 'chat-1'), state('task', 'task-1'), state('task', 'task-read', 3, 3), state('document', 'doc-1')];
    expect(collectUnreadViewResources(rows, ['task'])).toEqual([
      { resource_type: 'task', resource_id: 'task-1', activity_version: 2 },
    ]);
  });

  it('marks every unread Inbox family while excluding already-read resources', async () => {
    const { store, writes } = towerStore([
      state('thread', 'chat-1', 4), state('task', 'task-1', 5), state('document', 'doc-1', 6), state('task', 'task-read', 7, 7),
    ]);
    const result = await unreadStoreMixin.markInboxResourcesRead.call(store, ['thread', 'task', 'document']);
    expect(result).toEqual({ ok: true, count: 3 });
    expect(writes.map((row) => `${row.resource_type}:${row.resource_id}`).sort()).toEqual(['document:doc-1', 'task:task-1', 'thread:chat-1']);
    expect(store._unreadChat).toBe(false);
    expect(store._unreadTasks).toBe(false);
    expect(store._unreadDocs).toBe(false);
  });

  it('treats a zero-item family as a harmless success without a Tower write', async () => {
    const { store } = towerStore([state('thread', 'chat-1')]);
    expect(await unreadStoreMixin.markInboxResourcesRead.call(store, ['document'])).toEqual({ ok: true, count: 0, empty: true });
    expect(store.markTowerPgResourcesViewed).not.toHaveBeenCalled();
  });

  it('renders an accessible family menu and derives task icons from board-column colour while unread treatment remains red', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(html).toContain('aria-label="Inbox read actions"');
    expect(html).toContain('role="menu" aria-label="Mark Inbox as read"');
    expect(html).toContain("runInboxReadAction(['thread', 'task', 'document'], 'Inbox items')");
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html.match(/--task-status-color': \$store\.chat\.resolveTaskBoardColumnColor\((?:item|task)\)/g)).toHaveLength(2);
    expect(styles).toMatch(/\.flightdeck-summary-card-task\s*\{[^}]*--flightdeck-summary-card-accent:\s*var\(--task-status-color, #9ca3af\)/s);
    expect(styles).toMatch(/--flightdeck-summary-card-icon-bg:\s*color-mix\([^;]*--task-status-color/s);
    expect(styles).toMatch(/--flightdeck-summary-card-icon-color:\s*color-mix\([^;]*--task-status-color/s);
    expect(styles).toMatch(/--unread-pastel-red:\s*rgba\(254, 226, 226, 0\.62\)/);
  });
});

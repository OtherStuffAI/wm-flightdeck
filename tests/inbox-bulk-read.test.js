import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  collectScopeUnreadViewResources,
  collectUnreadViewResources,
  unreadStoreMixin,
} from '../src/unread-store.js';

function state(type, id, activityVersion = 2, viewedActivityVersion = 0, channelId = 'channel-1') {
  return {
    record_id: `${type}:${id}`,
    resource_type: type,
    resource_id: id,
    channel_id: channelId,
    activity_version: activityVersion,
    viewed_activity_version: viewedActivityVersion,
    sync_status: 'synced',
  };
}

function towerStore(initialRows, context = {}) {
  let rows = initialRows;
  const writes = [];
  const store = {
    isTowerPgMode: true,
    currentWorkspace: { pgBackendMode: true, workspaceId: 'workspace-1', directHttpsUrl: 'http://tower.test', appNpub: 'npub1app' },
    pgContextScopeId: context.selectedScopeId || '',
    selectedChannelId: context.selectedChannelId || '',
    scopesMap: context.scopesMap || new Map(),
    channels: context.channels || [],
    messages: context.messages || [],
    tasks: context.tasks || [],
    documents: context.documents || [],
    inboxReadBusy: false,
    inboxReadNotice: '',
    _unreadThreadItems: {}, _unreadTaskItems: {}, _unreadDocItems: {}, _unreadChannels: {},
    getResourceViewStates: vi.fn(async () => rows),
    upsertResourceViewState: vi.fn(async (row) => { rows = [...rows.filter((item) => item.record_id !== row.record_id), row]; }),
    markTowerPgResourcesViewed: vi.fn(async (_workspaceId, resources) => {
      writes.push(...resources);
      return { states: resources.map((resource) => state(resource.resource_type, resource.resource_id, resource.viewed_activity_version, resource.viewed_activity_version)) };
    }),
    refreshTowerPgResourceViewStates: vi.fn(async () => unreadStoreMixin.applyTowerPgResourceViewStates.call(store, rows)),
    applyTowerPgResourceViewStates: unreadStoreMixin.applyTowerPgResourceViewStates,
    markInboxResourcesRead: unreadStoreMixin.markInboxResourcesRead,
  };
  unreadStoreMixin.applyTowerPgResourceViewStates.call(store, rows);
  return { store, writes };
}

describe('Inbox bulk read', () => {
  const scopeProduct = { record_id: 'scope-product', level: 'product', record_state: 'active' };
  const scopeProject = { record_id: 'scope-project', level: 'project', parent_id: 'scope-product', l1_id: 'scope-product', record_state: 'active' };
  const scopeSibling = { record_id: 'scope-sibling', level: 'product', record_state: 'active' };
  const scopesMap = new Map([scopeProduct, scopeProject, scopeSibling].map((scope) => [scope.record_id, scope]));
  const channels = [
    { record_id: 'channel-product', scope_id: 'scope-product', record_state: 'active' },
    { record_id: 'channel-project', scope_id: 'scope-project', record_state: 'active' },
    { record_id: 'channel-sibling', scope_id: 'scope-sibling', record_state: 'active' },
  ];

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

  it.each([
    { types: ['task'], expected: ['task:task-product', 'task:task-project'] },
    { types: ['document'], expected: ['document:doc-product', 'document:doc-project'] },
    { types: ['thread'], expected: ['thread:thread-product', 'thread:thread-project'] },
    {
      types: ['thread', 'task', 'document'],
      expected: [
        'document:doc-product', 'document:doc-project',
        'task:task-product', 'task:task-project',
        'thread:thread-product', 'thread:thread-project',
      ],
    },
  ])('scopes the $types Inbox shortcut to the visible scope and its descendants', async ({ types, expected }) => {
    const rows = [
      state('thread', 'thread-product', 2, 0, 'channel-product'),
      state('thread', 'thread-project', 2, 0, 'channel-project'),
      state('thread', 'thread-sibling', 2, 0, 'channel-sibling'),
      state('task', 'task-product', 2, 0, 'channel-product'),
      state('task', 'task-project', 2, 0, 'channel-project'),
      state('task', 'task-sibling', 2, 0, 'channel-sibling'),
      state('document', 'doc-product', 2, 0, 'channel-product'),
      state('document', 'doc-project', 2, 0, 'channel-project'),
      state('document', 'doc-sibling', 2, 0, 'channel-sibling'),
    ];
    const { store, writes } = towerStore(rows, {
      selectedScopeId: 'scope-product',
      selectedChannelId: 'channel-product',
      scopesMap,
      channels,
    });

    const result = await unreadStoreMixin.runInboxReadAction.call(store, types);

    expect(result).toEqual({ ok: true, count: expected.length });
    expect(writes.map((row) => `${row.resource_type}:${row.resource_id}`).sort()).toEqual([...expected].sort());
    const currentRows = await store.getResourceViewStates();
    expect(currentRows.filter((row) => row.resource_id.endsWith('-sibling'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource_type: 'thread', viewed_activity_version: 0 }),
      expect.objectContaining({ resource_type: 'task', viewed_activity_version: 0 }),
      expect.objectContaining({ resource_type: 'document', viewed_activity_version: 0 }),
    ]));
    expect(store._unreadThreadItems['thread-sibling']).toBe(true);
    expect(store._unreadDocItems['doc-sibling']).toBe(true);
    expect(store._unreadChannels['channel-sibling']).toBe(true);
  });

  it('uses authoritative resource scope before channel fallback', () => {
    const rows = [state('task', 'task-moved', 4, 0, 'channel-product')];
    expect(collectScopeUnreadViewResources(rows, ['task'], {
      selectedScopeId: 'scope-product',
      scopesMap,
      channels,
      tasks: [{ record_id: 'task-moved', scope_id: 'scope-sibling', channel_id: 'channel-product' }],
    })).toEqual([]);
  });

  it('does not narrow a scoped action to the selected channel', async () => {
    const { store, writes } = towerStore([
      state('thread', 'thread-product', 3, 0, 'channel-product'),
      state('thread', 'thread-project', 4, 0, 'channel-project'),
    ], {
      selectedScopeId: 'scope-product',
      selectedChannelId: 'channel-product',
      scopesMap,
      channels,
    });

    await unreadStoreMixin.runInboxReadAction.call(store, ['thread']);

    expect(writes.map((row) => row.resource_id).sort()).toEqual(['thread-product', 'thread-project']);
  });

  it('keeps All scopes workspace-wide even when a channel remains selected', async () => {
    const { store, writes } = towerStore([
      state('thread', 'thread-product', 2, 0, 'channel-product'),
      state('task', 'task-sibling', 2, 0, 'channel-sibling'),
      state('document', 'doc-project', 2, 0, 'channel-project'),
    ], {
      selectedScopeId: '',
      selectedChannelId: 'channel-product',
      scopesMap,
      channels,
    });

    await unreadStoreMixin.runInboxReadAction.call(store, ['thread', 'task', 'document']);

    expect(writes.map((row) => `${row.resource_type}:${row.resource_id}`).sort()).toEqual([
      'document:doc-project', 'task:task-sibling', 'thread:thread-product',
    ]);
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

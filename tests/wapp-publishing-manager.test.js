import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/backend-mode.js', () => ({ isTowerPgBackendMode: vi.fn(() => true) }));

vi.mock('../src/api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createTowerPgPersonalWapp: vi.fn(async (_workspaceId, body) => ({
      personal_wapp: {
        id: 'personal-wapp-1',
        owner_actor_id: 'actor-owner',
        owner_actor_npub: 'npub1owner',
        ...body,
        status: 'active',
        row_version: 1,
      },
    })),
    createTowerPgScopeChannel: vi.fn(async (_workspaceId, scopeId, body) => ({
      channel: { id: 'channel-new', scope_id: scopeId, title: body.name, name: body.name, kind: 'channel' },
    })),
    deleteTowerPgWappActivityMute: vi.fn(async () => ({})),
    disableTowerPgWappPublishingGrant: vi.fn(async () => ({})),
    patchTowerPgWappActivityUserState: vi.fn(async () => ({})),
    putTowerPgWappActivityMute: vi.fn(async () => ({})),
    putTowerPgWappPublishingGrant: vi.fn(async (_workspaceId, installationId, body) => ({
      grant: { ...body, grant_id: 'grant-1', wapp_installation_id: installationId, grant_version: 1, status: 'active' },
    })),
    revokeTowerPgWappPublishingGrant: vi.fn(async () => ({})),
    rotateTowerPgWappPublishingGrant: vi.fn(async () => ({})),
    updateTowerPgPersonalWapp: vi.fn(async (_workspaceId, id, body) => ({
      personal_wapp: {
        id,
        owner_actor_id: 'actor-owner',
        owner_actor_npub: 'npub1owner',
        ...body,
        status: 'active',
        row_version: 2,
      },
    })),
  };
});

vi.mock('../src/db.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    upsertChannel: vi.fn(async (row) => row),
    upsertWapp: vi.fn(async (row) => row),
    upsertWappActivityItem: vi.fn(async (row) => row),
    upsertWappPublishingGrant: vi.fn(async (row) => row),
  };
});

vi.mock('../src/pg-read-hydrator.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    hydrateTowerPgChannels: vi.fn(async (store) => store.channels || []),
    hydrateTowerPgPersonalWapps: vi.fn(async (store) => store.wapps || []),
    hydrateTowerPgWappActivity: vi.fn(async () => ({ items: [], counts: {}, mutes: [] })),
    hydrateTowerPgWappPublishingGrants: vi.fn(async () => []),
    resolveTowerPgWorkspaceContext: vi.fn(() => ({
      workspaceId: 'workspace-1',
      baseUrl: 'https://tower.example',
      appNpub: 'npub1flightdeck',
    })),
  };
});

import {
  createTowerPgPersonalWapp,
  createTowerPgScopeChannel,
  patchTowerPgWappActivityUserState,
  putTowerPgWappPublishingGrant,
  updateTowerPgPersonalWapp,
} from '../src/api.js';
import { upsertWapp, upsertWappActivityItem } from '../src/db.js';
import {
  hydrateTowerPgPersonalWapps,
  hydrateTowerPgWappActivity,
  resolveTowerPgWorkspaceContext,
  mapPgWappActivityItemToLocal,
} from '../src/pg-read-hydrator.js';
import {
  approvedWappOpenTarget,
  extractWappPublishingMetadata,
  findPublishingPersonalWapp,
  filterWappActivityItems,
  normalizeHttpsOrigins,
  normalizePersonalWappLaunchUrl,
  resolveWappActivityOpenTarget,
  wappPublishingManagerMixin,
} from '../src/wapp-publishing-manager.js';

function createStore(overrides = {}) {
  const store = Object.create(wappPublishingManagerMixin);
  Object.assign(store, {
    canAdminWorkspace: true,
    scopes: [{ record_id: 'scope-1', title: 'Sales' }],
    channels: [{ record_id: 'channel-1', scope_id: 'scope-1', title: 'Leads', record_state: 'active' }],
    wapps: [],
    wappPublishingGrants: [{
      grant_id: '',
      app_id: 'app-1',
      wapp_installation_id: 'installation-1',
      publisher_npub: 'npub1publisher',
      owner_npub: 'npub1owner',
      display_name: 'Kindling',
      capabilities: [],
      destinations: [],
      registered_open_origins: [],
      status: 'unconfigured',
    }],
    wappPublishingSelectedInstallationId: 'installation-1',
    wappPublishingCanPost: true,
    wappPublishingDestinationIds: [],
    wappPublishingOriginsText: 'https://kindling.example',
    wappPublishingEditorOpen: true,
    wappPublishingEditorSaving: false,
    wappPublishingEditorError: '',
    wappPublishingAddToMyWapps: false,
    wappPublishingLauncherLaunchUrl: '',
    wappPublishingLauncherDescription: '',
    wappPublishingLauncherIconUrl: '',
    wappPublishingLauncherError: '',
    wappPublishingGrantSaved: false,
    wappPublishingNewChannelOpen: false,
    wappPublishingNewChannelScopeId: '',
    wappPublishingNewChannelName: '',
    wappPublishingNewChannelSaving: false,
    wappPublishingNewChannelError: '',
    currentPgActorId: 'actor-owner',
    currentWorkspace: { pgMe: { actor: { actor_id: 'actor-owner', npub: 'npub1owner' } } },
    currentWorkspaceGroups: [{ group_id: 'group-workspace', name: 'Workspace' }],
    newChannelAccessRows: [],
    refreshTowerPgWorkspaceMembers: vi.fn(async () => []),
    refreshGroups: vi.fn(async () => []),
    resetNewChannelAccessRows() {
      this.newChannelAccessRows = [
        { principal_type: 'group', principal_id: 'group-workspace', capacity: 'viewer' },
        { principal_type: 'actor', principal_id: 'actor-owner', capacity: 'manager' },
      ];
    },
    getScopeBreadcrumb: () => 'Sales',
    getChannelLabel: () => 'Leads',
    ...overrides,
  });
  const inFlight = new Map();
  const service = {
    ensureLoaded(family) {
      if (inFlight.has(family)) return inFlight.get(family);
      const pending = Promise.resolve(family === 'wapp-activity'
        ? hydrateTowerPgWappActivity(store)
        : family === 'personal-wapps'
          ? hydrateTowerPgPersonalWapps(store)
          : []);
      inFlight.set(family, pending);
      pending.finally(() => inFlight.delete(family));
      return pending;
    },
  };
  store.requestTowerSyncFamily ??= (family) => service.ensureLoaded(family);
  return store;
}

describe('WApp activity reconciliation ownership', () => {
  beforeEach(() => {
    hydrateTowerPgWappActivity.mockClear();
    hydrateTowerPgPersonalWapps.mockClear();
    patchTowerPgWappActivityUserState.mockClear();
    upsertWappActivityItem.mockClear();
  });

  it('coalesces overlapping refresh triggers without queuing another full pass', async () => {
    let releaseFirst;
    hydrateTowerPgWappActivity
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce({ items: [{ record_id: 'item-latest' }], counts: { unread: 1 }, mutes: [] });
    const store = createStore();

    const first = store.reconcileWappActivity();
    const second = store.reconcileWappActivity();
    const third = store.reconcileWappActivity();
    expect(hydrateTowerPgWappActivity).toHaveBeenCalledTimes(1);

    releaseFirst({ items: [{ record_id: 'item-first' }], counts: {}, mutes: [] });
    await Promise.all([first, second, third]);

    expect(hydrateTowerPgWappActivity).toHaveBeenCalledTimes(1);
    expect(store.wappActivityLoading).toBe(false);
    expect(store.wappActivityReconciledWorkspaceKey).toBeFalsy();
  });

  it('refreshes Personal WApp launchers with activity so cold reloads can render View', async () => {
    const store = createStore({ wapps: [] });
    hydrateTowerPgWappActivity.mockResolvedValueOnce({
      items: [{ record_id: 'item-1', wapp_installation_id: 'installation-1' }],
      counts: { unread: 1 },
      mutes: [],
    });
    hydrateTowerPgPersonalWapps.mockImplementationOnce(async (target) => {
      target.wapps = [{
        record_id: 'launcher-1',
        pg_backend: true,
        pg_record_type: 'personal_wapp',
        owner_actor_id: 'actor-owner',
        record_state: 'active',
        launch_url: 'https://kindling.example/app',
        metadata: { wapp_installation_id: 'installation-1' },
      }];
      return target.wapps;
    });

    await store.reconcileWappActivity({ force: true });

    expect(hydrateTowerPgPersonalWapps).toHaveBeenCalledWith(store);
    expect(resolveWappActivityOpenTarget(
      { wapp_installation_id: 'installation-1', state: 'active' },
      [],
      store.wapps,
    )).toEqual(expect.objectContaining({
      url: 'https://kindling.example/app',
      target_type: 'launcher',
    }));
  });

  it('defers reconciliation until Tower workspace context is ready', async () => {
    resolveTowerPgWorkspaceContext.mockReturnValueOnce({ workspaceId: '', baseUrl: '' });
    const store = createStore({ currentWorkspaceKey: 'workspace-cold-start' });

    await expect(store.reconcileWappActivity()).resolves.toEqual(expect.objectContaining({ deferred: true }));

    expect(hydrateTowerPgWappActivity).not.toHaveBeenCalled();
    expect(store.wappActivityReconciledWorkspaceKey).toBeFalsy();
  });

  it('separates workspace bootstrap state from silent reconciliation', () => {
    const store = createStore({
      wappActivityItems: [{ record_id: 'old-item' }],
      wappActivityCounts: { unread: 1 },
      wappActivityMutes: [{ record_id: 'old-mute' }],
      wappActivityError: 'old error',
    });
    store.resetWappActivityProjection();
    expect(store).toMatchObject({
      wappActivityItems: [], wappActivityCounts: {}, wappActivityMutes: [],
      wappActivityError: '', wappActivityBootstrapping: true, wappActivityLoading: false,
    });
    store.applyWappActivityProjection({ items: [{ record_id: 'cached' }], counts: { unread: 1 }, mutes: [] });
    expect(store.wappActivityItems).toEqual([{ record_id: 'cached' }]);
    expect(store.wappActivityBootstrapping).toBe(false);
  });
});

describe('WApp publishing manager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('consumes Autopilot installation metadata from both top-level and compatibility metadata', () => {
    expect(extractWappPublishingMetadata({
      app_id: 'app-1',
      metadata: { autopilot_wapp: { wapp_installation_id: 'installation-1', publisher_npub: 'npub1publisher', registered_open_origins: ['https://kindling.example'] } },
    })).toMatchObject({
      app_id: 'app-1',
      wapp_installation_id: 'installation-1',
      publisher_npub: 'npub1publisher',
      registered_open_origins: ['https://kindling.example'],
    });
  });

  it('accepts only normalized HTTPS origins without credentials, paths, query, or fragments', () => {
    expect(normalizeHttpsOrigins([
      'https://kindling.example',
      'https://kindling.example/',
      'http://kindling.example',
      'https://user:pass@kindling.example',
      'https://kindling.example/path',
    ])).toEqual(['https://kindling.example']);
  });

  it('accepts only credential-free HTTP(S) launcher URLs', () => {
    expect(normalizePersonalWappLaunchUrl('https://kindling.example/app')).toBe('https://kindling.example/app');
    expect(normalizePersonalWappLaunchUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizePersonalWappLaunchUrl('javascript:alert(1)')).toBe('');
    expect(normalizePersonalWappLaunchUrl('https://user:pass@kindling.example')).toBe('');
  });

  it('opens only an approved HTTPS origin and reports a useful hostname', () => {
    const grants = [{
      wapp_installation_id: 'installation-1',
      registered_open_origins: ['https://kindling.example'],
      grant_authoritative: true,
      status: 'active',
    }];
    expect(approvedWappOpenTarget({ wapp_installation_id: 'installation-1', open_url: 'https://kindling.example/leads/7' }, grants))
      .toMatchObject({ hostname: 'kindling.example', origin: 'https://kindling.example' });
    expect(approvedWappOpenTarget({ wapp_installation_id: 'installation-1', open_url: 'https://evil.example/leads/7' }, grants)).toBeNull();
    expect(approvedWappOpenTarget({ wapp_installation_id: 'installation-1', open_url: 'javascript:alert(1)' }, grants)).toBeNull();
    expect(approvedWappOpenTarget({ wapp_installation_id: 'installation-1', open_url: 'https://kindling.example', state: 'withdrawn' }, grants)).toBeNull();
    expect(approvedWappOpenTarget(
      { wapp_installation_id: 'installation-1', open_url: 'https://kindling.example/leads/7' },
      [{ ...grants[0], status: 'revoked' }],
    )).toBeNull();
    expect(approvedWappOpenTarget(
      { wapp_installation_id: 'installation-1', open_url: 'https://kindling.example/leads/7' },
      [{ ...grants[0], grant_authoritative: false }],
    )).toBeNull();
  });

  it('prefers an approved activity deep link over a matching visible launcher', () => {
    const grants = [{
      wapp_installation_id: 'installation-1',
      registered_open_origins: ['https://kindling.example'],
      grant_authoritative: true,
      status: 'active',
    }];
    const target = resolveWappActivityOpenTarget({
      wapp_installation_id: 'installation-1',
      open_url: 'https://kindling.example/leads/7',
    }, grants, [{
      launch_url: 'https://launcher.example/app',
      metadata: { wapp_installation_id: 'installation-1' },
    }]);

    expect(target).toMatchObject({ url: 'https://kindling.example/leads/7', target_type: 'activity' });
  });

  it('falls back only to a matching visible launcher with a safe launch URL', () => {
    const item = { wapp_installation_id: 'installation-1', app_id: 'app-1' };
    expect(resolveWappActivityOpenTarget(item, [], [{
      launch_url: 'https://launcher.example/app',
      metadata: { wapp_installation_id: 'installation-1' },
    }])).toMatchObject({ url: 'https://launcher.example/app', target_type: 'launcher' });
    expect(resolveWappActivityOpenTarget(item, [], [{
      app_id: 'app-1',
      launch_url: 'javascript:alert(1)',
    }])).toBeNull();
    expect(resolveWappActivityOpenTarget(item, [], [{
      app_id: 'another-app',
      launch_url: 'https://launcher.example/app',
    }])).toBeNull();
  });

  it('falls back to a matching safe launcher when Tower rejects only the activity deep link', () => {
    const item = mapPgWappActivityItemToLocal({
      id: 'activity-1',
      wapp_installation_id: 'installation-1',
      grant_status: 'active',
      state: 'active',
      open_url: null,
      open_url_allowed: false,
    });

    expect(item).toMatchObject({
      open_url: '',
      open_url_allowed: false,
      open_links_disabled: false,
    });
    expect(resolveWappActivityOpenTarget(item, [], [{
      launch_url: 'https://wapp-one.example.invalid/',
      metadata: { wapp_installation_id: 'installation-1' },
    }])).toMatchObject({
      url: 'https://wapp-one.example.invalid/',
      target_type: 'launcher',
    });
  });

  it('keeps retained, revoked, and disabled items fail-closed without a View target', () => {
    const launcher = [{
      launch_url: 'https://launcher.example/app',
      metadata: { wapp_installation_id: 'installation-1' },
    }];
    const base = { wapp_installation_id: 'installation-1' };
    expect(resolveWappActivityOpenTarget({ ...base, state: 'resolved' }, [], launcher)).toBeNull();
    expect(resolveWappActivityOpenTarget({ ...base, grant_status: 'revoked' }, [], launcher)).toBeNull();
    expect(resolveWappActivityOpenTarget({ ...base, open_links_disabled: true }, [], launcher)).toBeNull();
  });

  it('opens View in an isolated tab and marks an unread item read after launch', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const store = createStore({
      visiblePersonalWapps: [{
        launch_url: 'https://launcher.example/app',
        metadata: { wapp_installation_id: 'installation-1' },
      }],
      markWappActivityRead: vi.fn(),
    });
    const item = { record_id: 'activity-1', wapp_installation_id: 'installation-1', unread: true };

    expect(store.openWappActivityLink(item)).toBe(true);
    expect(open).toHaveBeenCalledWith('https://launcher.example/app', '_blank', 'noopener,noreferrer');
    expect(store.markWappActivityRead).toHaveBeenCalledWith(item);
    vi.unstubAllGlobals();
  });

  it('opens the exact Tower-approved Book of Sand URL without a loaded client grant', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const store = createStore({
      wappPublishingGrants: [],
      visiblePersonalWapps: [{
        launch_url: 'https://wapp-two.example.invalid/',
        metadata: { wapp_installation_id: 'book-of-sand' },
      }],
    });
    const openUrl = 'https://wapp-two.example.invalid/?story=bitcoin-mining%3Aocean-bip110-stratum-routing-rebate-2026-08-10';
    const item = mapPgWappActivityItemToLocal({
      id: '07bd5d8c-6aed-44af-841c-e093e894cda2',
      wapp_installation_id: 'book-of-sand',
      open_url: openUrl,
      open_url_allowed: true,
      state: 'active',
    });

    expect(item.registered_open_origins).toEqual([]);

    expect(store.getWappActivityOpenTarget(item)).toMatchObject({ url: openUrl, target_type: 'activity' });
    expect(store.openWappActivityLink(item)).toBe(true);
    expect(open).toHaveBeenCalledWith(openUrl, '_blank', 'noopener,noreferrer');

    const fragmentUrl = `${openUrl}#latest`;
    expect(store.getWappActivityOpenTarget({ ...item, open_url: fragmentUrl })).toMatchObject({ url: fragmentUrl });
    vi.unstubAllGlobals();
  });

  it('does not trust an unapproved Tower activity URL without a loaded client grant', () => {
    const launcher = [{
      launch_url: 'https://wapp-two.example.invalid/',
      metadata: { wapp_installation_id: 'book-of-sand' },
    }];
    const base = {
      id: '07bd5d8c-6aed-44af-841c-e093e894cda2',
      wapp_installation_id: 'book-of-sand',
      open_url: 'https://wapp-two.example.invalid/?story=bitcoin-mining%3Aocean-bip110-stratum-routing-rebate-2026-08-10',
      state: 'active',
    };

    expect(resolveWappActivityOpenTarget(mapPgWappActivityItemToLocal({ ...base, open_url_allowed: false }), [], launcher))
      .toMatchObject({ url: 'https://wapp-two.example.invalid/', target_type: 'launcher' });
    expect(resolveWappActivityOpenTarget(base, [], launcher))
      .toMatchObject({ url: 'https://wapp-two.example.invalid/', target_type: 'launcher' });
    expect(approvedWappOpenTarget({ ...base, open_url_allowed: true, open_url: 'https://user:pass@wapp-two.example.invalid/' }, [])).toBeNull();
    expect(approvedWappOpenTarget({ ...base, open_url_allowed: true, grant_status: 'revoked' }, [])).toBeNull();
    expect(approvedWappOpenTarget({ ...base, open_url_allowed: true, open_links_disabled: true }, [])).toBeNull();
  });

  it('filters unread/source/category/channel and excludes dismissed or muted rows', () => {
    const rows = [
      { record_id: 'visible', unread: true, wapp_installation_id: 'installation-1', category: 'lead', channel_id: 'channel-1', occurred_at: '2026-08-03T01:00:00Z' },
      { record_id: 'read', unread: false, wapp_installation_id: 'installation-1', category: 'lead', channel_id: 'channel-1' },
      { record_id: 'dismissed', unread: true, dismissed_at: '2026-08-03T00:00:00Z', wapp_installation_id: 'installation-1', category: 'lead', channel_id: 'channel-1' },
      { record_id: 'muted', unread: true, muted: true, wapp_installation_id: 'installation-1', category: 'lead', channel_id: 'channel-1' },
    ];
    expect(filterWappActivityItems(rows, { unread: true, source: 'installation-1', category: 'lead', channel: 'channel-1' }).map((row) => row.record_id))
      .toEqual(['visible']);
  });

  it('reports active activity filters and clears every filter back to its default', () => {
    const store = createStore({
      wappActivityFilterUnread: true,
      wappActivityFilterSource: 'installation-1',
      wappActivityFilterCategory: 'lead',
      wappActivityFilterChannel: 'channel-1',
    });

    expect(store.hasActiveWappActivityFilters).toBe(true);
    store.clearWappActivityFilters();
    expect(store.hasActiveWappActivityFilters).toBe(false);
    expect({
      unread: store.wappActivityFilterUnread,
      source: store.wappActivityFilterSource,
      category: store.wappActivityFilterCategory,
      channel: store.wappActivityFilterChannel,
    }).toEqual({ unread: false, source: '', category: '', channel: '' });
  });

  it('persists a single Feed dismissal through Tower and materializes only the returned item', async () => {
    let finishPersistence;
    patchTowerPgWappActivityUserState.mockImplementationOnce(() => new Promise((resolve) => {
      finishPersistence = resolve;
    }));
    const item = { record_id: 'activity-1', title: 'First item', unread: true };
    const store = createStore({ wappActivityItems: [item], wappActivityCounts: { unread: 1 } });

    const dismissal = store.dismissWappActivity(item);
    expect(store.filteredWappActivityItems).toEqual([]);
    expect(store.wappActivityUnreadCount).toBe(0);

    finishPersistence({ state: { dismissed_at: '2026-08-06T01:00:00Z', unread: true } });
    await expect(dismissal).resolves.toBe(true);

    expect(patchTowerPgWappActivityUserState).toHaveBeenCalledWith(
      'workspace-1',
      'activity-1',
      { dismissed: true },
      { baseUrl: 'https://tower.example', appNpub: 'npub1flightdeck' },
    );
    expect(upsertWappActivityItem).toHaveBeenCalledTimes(1);
    expect(upsertWappActivityItem).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'activity-1',
      dismissed_at: '2026-08-06T01:00:00Z',
    }));
  });

  it('restores an optimistically dismissed Feed item and reports a visible persistence failure', async () => {
    patchTowerPgWappActivityUserState.mockRejectedValueOnce(new Error('Tower unavailable'));
    const item = { record_id: 'activity-1', title: 'First item', unread: true };
    const store = createStore({ wappActivityItems: [item], wappActivityCounts: { unread: 1 }, wappActivityDismissNotice: '' });

    await expect(store.dismissWappActivity(item)).resolves.toBe(false);

    expect(store.filteredWappActivityItems).toEqual([item]);
    expect(store.wappActivityUnreadCount).toBe(1);
    expect(store.wappActivityError).toBe('Tower unavailable');
    expect(store.wappActivityDismissNotice).toBe('Dismissal failed. The Feed item has been restored.');
  });

  it('dismisses every currently filtered Feed item without touching unrelated cards', async () => {
    patchTowerPgWappActivityUserState.mockImplementation(async (_workspaceId, itemId) => ({
      state: { dismissed_at: '2026-08-06T01:00:00Z', unread: true },
    }));
    const store = createStore({
      wappActivityItems: [
        { record_id: 'lead-1', category: 'lead' },
        { record_id: 'lead-2', category: 'lead' },
        { record_id: 'archive-1', category: 'archive' },
      ],
      wappActivityFilterCategory: 'lead',
      wappActivityDismissAllBusy: false,
      wappActivityDismissNotice: '',
    });

    const dismissal = store.dismissAllWappActivity();
    expect(store.filteredWappActivityItems).toEqual([]);
    await expect(dismissal).resolves.toEqual({ ok: true, count: 2 });

    expect(patchTowerPgWappActivityUserState).toHaveBeenCalledTimes(2);
    expect(patchTowerPgWappActivityUserState.mock.calls.map((call) => call[1]).sort()).toEqual(['lead-1', 'lead-2']);
    expect(store.wappActivityDismissAllBusy).toBe(false);
    expect(store.wappActivityDismissNotice).toBe('2 items dismissed.');
  });

  it('treats dismiss all on an empty Feed as an intentional no-op', async () => {
    const store = createStore({
      wappActivityItems: [],
      wappActivityDismissAllBusy: false,
      wappActivityDismissNotice: '',
    });

    await expect(store.dismissAllWappActivity()).resolves.toEqual({ ok: true, count: 0 });

    expect(patchTowerPgWappActivityUserState).not.toHaveBeenCalled();
    expect(store.wappActivityDismissNotice).toBe('Feed is already clear.');
  });

  it('requires an explicit destination and sends only selected scope/channel pairs', async () => {
    const store = createStore();
    await store.saveWappPublishingGrant();
    expect(putTowerPgWappPublishingGrant).not.toHaveBeenCalled();
    expect(store.wappPublishingEditorError).toContain('Select at least one channel');

    store.wappPublishingDestinationIds = ['channel-1'];
    await store.saveWappPublishingGrant();
    expect(putTowerPgWappPublishingGrant).toHaveBeenCalledWith(
      'workspace-1',
      'installation-1',
      expect.objectContaining({
        capabilities: ['activity.publish'],
        destinations: [{ scope_id: 'scope-1', channel_id: 'channel-1' }],
        registered_open_origins: ['https://kindling.example'],
      }),
      expect.objectContaining({ baseUrl: 'https://tower.example', appNpub: 'npub1flightdeck' }),
    );
  });

  it('keeps background-only registered installations manageable without a launcher', () => {
    const store = createStore();
    expect(store.wappPublishingInstallations).toEqual([
      expect.objectContaining({ wapp_installation_id: 'installation-1', display_name: 'Kindling' }),
    ]);
    expect(store.wappPublishingInstallations[0].launcher).toBeUndefined();
  });

  it('can grant a background-only installation without creating a launcher assignment', async () => {
    const store = createStore({ wappPublishingGrants: [], wapps: [], currentViewerNpub: 'npub1owner' });
    store.openNewWappPublishingEditor();
    Object.assign(store.wappPublishingDraftInstallation, {
      wapp_installation_id: 'background-installation',
      app_id: 'background-app',
      publisher_npub: 'npub1background',
      owner_npub: 'npub1owner',
      display_name: 'Background Processor',
    });
    store.wappPublishingDestinationIds = ['channel-1'];
    store.wappPublishingOriginsText = '';
    store.wappPublishingAddToMyWapps = false;

    await store.saveWappPublishingGrant();

    expect(putTowerPgWappPublishingGrant).toHaveBeenCalledWith(
      'workspace-1',
      'background-installation',
      expect.objectContaining({ app_id: 'background-app', publisher_npub: 'npub1background' }),
      expect.any(Object),
    );
    expect(store.wapps).toEqual([]);
  });

  it('defaults new installations to My WApps and saves the grant before creating the launcher', async () => {
    const store = createStore({ wappPublishingGrants: [], wapps: [], currentViewerNpub: 'npub1owner' });
    store.openNewWappPublishingEditor();
    expect(store.wappPublishingAddToMyWapps).toBe(true);
    Object.assign(store.wappPublishingDraftInstallation, {
      wapp_installation_id: 'installation-new',
      app_id: 'app-new',
      wapp_id: 'assignment-new',
      publisher_npub: 'npub1publisher',
      owner_npub: 'npub1owner',
      display_name: 'New WApp',
      source_wingman_url: 'https://wingman.example',
    });
    store.wappPublishingDestinationIds = ['channel-1'];
    store.wappPublishingLauncherLaunchUrl = 'https://new.example/app';
    store.wappPublishingLauncherDescription = 'Useful launcher';

    await store.saveWappPublishingGrant();

    expect(putTowerPgWappPublishingGrant.mock.invocationCallOrder[0])
      .toBeLessThan(createTowerPgPersonalWapp.mock.invocationCallOrder[0]);
    expect(createTowerPgPersonalWapp).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      title: 'New WApp',
      launch_url: 'https://new.example/app',
      description: 'Useful launcher',
      app_id: 'app-new',
      wapp_id: 'assignment-new',
      source_wingman_url: 'https://wingman.example',
      metadata: expect.objectContaining({
        wapp_installation_id: 'installation-new',
        autopilot_wapp: expect.objectContaining({ app_id: 'app-new', wapp_installation_id: 'installation-new' }),
      }),
    }), expect.any(Object));
    expect(upsertWapp).toHaveBeenCalledWith(expect.objectContaining({ record_id: 'personal-wapp-1', app_id: 'app-new' }));
    expect(hydrateTowerPgPersonalWapps).toHaveBeenCalledWith(store);
    expect(store.wapps).toEqual(expect.arrayContaining([expect.objectContaining({ app_id: 'app-new' })]));
    expect(store.wappPublishingEditorOpen).toBe(false);
  });

  it('deduplicates launcher retries by installation metadata first and stable app_id second', async () => {
    const installation = { wapp_installation_id: 'installation-1', app_id: 'app-1', display_name: 'Kindling' };
    const exact = { record_id: 'exact', app_id: 'old-app', metadata: { wapp_installation_id: 'installation-1' }, owner_actor_id: 'actor-owner' };
    const sameApp = { record_id: 'same-app', app_id: 'app-1', owner_actor_id: 'actor-owner' };
    expect(findPublishingPersonalWapp([sameApp, exact], installation, 'actor-owner')).toBe(exact);
    expect(findPublishingPersonalWapp([sameApp], installation, 'actor-owner')).toBe(sameApp);

    const store = createStore({ wapps: [sameApp] });
    store.wappPublishingLauncherLaunchUrl = 'https://kindling.example';
    await store.saveWappPublishingLauncher(installation);
    expect(updateTowerPgPersonalWapp).toHaveBeenCalledWith('workspace-1', 'same-app', expect.objectContaining({ app_id: 'app-1' }), expect.any(Object));
    expect(createTowerPgPersonalWapp).not.toHaveBeenCalled();
  });

  it('keeps a successful grant visible and retries only the failed launcher step', async () => {
    createTowerPgPersonalWapp.mockRejectedValueOnce(new Error('launcher unavailable'));
    const store = createStore({ wappPublishingGrants: [], wapps: [], currentViewerNpub: 'npub1owner' });
    store.openNewWappPublishingEditor();
    Object.assign(store.wappPublishingDraftInstallation, {
      wapp_installation_id: 'installation-new', app_id: 'app-new', publisher_npub: 'npub1publisher', owner_npub: 'npub1owner', display_name: 'New WApp',
    });
    store.wappPublishingDestinationIds = ['channel-1'];
    store.wappPublishingLauncherLaunchUrl = 'https://new.example';

    await store.saveWappPublishingGrant();
    expect(store.wappPublishingGrantSaved).toBe(true);
    expect(store.wappPublishingLauncherError).toContain('Publishing grant saved');
    expect(store.wappPublishingEditorOpen).toBe(true);
    expect(putTowerPgWappPublishingGrant).toHaveBeenCalledTimes(1);

    await store.retryWappPublishingLauncher();
    expect(createTowerPgPersonalWapp).toHaveBeenCalledTimes(2);
    expect(putTowerPgWappPublishingGrant).toHaveBeenCalledTimes(1);
    expect(store.wappPublishingEditorOpen).toBe(false);
  });

  it('rejects missing or unsafe launch URLs before saving a default-on setup', async () => {
    const store = createStore({ wappPublishingGrants: [], wapps: [], currentViewerNpub: 'npub1owner' });
    store.openNewWappPublishingEditor();
    Object.assign(store.wappPublishingDraftInstallation, {
      wapp_installation_id: 'installation-new', app_id: 'app-new', publisher_npub: 'npub1publisher', owner_npub: 'npub1owner', display_name: 'New WApp',
    });
    store.wappPublishingDestinationIds = ['channel-1'];
    for (const launchUrl of ['', 'javascript:alert(1)', 'https://user:pass@example.com']) {
      store.wappPublishingLauncherLaunchUrl = launchUrl;
      await store.saveWappPublishingGrant();
    }
    expect(putTowerPgWappPublishingGrant).not.toHaveBeenCalled();
    expect(store.wappPublishingEditorError).toContain('valid HTTP(S) launch URL');
  });

  it('creates and materializes a channel inline without disturbing the publishing draft', async () => {
    const store = createStore({
      channels: [{ record_id: 'channel-1', scope_id: 'scope-1', title: 'Leads', record_state: 'active' }],
      applyChannels(rows) { this.channels = rows; },
    });
    store.wappPublishingDestinationIds = ['channel-1'];
    store.wappPublishingOriginsText = 'https://kindling.example';
    store.wappPublishingNewChannelScopeId = 'scope-1';
    store.wappPublishingNewChannelName = 'WApp Updates';
    store.resetNewChannelAccessRows();

    await store.createWappPublishingChannel();

    expect(createTowerPgScopeChannel).toHaveBeenCalledWith('workspace-1', 'scope-1', expect.objectContaining({
      name: 'WApp Updates',
      kind: 'channel',
      grants: [
        { principal_type: 'group', principal_id: 'group-workspace', access_level: 'view' },
        { principal_type: 'actor', principal_id: 'actor-owner', access_level: 'manage' },
      ],
    }), { baseUrl: 'https://tower.example', appNpub: 'npub1flightdeck' });
    expect(store.wappPublishingDestinationIds).toEqual(['channel-1', 'channel-new']);
    expect(store.wappPublishingOriginsText).toBe('https://kindling.example');
    expect(store.wappPublishingEditorOpen).toBe(true);
    expect(store.channels).toEqual(expect.arrayContaining([expect.objectContaining({ record_id: 'channel-new' })]));
  });

  it('keeps inline channel API errors inside the channel interaction', async () => {
    createTowerPgScopeChannel.mockRejectedValueOnce(new Error('You cannot create a channel here'));
    const store = createStore();
    store.wappPublishingNewChannelScopeId = 'scope-1';
    store.wappPublishingNewChannelName = 'WApp Updates';
    store.resetNewChannelAccessRows();

    await store.createWappPublishingChannel();

    expect(store.wappPublishingNewChannelError).toContain('cannot create');
    expect(store.wappPublishingEditorOpen).toBe(true);
    expect(store.wappPublishingDestinationIds).toEqual([]);
  });
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectSettingsManagerMixin } from '../src/connect-settings-manager.js';
import { connectTowerBridge, saveTowerTransportPreference } from '../src/tower-transport.js';
import { verifyPairedTowerWorkspace } from '../src/api.js';

vi.mock('../src/tower-transport.js', async (original) => ({
  ...await original(), connectTowerBridge: vi.fn(), saveTowerTransportPreference: vi.fn(),
}));
vi.mock('../src/api.js', async (original) => ({ ...await original(), verifyPairedTowerWorkspace: vi.fn() }));
let store;
let reload;
beforeEach(() => {
  vi.clearAllMocks();
  reload = vi.fn();
  vi.stubGlobal('window', { wingmanTowerTransport: { version: 2, available: true }, location: { reload } });
  store = Object.create(connectSettingsManagerMixin);
  Object.defineProperty(store, 'isTowerPgMode', { value: true });
  Object.assign(store, {
    backendUrl: 'https://tower.example', workspaceOwnerNpub: 'owner', currentWorkspace: { workspaceId: 'workspace' },
    superbasedConnectionConfig: { serverNpub: 'service' }, towerTransportMode: 'fips', towerFipsEndpoint: 'paired-endpoint',
    getTowerSyncService: () => ({ prepareTransportReload: async () => {} }),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('rejects a workspace change during native approval before signing or saving the other workspace', async () => {
  let approve;
  connectTowerBridge.mockImplementation(() => new Promise((resolve) => { approve = resolve; }));
  const saving = store.saveTowerTransportSettings();
  store.currentWorkspace = { workspaceId: 'different-workspace' };
  approve({ mode: 'fips', endpoint: 'paired-endpoint', serviceNpub: 'service' });
  await saving;
  expect(store.towerTransportError).toContain('Workspace changed');
  expect(verifyPairedTowerWorkspace).not.toHaveBeenCalled();
  expect(saveTowerTransportPreference).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('reports an unsupported client before attempting a signed identity probe', async () => {
  window.wingmanTowerTransport = undefined;
  await store.saveTowerTransportSettings();
  expect(store.towerTransportError).toContain('FIPS requires WMapp');
  expect(connectTowerBridge).not.toHaveBeenCalled();
  expect(verifyPairedTowerWorkspace).not.toHaveBeenCalled();
});

it('validates a paired workspace then persists the logical Tower and reloads the same origin', async () => {
  const connection = { mode: 'fips', endpoint: 'paired-endpoint', serviceNpub: 'service' };
  connectTowerBridge.mockResolvedValue(connection);
  verifyPairedTowerWorkspace.mockResolvedValue(undefined);
  await store.saveTowerTransportSettings();
  expect(verifyPairedTowerWorkspace).toHaveBeenCalledWith(connection, 'workspace', 'owner');
  expect(saveTowerTransportPreference).toHaveBeenCalledWith('https://tower.example', connection);
  expect(reload).toHaveBeenCalledTimes(1);
});


it('rejects the screenshot mesh override without saving a transport or reloading', async () => {
  store.backendUrl = 'https://node.fips:43100';
  store.towerTransportMode = 'https';
  expect(store.towerTransportStatus).toContain('Unavailable');
  await store.saveTowerTransportSettings();
  expect(store.towerTransportError).toContain('HTTP backend override');
  expect(saveTowerTransportPreference).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('recovers only by explicit choice to the stored workspace Tower and keeps identity/outbox', async () => {
  store.backendUrl = 'https://node.fips:43100';
  store.superbasedTokenInput = 'http://node.fips:43100';
  store.currentWorkspace.directHttpsUrl = 'https://tower.example';
  store.currentWorkspace.connectionToken = '{"workspace_id":"workspace"}';
  store.pendingWrites = [{ id: 'pending' }];
  store.selectedWorkspaceKey = 'stable-key';
  store.persistWorkspaceSettings = vi.fn();
  store.loadTowerTransportSettings();
  expect(store.backendUrl).toBe('https://node.fips:43100');
  expect(store.towerFipsEndpoint).toBe('http://node.fips:43100');
  await store.restoreWorkspaceTower();
  expect(store.backendUrl).toBe('https://tower.example');
  expect(store.superbasedTokenInput).toBe(store.currentWorkspace.connectionToken);
  expect(store.workspaceOwnerNpub).toBe('owner');
  expect(store.selectedWorkspaceKey).toBe('stable-key');
  expect(store.pendingWrites).toEqual([{ id: 'pending' }]);
  expect(store.persistWorkspaceSettings).toHaveBeenCalledOnce();
  expect(saveTowerTransportPreference).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledOnce();
});

it('does not guess a recovery Tower when workspace metadata is missing', async () => {
  store.backendUrl = 'http://node.fips:43100';
  await store.restoreWorkspaceTower();
  expect(store.towerRecoveryUrl).toBe('');
  expect(store.backendUrl).toBe('http://node.fips:43100');
  expect(reload).not.toHaveBeenCalled();
});

it('returns to HTTPS with the same logical Tower through the existing sync owner', async () => {
  store.towerTransportMode = 'https';
  const prepare = vi.fn();
  store.getTowerSyncService = () => ({ prepareTransportReload: prepare });
  await store.saveTowerTransportSettings();
  expect(saveTowerTransportPreference).toHaveBeenCalledWith('https://tower.example', { mode: 'https' });
  expect(prepare).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
});


it('does not copy a mesh connection token back during recovery', async () => {
  store.backendUrl = 'https://node.fips:43100';
  store.superbasedTokenInput = 'http://node.fips:43100';
  store.currentWorkspace.directHttpsUrl = 'https://tower.example';
  store.currentWorkspace.connectionToken = 'http://node.fips:43100';
  store.persistWorkspaceSettings = vi.fn();
  await store.restoreWorkspaceTower();
  expect(store.superbasedTokenInput).toBe('');
  expect(store.backendUrl).toBe('https://tower.example');
});

it('rejects recovery if workspace changes while the sync owner drains', async () => {
  store.backendUrl = 'https://node.fips:43100';
  store.currentWorkspace.directHttpsUrl = 'https://tower.example';
  let drained;
  store.getTowerSyncService = () => ({ prepareTransportReload: () => new Promise(resolve => { drained = resolve; }) });
  store.persistWorkspaceSettings = vi.fn();
  const restoring = store.restoreWorkspaceTower();
  store.currentWorkspace = { workspaceId: 'other', directHttpsUrl: 'https://other.example' };
  drained();
  await restoring;
  expect(store.towerTransportError).toContain('Workspace changed');
  expect(store.persistWorkspaceSettings).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

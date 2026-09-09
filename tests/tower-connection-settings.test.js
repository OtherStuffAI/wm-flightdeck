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

import { describe, expect, it, vi } from 'vitest';

import {
  refreshInstalledAutopilotConnection,
  verifiedConnectionPayload,
} from '../src/autopilot-connection-refresh.js';

const connection = {
  id: 'connection-1',
  row_version: 3,
  installation_id: 'installation-one',
  display_name: 'Primary',
  fips_transport_npub: 'npub1transport',
  fips_endpoint: 'http://npub1transport.fips:3601',
  https_endpoint: null,
  api_version: '1',
  capabilities: ['health'],
  metadata: {
    connect_package_version: 2,
    installation_npub: 'npub1installation',
    health_path: '/api/owners/npub1owner/control-plane/v1/health',
    agents_path: '/api/owners/npub1owner/control-plane/v1/agents',
  },
};

const verified = {
  version: 2,
  installationId: 'installation-one',
  installationNpub: 'npub1installation',
  transportNpub: 'npub1transport',
  fipsEndpoint: 'http://npub1transport.fips:3601',
  httpsEndpoint: null,
  apiVersion: 1,
  capabilities: ['health', 'flightdeck.live-thread-activity.v1'],
  healthPath: '/api/owners/npub1owner/control-plane/v1/health',
  agentsPath: '/api/owners/npub1owner/control-plane/v1/agents',
  controlledRestartPath: null,
  controlledRestartStatusPath: null,
};

describe('installed Autopilot connection refresh', () => {
  it('atomically persists verified public package fields while preserving the connection and agents', async () => {
    const agents = [{ id: 'agent-1', connection_id: connection.id }];
    const installedClient = { health: vi.fn(async () => ({ ok: true })), refreshConnectPackage: vi.fn(async () => verified), disconnect: vi.fn() };
    const refreshedClient = { health: vi.fn(async () => ({ ok: true })), disconnect: vi.fn() };
    const createClient = vi.fn()
      .mockReturnValueOnce(installedClient)
      .mockReturnValueOnce(refreshedClient);
    const persist = vi.fn(async (_store, _workspaceId, payload) => ({
      autopilot_connection: { ...connection, ...payload, id: connection.id },
    }));
    const store = { currentWorkspace: { workspaceId: 'workspace-1' }, backendUrl: 'https://tower.example', workspaceAgents: agents };

    const result = await refreshInstalledAutopilotConnection(store, connection, { createClient, persist });

    expect(result.verified.capabilities).toContain('flightdeck.live-thread-activity.v1');
    expect(persist).toHaveBeenCalledWith(store, 'workspace-1', connection.id, {
      ...verifiedConnectionPayload(verified, connection),
      row_version: connection.row_version,
    }, { baseUrl: store.backendUrl });
    expect(result.connection.id).toBe(connection.id);
    expect(store.workspaceAgents).toBe(agents);
    expect(installedClient.health).toHaveBeenCalledBefore(installedClient.refreshConnectPackage);
    expect(refreshedClient.health).toHaveBeenCalledOnce();
  });

  it('rejects a Tower response that changes the installation or transport identity', async () => {
    const installedClient = { health: vi.fn(), refreshConnectPackage: vi.fn(async () => verified), disconnect: vi.fn() };
    const refreshedClient = { health: vi.fn(), disconnect: vi.fn() };
    const createClient = vi.fn().mockReturnValueOnce(installedClient).mockReturnValueOnce(refreshedClient);
    const persist = vi.fn(async () => ({ autopilot_connection: { ...connection, id: 'replacement-connection' } }));

    await expect(refreshInstalledAutopilotConnection({ currentWorkspace: { workspaceId: 'workspace-1' } }, connection, { createClient, persist }))
      .rejects.toThrow('preserve the installed Autopilot connection identity');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const client = vi.hoisted(() => ({ controlledRestart: vi.fn(), controlledRestartStatus: vi.fn(), readAgent: vi.fn(), refreshConnectPackage: vi.fn(), health: vi.fn(), disconnect: vi.fn() }));
const commands = vi.hoisted(() => ({ createTowerPgAutopilotConnection: vi.fn(), updateTowerPgAutopilotConnection: vi.fn(), createTowerPgWorkspaceAgent: vi.fn() }));
vi.mock('../src/autopilot-connect-client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createAutopilotDiscoveryClient: vi.fn(() => client),
}));
vi.mock('../src/tower-command-intents.js', () => commands);

import { agentSpaceManagerMixin } from '../src/agent-space-manager.js';

const transportNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));
const installationNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));

function store() {
  const workspaceAgents = [{ id: 'agent-1', connection_id: 'connection-1', agent_id: 'test-agent', agent_npub: 'npub1testagent', metadata: {} }];
  const agentConnections = [{ id: 'connection-1', row_version: 3, fips_endpoint: `http://${transportNpub}.fips:3601`, fips_transport_npub: transportNpub,
    installation_id: 'installation-one', display_name: 'Primary Autopilot', api_version: '1', capabilities: [], metadata: { installation_npub: installationNpub,
      connect_package_version: 2, health_path: '/api/owners/npub1owner/control-plane/v1/health', agents_path: '/api/owners/npub1owner/control-plane/v1/agents' } }];
  const value = {
    selectedWorkspaceAgentId: 'agent-1',
    workspaceAgents,
    agentConnections, currentWorkspace: { workspaceId: 'workspace-1' }, backendUrl: 'https://tower.example',
  };
  Object.defineProperties(value, Object.getOwnPropertyDescriptors(agentSpaceManagerMixin));
  Object.assign(value, { selectedWorkspaceAgentId: 'agent-1', workspaceAgents,
    agentConnections, currentWorkspace: { workspaceId: 'workspace-1' }, backendUrl: 'https://tower.example', controlledRestartConnectionId: 'connection-1', controlledRestartAvailability: 'available', controlledRestartConfirmOpen: true, controlledRestartBusy: false,
    controlledRestartStatus: null, controlledRestartError: '', _verifiedControlledRestartPackages: new Map([['connection-1', { capabilities: ['system.controlled-restart.v1'] }]]) });
  return value;
}

describe('Agents controlled restart UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.readAgent.mockResolvedValue({ agent: {} });
    client.health.mockResolvedValue({ ok: true });
    client.disconnect.mockResolvedValue();
    client.refreshConnectPackage.mockResolvedValue({
      version: 2, installationId: 'installation-one', installationNpub, transportNpub,
      fipsEndpoint: `http://${transportNpub}.fips:3601`, httpsEndpoint: null, apiVersion: 1,
      capabilities: ['system.controlled-restart.v1'], healthPath: '/api/owners/npub1owner/control-plane/v1/health',
      agentsPath: '/api/owners/npub1owner/control-plane/v1/agents', controlledRestartPath: '/api/system/controlled-restart', controlledRestartStatusPath: '/api/system/controlled-restart/status',
    });
    commands.updateTowerPgAutopilotConnection.mockImplementation(async (_storeValue, _workspaceId, connectionId, body) => ({
      autopilot_connection: { id: connectionId, ...body },
    }));
  });

  it('keeps a stale connection visible and enables restart only after verified capability refresh', async () => {
    const subject = store();
    subject.controlledRestartAvailability = 'idle';
    subject.controlledRestartConnectionId = '';
    expect(subject.controlledRestartConnections).toHaveLength(1);
    expect(subject.controlledRestartCanSubmit).toBe(false);
    await subject.initializeControlledRestartLifecycle();
    expect(client.refreshConnectPackage).toHaveBeenCalledOnce();
    expect(commands.updateTowerPgAutopilotConnection).toHaveBeenCalledWith(subject, 'workspace-1', 'connection-1', expect.objectContaining({
      installation_id: 'installation-one', capabilities: expect.arrayContaining(['system.controlled-restart.v1']),
    }), { baseUrl: 'https://tower.example' });
    expect(subject.controlledRestartAvailabilityMessage).toBe('Controlled restart is available. The destructive request still requires your browser admin signature.');
    expect(subject.controlledRestartAvailability).toBe('available');
    expect(subject.controlledRestartCanSubmit).toBe(true);
  });

  it('requires an explicit target when multiple Autopilot installations exist', async () => {
    const subject = store();
    subject.agentConnections = [...subject.agentConnections, { ...subject.agentConnections[0], id: 'connection-2', installation_id: 'installation-two' }];
    subject.controlledRestartConnectionId = '';
    subject.controlledRestartAvailability = 'idle';
    await subject.initializeControlledRestartLifecycle();
    expect(subject.controlledRestartAvailability).toBe('selection_required');
    expect(subject.controlledRestartCanSubmit).toBe(false);
    expect(client.refreshConnectPackage).not.toHaveBeenCalled();
  });

  it('shows signer absence and does not claim restart progress', async () => {
    client.controlledRestart.mockRejectedValue(Object.assign(new Error('Browser signer unavailable'), { code: 'signer_unavailable' }));
    const subject = store();
    await subject.requestControlledRestart();
    expect(subject.controlledRestartError).toContain('Browser signer unavailable');
    expect(client.controlledRestartStatus).not.toHaveBeenCalled();
    expect(subject.controlledRestartStatus).toBeNull();
  });

  it('resumes status after an ambiguous pre-ack disconnect', async () => {
    client.controlledRestart.mockRejectedValue(Object.assign(new Error('Disconnected'), { code: 'fips_request_failed' }));
    client.controlledRestartStatus.mockResolvedValue({ inProgress: false, operation: { status: 'partial', counts: { forced: 1 },
      sessions: [{ recoveryStatus: 'failed' }], failure: null } });
    const subject = store();
    await subject.requestControlledRestart();
    expect(client.controlledRestartStatus).toHaveBeenCalledOnce();
    expect(subject.controlledRestartError).toBe('');
    expect(subject.controlledRestartConfirmOpen).toBe(false);
    expect(subject.controlledRestartStatusLabel).toContain('1 recovery failure(s), 1 forced stop(s)');
  });

  it('reports failed and completed final outcomes', () => {
    const subject = store();
    subject.controlledRestartStatus = { operation: { status: 'failed', failure: { phase: 'checkpointed', message: 'disk full' } } };
    expect(subject.controlledRestartStatusLabel).toBe('Restart failed during checkpointed: disk full');
    subject.controlledRestartStatus = { operation: { status: 'complete', counts: { eligible: 3 } } };
    expect(subject.controlledRestartStatusLabel).toBe('Restart complete: 3 eligible session(s) recovered.');
  });

  it('loads persisted status after the top-level Agents lifecycle refresh', async () => {
    client.controlledRestartStatus.mockResolvedValue({ inProgress: false, operation: { status: 'complete', counts: { eligible: 2 } } });
    const subject = store();
    await subject.refreshControlledRestartAvailability();
    await vi.waitFor(() => expect(client.controlledRestartStatus).toHaveBeenCalledOnce());
    expect(subject.controlledRestartStatus?.operation?.status).toBe('complete');
  });
});

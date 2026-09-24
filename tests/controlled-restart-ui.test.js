import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const client = vi.hoisted(() => ({ controlledRestart: vi.fn(), controlledRestartStatus: vi.fn(), readAgent: vi.fn() }));
vi.mock('../src/autopilot-connect-client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createAutopilotDiscoveryClient: vi.fn(() => client),
}));

import { agentSpaceManagerMixin } from '../src/agent-space-manager.js';

function store() {
  const transportNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));
  const installationNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));
  const workspaceAgents = [{ id: 'agent-1', connection_id: 'connection-1', agent_id: 'rick', agent_npub: 'npub1rick', metadata: {} }];
  const agentConnections = [{ id: 'connection-1', fips_endpoint: `http://${transportNpub}.fips:3601`, fips_transport_npub: transportNpub,
    api_version: '1', capabilities: ['system.controlled-restart.v1'], metadata: { installation_npub: installationNpub,
      controlled_restart_path: '/api/system/controlled-restart', controlled_restart_status_path: '/api/system/controlled-restart/status' } }];
  const value = {
    selectedWorkspaceAgentId: 'agent-1',
    workspaceAgents,
    agentConnections,
  };
  Object.defineProperties(value, Object.getOwnPropertyDescriptors(agentSpaceManagerMixin));
  Object.assign(value, { selectedWorkspaceAgentId: 'agent-1', workspaceAgents,
    agentConnections, controlledRestartConfirmOpen: true, controlledRestartBusy: false,
    controlledRestartStatus: null, controlledRestartError: '' });
  return value;
}

describe('Agents controlled restart UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.readAgent.mockResolvedValue({ agent: {} });
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

  it('loads persisted status when the Agents view is reopened', async () => {
    client.controlledRestartStatus.mockResolvedValue({ inProgress: false, operation: { status: 'complete', counts: { eligible: 2 } } });
    const subject = store();
    subject.selectAgentSpaceView = vi.fn(async () => {});
    await subject.openAgentSpace('agent-1');
    await vi.waitFor(() => expect(client.controlledRestartStatus).toHaveBeenCalledOnce());
    expect(subject.controlledRestartStatus?.operation?.status).toBe('complete');
  });
});

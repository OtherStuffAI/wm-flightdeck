import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/tower-command-intents.js', () => ({
  createTowerPgWappDelegation: vi.fn(async () => ({ delegation: { id: 'delegation-1' } })),
  createTowerPgWappInstallIntent: vi.fn(async () => ({ intent: { id: 'intent-1', status: 'pending' } })),
  getTowerPgManagedWappInstallations: vi.fn(async () => ({ installations: [{ wapp_installation_id: 'install-1', lifecycle_status: 'active' }] })),
  getTowerPgWappDelegations: vi.fn(async () => ({ delegations: [{ id: 'delegation-1' }] })),
  getTowerPgWappInstallIntents: vi.fn(async () => ({ intents: [{ id: 'intent-1', status: 'pending' }] })),
  reconcileTowerPgManagedWappInstallation: vi.fn(async () => ({})),
  revokeTowerPgManagedWappInstallation: vi.fn(async () => ({})),
  revokeTowerPgWappDelegation: vi.fn(async () => ({})),
}));

vi.mock('../src/wapp-autopilot-service.js', () => ({
  claimAutopilotWappInstallIntent: vi.fn(async () => ({})),
  loadAutopilotWappActivationCatalog: vi.fn(async () => ({ apps: [] })),
}));

import { createTowerPgWappDelegation, createTowerPgWappInstallIntent } from '../src/tower-command-intents.js';
import { capabilityPreview, delegationStatus, wappManagementManagerMixin } from '../src/wapp-management-manager.js';

function store(overrides = {}) { return Object.assign(Object.create(wappManagementManagerMixin), { isTowerPgMode: true, canAdminWorkspace: true, currentWorkspace: { workspaceId: 'workspace-1' }, pgWorkspaceMembers: [{ actor_id: 'testagent', display_name: 'Test Agent' }], ...overrides }); }

describe('WApp management manager', () => {
  beforeEach(() => vi.clearAllMocks());
  it('distinguishes active, expired, and revoked grants', () => {
    expect(delegationStatus({ expires_at: '2099-01-01T00:00:00Z' }, 0)).toBe('active');
    expect(delegationStatus({ expires_at: '2020-01-01T00:00:00Z' }, Date.now())).toBe('expired');
    expect(delegationStatus({ revoked_at: '2020-01-01T00:00:00Z' })).toBe('revoked');
  });
  it('previews narrow authority and explicit exclusions', () => {
    const preview = capabilityPreview({ delegateName: 'Test Agent', filters: { app_ids: ['book-of-sand'], installation_ids: [], scope_ids: [], channel_ids: [], capabilities: ['activity.publish'], open_origins: ['https://stories.example'] }, expiresAt: 'tomorrow' });
    expect(preview).toContain('Test Agent can assign and manage book-of-sand');
    expect(preview).toContain('does not grant workspace admin');
    expect(preview).toContain('https://stories.example');
  });
  it('submits the exact supported delegation filter shape without a private key', async () => {
    const target = store(); target.openWappDelegationEditor('testagent'); Object.assign(target.wappDelegationDraft, { app_ids: 'book-of-sand', open_origins: 'https://stories.example', autopilot_origins: 'https://wingman.example' });
    await target.saveWappDelegation();
    const body = createTowerPgWappDelegation.mock.calls[0][2];
    expect(body.delegate_actor_id).toBe('testagent');
    expect(body.filters).toEqual(expect.objectContaining({ app_ids: ['book-of-sand'], capabilities: ['activity.publish'], open_origins: ['https://stories.example'], autopilot_origins: ['https://wingman.example'] }));
    expect(JSON.stringify(body)).not.toMatch(/nsec|private.key/i);
  });
  it('creates a Feed-only existing-app intent with no channel destination', async () => {
    const target = store(); target.openWappInstallEditor(); Object.assign(target.wappInstallDraft, { app_id: 'book-of-sand', app_version: '1.0.0', title: 'Book of Sand', launch_url: 'https://stories.example/?story=one', autopilot_origin: 'https://wingman.example', open_origins: 'https://stories.example' });
    await target.createWappInstallIntent();
    expect(createTowerPgWappInstallIntent.mock.calls[0][2]).toEqual(expect.objectContaining({ app_id: 'book-of-sand', capabilities: ['activity.publish'], destinations: [], registered_open_origins: ['https://stories.example'] }));
  });
});

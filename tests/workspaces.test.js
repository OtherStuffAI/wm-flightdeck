import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceKey,
  findWorkspaceByKey,
  mergeWorkspaceEntries,
  normalizeWorkspaceEntry,
  workspaceFromToken,
} from '../src/workspaces.js';

describe('workspace identity keys', () => {
  it('prefers service_npub when building workspace keys', () => {
    expect(buildWorkspaceKey({
      workspaceOwnerNpub: 'npub1workspace',
      serviceNpub: 'npub1service',
      directHttpsUrl: 'https://sb.example',
    })).toBe('service:npub1service::workspace:npub1workspace');
  });

  it('falls back to url-scoped keys when service_npub is missing', () => {
    expect(buildWorkspaceKey({
      workspaceOwnerNpub: 'npub1workspace',
      directHttpsUrl: 'https://sb.example/',
    })).toBe('url:https://sb.example::workspace:npub1workspace');
  });
});

describe('workspace entry normalization', () => {
  it('keeps missing names empty so placeholders stay render-only', () => {
    const workspace = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1workspace',
    });

    expect(workspace).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      name: '',
      description: '',
      avatarUrl: null,
    });
  });

  it('accepts workspace profile fields from snake_case payloads', () => {
    const workspace = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1workspace',
      workspace_name: 'Example Workspace',
      workspace_description: 'Workspace profile',
      workspace_avatar_url: 'storage://avatar-1',
      admin_group_id: 'admin-group-1',
      admin_group_npub: 'npub1admin',
    });

    expect(workspace).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Example Workspace',
      description: 'Workspace profile',
      avatarUrl: 'storage://avatar-1',
      adminGroupId: 'admin-group-1',
      adminGroupNpub: 'npub1admin',
    });
  });

  it('recovers backend metadata from a saved connection token', () => {
    const token = btoa(JSON.stringify({
      type: 'superbased_connection',
      version: 2,
      direct_https_url: 'https://tower.example.com',
      service_npub: 'npub1service',
      tower_name: 'Family Tower',
      tower_description: 'Private family workspace host',
      workspace_owner_npub: 'npub1workspace',
      app_npub: 'npub1app',
      relays: ['wss://relay.example'],
    }));

    const workspace = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1workspace',
      connection_token: token,
    });

    expect(workspace).toMatchObject({
      workspaceKey: 'service:npub1service::workspace:npub1workspace',
      workspaceOwnerNpub: 'npub1workspace',
      directHttpsUrl: 'https://tower.example.com',
      serviceNpub: 'npub1service',
      towerName: 'Family Tower',
      towerDescription: 'Private family workspace host',
      appNpub: 'npub1app',
      relayUrls: ['wss://relay.example'],
      connectionToken: token,
    });
  });

  it('preserves existing metadata when incoming workspace payloads are partial', () => {
    const existing = [{
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Example Workspace',
      description: 'Main workspace',
      avatarUrl: 'storage://avatar-1',
      dashboardGreetingTemplate: 'Remember $user.name,\\nYou can just do things?',
      directHttpsUrl: 'https://sb.example',
      serviceNpub: 'npub1service',
      appNpub: 'npub1app',
      relayUrls: ['wss://relay.example'],
      connectionToken: 'token-1',
    }];

    const merged = mergeWorkspaceEntries(existing, [{
      workspace_owner_npub: 'npub1workspace',
      direct_https_url: 'https://tower.example',
    }]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Example Workspace',
      description: 'Main workspace',
      avatarUrl: 'storage://avatar-1',
      dashboardGreetingTemplate: 'Remember $user.name,\\nYou can just do things?',
      directHttpsUrl: 'https://tower.example',
    });
  });

  it('accepts dashboard greeting templates from snake_case payloads', () => {
    const workspace = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1workspace',
      workspace_name: 'Example Workspace',
      dashboard_greeting_template: 'Welcome $user.name,\\nwhere next?',
    });

    expect(workspace).toMatchObject({
      dashboardGreetingTemplate: 'Welcome $user.name,\\nwhere next?',
    });
  });

  it('stores workspace metadata objects from Tower PG payloads', () => {
    const workspace = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1workspace',
      workspace_id: 'workspace-1',
      service_npub: 'npub1tower',
      direct_https_url: 'https://tower.example',
      metadata: {
        wingman_harness_url: 'https://agent.example.invalid',
        wingman_harness_agent_npub: 'npub1lycg5qvjtrp3qjf5f7zl382j9x6nrjz9sdhenvyxq8c3808qxmus6gq266',
      },
    });

    expect(workspace).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      workspaceId: 'workspace-1',
      metadata: {
        wingman_harness_url: 'https://agent.example.invalid',
        wingman_harness_agent_npub: 'npub1lycg5qvjtrp3qjf5f7zl382j9x6nrjz9sdhenvyxq8c3808qxmus6gq266',
      },
    });
  });

  it('keeps distinct entries for the same workspace pubkey on different services', () => {
    const merged = mergeWorkspaceEntries([], [
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://tower.example.invalid',
        service_npub: 'npub1servicea',
        name: 'Example Workspace',
      },
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://tower.example.com',
        service_npub: 'npub1serviceb',
        name: 'Example Workspace',
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.workspaceKey).sort()).toEqual([
      'service:npub1servicea::workspace:npub1workspace',
      'service:npub1serviceb::workspace:npub1workspace',
    ]);
  });

  it('keeps distinct legacy entries for the same workspace pubkey when neither side has a service key', () => {
    const merged = mergeWorkspaceEntries([], [
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://tower.example.invalid',
        name: 'Example Workspace',
      },
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://tower.example.com',
        name: 'Example Workspace',
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.workspaceKey).sort()).toEqual([
      'url:https://tower.example.com::workspace:npub1workspace',
      'url:https://tower.example.invalid::workspace:npub1workspace',
    ]);
  });

  it('finds a workspace by composite workspace key', () => {
    const workspaces = mergeWorkspaceEntries([], [
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://tower.example.invalid',
        service_npub: 'npub1servicea',
      },
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://tower.example.com',
        service_npub: 'npub1serviceb',
      },
    ]);

    const found = findWorkspaceByKey(workspaces, 'service:npub1serviceb::workspace:npub1workspace');
    expect(found?.directHttpsUrl).toBe('https://tower.example.com');
  });

  it('applies explicit clears from workspace settings payloads without wiping other fields', () => {
    const existing = [{
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Example Workspace',
      description: 'Main workspace',
      avatarUrl: 'storage://avatar-1',
      directHttpsUrl: 'https://sb.example',
      serviceNpub: 'npub1service',
      appNpub: 'npub1app',
      relayUrls: ['wss://relay.example'],
      connectionToken: 'token-1',
    }];

    const merged = mergeWorkspaceEntries(existing, [{
      workspace_owner_npub: 'npub1workspace',
      workspace_description: '',
      workspace_avatar_url: null,
    }]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Example Workspace',
      description: '',
      avatarUrl: null,
      directHttpsUrl: 'https://sb.example',
    });
  });

  it('does not let sparse workspace refreshes erase an existing avatar', () => {
    const existing = [{
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Example Workspace',
      description: 'Main workspace',
      avatarUrl: 'storage://avatar-1',
      directHttpsUrl: 'https://sb.example',
      serviceNpub: 'npub1service',
      appNpub: 'npub1app',
    }];

    const merged = mergeWorkspaceEntries(existing, [{
      workspace_owner_npub: 'npub1workspace',
      service_npub: 'npub1service',
      avatarUrl: undefined,
      name: 'Example Workspace',
    }]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      avatarUrl: 'storage://avatar-1',
    });
  });

  it('does not let token-derived workspace metadata erase an existing workspace name', () => {
    const existing = [{
      workspaceOwnerNpub: 'npub1workspaceowner',
      name: 'Named workspace',
      directHttpsUrl: 'https://sb.example',
      serviceNpub: 'npub1service',
      appNpub: 'npub1app',
      relayUrls: [],
      connectionToken: 'token-1',
    }];

    const token = btoa(JSON.stringify({
      kind: 30078,
      pubkey: 'f'.repeat(64),
      sig: 'sig',
      tags: [
        ['d', 'superbased-token'],
        ['service_npub', 'npub1service'],
        ['workspace_owner', 'npub1workspaceowner'],
        ['app_npub', 'npub1app'],
        ['backend_url', 'https://sb.example'],
      ],
    }));
    const tokenWorkspace = workspaceFromToken(token);

    const merged = mergeWorkspaceEntries(existing, [tokenWorkspace]);

    expect(merged[0]).toMatchObject({
      workspaceOwnerNpub: 'npub1workspaceowner',
      name: 'Named workspace',
      directHttpsUrl: 'https://sb.example',
      connectionToken: token,
    });
  });

  it('uses the workspace name embedded in a token when present', () => {
    const token = btoa(JSON.stringify({
      kind: 30078,
      pubkey: 'f'.repeat(64),
      sig: 'sig',
      tags: [
        ['d', 'superbased-token'],
        ['service_npub', 'npub1service'],
        ['workspace_owner', 'npub1workspaceowner'],
        ['workspace_name', 'Example Workspace'],
        ['app_npub', 'npub1app'],
        ['backend_url', 'https://sb.example'],
      ],
    }));

    expect(workspaceFromToken(token)).toMatchObject({
      workspaceOwnerNpub: 'npub1workspaceowner',
      name: 'Example Workspace',
      directHttpsUrl: 'https://sb.example',
    });
  });

  it('preserves tower discovery metadata from tokens on workspace entries', () => {
    const token = btoa(JSON.stringify({
      type: 'superbased_connection',
      version: 2,
      direct_https_url: 'https://sb.example',
      service_npub: 'npub1service',
      tower_name: 'Family Tower',
      tower_description: 'Private family workspace host',
      workspace_owner_npub: 'npub1workspaceowner',
      app_npub: 'npub1app',
    }));

    expect(workspaceFromToken(token)).toMatchObject({
      workspaceOwnerNpub: 'npub1workspaceowner',
      directHttpsUrl: 'https://sb.example',
      serviceNpub: 'npub1service',
      towerName: 'Family Tower',
      towerDescription: 'Private family workspace host',
      connectionToken: token,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  bootstrapWorkspaceSessionKeyMock,
  markCachedWorkspaceKeyRegisteredMock,
  markWorkspaceKeyRegisteredMock,
  registerWorkspaceKeyMock,
} = vi.hoisted(() => ({
  bootstrapWorkspaceSessionKeyMock: vi.fn(),
  markCachedWorkspaceKeyRegisteredMock: vi.fn(),
  markWorkspaceKeyRegisteredMock: vi.fn(),
  registerWorkspaceKeyMock: vi.fn(),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  bootstrapWorkspaceSessionKey: bootstrapWorkspaceSessionKeyMock,
  clearActiveWorkspaceKey: vi.fn(),
  getActiveWorkspaceKeyNpub: vi.fn(() => null),
  markCachedWorkspaceKeyRegistered: markCachedWorkspaceKeyRegisteredMock,
  markWorkspaceKeyRegistered: markWorkspaceKeyRegisteredMock,
}));

vi.mock('../src/api.js', () => ({
  registerWorkspaceKey: registerWorkspaceKeyMock,
  setBaseUrl: vi.fn(),
}));

import { createShellState } from '../src/shell-state.js';

describe('PG workspace signer bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not retry workspace-key registration when descriptor verification removed the selection', async () => {
    const shell = createShellState();
    const staleWorkspace = {
      workspaceKey: 'pg:stale',
      workspaceOwnerNpub: 'npub1operator-a',
      workspaceServiceNpub: 'npub1stale',
      pgBackendMode: true,
    };
    Object.defineProperty(shell, 'currentWorkspace', {
      configurable: true,
      value: staleWorkspace,
    });
    shell.selectedWorkspaceKey = staleWorkspace.workspaceKey;
    shell.currentWorkspaceOwnerNpub = staleWorkspace.workspaceOwnerNpub;
    shell.session = { npub: 'npub1operator-a', method: 'extension' };
    shell.ensurePgWorkspaceAvailable = vi.fn().mockResolvedValue(null);

    await shell.bootstrapSelectedWorkspace();

    expect(shell.ensurePgWorkspaceAvailable).toHaveBeenCalledWith(staleWorkspace);
    expect(bootstrapWorkspaceSessionKeyMock).not.toHaveBeenCalled();
    expect(registerWorkspaceKeyMock).not.toHaveBeenCalled();
  });

  it('registers the workspace service key before PG storage reads can render', async () => {
    const workspaceKey = {
      npub: 'npub1delegatedworkspacekey',
      workspaceServiceNpub: 'npub1workspaceservice',
      userNpub: 'npub1operator-a',
    };
    bootstrapWorkspaceSessionKeyMock.mockImplementationOnce(async (options) => {
      await options.onRegister({ ws_key_npub: workspaceKey.npub }, workspaceKey);
      return workspaceKey;
    });
    registerWorkspaceKeyMock.mockResolvedValueOnce({ ok: true });
    markCachedWorkspaceKeyRegisteredMock.mockResolvedValueOnce(undefined);
    const shell = createShellState();
    Object.defineProperty(shell, 'currentWorkspace', {
      configurable: true,
      value: {
        workspaceOwnerNpub: 'npub1operator-a',
        workspaceServiceNpub: 'npub1workspaceservice',
        pgBackendMode: true,
      },
    });
    shell.currentWorkspaceOwnerNpub = 'npub1operator-a';
    shell.backendUrl = 'https://workspace-tower.example';
    shell.session = { npub: 'npub1operator-a', method: 'extension' };

    await expect(shell.ensureWorkspaceSessionKey()).resolves.toBe(workspaceKey);

    expect(bootstrapWorkspaceSessionKeyMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceOwnerNpub: 'npub1workspaceservice',
      userNpub: 'npub1operator-a',
    }));
    expect(registerWorkspaceKeyMock).toHaveBeenCalledWith({
      workspace_owner_npub: 'npub1workspaceservice',
      ws_key_npub: 'npub1delegatedworkspacekey',
    });
    expect(markWorkspaceKeyRegisteredMock).toHaveBeenCalled();
    expect(markCachedWorkspaceKeyRegisteredMock).toHaveBeenCalledWith('npub1workspaceservice');
  });
});

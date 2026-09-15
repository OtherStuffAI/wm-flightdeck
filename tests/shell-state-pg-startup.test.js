import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSettings = vi.fn();
const setBaseUrl = vi.fn();
const tryAutoLoginFromStorage = vi.fn();
const pubkeyToNpub = vi.fn();
const setActiveSessionNpub = vi.fn();
const isTowerPgBackendMode = vi.fn(() => true);

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode,
}));

vi.mock('../src/version-check.js', () => ({
  getRunningBuildId: vi.fn(() => 'test-build'),
}));

vi.mock('../src/db.js', () => ({
  getSettings,
  hasWorkspaceDb: vi.fn(() => false),
  clearRuntimeData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/api.js', () => ({
  registerWorkspaceKey: vi.fn().mockResolvedValue(undefined),
  setBaseUrl,
}));

vi.mock('../src/auth/nostr.js', () => ({
  signLoginEvent: vi.fn(),
  getPubkeyFromEvent: vi.fn(),
  pubkeyToNpub,
  tryAutoLoginFromStorage,
  clearAutoLogin: vi.fn(),
  setAutoLogin: vi.fn(),
  hasExtensionSigner: vi.fn(() => true),
  waitForExtensionSigner: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  setActiveSessionNpub,
  clearCryptoContext: vi.fn(),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  bootstrapWorkspaceSessionKey: vi.fn().mockResolvedValue(null),
  clearActiveWorkspaceKey: vi.fn(),
  getActiveWorkspaceKey: vi.fn(() => null),
  getActiveWorkspaceKeyNpub: vi.fn(() => ''),
  markCachedWorkspaceKeyRegistered: vi.fn().mockResolvedValue(undefined),
  markWorkspaceKeyRegistered: vi.fn(),
}));

vi.mock('../src/workspace-manager.js', () => ({
  guessDefaultBackendUrl: vi.fn(() => 'https://default.example'),
}));

function installWindow() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = {
    location: { href: 'https://flightdeck.example/flight-deck' },
    history: { replaceState: vi.fn(), pushState: vi.fn(), state: null },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  globalThis.document = {
    title: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return () => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  };
}

function attachStartupStubs(shell) {
  shell.startExtensionSignerWatch = vi.fn();
  shell.initCommandPaletteShortcuts = vi.fn();
  shell.initDocCommentConnector = vi.fn();
  shell.startSharedLiveQueries = vi.fn();
  shell.loadTowerTransportSettings = vi.fn();
  shell.resolveChatProfile = vi.fn();
  shell.rememberPeople = vi.fn().mockResolvedValue(undefined);
  shell.filterKnownWorkspacesForActiveSession = vi.fn();
  shell.discoverPgOnboardingAnnouncements = vi.fn().mockResolvedValue(undefined);
  shell.discoverPgWorkspaceSelfIndex = vi.fn().mockResolvedValue(undefined);
  shell.updateWorkspaceBootstrapPrompt = vi.fn();
  shell.openConnectModal = vi.fn();
  shell.hydrateKnownWorkspaceProfiles = vi.fn().mockResolvedValue(undefined);
  shell.loadRemoteWorkspaces = vi.fn().mockResolvedValue([]);
  shell.prepareWorkspaceAccessGate = vi.fn(() => false);
  shell.tryRecoverWorkspace = vi.fn().mockResolvedValue(undefined);
  shell.ensureBackgroundSync = vi.fn();
}

async function flushStartupTail() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('shell PG startup restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTowerPgBackendMode.mockReturnValue(true);
    tryAutoLoginFromStorage.mockResolvedValue({ pubkey: 'user-pubkey', method: 'extension' });
    pubkeyToNpub.mockResolvedValue('npub1user');
  });

  it('waits for auto-login before selecting and bootstrapping a saved PG workspace', async () => {
    const restoreGlobals = installWindow();
    try {
      const { createShellState } = await import('../src/shell-state.js');
      const workspace = {
        workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg::id:workspace-1',
        workspaceOwnerNpub: 'npub1owner',
        workspaceServiceNpub: 'npub1workspace',
        towerServiceNpub: 'npub1tower',
        workspaceId: 'workspace-1',
        appNpub: 'flightdeck_pg',
        pgSessionNpub: 'npub1user',
        pgBackendMode: true,
        directHttpsUrl: 'https://tower.example',
      };
      getSettings.mockResolvedValue({
        backendUrl: 'https://tower.example',
        currentWorkspaceKey: workspace.workspaceKey,
        currentWorkspaceOwnerNpub: workspace.workspaceOwnerNpub,
        knownWorkspaces: [workspace],
      });
      const shell = createShellState();
      attachStartupStubs(shell);
      const selectSessions = [];
      const bootstrapSessions = [];
      shell.selectWorkspace = vi.fn(async function selectWorkspace() {
        selectSessions.push(this.session?.npub || '');
      });
      shell.bootstrapSelectedWorkspace = vi.fn(async function bootstrapSelectedWorkspace() {
        bootstrapSessions.push(this.session?.npub || '');
      });

      await shell.init();
      await flushStartupTail();

      expect(tryAutoLoginFromStorage).toHaveBeenCalled();
      expect(selectSessions).toEqual(['npub1user', 'npub1user']);
      expect(bootstrapSessions).toEqual(['npub1user', 'npub1user']);
      expect(selectSessions).not.toContain('');
      expect(setActiveSessionNpub).toHaveBeenCalledWith('npub1user');
    } finally {
      restoreGlobals();
    }
  });

  it('does not select a saved PG workspace when refresh has no restored signer session', async () => {
    const restoreGlobals = installWindow();
    try {
      const { createShellState } = await import('../src/shell-state.js');
      const workspace = {
        workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg::id:workspace-1',
        workspaceOwnerNpub: 'npub1owner',
        workspaceServiceNpub: 'npub1workspace',
        towerServiceNpub: 'npub1tower',
        workspaceId: 'workspace-1',
        appNpub: 'flightdeck_pg',
        pgSessionNpub: 'npub1user',
        pgBackendMode: true,
        directHttpsUrl: 'https://tower.example',
      };
      getSettings.mockResolvedValue({
        backendUrl: 'https://tower.example',
        currentWorkspaceKey: workspace.workspaceKey,
        currentWorkspaceOwnerNpub: workspace.workspaceOwnerNpub,
        knownWorkspaces: [workspace],
      });
      tryAutoLoginFromStorage.mockResolvedValue(null);
      const shell = createShellState();
      attachStartupStubs(shell);
      shell.selectWorkspace = vi.fn();
      shell.bootstrapSelectedWorkspace = vi.fn();

      await shell.init();
      await flushStartupTail();

      expect(shell.selectWorkspace).not.toHaveBeenCalled();
      expect(shell.bootstrapSelectedWorkspace).not.toHaveBeenCalled();
    } finally {
      restoreGlobals();
    }
  });
});

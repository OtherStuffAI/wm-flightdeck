import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyWorkspaceRecoveryMixin } from '../src/legacy-workspace-recovery-manager.js';
import { checkLegacyWorkspaceRecovery } from '../src/legacy-workspace-recovery-client.js';
vi.mock('../src/legacy-workspace-recovery-client.js', () => ({ checkLegacyWorkspaceRecovery: vi.fn() }));
let saved;
const workspace = key => ({ workspaceKey: key });
function store(key = 'pg:signer::id:alpha') {
  return { ...legacyWorkspaceRecoveryMixin, currentWorkspaceKey: key, _workspaceSelectionGeneration: 1,
    isTowerPgMode: true, performTowerPgFullSync: vi.fn(async () => ({ pgMode: true })) };
}
beforeEach(() => {
  saved = new Map();
  vi.stubGlobal('localStorage', { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) });
  vi.mocked(checkLegacyWorkspaceRecovery).mockReset().mockResolvedValue({ status: 'required' });
});
afterEach(() => vi.unstubAllGlobals());

describe('avatar recovery choices', () => {
  it('remembers dismissal on reload without applying it to another workspace or signer', async () => {
    const first = store();
    await first.refreshLegacyWorkspaceRecovery(workspace(first.currentWorkspaceKey));
    first.dismissLegacyWorkspaceRecovery();
    const reopened = store();
    await reopened.refreshLegacyWorkspaceRecovery(workspace(reopened.currentWorkspaceKey));
    expect(reopened.legacyWorkspaceRecoveryDismissed).toBe(true);
    expect(reopened.legacyWorkspaceRecoveryNotice).toContain('unsynced edits');
    for (const key of ['pg:signer::id:beta', 'pg:other::id:alpha']) {
      const other = store(key);
      await other.refreshLegacyWorkspaceRecovery(workspace(key));
      expect(other.legacyWorkspaceRecoveryDismissed).toBe(false);
    }
  });
  it('uses Tower only after a successful refresh and retires the legacy prompt on reload', async () => {
    const first = store();
    await first.useTowerForLegacyRecovery();
    expect(first.performTowerPgFullSync).toHaveBeenCalledWith({ manual: true });
    const reopened = store();
    await reopened.refreshLegacyWorkspaceRecovery(workspace(reopened.currentWorkspaceKey));
    expect(checkLegacyWorkspaceRecovery).not.toHaveBeenCalled();
    expect(reopened.legacyWorkspaceRecoveryNotice).toBe('');
  });
  it.each(['offline', 'unconfigured'])('does not retire recovery after %s sync', async failure => {
    const current = store();
    current.performTowerPgFullSync = vi.fn(async () => {
      if (failure === 'offline') throw new Error('Offline');
      return { pushed: 0, pulled: 0 };
    });
    await current.useTowerForLegacyRecovery();
    expect(saved.size).toBe(0);
    expect(current.legacyWorkspaceRecoveryError).not.toBe('');
  });
  it('does not resolve a different workspace when selection changes during sync', async () => {
    const current = store();
    let finish;
    current.performTowerPgFullSync = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const running = current.useTowerForLegacyRecovery();
    await current.useTowerForLegacyRecovery();
    expect(current.performTowerPgFullSync).toHaveBeenCalledTimes(1);
    current.currentWorkspaceKey = 'pg:signer::id:beta';
    current._workspaceSelectionGeneration++;
    finish({ pgMode: true });
    await running;
    expect(saved.size).toBe(0);
    expect(current.legacyWorkspaceRecoveryBusy).toBe(false);
  });
  it('ignores inspection finishing after choosing Tower', async () => {
    let finish;
    vi.mocked(checkLegacyWorkspaceRecovery).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const current = store();
    const inspection = current.refreshLegacyWorkspaceRecovery(workspace(current.currentWorkspaceKey));
    await current.useTowerForLegacyRecovery();
    finish({ status: 'required' });
    await inspection;
    expect(current.legacyWorkspaceRecoveryNotice).toBe('');
  });
  it('allows session dismissal when browser preference storage fails', () => {
    vi.stubGlobal('localStorage', { setItem() { throw new Error('Quota exceeded'); } });
    const current = store();
    current.dismissLegacyWorkspaceRecovery();
    expect(current.legacyWorkspaceRecoveryDismissed).toBe(true);
    expect(current.legacyWorkspaceRecoveryError).toContain('could not save');
  });
});

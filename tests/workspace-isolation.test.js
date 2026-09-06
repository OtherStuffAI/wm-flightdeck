import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeWorkspaceEntry, mergeWorkspaceEntries, findWorkspaceByKey } from '../src/workspaces.js';
import { openWorkspaceDb, deleteWorkspaceDb, getScopesByOwner, setSyncState, getSyncState } from '../src/db.js';
import { hydrateTowerPgScopes, syncTowerPgWorkspace } from '../src/pg-read-hydrator.js';

const keys = new Set();
function workspace(id, tower = 'npub1tower') {
  const entry = normalizeWorkspaceEntry({
    workspaceId: id, workspaceOwnerNpub: 'npub1owner', workspaceServiceNpub: 'npub1service',
    towerServiceNpub: tower, appNpub: 'flightdeck_pg', pgSessionNpub: 'npub1user',
    pgBackendMode: true, directHttpsUrl: 'https://tower.example', name: 'Same label',
  });
  keys.add(entry.workspaceKey);
  return entry;
}
afterEach(async () => { for (const key of keys) await deleteWorkspaceDb(key); keys.clear(); });

describe('PG workspace isolation', () => {
  it('separates same-owner/service workspaces and backend identities, including restored legacy keys', () => {
    const alpha = workspace('alpha');
    const beta = workspace('beta');
    const other = workspace('alpha', 'npub1othertower');
    const legacyKey = alpha.workspaceKey.replace('::id:alpha', '');
    const restored = normalizeWorkspaceEntry({ ...beta, workspaceKey: legacyKey });
    expect(restored.workspaceKey).toBe(beta.workspaceKey);
    const entries = mergeWorkspaceEntries([alpha], [restored, other]);
    expect(entries).toHaveLength(3);
    expect(findWorkspaceByKey([alpha], legacyKey)).toEqual(alpha);
    expect(findWorkspaceByKey(entries, legacyKey)).toBeNull();
    expect(normalizeWorkspaceEntry(JSON.parse(JSON.stringify(beta)))).toEqual(beta);
  });

  it('opens an empty workspace, rejects delayed old rows, and restores the previous rows and cursor', async () => {
    const alpha = workspace('alpha');
    const beta = workspace('beta');
    const store = { currentWorkspace: alpha, session: { npub: 'npub1user' } };
    openWorkspaceDb(alpha.workspaceKey);
    await hydrateTowerPgScopes(store, { getTowerPgWorkspaceScopes: async () => ({ scopes: [{ id: 'alpha-scope', name: 'Alpha scope' }] }) });
    await setSyncState('test-cursor', 'alpha-cursor');
    let resolve;
    const delayed = hydrateTowerPgScopes(store, { getTowerPgWorkspaceScopes: () => new Promise(r => { resolve = r; }) });
    const rejected = expect(delayed).rejects.toThrow('Workspace changed');
    store.currentWorkspace = beta;
    openWorkspaceDb(beta.workspaceKey);
    expect(await getScopesByOwner('npub1owner')).toEqual([]);
    expect(await getSyncState('test-cursor')).toBeFalsy();
    resolve({ scopes: [{ id: 'late-alpha', name: 'Late Alpha' }] });
    await rejected;
    expect(await getScopesByOwner('npub1owner')).toEqual([]);
    openWorkspaceDb(alpha.workspaceKey);
    expect((await getScopesByOwner('npub1owner')).map(r => r.record_id)).toEqual(['alpha-scope']);
    expect(await getSyncState('test-cursor')).toBe('alpha-cursor');
  });

  it('does not materialize a delayed workspace sync bundle after an away-and-back activation', async () => {
    const alpha = workspace('alpha');
    const store = { currentWorkspace: alpha, _workspaceSelectionGeneration: 1 };
    const materialize = vi.fn();
    await expect(syncTowerPgWorkspace(store, {}, {
      getSyncState: async () => null,
      getTowerPgWorkspaceSync: async () => {
        store._workspaceSelectionGeneration += 2;
        return { cursor: 'old', scopes: [] };
      },
      hydrateTowerPgSyncBundle: materialize,
    })).rejects.toThrow('Workspace changed');
    expect(materialize).not.toHaveBeenCalled();
  });
});

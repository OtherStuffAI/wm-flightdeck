import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legacyWorkspaceDatabaseNames, inspectLegacyWorkspaceRecovery, legacyWorkspaceRecoveryMessage } from '../src/legacy-workspace-recovery.js';
import { checkLegacyWorkspaceRecovery } from '../src/legacy-workspace-recovery-client.js';
import { normalizeWorkspaceEntry } from '../src/workspaces.js';

const alpha = normalizeWorkspaceEntry({ workspaceId: 'alpha', workspaceOwnerNpub: 'owner', workspaceServiceNpub: 'service', towerServiceNpub: 'tower', appNpub: 'app', pgSessionNpub: 'user', pgBackendMode: true });
const beta = normalizeWorkspaceEntry({ ...alpha, workspaceId: 'beta' });
const names = legacyWorkspaceDatabaseNames(alpha);
const opened = [];
async function legacy(name = names[0]) {
  const db = new Dexie(name);
  db.version(1).stores({ pending_writes: '++row_id', tasks: 'record_id', document_drafts: 'draft_key', sync_state: 'key' });
  await db.open();
  opened.push(db);
  return db;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const db of opened.splice(0)) { db.close(); await Dexie.delete(db.name); }
});

describe('legacy cache upgrade recovery', () => {
  it('detects pending commands without copying, modifying or upgrading originals, on repeated startup', async () => {
    const db = await legacy();
    const command = { row_id: 1, record_id: 'edit', envelope: { text: 'Local edit' } };
    await db.pending_writes.put(command);
    for (let startup = 0; startup < 2; startup++) {
      const result = await inspectLegacyWorkspaceRecovery(names);
      expect(result).toEqual({ status: 'required', databaseNames: [db.name] });
      expect(legacyWorkspaceRecoveryMessage(result)).toContain('Local edit recovery required');
      expect(await db.pending_writes.toArray()).toEqual([command]);
      expect(db.verno).toBe(1);
    }
    expect(await Dexie.exists(`wingman-fd-ws-${alpha.workspaceKey}`)).toBe(false);
  });

  it.each([
    ['tasks', { record_id: 'pending', sync_status: 'pending' }],
    ['tasks', { record_id: 'failed', sync_status: 'failed' }],
    ['tasks', { record_id: 'reconcile', sync_status: 'synced', pg_reconciliation_pending: true }],
    ['document_drafts', { draft_key: 'draft', workspace_id: 'alpha', content: 'Saved draft' }],
  ])('detects protected %s rows even without a queued command', async (table, row) => {
    const db = await legacy();
    await db.table(table).put(row);
    expect((await inspectLegacyWorkspaceRecovery(names)).status).toBe('required');
    expect(await db.table(table).toArray()).toEqual([row]);
  });

  it('leaves a clean old cache intact without a warning; absent caches are not created', async () => {
    expect(await inspectLegacyWorkspaceRecovery(names)).toEqual({ status: 'clear', databaseNames: [] });
    expect(await Dexie.exists(names[0])).toBe(false);
    const db = await legacy();
    await db.tasks.put({ record_id: 'remote', sync_status: 'synced' });
    expect(legacyWorkspaceRecoveryMessage(await inspectLegacyWorkspaceRecovery(names))).toBe('');
    expect(await db.tasks.count()).toBe(1);
  });

  it('warns in both ambiguous same-service workspaces and never treats a command UUID or last sync identity as proof for the entire cache', async () => {
    expect(legacyWorkspaceDatabaseNames(beta)).toEqual(names);
    const db = await legacy();
    await db.pending_writes.put({ workspace_id: 'alpha', record_id: 'alpha-edit' });
    await db.tasks.put({ record_id: 'unknown-edit', sync_status: 'pending' });
    await db.sync_state.put({ key: 'identity', workspace_id: 'alpha' });
    for (const ws of [alpha, beta, alpha]) {
      expect((await inspectLegacyWorkspaceRecovery(legacyWorkspaceDatabaseNames(ws))).status).toBe('required');
    }
    expect(await db.pending_writes.count()).toBe(1);
    expect(await db.tasks.count()).toBe(1);
  });

  it('also detects the pre-sign-in legacy identity', async () => {
    const db = await legacy(names[1]);
    await db.pending_writes.put({ record_id: 'edit' });
    expect((await inspectLegacyWorkspaceRecovery(names)).databaseNames).toEqual([names[1]]);
  });

  it('reports unavailable inspection visibly, including unsupported workers', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('unavailable'); } });
    expect(legacyWorkspaceRecoveryMessage(await checkLegacyWorkspaceRecovery(alpha))).toContain('could not check');
  });
});

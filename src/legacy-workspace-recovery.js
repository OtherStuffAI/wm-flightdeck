import Dexie from 'dexie';

// These are discovery candidates, never evidence that the rows belong to the
// selected UUID. In particular, a legacy DB can contain several workspaces.
export function legacyWorkspaceDatabaseNames(workspace = {}) {
  const key = String(workspace.workspaceKey || '');
  const suffix = `::id:${workspace.workspaceId}`;
  if (!workspace.pgBackendMode || !workspace.workspaceId || !key.startsWith('pg:') || !key.endsWith(suffix)) return [];
  const legacy = key.slice(0, -suffix.length);
  const unsigned = legacy.replace(/^pg:[^:]+::tower:/, 'pg:tower:');
  return [...new Set([legacy, unsigned])].map(value => `wingman-fd-ws-${value}`);
}

export async function inspectLegacyWorkspaceRecovery(databaseNames) {
  const existing = new Set(await Dexie.getDatabaseNames());
  const affected = [];
  for (const name of databaseNames.filter(name => existing.has(name))) {
    // Dynamic schema: inspect without upgrading, opening an active partition,
    // modifying originals, or making commands available to a flush worker.
    const db = new Dexie(name, { autoOpen: false });
    try {
      await db.open();
      const unsynced = await db.transaction('r', db.tables, async () => {
        for (const table of db.tables) {
          if (['pending_writes', 'document_drafts'].includes(table.name)) {
            if (await table.count()) return true;
          } else if (await table.filter(row =>
            ['pending', 'failed'].includes(row?.sync_status) || row?.pg_reconciliation_pending === true
          ).limit(1).count()) return true;
        }
        return false;
      });
      if (unsynced) affected.push(name);
    } finally {
      db.close();
    }
  }
  return { status: affected.length ? 'required' : 'clear', databaseNames: affected };
}

export function legacyWorkspaceRecoveryMessage(result) {
  if (result?.status === 'clear') return '';
  const reason = result?.status === 'required'
    ? 'An older workspace cache contains unsynced edits or saved drafts.'
    : 'Flight Deck could not check an older workspace cache for unsynced edits.';
  return `Local edit recovery required. ${reason} Older edits have not been copied or sent. Keep this browser’s site data and ask your workspace administrator for recovery help: back up the old cache, confirm which workspace each edit belongs to, then recover it there. Choose recovery, dismiss this notice, or use Tower’s version from this menu.`;
}

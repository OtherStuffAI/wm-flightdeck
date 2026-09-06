import { legacyWorkspaceDatabaseNames } from './legacy-workspace-recovery.js';

export function checkLegacyWorkspaceRecovery(workspace) {
  const databaseNames = legacyWorkspaceDatabaseNames(workspace);
  if (!databaseNames.length) return Promise.resolve({ status: 'clear', databaseNames: [] });
  return new Promise(resolve => {
    let worker;
    let timeout;
    const finish = result => {
      clearTimeout(timeout);
      worker?.terminate();
      resolve(result);
    };
    try {
      worker = new Worker(new URL('./worker/legacy-workspace-recovery-worker.js', import.meta.url), { type: 'module' });
      timeout = setTimeout(() => finish({ status: 'unavailable' }), 30000);
      worker.onmessage = event => finish(event.data);
      worker.onerror = () => finish({ status: 'unavailable' });
      worker.postMessage(databaseNames);
    } catch {
      finish({ status: 'unavailable' });
    }
  });
}

import { inspectLegacyWorkspaceRecovery } from '../legacy-workspace-recovery.js';

self.onmessage = async event => {
  try {
    self.postMessage(await inspectLegacyWorkspaceRecovery(event.data));
  } catch {
    self.postMessage({ status: 'unavailable' });
  }
};

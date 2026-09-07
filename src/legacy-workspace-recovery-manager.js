import { legacyWorkspaceRecoveryMessage } from './legacy-workspace-recovery.js';
import { checkLegacyWorkspaceRecovery } from './legacy-workspace-recovery-client.js';

const preferenceKey = workspaceKey => `flightdeck.legacy-recovery.v1:${workspaceKey}`;
function readChoice(workspaceKey) {
  try { return localStorage.getItem(preferenceKey(workspaceKey)) || ''; }
  catch { return ''; }
}
function writeChoice(workspaceKey, choice) {
  if (!workspaceKey) throw new Error('Select a workspace first.');
  localStorage.setItem(preferenceKey(workspaceKey), choice);
}

export const legacyWorkspaceRecoveryMixin = {
  legacyWorkspaceRecoveryNotice: '',
  legacyWorkspaceRecoveryDismissed: false,
  legacyWorkspaceRecoveryBusy: false,
  legacyWorkspaceRecoveryError: '',

  async refreshLegacyWorkspaceRecovery(workspace) {
    const generation = this._workspaceSelectionGeneration;
    const key = workspace.workspaceKey;
    this.legacyWorkspaceRecoveryError = '';
    this.legacyWorkspaceRecoveryDismissed = readChoice(key) === 'dismissed';
    if (readChoice(key) === 'tower') {
      this.legacyWorkspaceRecoveryNotice = '';
      return;
    }
    const result = await checkLegacyWorkspaceRecovery(workspace);
    if (generation !== this._workspaceSelectionGeneration || this.currentWorkspaceKey !== key) return;
    // A choice made while inspection was in flight must win over its result.
    const choice = readChoice(key);
    this.legacyWorkspaceRecoveryDismissed = choice === 'dismissed';
    this.legacyWorkspaceRecoveryNotice = choice === 'tower' ? '' : legacyWorkspaceRecoveryMessage(result);
  },

  dismissLegacyWorkspaceRecovery() {
    try {
      writeChoice(this.currentWorkspaceKey, 'dismissed');
      this.legacyWorkspaceRecoveryDismissed = true;
      this.legacyWorkspaceRecoveryError = '';
    } catch {
      // Dismiss for this session even when persistence is unavailable.
      this.legacyWorkspaceRecoveryDismissed = true;
      this.legacyWorkspaceRecoveryError = 'Dismissed for now. This browser could not save the preference.';
    }
  },

  async useTowerForLegacyRecovery() {
    if (this.legacyWorkspaceRecoveryBusy || !this.isTowerPgMode) return;
    const key = this.currentWorkspaceKey;
    const generation = this._workspaceSelectionGeneration;
    this.legacyWorkspaceRecoveryBusy = true;
    this.legacyWorkspaceRecoveryError = '';
    try {
      // The canonical UUID cache already excludes the ambiguous legacy outbox.
      // Pull Tower into it; never replay or erase a possibly shared old cache.
      const result = await this.performTowerPgFullSync({ manual: true });
      if (generation !== this._workspaceSelectionGeneration || this.currentWorkspaceKey !== key) return;
      if (!result?.pgMode) throw new Error('Connect to Tower before choosing its version.');
      writeChoice(key, 'tower');
      this.legacyWorkspaceRecoveryNotice = '';
      this.legacyWorkspaceRecoveryDismissed = false;
    } catch (error) {
      if (generation === this._workspaceSelectionGeneration && this.currentWorkspaceKey === key) {
        this.legacyWorkspaceRecoveryError = error?.message || 'Could not refresh from Tower. Please retry.';
      }
    } finally {
      this.legacyWorkspaceRecoveryBusy = false;
    }
  },
};

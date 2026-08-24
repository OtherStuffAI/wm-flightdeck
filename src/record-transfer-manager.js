import { upsertDocument, upsertMessage, upsertTask } from './db.js';
import { getPgChannelScopeId } from './pg-record-context.js';
import {
  createTowerPgMessageFromLocal,
  moveTowerPgDocFromLocal,
  moveTowerPgTaskFromLocal,
} from './tower-command-intents.js';
import { buildFlightDeckReference } from './record-links.js';

function trimText(value) {
  return String(value ?? '').trim();
}

export function createRecordTransferState() {
  return {
    recordTransfer: {
      open: false,
      mode: 'move',
      recordType: '',
      record: null,
      destinationScopeId: '',
      destinationChannelId: '',
      submitting: false,
      error: '',
    },
  };
}

export const recordTransferManagerMixin = {
  get recordTransferScopeOptions() {
    const channels = Array.isArray(this.channels) ? this.channels : [];
    const scopeIds = [...new Set(channels
      .filter((channel) => channel?.record_id && channel.record_state !== 'deleted')
      .map((channel) => getPgChannelScopeId(channel))
      .filter(Boolean))];
    return scopeIds.map((scopeId) => {
      const scope = (this.scopes || []).find((entry) => entry?.record_id === scopeId) || null;
      return {
        id: scopeId,
        label: scope?.title || this.getScopeBreadcrumb?.(scopeId) || 'Visible scope',
      };
    }).sort((left, right) => left.label.localeCompare(right.label));
  },

  get recordTransferChannelOptions() {
    const scopeId = trimText(this.recordTransfer?.destinationScopeId);
    return (this.channels || [])
      .filter((channel) => channel?.record_id && channel.record_state !== 'deleted' && (!scopeId || getPgChannelScopeId(channel) === scopeId))
      .map((channel) => ({
        id: channel.record_id,
        label: this.getChannelLabel?.(channel) || channel.title || channel.name || 'Untitled channel',
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  },

  get recordTransferTitle() {
    return this.recordTransfer?.mode === 'tag' ? 'Tag in Chat…' : 'Move to…';
  },

  openRecordTransfer(mode, recordType, record = null) {
    const type = recordType === 'document' || recordType === 'doc' ? 'document' : 'task';
    const source = record || (type === 'document' ? this.selectedDocument : this.editingTask);
    if (!source?.record_id || !source?.pg_backend) {
      this.error = 'This action is available for synced Tower PG tasks and documents.';
      return false;
    }
    const sourceScopeId = trimText(source.scope_id || source.scope_l1_id);
    this.recordTransfer = {
      ...createRecordTransferState().recordTransfer,
      open: true,
      mode: mode === 'tag' ? 'tag' : 'move',
      recordType: type,
      record: { ...source },
      destinationScopeId: sourceScopeId || this.recordTransferScopeOptions[0]?.id || '',
    };
    return true;
  },

  openRecordMove(recordType, record = null) {
    return this.openRecordTransfer('move', recordType, record);
  },

  openRecordTagInChat(recordType, record = null) {
    return this.openRecordTransfer('tag', recordType, record);
  },

  closeRecordTransfer() {
    if (this.recordTransfer?.submitting) return false;
    this.recordTransfer = createRecordTransferState().recordTransfer;
    return true;
  },

  recordTransferScopeChanged() {
    this.recordTransfer = {
      ...this.recordTransfer,
      destinationChannelId: '',
      error: '',
    };
  },

  recordTransferChannelChanged() {
    this.recordTransfer = { ...this.recordTransfer, error: '' };
  },

  async submitRecordTransfer() {
    const transfer = this.recordTransfer || {};
    const channelId = trimText(transfer.destinationChannelId);
    const scopeId = trimText(transfer.destinationScopeId);
    if (!channelId) {
      this.recordTransfer = { ...transfer, error: 'Choose a destination channel.' };
      return false;
    }
    const destination = (this.channels || []).find((channel) => channel?.record_id === channelId && getPgChannelScopeId(channel) === scopeId);
    if (!destination) {
      this.recordTransfer = { ...transfer, error: 'The destination is no longer visible. Choose another channel.' };
      return false;
    }
    if (transfer.mode === 'move' && channelId === trimText(transfer.record?.pg_channel_id || transfer.record?.channel_id)) {
      this.recordTransfer = { ...transfer, error: 'This record is already in that channel.' };
      return false;
    }
    this.recordTransfer = { ...transfer, submitting: true, error: '' };
    try {
      if (transfer.mode === 'tag') {
        await this.tagRecordInDestinationChat(transfer, destination);
      } else {
        await this.moveRecordToDestination(transfer, destination);
      }
      this.recordTransfer = createRecordTransferState().recordTransfer;
      return true;
    } catch (error) {
      this.recordTransfer = { ...this.recordTransfer, submitting: false, error: error?.message || 'The action could not be completed.' };
      return false;
    }
  },

  async moveRecordToDestination(transfer, destination) {
    const accepted = transfer.recordType === 'document'
      ? await moveTowerPgDocFromLocal(this, transfer.record, destination.record_id, getPgChannelScopeId(destination))
      : await moveTowerPgTaskFromLocal(this, transfer.record, destination.record_id, getPgChannelScopeId(destination));
    if (transfer.recordType === 'document') {
      await upsertDocument(accepted);
      if (typeof this.patchDocumentLocal === 'function') this.patchDocumentLocal(accepted);
      else await this.applyDocuments?.([...(this.documents || []).filter((item) => item.record_id !== accepted.record_id), accepted]);
    } else {
      await upsertTask(accepted);
      await this.applyTasks?.([...(this.tasks || []).filter((item) => item.record_id !== accepted.record_id), accepted]);
      if (this.editingTask?.record_id === accepted.record_id) this.editingTask = { ...this.editingTask, ...accepted };
    }
  },

  async tagRecordInDestinationChat(transfer, destination) {
    const mention = buildFlightDeckReference({
      type: transfer.recordType,
      id: transfer.record.record_id,
      label: transfer.record.title || (transfer.recordType === 'document' ? 'Untitled document' : 'Untitled task'),
    });
    if (!mention) throw new Error('The structured Flight Deck reference could not be created.');
    const clientRecordId = crypto.randomUUID();
    const now = new Date().toISOString();
    const accepted = await createTowerPgMessageFromLocal(this, {
      record_id: clientRecordId,
      channel_id: destination.record_id,
      parent_message_id: null,
      body: mention,
      attachments: [],
      sender_npub: this.session?.npub,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
      pg_backend: true,
      pg_workspace_id: this.currentWorkspace?.workspaceId || this.currentWorkspace?.workspace_id || this.currentWorkspaceKey || null,
      pg_scope_id: getPgChannelScopeId(destination),
      pg_thread_id: null,
    });
    if (!accepted?.record_id || !accepted?.pg_thread_id) {
      throw new Error('Tower did not return the newly created thread.');
    }
    await upsertMessage(accepted);
    this.navigateTo?.('chat', { syncRoute: false });
    await this.selectChannel?.(destination.record_id, { syncRoute: false, scrollToLatest: false });
    this.patchMessageLocal?.(accepted);
    this.openThread?.(accepted.record_id, { syncRoute: false, scrollToLatest: false });
    this.scheduleComposerAutosize?.('thread');
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => document.querySelector?.('[data-chat-composer="thread"]')?.focus?.());
    }
    this.syncRoute?.();
  },
};

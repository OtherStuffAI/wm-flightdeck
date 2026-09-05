import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveQuery } from 'dexie';
import { openWorkspaceDb, deleteWorkspaceDb, getWorkspaceDb, getThreadMessagePresentationWindow } from '../src/db.js';
import { mapPgThreadToLocal, mapPgMessageToLocal, readTowerPgThreadHistoryPage, hydrateTowerPgSyncBundle } from '../src/pg-read-hydrator.js';
import { chatMessageManagerMixin } from '../src/chat-message-manager.js';
import { autopilotOverviewManagerMixin } from '../src/autopilot-overview-manager.js';
import { sectionLiveQueryMixin } from '../src/section-live-queries.js';
import { instrumentIndexedDb } from './helpers/indexeddb-metrics.js';
import { TowerSyncService } from '../src/tower-sync-service.js';

const key = 'inbox-thread-history-test';
const rawThread = id => ({ id, channel_id: 'channel-a', workspace_id: 'workspace-a', source_message_id: `${id}-source`, title: id, created_at: '2026-01-01T00:00:00Z', row_version: 1 });
const rawMessage = (id, n) => ({ id: n === 0 ? `${id}-source` : `${id}-${n}`, thread_id: id, channel_id: 'channel-a', workspace_id: 'workspace-a', body: `${id} reply ${n}`, created_at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), row_version: 1 });
async function seed(id, count) {
  const thread = rawThread(id);
  const options = { threadById: new Map([[id, thread]]) }; // ownerless installed-cache compatibility
  await getWorkspaceDb().chat_messages.bulkPut([mapPgThreadToLocal(thread), ...Array.from({ length: count }, (_, n) => mapPgMessageToLocal(rawMessage(id, n), options))]);
}
const subscriptions = [];
afterEach(async () => { subscriptions.splice(0).forEach(sub => sub.unsubscribe()); await deleteWorkspaceDb(key); });
function store() {
  const s = Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(chatMessageManagerMixin), ...Object.getOwnPropertyDescriptors(autopilotOverviewManagerMixin), ...Object.getOwnPropertyDescriptors(sectionLiveQueryMixin) });
  Object.assign(s, {
    currentWorkspaceKey: key, workspaceOwnerNpub: 'owner', currentWorkspace: { workspaceId: 'workspace-a' },
    navSection: 'status', selectedChannelId: 'unrelated-channel', selectedBoardId: 'all',
    messages: [], channels: [], audioNotes: [], fileMessages: [], fileComments: [], scopes: [], tasks: [], documents: [],
    THREAD_REPLY_PAGE_SIZE: 6, mainFeedVisibleCount: 21, threadVisibleReplyCount: 6,
    summaryPanelPages: {}, summaryCollapsedPanels: {},
    saveChatComposerDraft() {}, restoreChatComposerDraft() {}, syncRoute() {},
    captureScrollAnchor() {}, restoreScrollAnchor() {}, syncChatPreviewState() {}, scheduleChatPreviewMeasurement() {},
    scheduleStorageImageHydration() {}, scheduleThreadRepliesScrollToBottom() {}, updateResponseActivityTimer() {},
    applyAgentActivities() {}, applyAddressBookPeople() {}, applyFileMessages() {}, applyFileComments() {},
    applyDocuments() {}, applyTasks() {}, applyScopes() {}, applyChannels() {}, applyDailyNotes() {}, applyWapps() {},
    applyDirectories() {},
    createLiveSubscription(query, onNext) { const sub = liveQuery(query).subscribe({ next: onNext }); subscriptions.push(sub); return sub; },
    stopLiveSubscription(sub) { sub.unsubscribe(); },
  });
  return s;
}

describe('real Inbox thread history path', () => {
  it('opens canonical ownerless history beyond Inbox sources and selected-channel windows, pages and follows edits/deletes', async () => {
    openWorkspaceDb(key); await seed('thread-a', 241); await seed('thread-b', 131);
    const s = store();
    s.markTowerPgResourceViewed = vi.fn();
    await s.openAutopilotOverviewThread({ id: 'thread-a', rootRecordId: 'thread-a-source', channelId: 'channel-a' });
    await vi.waitFor(() => expect(s.visibleThreadMessages.map(row => row.body)).toEqual(Array.from({ length: 6 }, (_, i) => `thread-a reply ${235 + i}`)));
    expect(s.selectedChannelId).toBe('unrelated-channel');
    expect(s.markTowerPgResourceViewed).toHaveBeenCalledWith('thread', 'thread-a', undefined);
    expect(s.fileMessages).toEqual([]);
    expect(s.messages.length).toBeLessThanOrEqual(8);
    s.showMoreThreadMessages();
    await vi.waitFor(() => expect(s.visibleThreadMessages).toHaveLength(12));
    for (let i = 0; i < 39; i++) s.showMoreThreadMessages();
    await vi.waitFor(() => expect(s.visibleThreadMessages.some(row => row.body === 'thread-a reply 1')).toBe(true));
    await getWorkspaceDb().chat_messages.update('thread-a-240', { body: 'edited reply', version: 2 });
    await vi.waitFor(() => expect(s.visibleThreadMessages.some(row => row.body === 'edited reply')).toBe(true));
    await getWorkspaceDb().chat_messages.delete('thread-a-240');
    await vi.waitFor(() => expect(s.visibleThreadMessages.some(row => row.body === 'edited reply')).toBe(false));
    await s.openAutopilotOverviewThread({ id: 'thread-b', rootRecordId: 'thread-b', channelId: 'channel-a' });
    await s.openAutopilotOverviewThread({ id: 'thread-a', rootRecordId: 'thread-a-source', channelId: 'channel-a' });
    await vi.waitFor(() => expect(s.visibleThreadMessages.at(-1)?.body).toBe('thread-a reply 239'));
    expect(s.messages.every(row => row.pg_thread_id === 'thread-a')).toBe(true);
    await s.reconcileDeckThreadMessages([{ record_id: 'preview', channel_id: 'channel-a', parent_message_id: s.activeThreadId }]);
    expect(s.messages.some(row => row.record_id === 'preview')).toBe(false);
  });

  it('invalidates a previously read derived window after an incremental collection revision', async () => {
    openWorkspaceDb(key); await seed('edited', 8);
    const s = store(); s.activeThreadId = 'edited';
    s.messages = await getThreadMessagePresentationWindow('channel-a', 'edited');
    expect(s.visibleThreadMessages.at(-1).body).toBe('edited reply 7');
    const index = s.messages.findIndex(row => row.record_id === 'edited-7');
    s.messages.splice(index, 1, { ...s.messages[index], body: 'Updated body', version: 2 });
    s.messageCollectionRevision = 1;
    expect(s.visibleThreadMessages.at(-1).body).toBe('Updated body');
  });

  it('retains inherited transcript coverage after a canonical thread metadata update', async () => {
    openWorkspaceDb(key); await seed('ancestor', 3); await seed('branch', 2);
    const db = getWorkspaceDb();
    await db.sync_state.put({ key: 'thread-history-page:branch', value: { messageIds: ['ancestor-1', 'branch-1'], nextCursor: null } });
    await db.chat_messages.update('ancestor-1', { read_only: true, pg_inherited: true });
    await db.chat_messages.put({ ...mapPgThreadToLocal(rawThread('branch')), title: 'Updated branch', version: 2 });
    const rows = await getThreadMessagePresentationWindow('channel-a', 'branch');
    expect(rows.find(row => row.record_id === 'ancestor-1')).toMatchObject({ parent_message_id: 'branch', read_only: true, pg_inherited: true });
  });

  it('retains actual persisted identity when a source message is not cached yet', async () => {
    openWorkspaceDb(key);
    await getWorkspaceDb().chat_messages.put(mapPgThreadToLocal(rawThread('partial')));
    const rows = await getThreadMessagePresentationWindow('channel-a', 'partial-source', { threadId: 'partial' });
    expect(rows.map(row => row.record_id)).toEqual(['partial']);
    const s = store(); s.activeThreadId = 'partial-source'; s.messages = rows;
    expect(s.getThreadParentMessage().record_id).toBe('partial');
  });

  it('keeps indexed detail reads bounded independently of busy unrelated threads', async () => {
    openWorkspaceDb(key); await seed('wanted', 400); await seed('other', 1000);
    const metrics = instrumentIndexedDb();
    try {
      const page = await getThreadMessagePresentationWindow('channel-a', 'wanted-source', { replyLimit: 6 });
      expect(page).toHaveLength(8);
      expect(metrics.snapshot().valueRowsRead).toBeLessThanOrEqual(18);
    } finally { metrics.restore(); }
  });

  it('ignores late remote pagination state after switching away and back', async () => {
    openWorkspaceDb(key); await seed('thread-a', 10); await seed('thread-b', 10);
    const s = store();
    const pending = [];
    s.requestTowerSyncFamily = vi.fn(() => new Promise(resolve => pending.push(resolve)));
    const row = id => ({ id, rootRecordId: id, channelId: 'channel-a' });
    await s.openAutopilotOverviewThread(row('thread-a'));
    await s.openAutopilotOverviewThread(row('thread-b'));
    await s.openAutopilotOverviewThread(row('thread-a'));
    pending[0]({ nextCursor: 'stale-a' }); pending[1]({ nextCursor: 'stale-b' });
    await Promise.resolve();
    expect(s.threadHistoryCursor).toBeNull();
    pending[2]({ nextCursor: 'current-a' });
    await vi.waitFor(() => expect(s.threadHistoryCursor).toBe('current-a'));
    await vi.waitFor(() => expect(s.visibleThreadMessages.at(-1)?.body).toBe('thread-a reply 9'));
  });

  it('loads one cold page through service/materialization and protects pending rows and workspace cursors', async () => {
    openWorkspaceDb(key);
    const s = { backendUrl: 'http://localhost:1', workspaceOwnerNpub: 'owner', currentWorkspace: { workspaceId: 'workspace-a', directHttpsUrl: 'http://localhost:1' } };
    const db = getWorkspaceDb();
    await db.sync_state.put({ key: 'workspace-cursor', value: 'keep' });
    const read = vi.fn().mockResolvedValue({ messages: [rawMessage('cold', 0), rawMessage('cold', 1)], next_cursor: 'page-2' });
    const service = new TowerSyncService({ workspaceKey: key, families: { 'thread-history-page': {
      load: (_, options) => readTowerPgThreadHistoryPage(s, 'channel-a', 'cold', { ...options, getTowerPgThread: async () => rawThread('cold'), getTowerPgChannelMessages: read }),
      materialize: bundle => hydrateTowerPgSyncBundle(s, bundle),
    } } });
    const result = await service.ensureLoaded('thread-history-page', 'cold:first');
    expect(result).toEqual({ nextCursor: 'page-2', count: 2 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][2]).toMatchObject({ limit: 100, cursor: null, effectiveTranscript: true });
    expect((await getThreadMessagePresentationWindow('channel-a', 'cold')).some(row => row.body === 'cold reply 1')).toBe(true);
    await db.pending_writes.add({ record_id: 'cold-1', envelope: {} });
    await db.chat_messages.update('cold-1', { body: 'pending edit', sync_status: 'pending', version: 2 });
    await db.pg_record_rows.put({ key: 'message:cold-2', family: 'message', id: 'cold-2', operation: 'delete' });
    read.mockResolvedValue({ messages: [rawMessage('cold', 1), rawMessage('cold', 2)], next_cursor: null });
    await service.ensureLoaded('thread-history-page', 'cold:page-2', { cursor: 'page-2' });
    expect(read).toHaveBeenCalledTimes(2);
    expect(await db.chat_messages.get('cold-2')).toBeUndefined();
    expect((await db.chat_messages.get('cold-1')).body).toBe('pending edit');
    expect(await db.pending_writes.count()).toBe(1);
    expect((await db.sync_state.get('workspace-cursor')).value).toBe('keep');
    service.dispose();
  });
});

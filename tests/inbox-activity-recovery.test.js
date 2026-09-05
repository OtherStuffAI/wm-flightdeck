import { beforeEach, expect, it } from 'vitest';
import { liveQuery } from 'dexie';
import fixture from './fixtures/flightdeck-record-delta-v1.json';
import { openWorkspaceDb, getOwnerActivityWindow, getRecentChannelActivity } from '../src/db.js';
import { applyPgRecordChanges } from '../src/pg-record-delta.js';
import { queryInboxSource, sectionLiveQueryMixin } from '../src/section-live-queries.js';
import { buildAutopilotOverviewThreads, autopilotOverviewManagerMixin } from '../src/autopilot-overview-manager.js';

const owner = 'npub1owner';
const workspaceId = fixture.canonical_upserts.changes[0].workspace_id;
const transport = { workspaceId, workspaceOwnerNpub: owner, currentWorkspace: { workspaceId }, session: { npub: 'npub1viewer' } };
let db;
beforeEach(async () => {
  db = openWorkspaceDb('inbox-recovery'); await db.open();
  await Promise.all(db.tables.map(table => table.clear()));
  await applyPgRecordChanges(transport, fixture.canonical_upserts, { expectedCursor: null });
});
const input = (type = 'all', scopeId = 'all') => ({ workspaceOwnerNpub: owner, deckInboxType: type,
  autopilotOverviewContext: { scopeId, channelId: 'all' }, inboxActivityVisibleCount: 100 });

it('materializes canonical chats into owner activity, and recovers rows from previous installed builds without writes', async () => {
  const mapped = await db.chat_messages.toArray();
  expect(mapped.length).toBeGreaterThan(0);
  expect(mapped.every(row => row.owner_npub === owner)).toBe(true);
  const page = await getOwnerActivityWindow('chat_messages', owner);
  expect(page.rows.length).toBeGreaterThan(0);
  // Exact old mapped shape: remove only the field absent before this repair.
  await db.chat_messages.toCollection().modify(row => { delete row.owner_npub; });
  await db.pending_writes.add({ record_id: 'local-command', envelope: { body: 'pending' } });
  const before = await db.chat_messages.toArray();
  const cursors = await db.sync_state.toArray();
  expect((await getOwnerActivityWindow('chat_messages', owner)).rows.map(row => row.record_id))
    .toEqual(page.rows.map(row => row.record_id));
  const activity = await getRecentChannelActivity(owner);
  expect(activity.length).toBeGreaterThan(0);
  expect(activity.every(row => row.pg_record_type === 'message')).toBe(true);
  expect(await db.chat_messages.toArray()).toEqual(before);
  expect(await db.sync_state.toArray()).toEqual(cursors);
  expect(await db.pending_writes.count()).toBe(1);
});

it('finds old scoped Chat, Task, Docs and Files before unrelated newer candidates and filters exhaust honestly', async () => {
  const channel = await db.channels.toCollection().first();
  const scope = channel.scope_id;
  const task = await db.tasks.toCollection().first();
  const doc = (await db.documents.toArray()).find(row => row.pg_record_type === 'doc');
  await db.tasks.bulkPut(Array.from({ length: 160 }, (_, i) => ({ ...task, record_id: `other-${i}`, scope_id: 'elsewhere', scope_l1_id: 'elsewhere', updated_at: '2099-01-01T00:00:00Z' })));
  await db.documents.bulkPut(Array.from({ length: 160 }, (_, i) => ({ ...doc, record_id: `other-doc-${i}`, scope_id: 'elsewhere', scope_l1_id: 'elsewhere', updated_at: '2099-01-01T00:00:00Z' })));
  for (const [type, family] of [['chat', 'chat_messages'], ['task', 'tasks'], ['document', 'documents'], ['file', 'documents']]) {
    const page = await queryInboxSource(input(type, scope), owner, family);
    expect(page.rows.length, type).toBeGreaterThan(0);
    expect(page.hasMore, type).toBe(false);
  }
  expect(await queryInboxSource(input('chat', scope), owner, 'tasks')).toEqual({ rows: [], hasMore: false });
  expect(await queryInboxSource({ ...input('task', scope), deckInboxSearchQuery: 'no such match' }, owner, 'tasks')).toEqual({ rows: [], hasMore: false });
});

it('pages distinct chat threads despite a busy thread and keeps Recent Channels independent and live after edits/deletes', async () => {
  const template = fixture.canonical_upserts.changes.find(change => change.family === 'message');
  const changes = Array.from({ length: 125 }, (_, i) => ({ ...template, id: `message-${i}`, version: String(1000 + i),
    row: { ...template.row, id: `message-${i}`, thread_id: `thread-${i}`, updated_at: new Date(Date.UTC(2027, 8, 5) - i * 1000).toISOString() } }));
  await applyPgRecordChanges(transport, { ...fixture.one_message_delta, changes, next_cursor: 'many' });
  let page = await queryInboxSource(input('chat'), owner, 'chat_messages');
  const channels = await db.channels.toArray();
  expect(buildAutopilotOverviewThreads({ channels, messages: page.rows }).length).toBe(100);
  expect(page.hasMore).toBe(true);
  page = await queryInboxSource({ ...input('chat'), inboxActivityVisibleCount: 150 }, owner, 'chat_messages');
  expect(buildAutopilotOverviewThreads({ channels, messages: page.rows }).length).toBeGreaterThan(125);
  expect(page.hasMore).toBe(false);
  const recent = await getRecentChannelActivity(owner);
  const latest = recent.find(row => row.record_id === 'message-0');
  expect(latest).toBeTruthy();
  await db.chat_messages.update(latest.record_id, { body: 'edited preview' });
  expect((await getRecentChannelActivity(owner)).find(row => row.record_id === latest.record_id).body).toBe('edited preview');
  await db.chat_messages.delete(latest.record_id);
  expect((await getRecentChannelActivity(owner)).some(row => row.record_id === 'message-1')).toBe(true);
  await db.chat_messages.where('channel_id').equals(latest.channel_id).delete();
  expect((await getRecentChannelActivity(owner)).some(row => row.channel_id === latest.channel_id)).toBe(false);
});

it('retains the live Feed subscription through Inbox type, page and scope transitions and delivers add/edit/remove', async () => {
  const received = [];
  const subscriptions = [];
  const store = Object.assign(Object.defineProperties({}, Object.getOwnPropertyDescriptors(autopilotOverviewManagerMixin)), sectionLiveQueryMixin, {
    currentWorkspaceKey: 'inbox-recovery', workspaceOwnerNpub: owner, navSection: 'status',
    createLiveSubscription(query, onNext) { const sub = liveQuery(query).subscribe({ next: onNext }); subscriptions.push({ query, sub }); return sub; },
    stopLiveSubscription(sub) { sub.unsubscribe(); },
    applyAddressBookPeople() {}, applyWapps() {}, applyScopes() {}, applyChannels() {}, applyDailyNotes() {},
    applyTasks() {}, applyDocuments() {}, applyFileMessages() {}, applyFileComments() {}, applyDirectories() {},
    applyWappActivityProjection(projection) { received.push(projection); },
  });
  store.startWorkspaceLiveQueries();
  const feed = subscriptions.find(entry => entry.query.toString().includes('getWappActivityProjection'));
  const waitFor = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10)); expect(predicate()).toBe(true); };
  try {
    await waitFor(() => received.length > 0);
    store.setDeckInboxType('chat'); store.inboxActivityVisibleCount = 150; store.startWorkspaceLiveQueries();
    store.syncDeckInboxContext('scope:another', 'another');
    expect(subscriptions.filter(entry => entry.query.toString().includes('getWappActivityProjection'))).toEqual([feed]);
    await db.wapp_activity_items.put({ record_id: 'feed-test', title: 'new', occurred_at: '2026-09-05T00:00:00Z' });
    await waitFor(() => received.at(-1).items.some(row => row.title === 'new'));
    await db.wapp_activity_items.update('feed-test', { title: 'changed' });
    await waitFor(() => received.at(-1).items.some(row => row.title === 'changed'));
    await db.wapp_activity_items.delete('feed-test');
    await waitFor(() => received.at(-1).items.length === 0);
  } finally { store.stopWorkspaceLiveQueries(); store.stopSharedLiveQueries(); }
});

it('keeps comment-driven task search and scoped comment/chat files in their original card families', async () => {
  const task = await db.tasks.toCollection().first();
  const original = fixture.canonical_upserts.changes.find(change => change.family === 'task_comment');
  await applyPgRecordChanges(transport, { ...fixture.one_message_delta, next_cursor: 'comment-search', changes: [{
    ...original, version: '80000', row: { ...original.row, row_version: 2, task_id: task.record_id,
      scope_id: task.scope_id, channel_id: task.pg_channel_id,
      body: 'Distinctive review phrase [Evidence](storage://comment-evidence)', updated_at: '2031-01-01T00:00:00Z' },
  }] });
  const comment = await db.comments.get(original.id);
  const search = { ...input('task', task.scope_id), deckInboxSearchQuery: 'Distinctive review phrase' };
  expect((await queryInboxSource(search, owner, 'tasks')).rows.some(row => row.record_id === task.record_id)).toBe(true);
  const files = await queryInboxSource(input('file', task.scope_id), owner, 'comments');
  expect(files.rows.some(row => row.record_id === comment.record_id)).toBe(true);
  const message = (await db.chat_messages.toArray()).find(row => row.pg_record_type === 'message');
  await db.chat_messages.update(message.record_id, { body: '[Chat evidence](storage://chat-evidence)' });
  expect((await queryInboxSource(input('file', task.scope_id), owner, 'chat_messages')).rows.some(row => row.record_id === message.record_id)).toBe(true);
});

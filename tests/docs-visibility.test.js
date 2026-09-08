import { expect, it, vi } from 'vitest';
import { openWorkspaceDb } from '../src/db.js';
import { mapPgDocToLocal } from '../src/pg-read-hydrator.js';
import { sectionLiveQueryMixin } from '../src/section-live-queries.js';
const { storeMock } = vi.hoisted(() => ({ storeMock: vi.fn() }));
vi.mock('alpinejs', () => ({ default: { store: storeMock, start() {} } }));

it('shows old documents after cold hydration, parent/channel selection and chat navigation', async () => {
  const { initApp } = await import('../src/app.js');
  initApp();
  const store = storeMock.mock.calls.find(([name]) => name === 'chat')[1];
  Object.defineProperty(store, 'isTowerPgMode', { value: true });
  const db = openWorkspaceDb('docs-visibility');
  await db.open();
  await db.documents.clear();
  Object.defineProperty(store, 'workspaceOwnerNpub', { value: 'owner' });
  Object.defineProperty(store, 'currentWorkspaceKey', { value: 'docs-visibility' });
  store.navSection = 'docs';
  store.pgBackendMode = true;
  store.scopes = [{ record_id: 'parent', title: 'Parent', level: 'product' }, { record_id: 'dialogue-scope', title: 'Dialogue', level: 'project', parent_id: 'parent', l1_id: 'parent' }];
  store.channels = [{ record_id: 'dialogue', scope_id: 'dialogue-scope', title: 'Dialogue' }, { record_id: 'agent-chat', scope_id: 'dm', title: 'Agent chat' }];
  const queries = [];
  store.createLiveSubscription = (query, onNext) => { queries.push({ query, onNext }); return { unsubscribe() {} }; };
  store.startSharedLiveQueries = vi.fn();
  store.initUnreadTracking = vi.fn();
  sectionLiveQueryMixin.startWorkspaceLiveQueries.call(store);
  for (const spec of queries) await spec.query();
  expect(store.documents).toEqual([]);
  const rows = ['Clean merged copy', 'Original draft'].map((title, index) => mapPgDocToLocal({ id: `spiral-${index}`, title: `Spiral ${title}`, channel_id: 'dialogue', scope_id: 'dialogue-scope', updated_at: '2026-08-27T08:46:50Z', row_version: index ? 58 : 1 }, { workspaceOwnerNpub: 'owner' }));
  await db.documents.bulkPut([...rows, ...Array.from({ length: 60 }, (_, i) => ({ record_id: `new-${i}`, owner_npub: 'owner', title: `New ${i}`, updated_at: '2026-09-08T00:00:00Z', record_state: 'active' })), { ...rows[0], record_id: 'other-owner', owner_npub: 'other' }]);
  // Execute the actual Docs live query after initially empty startup.
  for (const spec of queries) {
    const result = await spec.query();
    if (Array.isArray(result) && result.some(row => row.record_id === 'spiral-0')) spec.onNext(result);
  }
  expect(store.documents).toHaveLength(62);
  store.docFilter = 'Spiral';
  for (const board of ['__all__', 'parent', 'dialogue-scope', '__pg_channel__:dialogue']) {
    store.selectedBoardId = board;
    expect(store.filteredDocBrowserItems.map(row => row.item.record_id), board).toEqual(['spiral-0', 'spiral-1']);
  }
  store.selectedBoardId = '__pg_thread__:dialogue:unrelated-thread';
  expect(store.filteredDocBrowserItems).toEqual([]);
  store.selectedBoardId = '__pg_channel__:agent-chat';
  expect(store.filteredDocBrowserItems).toEqual([]);
  store.closeDocEditor = vi.fn();
  store.selectBoard = vi.fn(id => { store.selectedBoardId = id; });
  store.navigateTo = vi.fn();
  await store.openAllDocuments();
  expect(store.pgContextSelectedChannelId).toBeNull();
  expect(store.pgContextSelectedThreadId).toBeNull();
  store.docFilter = 'Spiral';
  expect(store.filteredDocBrowserItems).toHaveLength(2);
  sectionLiveQueryMixin.stopWorkspaceLiveQueries.call(store);
});

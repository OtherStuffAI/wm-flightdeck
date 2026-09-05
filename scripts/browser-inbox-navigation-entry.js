// Test entry only: real Alpine templates, projections and Dexie subscriptions,
// with an isolated database and synthetic activity. No authentication or network.
import Alpine from 'alpinejs';
import { liveQuery } from 'dexie';
import { openWorkspaceDb } from '../src/db.js';
import { sectionLiveQueryMixin } from '../src/section-live-queries.js';
import { autopilotOverviewManagerMixin } from '../src/autopilot-overview-manager.js';
import { buildSidebarScopeChannelGroups } from '../src/sidebar-navigation.js';

window.startInboxProbe = async () => {
  const db = openWorkspaceDb('inbox-browser');
  await db.open();
  const owner_npub = 'npub1owner';
  const scopes = await db.scopes.toArray();
  const scope_id = scopes[0]?.record_id;
  if (!scope_id) throw new Error('Canonical scopes did not hydrate');
  await db.channels.bulkPut([
    { record_id: 'probe-old', owner_npub, scope_id, title: 'Old inactive channel', is_active: false, updated_at: '2000-01-01' },
    { record_id: 'probe-empty', owner_npub, scope_id, title: 'Empty channel' },
  ]);
  // Replace activity only in this newly created test database. Canonical channel
  // and scope rows remain untouched for the production sidebar mapping check.
  for (const name of ['tasks', 'documents', 'chat_messages', 'comments']) await db.table(name).clear();
  await db.tasks.bulkPut(Array.from({ length: 225 }, (_, i) => ({
    record_id: `probe-task-${i}`, owner_npub, scope_id, title: i >= 200 ? `Older match ${i}` : `Task activity ${i + 1}`,
    state: 'ready', updated_at: new Date(Date.UTC(2026, 8, 5) - i * 1000).toISOString(),
  })));
  await db.documents.put({ record_id: 'probe-doc', owner_npub, scope_id, title: 'Project notes', updated_at: '2026-09-05T01:00:00Z' });
  await db.chat_messages.put({ record_id: 'probe-message', owner_npub, channel_id: 'probe-old', body: 'A recent conversation', updated_at: '2026-09-05T02:00:00Z' });
  const store = Object.defineProperties({}, Object.getOwnPropertyDescriptors(autopilotOverviewManagerMixin));
  Object.assign(store, sectionLiveQueryMixin, {
    currentWorkspaceKey: 'inbox-browser', workspaceOwnerNpub: owner_npub, navSection: 'status',
    channels: [], scopes: [], tasks: [], documents: [], fileMessages: [], fileComments: [],
    fileBrowserRows: [], scopesMap: new Map(),
    createLiveSubscription(query, onNext) { return liveQuery(query).subscribe({ next: onNext, error: error => { throw error; } }); },
    stopLiveSubscription(sub) { sub.unsubscribe(); },
    applyAddressBookPeople() {}, applyWapps() {}, applyDailyNotes() {}, applyDirectories() {},
    applyScopes(rows) { this.scopes = rows; this.scopesMap = new Map(rows.map(r => [r.record_id, r])); },
    applyChannels(rows) { this.channels = rows; }, applyDocuments(rows) { this.documents = rows; },
    applyTasks(rows) { this.tasks = rows; }, applyFileMessages(rows) { this.fileMessages = rows; },
    applyFileComments(rows) { this.fileComments = rows; },
    getScopeBreadcrumb(id) { return this.scopesMap.get(id)?.title || ''; },
    getChannelLabel(c) { return c.title || c.name; }, getScopeLabel() { return ''; },
    canCreateChannelInScope() { return false; }, isChannelUnread() { return false; },
    getAttentionIconSvg() { return ''; }, renderDeckCardText(text) { return Alpine.escapeHtml ? Alpine.escapeHtml(text) : String(text || '').replaceAll('<', '&lt;'); },
    resolveTaskBoardColumnColor() { return '#28785e'; }, formatRelativeTime() { return 'recently'; },
  });
  Object.defineProperty(store, 'sidebarScopeChannelGroups', { get() { return buildSidebarScopeChannelGroups(this.scopes, this.channels); } });
  Alpine.store('chat', store);
  window.probeStore = Alpine.store('chat');
  window.probeStore.startWorkspaceLiveQueries();
  Alpine.start();
};

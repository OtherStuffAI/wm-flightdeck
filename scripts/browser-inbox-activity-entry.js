// Test entry only: real Alpine templates, projections and Dexie subscriptions,
// with an isolated database populated by the canonical production worker. No authentication or network.
import Alpine from 'alpinejs';
import { liveQuery } from 'dexie';
import { openWorkspaceDb } from '../src/db.js';
import { sectionLiveQueryMixin } from '../src/section-live-queries.js';
import { autopilotOverviewManagerMixin } from '../src/autopilot-overview-manager.js';
import { filesManagerMixin } from '../src/files-manager.js';
import { wappPublishingManagerMixin } from '../src/wapp-publishing-manager.js';
import { buildSidebarScopeChannelGroups } from '../src/sidebar-navigation.js';

window.startInboxProbe = async () => {
  const db = openWorkspaceDb('inbox-browser');
  await db.open();
  const owner_npub = 'npub1owner';
  const scopes = await db.scopes.toArray();
  const scope_id = scopes[0]?.record_id;
  if (!scope_id) throw new Error('Canonical scopes did not hydrate');
  window.probeDb = db;
  // Simulate an installed pre-repair cache, without touching canonical rows,
  // commands or cursors. All ownership is still absent from these local rows.
  await db.chat_messages.toCollection().modify(row => { delete row.owner_npub; });
  const store = Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(filesManagerMixin), ...Object.getOwnPropertyDescriptors(wappPublishingManagerMixin), ...Object.getOwnPropertyDescriptors(autopilotOverviewManagerMixin) });
  Object.assign(store, sectionLiveQueryMixin, {
    currentWorkspaceKey: 'inbox-browser', workspaceOwnerNpub: owner_npub, navSection: 'status', isTowerPgMode: true,
    channels: [], scopes: [], tasks: [], documents: [], fileMessages: [], fileComments: [],
    scopesMap: new Map(),
    createLiveSubscription(query, onNext) { return liveQuery(query).subscribe({ next: onNext, error: error => { throw error; } }); },
    stopLiveSubscription(sub) { sub.unsubscribe(); },
    applyAddressBookPeople() {}, applyWapps() {}, applyDailyNotes() {}, applyDirectories() {},
    applyScopes(rows) { this.scopes = rows; this.scopesMap = new Map(rows.map(r => [r.record_id, r])); },
    applyChannels(rows) { this.channels = rows; }, applyDocuments(rows) { this.documents = rows; },
    applyTasks(rows) { this.tasks = rows; }, applyFileMessages(rows) { this.fileMessages = rows; },
    applyFileComments(rows) { this.fileComments = rows; },
    getScopeBreadcrumb(id) { return this.scopesMap.get(id)?.title || ''; },
    getChannelLabel(c) { return c.title || c.name; }, getScopeLabel() { return ''; },
    getChannelParticipants() { return []; }, getSenderName(value) { return value || "Participant"; },
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

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createShellState } from '../src/shell-state.js';
import { taskBoardStateMixin } from '../src/task-board-state.js';
import { buildPgChannelTaskBoardId } from '../src/pg-record-context.js';

function makeStore(section = 'tasks') {
  const store = createShellState({ initialSection: section });
  Object.defineProperties(store, Object.getOwnPropertyDescriptors(taskBoardStateMixin));
  Object.assign(store, {
    navCollapsed: false,
    selectedBoardId: 'scope-old',
    selectedChannelId: null,
    currentWorkspace: { pgBackendMode: true },
    channels: [{ record_id: 'channel-new', scope_id: 'scope-new' }],
    scopes: [{ record_id: 'scope-new', level: 'l1' }],
    tasks: [], messages: [],
    persistSelectedBoardId: vi.fn(), clearSelectedTasks: vi.fn(),
    normalizeTaskFilterTags: vi.fn(), closeBoardPicker: vi.fn(),
    syncRoute: vi.fn(), startWorkspaceLiveQueries: vi.fn(),
    ensureBackgroundSync: vi.fn(), refreshStatusRecentChanges: vi.fn(),
    clearInactiveSectionData: vi.fn(), cancelEditSchedule: vi.fn(),
    saveCurrentChatPresentation: vi.fn(), selectChannel: vi.fn(),
    applyChatPresentation: vi.fn(), refreshMessages: vi.fn(),
    closeThread: vi.fn(), validateSelectedBoardId: vi.fn(),
  });
  return store;
}

describe('Lock into a content view', () => {
  for (const section of ['tasks', 'docs', 'chat', 'files']) {
    it(`retains ${section} through scope and channel selection with new filter context`, async () => {
      const store = makeStore(section);
      store.toggleCurrentViewLock();
      await store.selectWorkContextScope('scope-new');
      expect(store.navSection).toBe(section);
      expect(store.selectedBoardId).toBe('scope-new');
      expect(store.selectedChannelId).toBeNull();
      expect(store.lockedView).toBe(section);
      await store.selectWorkContextChannel('channel-new');
      expect(store.navSection).toBe(section);
      expect(store.selectedBoardId).toBe(buildPgChannelTaskBoardId('channel-new'));
      expect(store.selectedChannelId).toBe('channel-new');
      expect(store.clearInactiveSectionData).not.toHaveBeenCalled();
      expect(store.refreshStatusRecentChanges).not.toHaveBeenCalled();
      expect(store.syncRoute).toHaveBeenCalled();
      expect(store.startWorkspaceLiveQueries).toHaveBeenCalled();
    });
    it(`opens Deck from unlocked ${section}`, async () => {
      const store = makeStore(section);
      await store.selectWorkContextChannel('channel-new');
      expect(store.navSection).toBe('status');
      expect(store.lockedView).toBeNull();
      expect(store.refreshStatusRecentChanges).toHaveBeenCalled();
    });
  }
  it('unlocks on a second click and starts a fresh view unlocked', () => {
    const store = makeStore();
    store.toggleCurrentViewLock();
    store.toggleCurrentViewLock();
    expect(store.lockedView).toBeNull();
    store.toggleCurrentViewLock();
    store.navigateTo('files');
    expect(store.lockedView).toBeNull();
    store.toggleCurrentViewLock();
    expect(store.lockedView).toBe('files');
    store.navigateTo('files');
    expect(store.lockedView).toBe('files');
  });
  it('clears a lock for direct/deep-link section changes without reviving it on return', () => {
    const store = makeStore();
    store.toggleCurrentViewLock();
    store.navSection = 'docs';
    store.navSection = 'tasks';
    expect(store.lockedView).toBeNull();
  });
  it('never locks Deck or Setup and never persists into a new shell', () => {
    for (const section of ['status', 'settings']) {
      const store = makeStore(section);
      store.toggleCurrentViewLock();
      expect(store.canLockCurrentView).toBe(false);
      expect(store.lockedView).toBeNull();
    }
    const store = makeStore();
    store.toggleCurrentViewLock();
    expect(makeStore().lockedView).toBeNull();
    store.navigateTo('status');
    expect(store.lockedView).toBeNull();
  });
  it('gates locking on the scope/channel sidebar and clears it when changing mode', async () => {
    const store = makeStore();
    store.toggleCurrentViewLock();
    store.togglePrimaryNav();
    expect(store.lockedView).toBeNull();
    expect(store.canLockCurrentView).toBe(false);
    store.toggleCurrentViewLock();
    expect(store.lockedView).toBeNull();
    await store.selectWorkContextScope('scope-new');
    expect(store.navSection).toBe('status');
    store.navSection = 'tasks';
    store.mobileNavOpen = true;
    expect(store.canLockCurrentView).toBe(true);
  });
  it('keeps explicit Deck navigation authoritative while locked', () => {
    const store = makeStore();
    store.toggleCurrentViewLock();
    store.selectDeckScope('scope-new');
    expect(store.navSection).toBe('status');
    expect(store.lockedView).toBeNull();
  });
  it('renders independent native toggle buttons with state, tooltip, and focus treatment', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const buttons = html.match(/<button type="button" class="view-lock-button"[\s\S]*?<\/button>/g);
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button).toContain(':aria-pressed="$store.chat.isCurrentViewLocked"');
      expect(button).toContain('aria-label="Lock ');
      expect(button).toContain(':title=');
      expect(button).toContain('@click.stop="$store.chat.toggleCurrentViewLock()"');
    }
  });
});

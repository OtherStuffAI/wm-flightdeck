import { afterEach, describe, expect, it, vi } from 'vitest';

import { taskDetailManagerMixin } from '../src/task-detail-manager.js';

function createTaskDetailStore(overrides = {}) {
  return {
    ...taskDetailManagerMixin,
    showTaskDetail: false,
    activeTaskId: null,
    editingTask: null,
    tasks: [{ record_id: 'task-1', title: 'Task one', description: '' }],
    taskDetailOriginRoute: '',
    releaseCurrentPgTaskDetailLeaseBeforeSwitch: vi.fn(),
    destroyTaskRichDescriptionEditor: vi.fn(),
    applyTaskComments: vi.fn(),
    getTaskAssigneeNpubs: vi.fn(() => []),
    resolveChatProfile: vi.fn(),
    loadTaskComments: vi.fn(),
    scheduleStorageImageHydration: vi.fn(),
    markTaskRead: vi.fn(),
    syncRoute: vi.fn(),
    stopTaskCommentsLiveQuery: vi.fn(),
    isTaskDetailEditing: vi.fn(() => false),
    navigateTo: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('task detail origin-aware Back navigation', () => {
  it('captures the task-board route when a board card opens detail', () => {
    vi.stubGlobal('window', {
      location: { pathname: '/flight-deck/tasks', search: '?scopeid=scope-1&view=list' },
    });
    const store = createTaskDetailStore();

    store.openTaskDetail('task-1');

    expect(store.taskDetailOriginRoute).toBe('/flight-deck/tasks?scopeid=scope-1&view=list');
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('captures a Deck route without changing its useful view state', () => {
    vi.stubGlobal('window', {
      location: { pathname: '/flight-deck/flight-deck', search: '?scopeid=scope-1' },
    });
    const store = createTaskDetailStore({
      navSection: 'tasks',
      summaryPanelPages: { tasks: 2 },
      collapsedSummaryPanels: ['docs'],
    });

    store.openTaskDetail('task-1');

    expect(store.taskDetailOriginRoute).toBe('/flight-deck/flight-deck?scopeid=scope-1');
    expect(store.navSection).toBe('tasks');
    expect(store.summaryPanelPages).toEqual({ tasks: 2 });
    expect(store.collapsedSummaryPanels).toEqual(['docs']);
  });

  it('captures chat thread context and opens its task directly on the full-page route', () => {
    vi.stubGlobal('window', {
      location: { pathname: '/flight-deck/chat', search: '?channelid=channel-1&threadid=thread-1' },
    });
    const store = createTaskDetailStore();

    store.openTaskDetail('task-1');

    expect(store.taskDetailOriginRoute).toBe('/flight-deck/chat?channelid=channel-1&threadid=thread-1');
    expect(store.navSection).toBe('tasks');
    expect(store.showTaskDetail).toBe(true);
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('checkpoints the effective thread route when the visible modal is ahead of the URL', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/flight-deck/chat', search: '?channelid=channel-1' },
      history: { state: { section: 'chat' }, replaceState },
    });
    const store = createTaskDetailStore({
      navSection: 'chat',
      activeThreadId: 'thread-1',
      buildRouteUrl: vi.fn(() => '/flight-deck/chat?channelid=channel-1&threadid=thread-1'),
    });

    store.openTaskDetail('task-1');

    expect(store.taskDetailOriginRoute).toContain('threadid=thread-1');
    expect(replaceState).toHaveBeenCalledWith(
      { section: 'chat' },
      '',
      '/flight-deck/chat?channelid=channel-1&threadid=thread-1',
    );
  });

  it('clears legacy task modal state whenever task detail opens', () => {
    const store = createTaskDetailStore({
      chatTaskModalOpen: true,
      chatTaskModalTitle: 'Legacy modal',
      chatTaskModalFullScreen: true,
    });

    store.openTaskDetail('task-1');

    expect(store.chatTaskModalOpen).toBe(false);
    expect(store.chatTaskModalTitle).toBe('');
    expect(store.chatTaskModalFullScreen).toBe(false);
  });

  it('restores the recorded origin when browser Forward reapplies a task-detail route', () => {
    const store = createTaskDetailStore();

    store.openTaskDetail('task-1', {
      captureOrigin: false,
      originRoute: '/flight-deck/flight-deck?scopeid=scope-1',
    });

    expect(store.taskDetailOriginRoute).toBe('/flight-deck/flight-deck?scopeid=scope-1');
  });

  it('uses browser Back only for the matching in-app task-detail history entry', async () => {
    const back = vi.fn();
    vi.stubGlobal('window', {
      history: { state: { taskDetailOriginRoute: '/flight-deck/flight-deck' }, length: 3, back },
    });
    const store = createTaskDetailStore({
      showTaskDetail: true,
      activeTaskId: 'task-1',
      editingTask: { record_id: 'task-1' },
      taskDetailOriginRoute: '/flight-deck/flight-deck',
    });

    await store.returnFromTaskDetail();

    expect(back).toHaveBeenCalledTimes(1);
    expect(store.navigateTo).not.toHaveBeenCalled();
    expect(store.syncRoute).not.toHaveBeenCalled();
  });

  it('replaces a direct task deep link with the task-board fallback', async () => {
    vi.stubGlobal('window', {
      history: { state: { section: 'tasks' }, length: 3, back: vi.fn() },
    });
    const store = createTaskDetailStore({
      showTaskDetail: true,
      activeTaskId: 'task-1',
      editingTask: { record_id: 'task-1' },
      taskDetailOriginRoute: '',
    });

    await store.returnFromTaskDetail();

    expect(window.history.back).not.toHaveBeenCalled();
    expect(store.navigateTo).toHaveBeenCalledWith('tasks', { syncRoute: false });
    expect(store.syncRoute).toHaveBeenCalledWith(true);
  });
});

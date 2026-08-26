import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getResourceViewState,
  getResourceViewStates,
  openWorkspaceDb,
  replaceResourceViewStates,
  upsertResourceViewState,
} from '../src/db.js';
import { hydrateTowerPgEventUpdates } from '../src/pg-read-hydrator.js';
import { unreadStoreMixin } from '../src/unread-store.js';

beforeEach(async () => {
  const db = openWorkspaceDb('resource-view-state-db-workspace');
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

function state(overrides = {}) {
  return {
    record_id: 'task:task-a', resource_type: 'task', resource_id: 'task-a',
    viewer_actor_id: 'actor-viewer',
    scope_id: 'scope-a', channel_id: 'channel-a', activity_version: 4,
    viewed_activity_version: 2, row_version: 1, sync_status: 'synced',
    updated_at: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

describe('resource view-state Dexie materialization', () => {
  it('persists the accepted post-transition task version as the read watermark', async () => {
    await upsertResourceViewState(state({ activity_version: 7, viewed_activity_version: 6 }));
    const commandTowerWorkspace = vi.fn(async (_name, input) => ({
      state: state({
        activity_version: input.args[3],
        viewed_activity_version: input.args[3],
        row_version: 2,
      }),
    }));
    const store = {
      isTowerPgMode: true,
      currentWorkspace: {
        pgBackendMode: true,
        workspaceId: 'workspace-1',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'npub1app',
      },
      tasks: [{ record_id: 'task-a', state: 'done', activity_version: 7 }],
      _unreadThreadItems: {},
      _unreadTaskItems: { 'task-a': true },
      _unreadDocItems: {},
      _unreadChannels: {},
      commandTowerWorkspace,
      applyTowerPgResourceViewStates: unreadStoreMixin.applyTowerPgResourceViewStates,
      markTowerPgResourceViewed: unreadStoreMixin.markTowerPgResourceViewed,
    };

    await expect(unreadStoreMixin.markTaskRead.call(store, 'task-a', 8)).resolves.toBe(true);

    expect(commandTowerWorkspace).toHaveBeenCalledWith(
      'resource-view-state.put',
      expect.objectContaining({ args: expect.arrayContaining(['workspace-1', 'task', 'task-a', 8]) }),
      expect.any(Object),
    );
    expect(await getResourceViewState('task', 'task-a')).toMatchObject({
      viewer_actor_id: 'actor-viewer',
      activity_version: 8,
      viewed_activity_version: 8,
    });
    expect(store._unreadTaskItems).toEqual({});
  });

  it('suppresses matching-actor task updates but keeps different-actor updates unread', () => {
    const matchingStore = {
      tasks: [{ record_id: 'task-a', updated_at: '2026-01-01T00:02:00.000Z', pg_updated_by_actor_id: 'actor-viewer' }],
      taskComments: [],
      _unreadThreadItems: {}, _unreadTaskItems: {}, _unreadDocItems: {}, _unreadChannels: {},
    };
    unreadStoreMixin.applyTowerPgResourceViewStates.call(matchingStore, [state()]);
    expect(matchingStore._unreadTaskItems).toEqual({});
    expect(matchingStore._unreadTasks).toBe(false);
    expect(matchingStore._unreadChannels).toEqual({});

    const differentStore = {
      ...matchingStore,
      tasks: [{ record_id: 'task-a', updated_at: '2026-01-01T00:02:00.000Z', pg_updated_by_actor_id: 'actor-other' }],
    };
    unreadStoreMixin.applyTowerPgResourceViewStates.call(differentStore, [state()]);
    expect(differentStore._unreadTaskItems).toEqual({ 'task-a': true });
    expect(differentStore._unreadTasks).toBe(true);
    expect(differentStore._unreadChannels).toEqual({ 'channel-a': true });
  });

  it('suppresses matching-actor task comments but keeps different-actor comments unread', () => {
    const store = {
      tasks: [{ record_id: 'task-a', updated_at: '2026-01-01T00:01:00.000Z', pg_updated_by_actor_id: 'actor-other' }],
      taskComments: [{
        record_id: 'comment-a', target_record_id: 'task-a', pg_record_type: 'task_comment',
        updated_at: '2026-01-01T00:02:00.000Z', pg_created_by_actor_id: 'actor-viewer',
      }],
      _unreadThreadItems: {}, _unreadTaskItems: {}, _unreadDocItems: {}, _unreadChannels: {},
    };
    unreadStoreMixin.applyTowerPgResourceViewStates.call(store, [state()]);
    expect(store._unreadTaskItems).toEqual({});

    store.taskComments[0] = { ...store.taskComments[0], pg_created_by_actor_id: 'actor-other' };
    unreadStoreMixin.applyTowerPgResourceViewStates.call(store, [state()]);
    expect(store._unreadTaskItems).toEqual({ 'task-a': true });
  });

  it('never regresses a newer optimistic viewed version with stale server or SSE state', async () => {
    await upsertResourceViewState(state({ viewed_activity_version: 4, sync_status: 'pending' }));
    await upsertResourceViewState(state({ viewed_activity_version: 2, activity_version: 5 }));
    expect(await getResourceViewState('task', 'task-a')).toMatchObject({
      viewed_activity_version: 4, sync_status: 'pending',
    });
  });

  it('removes inaccessible/deleted synced descendants while preserving offline writes', async () => {
    await upsertResourceViewState(state());
    await upsertResourceViewState(state({
      record_id: 'document:doc-a', resource_type: 'document', resource_id: 'doc-a', sync_status: 'pending',
    }));
    await replaceResourceViewStates([]);
    expect(await getResourceViewStates()).toEqual([expect.objectContaining({
      record_id: 'document:doc-a', sync_status: 'pending',
    })]);
  });

  it('monotonically consumes the viewer-scoped Tower SSE payload and refreshes aggregates', async () => {
    await upsertResourceViewState(state({ viewed_activity_version: 3, activity_version: 4 }));
    const refreshUnreadFlags = vi.fn(async () => {});
    await hydrateTowerPgEventUpdates({ refreshUnreadFlags }, [{
      event_type: 'flightdeck_pg.resource_view_state.updated',
      entity_type: 'resource_view_state',
      entity_id: 'task-a',
      payload: {
        viewer_actor_id: 'actor-a', resource_type: 'task', resource_id: 'task-a',
        activity_version: 4, viewed_activity_version: 4, row_version: 2,
      },
    }]);
    expect(await getResourceViewState('task', 'task-a')).toMatchObject({
      activity_version: 4, viewed_activity_version: 4,
    });
    expect(refreshUnreadFlags).toHaveBeenCalledOnce();
  });
});

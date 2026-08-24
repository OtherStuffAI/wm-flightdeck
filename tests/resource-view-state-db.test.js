import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getResourceViewState,
  getResourceViewStates,
  openWorkspaceDb,
  replaceResourceViewStates,
  upsertResourceViewState,
} from '../src/db.js';
import { hydrateTowerPgEventUpdates } from '../src/pg-read-hydrator.js';

beforeEach(async () => {
  const db = openWorkspaceDb('resource-view-state-db-workspace');
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

function state(overrides = {}) {
  return {
    record_id: 'task:task-a', resource_type: 'task', resource_id: 'task-a',
    scope_id: 'scope-a', channel_id: 'channel-a', activity_version: 4,
    viewed_activity_version: 2, row_version: 1, sync_status: 'synced',
    updated_at: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

describe('resource view-state Dexie materialization', () => {
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

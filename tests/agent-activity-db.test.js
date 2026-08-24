import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAgentActivity,
  getAgentActivitiesForChannel,
  getAgentActivityCommentaryForChannel,
  mergeAgentActivityCommentary,
  pruneExpiredAgentActivities,
  openWorkspaceDb,
  replacePgAgentActivitiesForChannel,
  upsertAgentActivity,
} from '../src/db.js';

const TEST_WORKSPACE = 'agent-activity-db-workspace';

beforeEach(async () => {
  const db = openWorkspaceDb(TEST_WORKSPACE);
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

function row(overrides = {}) {
  return {
    record_id: 'row-1', activity_id: 'activity-1', channel_id: 'channel-1', thread_id: 'thread-1',
    turn_id: 'turn-1', created_at: '2026-08-10T00:00:00.000Z',
    trigger_message_id: 'message-1', session_id: 'session-1', agent_npub: 'npub1agent',
    state: 'working', visibility: 'user_visible', sequence: 1,
    expires_at: '2999-01-01T00:00:00.000Z', updated_at: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('agent activity db', () => {
  it('keeps newer snapshots when stale SSE work arrives later', async () => {
    await upsertAgentActivity(row({ sequence: 3, summary: 'Newer' }));
    expect(await upsertAgentActivity(row({ sequence: 2, summary: 'Stale' }))).toBe(false);
    expect((await getAgentActivitiesForChannel('channel-1'))[0].summary).toBe('Newer');
  });

  it('replaces reconnect hydration and supports terminal cleanup', async () => {
    await replacePgAgentActivitiesForChannel('channel-1', [row()]);
    expect(await getAgentActivitiesForChannel('channel-1')).toHaveLength(1);
    await clearAgentActivity('row-1');
    expect(await getAgentActivitiesForChannel('channel-1')).toEqual([]);
  });

  it('keeps turn B working when a turn A terminal is replayed later', async () => {
    await upsertAgentActivity(row({ record_id: 'row-new', activity_id: 'activity-new', turn_id: 'turn-b', created_at: '2026-08-10T01:00:00.000Z', sequence: 1 }));
    await upsertAgentActivity(row({ record_id: 'row-old', activity_id: 'activity-old', turn_id: 'turn-a', state: 'completed', sequence: 999 }));
    expect(await getAgentActivitiesForChannel('channel-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ record_id: 'row-new', state: 'working', turn_id: 'turn-b' }),
      expect.objectContaining({ record_id: 'row-old', state: 'completed', turn_id: 'turn-a' }),
    ]));
  });

  it('deduplicates repeated commentary only inside one lifecycle', async () => {
    await upsertAgentActivity(row({ sequence: 2, summary: 'Latest commentary' }));
    expect(await upsertAgentActivity(row({ sequence: 2, summary: 'Repeated commentary' }))).toBe(false);
    expect((await getAgentActivitiesForChannel('channel-1'))[0].summary).toBe('Latest commentary');
  });

  it('stores ordered commentary exactly once by workspace, backend, turn, and sequence', async () => {
    const commentary = (sequence, body, turnId = 'turn-1') => ({
      history_key: `workspace-1\u0000https://tower.example\u0000${turnId}\u0000${sequence}`,
      workspace_id: 'workspace-1', backend_url: 'https://tower.example', turn_id: turnId,
      activity_id: 'activity-1', channel_id: 'channel-1', sequence, body,
    });
    expect(await mergeAgentActivityCommentary([
      commentary(2, 'Second'), commentary(1, 'First'), commentary(2, 'Replay'),
    ])).toBe(2);
    expect((await getAgentActivityCommentaryForChannel('channel-1')).map((item) => item.body)).toEqual(['First', 'Second']);

    await upsertAgentActivity(row({ sequence: 2 }));
    expect((await getAgentActivitiesForChannel('channel-1'))[0].commentary_history.map((item) => item.body)).toEqual(['First', 'Second']);
  });

  it('expires commentary with its owning activity lifecycle', async () => {
    await upsertAgentActivity(row({ expires_at: '2026-08-10T00:00:00.000Z' }));
    await mergeAgentActivityCommentary([{
      history_key: 'workspace-1\u0000https://tower.example\u0000turn-1\u00001',
      workspace_id: 'workspace-1', backend_url: 'https://tower.example', turn_id: 'turn-1',
      activity_id: 'activity-1', channel_id: 'channel-1', sequence: 1, body: 'Working',
    }]);
    await pruneExpiredAgentActivities(new Date('2026-08-10T00:00:01.000Z'));
    expect(await getAgentActivitiesForChannel('channel-1')).toEqual([]);
    expect(await getAgentActivityCommentaryForChannel('channel-1')).toEqual([]);
  });

  it('claims a legacy null turn once and preserves immutable created_at', async () => {
    await upsertAgentActivity(row({ turn_id: null, created_at: '2026-08-10T00:00:00.000Z', sequence: 1 }));
    await upsertAgentActivity(row({ turn_id: 'turn-claimed', created_at: '2026-08-10T09:00:00.000Z', sequence: 2 }));
    expect((await getAgentActivitiesForChannel('channel-1'))[0]).toEqual(expect.objectContaining({
      turn_id: 'turn-claimed',
      created_at: '2026-08-10T00:00:00.000Z',
    }));
  });

  it('merges reconnect hydration containing terminal A plus active B', async () => {
    await replacePgAgentActivitiesForChannel('channel-1', [
      row({ record_id: 'row-a', activity_id: 'activity-a', turn_id: 'turn-a', state: 'completed', sequence: 50 }),
      row({ record_id: 'row-b', activity_id: 'activity-b', turn_id: 'turn-b', created_at: '2026-08-10T02:00:00.000Z', sequence: 1 }),
    ]);
    expect(await getAgentActivitiesForChannel('channel-1')).toHaveLength(2);
  });
});

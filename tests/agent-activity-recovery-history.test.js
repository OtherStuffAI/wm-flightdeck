import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openWorkspaceDb, deleteWorkspaceDb, getAgentActivitiesForChannel, getAgentActivityCommentaryForChannel, getSyncState } from '../src/db.js';
import { hydrateTowerPgChannelAgentActivities, hydrateTowerPgEventUpdates } from '../src/pg-read-hydrator.js';

const key = 'agent-history-recovery-regression';
const target = () => ({ backendUrl: 'https://tower.example', workspaceOwnerNpub: 'owner', currentWorkspace: {
  workspaceId: 'workspace', workspaceOwnerNpub: 'owner', directHttpsUrl: 'https://tower.example', appNpub: 'app', pgBackendMode: true,
} });
const activity = (sequence = 1, extra = {}) => ({ id: 'row', activity_id: 'activity', turn_id: 'turn', workspace_id: 'workspace',
  channel_id: 'channel', thread_id: 'thread', visibility: 'user_visible', state: 'working', sequence,
  body: `Entry ${sequence}`, expires_at: '2020-01-01T00:00:00Z', ...extra });
const commentary = (sequence) => ({ activity_id: 'activity', turn_id: 'turn', sequence, state: 'working', visibility: 'user_visible', body: `Entry ${sequence}` });
const event = (row) => ({ entity_type: 'agent_activity', channel_id: row.channel_id, payload: { agent_activity: row } });
const read = async (store, rows, options = {}) => hydrateTowerPgChannelAgentActivities(store, 'channel', {
  getTowerPgAgentActivities: async () => ({ agent_activities: rows }), ...options,
});
beforeEach(async () => { await openWorkspaceDb(key).open(); });
afterEach(async () => { await deleteWorkspaceDb(key); });

describe('durable activity history materialisation', () => {
  it('preserves every burst entry in sequence order across replay and expiry reload', async () => {
    const store = target();
    const rows = [3, 1, 2, 3].map((sequence) => event(activity(sequence)));
    rows.push(event(activity(999, { workspace_id: 'another-workspace', body: 'Wrong workspace' })));
    rows.push(event(activity(4, { commentary_history: [{ ...commentary(4), turn_id: 'wrong-turn' }] })));
    await hydrateTowerPgEventUpdates(store, rows);
    await hydrateTowerPgEventUpdates(store, rows);
    expect((await getAgentActivityCommentaryForChannel('channel')).map((row) => row.body)).toEqual(['Entry 1', 'Entry 2', 'Entry 3']);
    expect((await getAgentActivitiesForChannel('channel'))[0].sequence).toBe(4);
    openWorkspaceDb(key).close();
    await openWorkspaceDb(key).open();
    expect((await getAgentActivitiesForChannel('channel'))[0].commentary_history).toHaveLength(3);
  });

  it('merges late commentary carried by terminal SSE without reverting terminal state', async () => {
    const store = target();
    await read(store, [activity(10, { state: 'completed', commentary_history: [commentary(2)] })]);
    await hydrateTowerPgEventUpdates(store, [event(activity(10, { state: 'completed', commentary_history: [commentary(1)] }))]);
    await hydrateTowerPgEventUpdates(store, [event(activity(3))]);
    const [row] = await getAgentActivitiesForChannel('channel');
    expect(row.state).toBe('completed');
    expect(row.commentary_history.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it('recovers forward pages after a failure without checkpointing undelivered data', async () => {
    const store = target();
    await read(store, [activity(1, { commentary_history: [commentary(1)], commentary_next_before_sequence: null })], { recover: true });
    const checkpointKey = 'agent-commentary-recovery:workspace:https://tower.example:activity:turn';
    expect((await getSyncState(checkpointKey)).sequence).toBe(1);
    const request = vi.fn(async (_workspace, options) => {
      if (!options.activityId) return { agent_activities: [activity(450, { state: 'completed', commentary_history: [commentary(450)] })] };
      throw new Error('network failed');
    });
    await expect(read(store, [], { recover: true, getTowerPgAgentActivities: request })).rejects.toThrow('network failed');
    expect((await getSyncState(checkpointKey)).sequence).toBe(1);
    request.mockImplementation(async (_workspace, options) => {
      if (!options.activityId) return { agent_activities: [activity(450, { state: 'completed', commentary_history: [commentary(450)] })] };
      const after = options.afterSequence;
      const end = Math.min(after + options.historyLimit, 450);
      return { agent_activities: [activity(450, { state: 'completed',
        commentary_history: Array.from({ length: end - after }, (_, index) => commentary(after + index + 1)),
        commentary_next_after_sequence: end < 450 ? end : null,
        commentary_next_before_sequence: null,
      })] };
    });
    const first = await read(store, [], { recover: true, getTowerPgAgentActivities: request });
    expect(first.recovery_pending).toBe(true);
    expect((await getSyncState(checkpointKey)).sequence).toBe(201);
    expect((await getAgentActivityCommentaryForChannel('channel'))).toHaveLength(202);
    await read(store, [], { recover: true, getTowerPgAgentActivities: request });
    const last = await read(store, [], { recover: true, getTowerPgAgentActivities: request });
    expect(last.recovery_pending).toBe(false);
    expect((await getSyncState(checkpointKey)).sequence).toBe(450);
    expect((await getAgentActivityCommentaryForChannel('channel'))).toHaveLength(450);
    expect((await getAgentActivitiesForChannel('channel'))[0].state).toBe('completed');
  });

  it('keeps older-history pagination separate from forward recovery and snapshot freshness', async () => {
    const store = target();
    await read(store, [activity(100, { commentary_history: [commentary(100)], commentary_next_before_sequence: 100 })]);
    await read(store, [activity(100, { commentary_history: [commentary(50)], commentary_next_before_sequence: 50 })], { activityId: 'activity', beforeSequence: 100 });
    await read(store, [activity(101, { commentary_history: [commentary(101)], commentary_next_before_sequence: null })], { activityId: 'activity', afterSequence: 100 });
    expect((await getAgentActivitiesForChannel('channel'))[0].commentary_next_before_sequence).toBe(50);
    await read(store, [activity(101, { commentary_history: [commentary(1)], commentary_next_before_sequence: null })], { activityId: 'activity', beforeSequence: 50 });
    await read(store, [activity(102, { commentary_next_before_sequence: 100 })]);
    expect((await getAgentActivitiesForChannel('channel'))[0].commentary_next_before_sequence).toBe(null);
  });

  it('recovers late lower-sequence commentary after terminal using an exact bigint delivery cursor', async () => {
    const store = target();
    const checkpointKey = 'agent-commentary-recovery:workspace:https://tower.example:activity:turn';
    const priorCursor = '9007199254740993';
    const lateCursor = '9007199254740994';
    const latest = Array.from({ length: 50 }, (_, index) => commentary(index + 101));
    await read(store, [activity(200, { state: 'completed', commentary_cursor: priorCursor, commentary_history: latest, commentary_next_before_sequence: 101 })], { recover: true });
    expect((await getSyncState(checkpointKey)).deliveryCursor).toBe(priorCursor);
    const request = vi.fn(async (_workspace, options) => ({ agent_activities: [activity(200, {
      state: 'completed', commentary_cursor: lateCursor,
      commentary_history: options.activityId ? [commentary(1)] : latest,
      commentary_next_cursor: null, commentary_next_before_sequence: options.activityId ? null : 101,
    })] }));
    await read(store, [], { recover: true, getTowerPgAgentActivities: request });
    expect(request.mock.calls[1][1]).toMatchObject({ activityId: 'activity', afterCommentaryCursor: priorCursor, historyLimit: 200 });
    expect(request.mock.calls[1][1].afterSequence).toBeUndefined();
    const [row] = await getAgentActivitiesForChannel('channel');
    expect(row.sequence).toBe(200);
    expect(row.state).toBe('completed');
    expect(row.commentary_next_before_sequence).toBe(101);
    expect(row.commentary_history.map((item) => item.sequence)).toEqual([1, ...Array.from({ length: 50 }, (_, index) => index + 101)]);
    expect((await getSyncState(checkpointKey)).deliveryCursor).toBe(lateCursor);
    request.mockClear();
    await read(store, [], { recover: true, getTowerPgAgentActivities: request });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('materializes summary-only explicit commentary and stale-page history coverage', async () => {
    const store = target();
    await hydrateTowerPgEventUpdates(store, [event(activity(10, { body: '', summary: 'Visible summary' }))]);
    await read(store, [activity(9, { commentary_history: [commentary(1)], commentary_next_before_sequence: null })], { activityId: 'activity', beforeSequence: 9 });
    const [row] = await getAgentActivitiesForChannel('channel');
    expect(row.sequence).toBe(10);
    expect(row.commentary_next_before_sequence).toBe(null);
    expect(row.commentary_history.map((item) => item.body)).toEqual(['Entry 1', 'Visible summary']);
  });

  it('rejects cross-turn exact recovery and stale workspace completions', async () => {
    const store = target();
    await read(store, [activity(1)]);
    await read(store, [activity(2, { turn_id: 'other', commentary_history: [{ ...commentary(2), turn_id: 'other' }] })], { activityId: 'activity', turnId: 'turn' });
    expect((await getAgentActivitiesForChannel('channel'))[0].sequence).toBe(1);
    await read(store, [], { getTowerPgAgentActivities: async () => {
      store.currentWorkspace.workspaceId = 'changed';
      return { agent_activities: [activity(3, { commentary_history: [commentary(3)] })] };
    } });
    expect((await getAgentActivitiesForChannel('channel'))[0].sequence).toBe(1);
    expect(await getAgentActivityCommentaryForChannel('channel')).toHaveLength(0);
  });
});

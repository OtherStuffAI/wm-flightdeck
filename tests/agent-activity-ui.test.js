import { describe, expect, it, vi } from 'vitest';
import './setup.js';
import { chatMessageManagerMixin } from '../src/chat-message-manager.js';

function store() {
  return Object.assign(Object.create(chatMessageManagerMixin), {
    currentWorkspace: { workspaceId: 'workspace-a' }, backendUrl: 'https://tower.example',
    activeThreadId: 'thread-a', activeChannelId: 'channel-a', sseStatus: 'connected',
    expandedAgentActivityIds: {}, agentActivities: [],
    getThreadParentMessage: () => null, getSenderName: () => 'Agent',
    revealPendingThreadAgentActivity() {}, updateResponseActivityTimer() {},
    requestTowerSyncFamily: vi.fn(async () => Object.assign([], { next_cursor: null })),
  });
}
function activity(overrides = {}) {
  return { record_id: 'row', activity_id: 'activity', turn_id: 'turn', channel_id: 'channel-a',
    state: 'working', sequence: 2, visibility: 'user_visible', expires_at: '2999-01-01T00:00:00Z',
    commentary_history: [{ history_key: 'one', turn_id: 'turn', activity_id: 'activity', sequence: 1, body: 'Visible update' }], ...overrides };
}

describe('activity presentation and user-requested bounded history loading', () => {
  it('shows recovery failures without exposing backend error details', () => {
    const target = store();
    target.agentActivityRecoveryError = 'secret transport diagnostics';
    target.agentActivityRecoveryAttempts = 1;
    expect(target.getAgentActivityRecoveryMessage(activity())).toBe('Activity updates could not be recovered. Retrying.');
    target.agentActivityRecoveryAttempts = 3;
    expect(target.getAgentActivityRecoveryMessage(activity())).toBe('Activity updates could not be recovered. Retrying with background sync.');
    expect(target.getAgentActivityRecoveryMessage(activity({ state: 'completed' }))).toBe('');
  });

  it.each(['completed', 'failed', 'cancelled'])('collapses confirmed %s, keeps history accessible after refresh', (state) => {
    const target = store();
    target.applyAgentActivities([activity()]);
    target.toggleAgentActivity('activity');
    expect(target.isAgentActivityExpanded('activity')).toBe(true);
    target.applyAgentActivities([activity({ state, sequence: 3 })]);
    expect(target.isAgentActivityExpanded('activity')).toBe(false);
    expect(target.formatAgentActivityTitle(target.agentActivities[0])).toBe(`Agent ${state}`);
    const reloaded = store();
    reloaded.applyAgentActivities(target.agentActivities);
    expect(reloaded.getVisibleAgentActivities()).toHaveLength(1);
    expect(reloaded.hasAgentActivityCommentaryHistory(reloaded.agentActivities[0])).toBe(true);
    reloaded.toggleAgentActivity('activity');
    reloaded.toggleAgentActivityHistory(reloaded.agentActivities[0]);
    expect(reloaded.isAgentActivityHistoryExpanded(reloaded.agentActivities[0])).toBe(true);
    expect(reloaded.getAgentActivityCommentaryHistory(reloaded.agentActivities[0])[0].body).toBe('Visible update');
  });

  it('loads one commentary page through the sync service and exposes retry after failure', async () => {
    const target = store();
    const row = activity({ commentary_next_before_sequence: 15 });
    target.requestTowerSyncFamily.mockRejectedValueOnce(new Error('offline'));
    await target.loadEarlierAgentActivityHistory(row);
    expect(target.getAgentActivityHistoryLoadState(row)).toBe('failed');
    await target.loadEarlierAgentActivityHistory(row);
    expect(target.getAgentActivityHistoryLoadState(row)).toBe('');
    expect(target.requestTowerSyncFamily).toHaveBeenLastCalledWith('agent-activity-history', 'channel-a:activity:15', {
      channelId: 'channel-a', activityId: 'activity', turnId: 'turn', beforeSequence: 15,
    });
    expect(target.agentActivities).toEqual([]);
  });

  it('coalesces clicks and prevents a late earlier-run page from affecting another workspace', async () => {
    const target = store();
    let resolve;
    target.requestTowerSyncFamily.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const first = target.loadEarlierAgentActivityRuns();
    await target.loadEarlierAgentActivityRuns();
    expect(target.requestTowerSyncFamily).toHaveBeenCalledTimes(1);
    target.currentWorkspace = { workspaceId: 'workspace-b' };
    resolve(Object.assign([], { next_cursor: 'older' }));
    await first;
    expect(target.getAgentActivityRunsLoadState()).toEqual({});
    expect(target.agentActivities).toEqual([]);
  });

  it('follows scoped run cursors and stops at a completed page', async () => {
    const target = store();
    target.requestTowerSyncFamily.mockResolvedValueOnce(Object.assign([], { next_cursor: 'older' }));
    await target.loadEarlierAgentActivityRuns();
    await target.loadEarlierAgentActivityRuns();
    await target.loadEarlierAgentActivityRuns();
    expect(target.requestTowerSyncFamily).toHaveBeenCalledTimes(2);
    expect(target.requestTowerSyncFamily).toHaveBeenLastCalledWith('channel-agent-activities', 'channel-a:thread-a:older', {
      channelId: 'channel-a', threadId: 'thread-a', cursor: 'older',
    });
    expect(target.getAgentActivityRunsLoadState().done).toBe(true);
  });
});

describe('retained run grouping', () => {
  function run(id, overrides = {}) {
    return activity({ record_id: id, activity_id: id, turn_id: id, agent_npub: 'agent-a',
      workspace_id: 'workspace-a', backend_url: 'https://tower.example', thread_id: 'thread-a',
      trigger_message_id: id, created_at: `2026-09-08T0${id}:00:00Z`, ...overrides });
  }
  it('shows only the newest healthy run above two expired retained runs in Chat and Inbox', () => {
    const target = store();
    target.applyAgentActivities([run('1', { expires_at: '2000-01-01' }), run('2', { expires_at: '2000-01-01' }), run('3')]);
    const [current] = target.activeThreadAgentActivities;
    expect(target.activeThreadAgentActivities).toHaveLength(1);
    expect(current.activity_id).toBe('3');
    expect(target.getAgentActivityHealth(current).state).toBe('live');
    expect(current.earlier_activities.map(row => row.activity_id)).toEqual(['2', '1']);
    expect(target.getAgentActivitiesForMessage('1')).toEqual([]);
    expect(target.getAgentActivitiesForMessage('3')).toEqual([current]);
    expect(target.formatEarlierAgentActivityTitle(current.earlier_activities[0])).toBe('Earlier activity · status unconfirmed');
    expect(target.agentActivities).toHaveLength(3);
  });
  it('keeps a late old replay out of the current slot and retains terminal history', () => {
    const target = store();
    target.applyAgentActivities([run('1', { sequence: 999, updated_at: '2999-01-01', state: 'completed' }), run('2')]);
    const [current] = target.activeThreadAgentActivities;
    expect(current.activity_id).toBe('2');
    expect(target.formatEarlierAgentActivityTitle(current.earlier_activities[0])).toBe('Earlier activity · completed');
  });
  it('keeps distinct agents, workspaces, backends and conversations separate', () => {
    const target = store();
    target.applyAgentActivities([run('1'), run('2', { agent_npub: 'agent-b' }),
      run('3', { workspace_id: 'workspace-b' }), run('4', { backend_url: 'https://other.example' }),
      run('5', { thread_id: 'other' }), run('6', { channel_id: 'other' })]);
    expect(target.getVisibleAgentActivities()).toHaveLength(4);
    expect(target.activeThreadAgentActivities.map(row => row.activity_id)).toEqual(['1', '2']);
  });
  it('shows quiet expiry neutrally and warns only the current panel after reconnect grace', () => {
    const target = store();
    target.applyAgentActivities([run('1'), run('2', { expires_at: '2000-01-01' })]);
    const [current] = target.activeThreadAgentActivities;
    expect(target.getAgentActivityHealth(current)).toEqual({ state: 'quiet', message: 'No recent update' });
    target.sseStatus = 'reconnecting';
    target.agentActivityRecoveryStartedAt = Date.now() - 59_000;
    expect(target.getAgentActivityHealth(current).message).toBe('Reconnecting');
    target.agentActivityRecoveryStartedAt -= 2_000;
    expect(target.getAgentActivityHealth(current).message).toBe('Connection lost—status unknown');
    expect(target.activeThreadAgentActivities).toHaveLength(1);
    expect(target.formatEarlierAgentActivityTitle(current.earlier_activities[0])).toContain('status unconfirmed');
  });
});

describe('menu-only activity details', () => {
  it('keeps expiry and completion out of the timeline without deleting history', () => {
    const target = store();
    const row = activity({ thread_id: 'thread-a', expires_at: '2000-01-01' });
    target.agentActivities = [row];
    target.sseStatus = 'reconnecting';
    expect(target.isCurrentAgentActivityWorking(row)).toBe(false);
    target.openAgentActivityDetails();
    expect(target.agentActivityDetailsRows).toHaveLength(1);
    row.expires_at = '2999-01-01';
    expect(target.isCurrentAgentActivityWorking(row)).toBe(true);
    row.state = 'completed';
    expect(target.isCurrentAgentActivityWorking(row)).toBe(false);
    expect(target.agentActivityDetailsRows).toHaveLength(1);
  });

  it('closes and clears displayed details on workspace, backend or thread switches', () => {
    for (const change of [s => s.currentWorkspace = {workspaceId:'other'}, s => s.backendUrl = 'https://other.example', s => s.activeThreadId = 'other']) {
      const target = store();
      target.agentActivities = [activity({thread_id:'thread-a'})];
      target.openAgentActivityDetails();
      expect(target.isAgentActivityDetailsOpen()).toBe(true);
      change(target);
      expect(target.isAgentActivityDetailsOpen()).toBe(false);
      expect(target.agentActivityDetailsRows).toEqual([]);
    }
  });

  it('uses the Inbox parent channel and pages channel history independently', async () => {
    const target = store();
    target.getThreadParentMessage = () => ({channel_id:'inbox-channel',pg_thread_id:'inbox-thread'});
    target.agentActivities = [activity({channel_id:'inbox-channel',thread_id:'inbox-thread'}), activity({record_id:'other',activity_id:'other',thread_id:'thread-a'})];
    target.openAgentActivityDetails('thread');
    expect(target.agentActivityDetailsRows.map(row => row.record_id)).toEqual(['row']);
    await target.loadEarlierAgentActivityRuns();
    expect(target.requestTowerSyncFamily).toHaveBeenLastCalledWith('channel-agent-activities', 'inbox-channel:inbox-thread:first', {channelId:'inbox-channel',threadId:'inbox-thread',cursor:undefined});
    target.openAgentActivityDetails('channel');
    expect(target.agentActivityDetailsRows.map(row => row.record_id)).toEqual(['other']);
    await target.loadEarlierAgentActivityRuns('channel');
    expect(target.requestTowerSyncFamily).toHaveBeenLastCalledWith('channel-agent-activities', 'channel-a:null:first', {channelId:'channel-a',threadId:null,cursor:undefined});
  });
});

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

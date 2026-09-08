import { describe, expect, it } from 'vitest';

import {
  isVisibleAgentActivity,
  getAgentActivityHealth,
  mapPgAgentActivity,
  reconcileAgentActivity,
  selectVisibleAgentActivities,
} from '../src/agent-activity.js';

function activity(overrides = {}) {
  return mapPgAgentActivity({
    id: 'row-1',
    activity_id: 'activity-1',
    turn_id: 'turn-1',
    channel_id: 'channel-1',
    thread_id: 'thread-1',
    trigger_message_id: 'message-1',
    session_id: 'session-1',
    agent_npub: 'npub1agent',
    state: 'working',
    visibility: 'user_visible',
    sequence: 1,
    summary: 'Running validation',
    body: 'Only explicit commentary is included.',
    expires_at: '2999-01-01T00:00:00.000Z',
    created_at: '2026-08-10T01:00:00.000Z',
    ...overrides,
  });
}

describe('agent activity lifecycle', () => {
  it('replaces only with a newer sequence', () => {
    const current = activity({ sequence: 4, summary: 'Current' });
    expect(reconcileAgentActivity(current, activity({ sequence: 3, summary: 'Stale' }))).toBe(current);
    expect(reconcileAgentActivity(current, activity({ sequence: 5, summary: 'Newer' })).summary).toBe('Newer');
  });

  it.each(['completed', 'failed', 'cancelled'])('keeps terminal state %s as a lifecycle tombstone', (state) => {
    expect(reconcileAgentActivity(activity(), activity({ state, sequence: 2 }))).toEqual(expect.objectContaining({ state }));
  });

  it('rejects unsafe visibility while preserving expired and historical lifecycle rows', () => {
    expect(activity({ visibility: 'hidden_reasoning' })).toBeNull();
    const old = activity({ activity_id: 'old', turn_id: 'old', expires_at: '2000-01-01T00:00:00.000Z' });
    const terminal = activity({ state: 'completed' });
    expect(isVisibleAgentActivity(old)).toBe(true);
    expect(selectVisibleAgentActivities([old, terminal])).toEqual([old, terminal]);
  });

  it.each(['completed', 'failed', 'cancelled'])('retains confirmed %s with later runs and ignores out-of-order replay', (state) => {
    const terminal = activity({ state, sequence: 9 });
    const later = activity({ activity_id: 'later', turn_id: 'later', sequence: 1 });
    expect(selectVisibleAgentActivities([terminal, later, activity({ sequence: 2 })])).toEqual([terminal, later]);
    expect(getAgentActivityHealth(terminal, 'disconnected').state).toBe('finished');
  });

  it('does not deduplicate distinct workspace, backend or turn identities', () => {
    const rows = [activity(), activity({ workspace_id: 'another' }), activity({ turn_id: 'another' })];
    expect(selectVisibleAgentActivities(rows)).toHaveLength(3);
  });

  it('does not reconcile sequence across turn identities', () => {
    const current = activity({ turn_id: 'turn-b', sequence: 2 });
    expect(reconcileAgentActivity(current, activity({ turn_id: 'turn-a', sequence: 999, state: 'completed' }))).toBe(current);
  });

  it.each(['connecting', 'reconnecting', 'disconnected', 'fallback-polling', 'connected'])('keeps received content during %s recovery before and after 60 seconds', (status) => {
    const row = activity();
    const startedAt = 10_000;
    expect(getAgentActivityHealth(row, status, startedAt + 59_999, { startedAt }).message).toBe('Reconnecting');
    expect(getAgentActivityHealth(row, status, startedAt + 60_000, { startedAt }).message).toBe('Connection lost—status unknown');
    expect(selectVisibleAgentActivities([row], status, startedAt + 60_000)).toEqual([row]);
    expect(row.state).toBe('working');
  });

  it('clears uncertainty only when recovery succeeds and leaves expired rows unknown', () => {
    expect(getAgentActivityHealth(activity(), 'connected', Date.now(), { startedAt: 0 }).state).toBe('live');
    const expired = activity({ expires_at: '2000-01-01T00:00:00.000Z' });
    expect(getAgentActivityHealth(expired, 'connected').message).toBe('No recent update');
    expect(selectVisibleAgentActivities([expired])).toEqual([expired]);
  });
});

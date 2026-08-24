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

  it('rejects unsafe visibility and suppresses stale snapshots after reload', () => {
    expect(activity({ visibility: 'hidden_reasoning' })).toBeNull();
    expect(isVisibleAgentActivity(activity({ expires_at: '2000-01-01T00:00:00.000Z' }))).toBe(true);
    expect(isVisibleAgentActivity(activity())).toBe(true);
    expect(selectVisibleAgentActivities([activity({ expires_at: '2000-01-01T00:00:00.000Z' })])).toEqual([]);
  });

  it('shows only the newest run for one thread and agent, including terminal cleanup', () => {
    const older = activity({ record_id: 'row-old', activity_id: 'activity-old', turn_id: 'turn-a', created_at: '2026-08-10T00:00:00.000Z', sequence: 10, body: 'Old run' });
    const received = activity({ record_id: 'row-new', activity_id: 'activity-new', turn_id: 'turn-b', created_at: '2026-08-10T01:00:00.000Z', sequence: 1, state: 'accepted', label: 'Message received' });
    const started = activity({ record_id: 'row-new', activity_id: 'activity-new', turn_id: 'turn-b', created_at: '2026-08-10T01:00:00.000Z', sequence: 2, label: 'Agent started' });
    const thinking = activity({ record_id: 'row-new', activity_id: 'activity-new', turn_id: 'turn-b', created_at: '2026-08-10T01:00:00.000Z', sequence: 3, body: 'Inspecting the event path' });

    expect(selectVisibleAgentActivities([older, received])).toEqual([received]);
    expect(selectVisibleAgentActivities([older, started])).toEqual([started]);
    expect(selectVisibleAgentActivities([older, thinking])).toEqual([thinking]);
    expect(selectVisibleAgentActivities([older, activity({
      record_id: 'row-new', activity_id: 'activity-new', turn_id: 'turn-b', created_at: '2026-08-10T01:00:00.000Z', sequence: 4, state: 'completed',
    })])).toEqual([]);
  });

  it.each(['failed', 'cancelled'])('keeps an older run suppressed after %s cleanup', (state) => {
    const older = activity({ record_id: 'row-old', activity_id: 'activity-old', turn_id: 'turn-a', created_at: '2026-08-10T00:00:00.000Z', sequence: 10 });
    const terminal = activity({ record_id: 'row-new', activity_id: 'activity-new', turn_id: 'turn-b', created_at: '2026-08-10T01:00:00.000Z', sequence: 1, state });
    expect(selectVisibleAgentActivities([older, terminal])).toEqual([]);
  });

  it('does not let a stale older-run event overwrite a newer run', () => {
    const newer = activity({ record_id: 'row-new', activity_id: 'activity-new', turn_id: 'turn-b', created_at: '2026-08-10T01:00:00.000Z', sequence: 1, body: 'Current run' });
    const stale = activity({ record_id: 'row-old', activity_id: 'activity-old', turn_id: 'turn-a', created_at: '2026-08-10T00:00:00.000Z', sequence: 999, state: 'completed', body: 'Stale run' });
    expect(selectVisibleAgentActivities([newer, stale])).toEqual([newer]);
  });

  it('does not reconcile sequence across turn identities', () => {
    const current = activity({ turn_id: 'turn-b', sequence: 2 });
    expect(reconcileAgentActivity(current, activity({ turn_id: 'turn-a', sequence: 999, state: 'completed' }))).toBe(current);
  });

  it('retains blue live activity and suppresses stale, connecting, and failed activity', () => {
    const expired = activity({ expires_at: '2000-01-01T00:00:00.000Z' });
    expect(getAgentActivityHealth(expired, 'connected').state).toBe('stale');
    expect(getAgentActivityHealth(activity(), 'reconnecting').state).toBe('degraded');
    expect(getAgentActivityHealth(activity(), 'fallback-polling').state).toBe('error');
    expect(getAgentActivityHealth(activity(), 'connected').state).toBe('live');
    expect(selectVisibleAgentActivities([activity()], 'connected')).toHaveLength(1);
    expect(selectVisibleAgentActivities([expired], 'connected')).toEqual([]);
    expect(selectVisibleAgentActivities([activity()], 'connecting')).toEqual([]);
    expect(selectVisibleAgentActivities([activity()], 'fallback-polling')).toEqual([]);
  });
});

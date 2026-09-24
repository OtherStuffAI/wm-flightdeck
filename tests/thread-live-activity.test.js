import { describe, expect, it, vi } from 'vitest';
import {
  LIVE_THREAD_ACTIVITY_CAPABILITY,
  liveOverlayAsAgentActivity,
  reconcileLiveThreadActivity,
  ThreadLiveActivityController,
  terminalLiveActivityHasDurableFinal,
} from '../src/thread-live-activity.js';

const event = (patch = {}) => ({
  routing_key: 'route-1',
  session_generation: 1,
  turn_id: 'turn-1',
  sequence: 1,
  cursor: '1',
  lifecycle: 'working',
  commentary: 'Inspecting.',
  activity_status: 'Working',
  timestamp: '2026-09-24T00:00:00Z',
  ...patch,
});

describe('thread live activity reconciliation', () => {
  it('accepts newer generations and higher sequence without duplicates or regression', () => {
    const first = reconcileLiveThreadActivity(null, event());
    expect(reconcileLiveThreadActivity(first, event())).toBe(first);
    expect(reconcileLiveThreadActivity(first, event({ sequence: 0, cursor: '0' }))).toBe(first);
    expect(reconcileLiveThreadActivity(first, event({ sequence: 2, cursor: '2' })).sequence).toBe(
      2,
    );
    expect(
      reconcileLiveThreadActivity(
        first,
        event({ session_generation: 2, turn_id: 'turn-2', sequence: 1 }),
      ).turn_id,
    ).toBe('turn-2');
    expect(reconcileLiveThreadActivity(first, event({ turn_id: 'other', sequence: 99 }))).toBe(
      first,
    );
  });

  it('maps the overlay into the existing activity card shape and yields terminal state to a durable final', () => {
    const row = liveOverlayAsAgentActivity(event(), {
      workspaceId: 'w',
      channelId: 'c',
      threadId: 't',
      agentNpub: 'a',
    });
    expect(row).toMatchObject({
      live_overlay: true,
      state: 'working',
      body: 'Inspecting.',
      visibility: 'user_visible',
    });
    expect(
      terminalLiveActivityHasDurableFinal(event({ lifecycle: 'completed' }), [
        { metadata: { source: 'autopilot_session', turn_id: 'turn-1' } },
      ]),
    ).toBe(true);
  });

  it('silently preserves fallback when the capability is unavailable and clears on close', async () => {
    const createClient = vi.fn();
    const onChange = vi.fn();
    const controller = new ThreadLiveActivityController({ createClient, onChange });
    await controller.open({ connection: { capabilities: [] }, context: {} });
    expect(createClient).not.toHaveBeenCalled();
    expect(controller.overlay).toBeNull();
    controller.setOverlay(event());
    controller.clear();
    expect(controller.overlay).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(LIVE_THREAD_ACTIVITY_CAPABILITY).toBe('flightdeck.live-thread-activity.v1');
  });
});

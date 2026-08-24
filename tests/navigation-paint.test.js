import { describe, expect, it } from 'vitest';

import {
  beginNavigationTiming,
  markNavigationTiming,
  publishNavigationTiming,
  waitForNavigationPaint,
} from '../src/navigation-paint.js';

describe('navigation paint boundary', () => {
  it('waits for Alpine and two animation frames before continuing', async () => {
    const order = [];
    const frames = [];
    const store = { $nextTick: (callback) => { order.push('alpine'); callback(); } };
    const waiting = waitForNavigationPaint(store, {
      requestFrame: (callback) => { frames.push(callback); },
      afterNextTick: () => order.push('tick-mark'),
    }).then(() => order.push('post-paint'));

    await Promise.resolve();
    expect(order).toEqual(['alpine', 'tick-mark']);
    frames.shift()();
    expect(order).toEqual(['alpine', 'tick-mark']);
    frames.shift()();
    await waiting;
    expect(order).toEqual(['alpine', 'tick-mark', 'post-paint']);
  });

  it('uses a deterministic microtask fallback outside browsers', async () => {
    const order = [];
    const waiting = waitForNavigationPaint({}, { requestFrame: null }).then(() => order.push('post-paint'));
    order.push('assigned');
    await waiting;
    expect(order).toEqual(['assigned', 'post-paint']);
  });

  it('keeps diagnostic history bounded and copyable', () => {
    const store = { recentNavigationTimings: [] };
    for (let index = 0; index < 20; index += 1) {
      const timing = beginNavigationTiming(store, 'channel', `channel-${index}`, { cacheHit: true });
      markNavigationTiming(timing, 'stateAssignedAt');
      markNavigationTiming(timing, 'alpineTickAt');
      markNavigationTiming(timing, 'paintAt');
      markNavigationTiming(timing, 'postPaintStartAt');
      markNavigationTiming(timing, 'postPaintEndAt');
      publishNavigationTiming(store, timing);
    }
    expect(store.recentNavigationTimings).toHaveLength(12);
    expect(store.recentNavigationTimings[0].destinationId).toBe('channel-8');
  });
});

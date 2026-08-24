import { describe, expect, it } from 'vitest';
import {
  moveChannelInOrder,
  moveChannelToScopePosition,
  normalizeChannelOrder,
  sortChannelsByOrder,
  sortChannelsByScopePosition,
} from '../src/channel-order.js';

describe('channel order helpers', () => {
  const channels = [
    { record_id: 'chan-a', title: 'A' },
    { record_id: 'chan-b', title: 'B' },
    { record_id: 'chan-c', title: 'C' },
  ];

  it('keeps saved ids first and appends new channels', () => {
    expect(normalizeChannelOrder(['chan-c', 'chan-a'], channels)).toEqual([
      'chan-c',
      'chan-a',
      'chan-b',
    ]);
  });

  it('drops duplicate and stale ids', () => {
    expect(normalizeChannelOrder(['chan-c', 'missing', 'chan-c', 'chan-a'], channels)).toEqual([
      'chan-c',
      'chan-a',
      'chan-b',
    ]);
  });

  it('sorts channels by normalized order', () => {
    expect(sortChannelsByOrder(channels, ['chan-c', 'chan-a']).map((channel) => channel.record_id)).toEqual([
      'chan-c',
      'chan-a',
      'chan-b',
    ]);
  });

  it('moves a dragged channel before the drop target', () => {
    expect(moveChannelInOrder(['chan-a', 'chan-b', 'chan-c'], channels, 'chan-c', 'chan-a')).toEqual([
      'chan-c',
      'chan-a',
      'chan-b',
    ]);
  });

  it('sorts persisted positions within each scope with a deterministic legacy fallback', () => {
    const scoped = [
      { record_id: 'a-legacy-2', scope_id: 'scope-a', position: null, created_at: '2026-01-02T00:00:00Z' },
      { record_id: 'b-2', scope_id: 'scope-b', position: 2, created_at: '2026-01-01T00:00:00Z' },
      { record_id: 'a-2', scope_id: 'scope-a', position: 2, created_at: '2026-01-03T00:00:00Z' },
      { record_id: 'b-1', scope_id: 'scope-b', position: 1, created_at: '2026-01-02T00:00:00Z' },
      { record_id: 'a-1', scope_id: 'scope-a', position: 1, created_at: '2026-01-04T00:00:00Z' },
      { record_id: 'a-legacy-1', scope_id: 'scope-a', position: null, created_at: '2026-01-01T00:00:00Z' },
    ];

    expect(sortChannelsByScopePosition(scoped).map((channel) => channel.record_id)).toEqual([
      'a-1', 'a-2', 'a-legacy-1', 'a-legacy-2', 'b-1', 'b-2',
    ]);
  });

  it('moves upward and downward while shifting only intervening scope siblings', () => {
    const scoped = [
      { record_id: 'a', scope_id: 'scope-a', position: 1 },
      { record_id: 'b', scope_id: 'scope-a', position: 2 },
      { record_id: 'c', scope_id: 'scope-a', position: 3 },
      { record_id: 'other', scope_id: 'scope-b', position: 1 },
    ];

    const upward = moveChannelToScopePosition(scoped, 'c', 1);
    expect(upward.channels.filter((channel) => channel.scope_id === 'scope-a').map((channel) => [channel.record_id, channel.position])).toEqual([
      ['c', 1], ['a', 2], ['b', 3],
    ]);
    expect(upward.channels.find((channel) => channel.record_id === 'other')).toMatchObject({ position: 1 });

    const downward = moveChannelToScopePosition(scoped, 'a', 3);
    expect(downward.channels.filter((channel) => channel.scope_id === 'scope-a').map((channel) => [channel.record_id, channel.position])).toEqual([
      ['b', 1], ['c', 2], ['a', 3],
    ]);
  });

  it('clamps helper requests and reports normalized no-op moves deliberately', () => {
    const scoped = [
      { record_id: 'a', scope_id: 'scope-a', position: 1 },
      { record_id: 'b', scope_id: 'scope-a', position: 2 },
    ];
    expect(moveChannelToScopePosition(scoped, 'a', 1)).toMatchObject({ previousPosition: 1, position: 1, changed: false });
    expect(moveChannelToScopePosition(scoped, 'a', 99)).toMatchObject({ previousPosition: 1, position: 2, changed: true });
  });
});

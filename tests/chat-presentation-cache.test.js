import { describe, expect, it } from 'vitest';
import {
  buildThreadAwarePresentationWindow,
  createChatPresentationCache,
} from '../src/chat-presentation-cache.js';

describe('chat presentation cache', () => {
  it('returns cached entries synchronously and promotes hits in LRU order', () => {
    const cache = createChatPresentationCache(2);
    cache.set('channel:a', { channelId: 'a', messages: [{ record_id: 'a', updated_at: '1' }] });
    cache.set('channel:b', { channelId: 'b', messages: [{ record_id: 'b', updated_at: '2' }] });
    expect(cache.get('channel:a').messages[0].record_id).toBe('a');
    cache.set('channel:c', { channelId: 'c', messages: [{ record_id: 'c', updated_at: '3' }] });
    expect(cache.keys()).toEqual(['channel:a', 'channel:c']);
    expect(cache.peek('channel:b')).toBeNull();
  });

  it('keeps recent roots, their replies, pending rows, and focused context', () => {
    const roots = Array.from({ length: 90 }, (_, index) => ({
      record_id: `root-${index}`,
      updated_at: String(index).padStart(3, '0'),
    }));
    const rows = [
      ...roots,
      { record_id: 'old-reply', parent_message_id: 'root-1', updated_at: '091' },
      { record_id: 'recent-reply', parent_message_id: 'root-89', updated_at: '092' },
      { record_id: 'failed-reply', parent_message_id: 'root-1', sync_status: 'failed', updated_at: '093' },
    ];
    const window = buildThreadAwarePresentationWindow(rows, { rootLimit: 80, focusMessageId: 'old-reply' });
    const ids = new Set(window.map((row) => row.record_id));
    expect(ids.has('root-0')).toBe(false);
    expect(ids.has('root-1')).toBe(true);
    expect(ids.has('old-reply')).toBe(true);
    expect(ids.has('recent-reply')).toBe(true);
    expect(ids.has('failed-reply')).toBe(true);
    expect(window.filter((row) => !row.parent_message_id)).toHaveLength(81);
  });

  it('preserves message object identity inside a cached presentation', () => {
    const cache = createChatPresentationCache();
    const message = { record_id: 'message-1', version: 2, body: 'same', updated_at: '1' };
    cache.set('channel:a', { channelId: 'a', messages: [message] });
    expect(cache.get('channel:a').messages[0]).toBe(message);
  });
});

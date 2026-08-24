import { describe, expect, it, vi } from 'vitest';
import { createRecentActorMentionResolver, rankRecentActorMentions } from '../src/recent-mentions.js';

const people = ['alice', 'bob', 'testagent', 'gone'].map((id) => ({ type: id === 'testagent' ? 'agent' : 'person', id, label: id }));
const message = (id, mentions, created_at, thread_id = '') => ({
  record_id: id,
  thread_id,
  created_at,
  metadata: { mentions: mentions.map((npub) => ({ npub })) },
});

describe('rankRecentActorMentions', () => {
  it('ranks distinct active-thread mentions before newer channel mentions', () => {
    const results = rankRecentActorMentions({
      messages: [
        message('channel', ['alice'], '2026-07-24T03:00:00Z'),
        message('thread-old', ['bob'], '2026-07-24T01:00:00Z', 'thread-1'),
        message('thread-new', ['testagent'], '2026-07-24T02:00:00Z', 'thread-1'),
        message('thread-1', ['gone'], '2026-07-24T00:00:00Z'),
      ],
      threadId: 'thread-1',
      mentionPeople: people,
    });
    expect(results.map((person) => person.id)).toEqual(['testagent', 'bob', 'gone', 'alice']);
  });

  it('excludes the viewer, draft mentions, duplicates, deleted messages, and unresolved actors', () => {
    const results = rankRecentActorMentions({
      messages: [
        message('latest', ['alice', 'unknown', 'bob', 'alice'], '2026-07-24T03:00:00Z'),
        { ...message('deleted', ['testagent'], '2026-07-24T04:00:00Z'), record_state: 'deleted' },
      ],
      mentionPeople: people.filter((person) => person.id !== 'gone'),
      currentUserNpub: 'alice',
      draft: '@[Bob](mention:person:bob)',
    });
    expect(results).toEqual([]);
  });

  it('reads PG mention metadata and respects the compact limit', () => {
    const results = rankRecentActorMentions({
      messages: [{ created_at: '2026-07-24T03:00:00Z', pg_metadata: { mentions: [{ npub: 'alice' }, { npub: 'bob' }] } }],
      mentionPeople: people,
      limit: 1,
    });
    expect(results.map((person) => person.id)).toEqual(['bob']);
  });

  it('does not rescan or rerank messages as the composer draft changes', () => {
    let timestampReads = 0;
    const messages = Array.from({ length: 2_000 }, (_, index) => ({
      record_id: `message-${index}`,
      metadata: { mentions: [{ npub: people[index % people.length].id }] },
      get created_at() {
        timestampReads += 1;
        return new Date(Date.UTC(2026, 6, 24, 0, 0, index)).toISOString();
      },
    }));
    const buildMentionPeople = vi.fn(() => people);
    const resolve = createRecentActorMentionResolver();
    const sourceReferences = [messages, people, 'thread-1'];

    resolve({
      sourceReferences,
      messages,
      threadId: 'thread-1',
      buildMentionPeople,
      draft: '',
      limit: 3,
    });
    expect(timestampReads).toBeGreaterThan(0);
    timestampReads = 0;

    for (let index = 0; index < 100; index += 1) {
      const result = resolve({
        sourceReferences,
        messages,
        threadId: 'thread-1',
        buildMentionPeople,
        draft: `ordinary typing ${index}`,
        limit: 3,
      });
      expect(result).toHaveLength(3);
    }

    expect(buildMentionPeople).toHaveBeenCalledTimes(1);
    expect(timestampReads).toBe(0);
  });

  it('filters actors already present in the draft without rebuilding the rank', () => {
    const buildMentionPeople = vi.fn(() => people);
    const messages = [message('latest', ['alice', 'bob', 'testagent'], '2026-07-24T03:00:00Z')];
    const sourceReferences = [messages, people];
    const resolve = createRecentActorMentionResolver();

    const initial = resolve({ sourceReferences, messages, buildMentionPeople, limit: 2 });
    const withMention = resolve({
      sourceReferences,
      messages,
      buildMentionPeople,
      draft: '@[Test Agent](mention:agent:testagent)',
      limit: 2,
    });

    expect(initial.map((person) => person.id)).toEqual(['testagent', 'bob']);
    expect(withMention.map((person) => person.id)).toEqual(['bob', 'alice']);
    expect(buildMentionPeople).toHaveBeenCalledTimes(1);
  });
});

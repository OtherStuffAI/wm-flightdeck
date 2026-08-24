// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { hydrateMentionComposer, serializeMentionComposer } from '../src/mention-composer.js';

const { alpineStartMock, alpineStoreMock } = vi.hoisted(() => ({
  alpineStartMock: vi.fn(),
  alpineStoreMock: vi.fn(),
}));

vi.mock('alpinejs', () => ({
  default: { store: alpineStoreMock, start: alpineStartMock },
}));

async function createStore() {
  vi.resetModules();
  const { initApp } = await import('../src/app.js');
  initApp();
  return alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
}

function setCaret(node, offset) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

beforeEach(() => {
  document.body.replaceChildren();
  alpineStartMock.mockClear();
  alpineStoreMock.mockClear();
});

describe('recent agent update composer action', () => {
  it('offers an accessible agent-only update pill in both composer rows', () => {
    const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
    const updatePills = html.match(/<button[^>]+recent-mention-update-chip[^>]+>/g) || [];

    expect(updatePills).toHaveLength(2);
    for (const pill of updatePills) {
      expect(pill).toContain(`x-show="person.type === 'agent'"`);
      expect(pill).toContain(`' update please?'`);
      expect(pill).toContain(`:aria-label="'Ask ' + person.label + ' for an update'"`);
    }
  });

  it('classifies an Agents-group member as an agent for the live quick-action condition', async () => {
    const store = await createStore();
    store.selectedChannelId = 'channel-implementation';
    store.channels = [{ record_id: 'channel-implementation', metadata: {} }];
    store.groups = [{ name: 'Agents', member_npubs: ['npub1testagent'] }];
    store.pgWorkspaceMembers = [{ npub: 'npub1testagent', display_name: 'Test Agent', kind: 'human' }];
    store.addressBookPeople = [];
    store.workroomParticipants = [];
    store.channelGrants = [];
    store.messages = [{
      record_id: 'message-1',
      created_at: '2026-07-25T01:05:05.656Z',
      metadata: { mentions: [{ npub: 'npub1testagent', type: 'agent', label: 'Test Agent' }] },
    }];
    store.getSenderName = () => 'Test Agent';
    store.getSenderAvatar = () => '';
    store.getChannelParticipants = () => [];

    expect(store.getRecentMentionChips('message')).toEqual([expect.objectContaining({
      id: 'npub1testagent', label: 'Test Agent', type: 'agent',
    })]);
  });

  it('does not rebuild recent mention candidates for every composer keystroke', async () => {
    const store = await createStore();
    const people = Array.from({ length: 40 }, (_, index) => ({
      id: `npub-${index}`,
      type: index % 5 === 0 ? 'agent' : 'person',
      label: `Person ${index}`,
    }));
    let timestampReads = 0;
    store.messages = Array.from({ length: 2_000 }, (_, index) => ({
      record_id: `message-${index}`,
      thread_id: index % 2 === 0 ? 'thread-1' : '',
      metadata: { mentions: [{ npub: people[index % people.length].id }] },
      get created_at() {
        timestampReads += 1;
        return new Date(Date.UTC(2026, 6, 25, 0, 0, index)).toISOString();
      },
    }));
    store.activeThreadId = 'thread-1';
    store.getMentionPeople = vi.fn(() => people);
    store.getSenderAvatar = vi.fn(() => '');

    store.getRecentMentionChips('thread');
    expect(timestampReads).toBeGreaterThan(0);
    timestampReads = 0;

    for (let index = 0; index < 100; index += 1) {
      store.threadInput = `typing ${index}`;
      store.getRecentMentionChips('thread');
      store.getRecentMentionChips('thread');
    }

    expect(store.getMentionPeople).toHaveBeenCalledTimes(1);
    expect(timestampReads).toBe(0);
  });

  it.each(['message', 'thread'])('prepares a structured %s draft without sending it', async (composer) => {
    const store = await createStore();
    const inputBar = document.createElement('div');
    inputBar.className = composer === 'thread' ? 'thread-input-bar' : 'chat-input-bar';
    const root = document.createElement('div');
    root.contentEditable = 'true';
    root.dataset.chatComposer = composer;
    hydrateMentionComposer(root, 'Existing draft');
    inputBar.append(root);
    const button = document.createElement('button');
    inputBar.append(button);
    document.body.append(inputBar);
    setCaret(root.firstChild, 'Existing'.length);
    const focus = vi.spyOn(root, 'focus');
    const sendMessage = vi.spyOn(store, 'sendMessage');
    const sendThreadReply = vi.spyOn(store, 'sendThreadReply');

    store.insertRecentMention(composer, {
      id: 'npub1testagent',
      type: 'agent',
      label: 'Test Agent',
    }, { currentTarget: button }, ' update please?');

    const expected = 'Existing @[Test Agent](mention:agent:npub1testagent) update please? draft';
    expect(serializeMentionComposer(root)).toBe(expected);
    expect(store[composer === 'thread' ? 'threadInput' : 'messageInput']).toBe(expected);
    expect(store.selectedAgentMentionsByComposer[composer]).toContainEqual({
      label: 'Test Agent',
      type: 'agent',
      npub: 'npub1testagent',
    });
    expect(focus).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendThreadReply).not.toHaveBeenCalled();
  });

  it('keeps the existing quick mention behavior unchanged', async () => {
    const store = await createStore();
    const inputBar = document.createElement('div');
    inputBar.className = 'chat-input-bar';
    const root = document.createElement('div');
    root.contentEditable = 'true';
    root.dataset.chatComposer = 'message';
    inputBar.append(root);
    const button = document.createElement('button');
    inputBar.append(button);
    document.body.append(inputBar);

    store.insertRecentMention('message', {
      id: 'npub1testagent',
      type: 'agent',
      label: 'Test Agent',
    }, { currentTarget: button });

    expect(serializeMentionComposer(root)).toBe('@[Test Agent](mention:agent:npub1testagent) ');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => true),
}));

import { isTowerPgBackendMode } from '../src/backend-mode.js';
import { writeContextManagerMixin } from '../src/write-context-manager.js';

function createStore(overrides = {}) {
  const store = {
    selectedBoardId: '__all__',
    selectedChannelId: 'channel-1',
    channels: [
      { record_id: 'channel-1', scope_id: 'scope-1', title: 'General', record_state: 'active' },
    ],
    ...overrides,
  };
  Object.defineProperties(store, Object.getOwnPropertyDescriptors(writeContextManagerMixin));
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  isTowerPgBackendMode.mockReturnValue(true);
});

describe('write context manager', () => {
  it('does not reuse a stale selected channel when the board is All', () => {
    const store = createStore();

    expect(store.resolvePgWriteContext()).toBeNull();
  });

  it('resolves an explicit channel even when the board is All', () => {
    const store = createStore();

    expect(store.resolvePgWriteContext({ channelId: 'channel-1' })).toMatchObject({
      scopeId: 'scope-1',
      channelId: 'channel-1',
    });
  });

  it('prompts for a channel when the visible board is scope Home', () => {
    const store = createStore({
      selectedBoardId: 'scope-1',
      selectedChannelId: 'channel-1',
    });

    expect(store.resolvePgWriteContext()).toBeNull();
  });

  it('sends pending messages after the user chooses a channel', async () => {
    const sendMessage = vi.fn().mockResolvedValue('sent');
    const selectPgChannelContext = vi.fn();
    const store = createStore({
      showWriteContextModal: true,
      writeContextPendingAction: { type: 'message', payload: { options: {} } },
      writeContextScopeId: 'scope-1',
      writeContextChannelId: 'channel-1',
      writeContextError: '',
      writeContextSubmitting: false,
      sendMessage,
      selectPgChannelContext,
    });

    await expect(store.confirmWriteContextModal()).resolves.toBe('sent');
    expect(selectPgChannelContext).toHaveBeenCalledWith('channel-1');
    expect(sendMessage).toHaveBeenCalledWith({ scopeId: 'scope-1', channelId: 'channel-1' });
    expect(store.showWriteContextModal).toBe(false);
  });

  it('infers the write scope from the selected channel', () => {
    const store = createStore({
      writeContextScopeId: '',
      writeContextChannelId: '',
    });

    store.selectWriteContextChannel('channel-1');

    expect(store.writeContextChannelId).toBe('channel-1');
    expect(store.writeContextScopeId).toBe('scope-1');
  });

  it('filters routing channels by scope and excludes explicitly read-only destinations', () => {
    const store = createStore({
      channels: [
        { record_id: 'channel-1', scope_id: 'scope-1', title: 'Writable', record_state: 'active' },
        { record_id: 'channel-2', scope_id: 'scope-1', title: 'Read only', record_state: 'active', can_write: false },
        { record_id: 'channel-3', scope_id: 'scope-2', title: 'Other scope', record_state: 'active' },
      ],
      writeContextPendingAction: { type: 'deck-thread-create', payload: { options: {} } },
      writeContextScopeId: 'scope-1',
      writeContextChannelId: '',
    });

    expect(store.writeContextChannelOptions.map((channel) => channel.record_id)).toEqual(['channel-1']);
    store.selectWriteContextScope('scope-2');
    expect(store.writeContextChannelId).toBe('');
    expect(store.writeContextChannelOptions.map((channel) => channel.record_id)).toEqual(['channel-3']);
  });

  it('continues routed thread creation only after a matching scope and channel resolve', async () => {
    const beginDeckThreadCreate = vi.fn().mockResolvedValue(true);
    const store = createStore({
      showWriteContextModal: true,
      writeContextPendingAction: { type: 'deck-thread-create', payload: { options: {} } },
      writeContextScopeId: 'scope-1',
      writeContextChannelId: 'channel-1',
      writeContextError: '',
      writeContextSubmitting: false,
      selectPgChannelContext: vi.fn(),
      beginDeckThreadCreate,
    });

    await expect(store.confirmWriteContextModal()).resolves.toBe(true);
    expect(beginDeckThreadCreate).toHaveBeenCalledWith('channel-1', { routed: true });
    expect(store.showWriteContextModal).toBe(false);
    expect(store.writeContextPendingAction).toBeNull();
  });

  it('keeps routed thread creation blocked for a channel outside the selected scope', async () => {
    const store = createStore({
      channels: [
        { record_id: 'channel-1', scope_id: 'scope-1', title: 'One', record_state: 'active' },
        { record_id: 'channel-2', scope_id: 'scope-2', title: 'Two', record_state: 'active' },
      ],
      writeContextPendingAction: { type: 'deck-thread-create', payload: { options: {} } },
      writeContextScopeId: 'scope-1',
      writeContextChannelId: 'channel-2',
      writeContextError: '',
      writeContextSubmitting: false,
    });

    await expect(store.confirmWriteContextModal()).resolves.toBeNull();
    expect(store.writeContextError).toBe('Select a channel before continuing.');
  });
});

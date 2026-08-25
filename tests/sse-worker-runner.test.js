import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/worker/sync-worker.js', () => ({
  runSync: vi.fn(),
  flushPendingWrites: vi.fn(async () => ({ pushed: 0 })),
  pullRecordsForFamilies: vi.fn(async () => ({})),
  pruneOnLogin: vi.fn(),
  checkStaleness: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  getPendingWrites: vi.fn(async () => []),
  getSyncState: vi.fn(async () => null),
  setSyncState: vi.fn(async () => 1),
}));
vi.mock('../src/api.js', () => ({ setBaseUrl: vi.fn() }));
vi.mock('../src/auth/nostr.js', () => ({ setExtensionSignerBridge: vi.fn() }));
vi.mock('../src/crypto/group-keys.js', () => ({
  importDecryptedKeys: vi.fn(),
  setActiveSessionNpub: vi.fn(),
}));
vi.mock('../src/crypto/workspace-keys.js', () => ({ importWorkspaceKeyFromMain: vi.fn() }));

class MockEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.closed = false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, event = {}) {
    this.listeners.get(type)?.(event);
  }

  close() {
    this.closed = true;
  }
}

describe('sync worker SSE handshake integration', () => {
  let posted;
  let dispatch;
  let originalSelf;
  let originalEventSource;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    posted = [];
    originalSelf = globalThis.self;
    originalEventSource = globalThis.EventSource;
    globalThis.self = {
      addEventListener(type, listener) {
        if (type === 'message') dispatch = (data) => listener({ data });
      },
      postMessage(message) {
        posted.push(message);
      },
    };
    MockEventSource.instances = [];
    globalThis.EventSource = MockEventSource;
    await import('../src/worker/sync-worker-runner.js');
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
    if (originalEventSource === undefined) delete globalThis.EventSource;
    else globalThis.EventSource = originalEventSource;
  });

  function latestStatus(status) {
    return posted.filter((message) => message.type === 'sync-worker:sse-status' && message.status === status).at(-1);
  }

  async function flushAsyncConnect() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('signs the newest legacy event id again on reconnect before adding token', () => {
    dispatch({
      type: 'sync-worker:sse-connect',
      ownerNpub: 'npub1owner',
      viewerNpub: 'npub1viewer',
      backendUrl: 'https://tower.example.com',
      workspaceDbKey: 'workspace-db',
      options: {},
    });
    const initial = latestStatus('token-needed');
    expect(initial.signingUrl).toBe('https://tower.example.com/api/v4/workspaces/npub1owner/stream');
    expect(MockEventSource.instances).toHaveLength(0);

    dispatch({
      type: 'sync-worker:sse-token',
      requestId: initial.requestId,
      connectionKey: initial.connectionKey,
      token: 'initial token',
    });
    const firstSource = MockEventSource.instances[0];
    expect(firstSource.url).toBe(`${initial.signingUrl}?token=initial+token`);
    firstSource.emit('connected', { lastEventId: 'event 42/next', data: '{}' });
    firstSource.readyState = 2;
    firstSource.onerror();

    vi.advanceTimersByTime(1_000);
    const reconnect = latestStatus('token-needed');
    expect(reconnect.requestId).not.toBe(initial.requestId);
    expect(reconnect.signingUrl).toBe(
      'https://tower.example.com/api/v4/workspaces/npub1owner/stream?last_event_id=event+42%2Fnext',
    );
    expect(reconnect.signingUrl).not.toContain('token=');

    dispatch({
      type: 'sync-worker:sse-token',
      requestId: reconnect.requestId,
      connectionKey: reconnect.connectionKey,
      token: 'reconnect token',
    });
    expect(MockEventSource.instances[1].url).toBe(`${reconnect.signingUrl}&token=reconnect+token`);
  });

  it('signs only the acknowledged PG cursor again on reconnect', async () => {
    dispatch({
      type: 'sync-worker:sse-connect',
      ownerNpub: 'npub1owner',
      viewerNpub: 'npub1viewer',
      backendUrl: 'https://tower.example.com',
      workspaceDbKey: 'workspace-db',
      options: { pgMode: true, workspaceId: 'workspace-1' },
    });
    await flushAsyncConnect();
    const initial = latestStatus('token-needed');
    dispatch({
      type: 'sync-worker:sse-token', requestId: initial.requestId,
      connectionKey: initial.connectionKey, token: 'initial-token',
    });
    const source = MockEventSource.instances[0];
    source.emit('connected', { data: JSON.stringify({ cursor: 'opaque cursor/7' }) });
    source.emit('flightdeck_pg.event', { data: JSON.stringify({ cursor: 'opaque cursor/7', entity_type: 'agent_activity', entity_id: 'row-1' }) });
    await vi.advanceTimersByTimeAsync(300);
    const batch = latestStatus('pull-complete');
    dispatch({
      type: 'sync-worker:sse-ack',
      batchId: batch.batchId,
      connectionGeneration: batch.connectionGeneration,
      requestedCursor: batch.requestedCursor,
    });
    await flushAsyncConnect();
    const { setSyncState } = await import('../src/db.js');
    expect(setSyncState).toHaveBeenCalledWith(
      'sse_pg_ack_cursor:v1:https%3A%2F%2Ftower.example.com:workspace-1:npub1owner:npub1viewer',
      'opaque cursor/7',
    );
    source.readyState = 2;
    source.onerror();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(latestStatus('token-needed').signingUrl).toBe(
      'https://tower.example.com/api/v4/flightdeck-pg/workspaces/workspace-1/events/stream?cursor=opaque+cursor%2F7',
    );
  });

  it('preserves an event received before disconnect and replays from the last committed cursor after failed materialisation', async () => {
    dispatch({
      type: 'sync-worker:sse-connect', ownerNpub: 'npub1owner', viewerNpub: 'npub1viewer',
      backendUrl: 'https://tower.example.com', workspaceDbKey: 'workspace-db',
      options: { pgMode: true, workspaceId: 'workspace-1' },
    });
    await flushAsyncConnect();
    const initial = latestStatus('token-needed');
    dispatch({ type: 'sync-worker:sse-token', requestId: initial.requestId, connectionKey: initial.connectionKey, token: 'initial' });
    const source = MockEventSource.instances[0];
    source.emit('flightdeck_pg.event', {
      data: JSON.stringify({ cursor: 'cursor-uncommitted', entity_type: 'agent_activity', entity_id: 'row-1' }),
    });
    source.readyState = 2;
    source.onerror();

    await vi.advanceTimersByTimeAsync(300);
    expect(latestStatus('pull-complete')).toMatchObject({
      receivedCursor: 'cursor-uncommitted',
      acknowledgedCursor: null,
      pgEvents: [expect.objectContaining({ entity_id: 'row-1' })],
    });
    await vi.advanceTimersByTimeAsync(700);
    expect(latestStatus('token-needed').signingUrl).toBe(
      'https://tower.example.com/api/v4/flightdeck-pg/workspaces/workspace-1/events/stream',
    );
  });

  it('times out and retries a missing signing response, and retries an explicit failure', async () => {
    dispatch({
      type: 'sync-worker:sse-connect', ownerNpub: 'npub1owner', viewerNpub: 'npub1viewer',
      backendUrl: 'https://tower.example.com', workspaceDbKey: 'workspace-db', options: {},
    });
    const first = latestStatus('token-needed');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(latestStatus('token-failed')).toMatchObject({ reason: 'token-request-timeout' });
    await vi.advanceTimersByTimeAsync(1_000);
    const retry = latestStatus('token-needed');
    expect(retry.requestId).not.toBe(first.requestId);

    dispatch({
      type: 'sync-worker:sse-token', requestId: retry.requestId,
      connectionKey: retry.connectionKey, ok: false, errorCode: 'signer-rejected',
    });
    expect(latestStatus('token-failed')).toMatchObject({ reason: 'token-request-failed' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(latestStatus('token-needed').requestId).not.toBe(retry.requestId);
  });

  it('discards stale and duplicate token responses across a context switch', () => {
    dispatch({
      type: 'sync-worker:sse-connect', ownerNpub: 'owner-1', viewerNpub: 'viewer',
      backendUrl: 'https://tower.example.com', workspaceDbKey: 'workspace-1', options: {},
    });
    const old = latestStatus('token-needed');
    dispatch({
      type: 'sync-worker:sse-connect', ownerNpub: 'owner-2', viewerNpub: 'viewer',
      backendUrl: 'https://tower.example.com', workspaceDbKey: 'workspace-2', options: {},
    });
    const current = latestStatus('token-needed');

    dispatch({ type: 'sync-worker:sse-token', requestId: old.requestId, connectionKey: old.connectionKey, token: 'stale' });
    expect(MockEventSource.instances).toHaveLength(0);
    dispatch({ type: 'sync-worker:sse-token', requestId: current.requestId, connectionKey: current.connectionKey, token: 'current' });
    expect(MockEventSource.instances).toHaveLength(1);
    dispatch({ type: 'sync-worker:sse-token', requestId: current.requestId, connectionKey: current.connectionKey, token: 'duplicate' });
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('discards a pending token after disconnect', () => {
    dispatch({
      type: 'sync-worker:sse-connect', ownerNpub: 'owner-1', viewerNpub: 'viewer',
      backendUrl: 'https://tower.example.com', workspaceDbKey: 'workspace-1', options: {},
    });
    const pending = latestStatus('token-needed');
    dispatch({ type: 'sync-worker:sse-disconnect', options: { reason: 'workspace-switch' } });
    dispatch({
      type: 'sync-worker:sse-token', requestId: pending.requestId,
      connectionKey: pending.connectionKey, token: 'stale',
    });
    expect(MockEventSource.instances).toHaveLength(0);
  });
});

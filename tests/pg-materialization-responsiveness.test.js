import { Worker as NodeWorker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { TowerPgMaterializationWorkerClient } from '../src/tower-pg-materialization-worker-client.js';

class NodeWorkerAdapter {
  constructor(url) {
    this.worker = new NodeWorker(url, { type: 'module' });
    this.listeners = new Map();
    this.worker.on('message', (data) => this.emit('message', { data }));
    this.worker.on('error', (error) => this.emit('error', { error, message: error.message }));
    this.worker.on('messageerror', (error) => this.emit('messageerror', { error, message: error.message }));
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message) {
    this.worker.postMessage(message);
  }

  terminate() {
    void this.worker.terminate();
  }

  emit(type, event) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
}

describe('large PG bundle main-thread responsiveness', () => {
  let client;

  afterEach(() => client?.dispose('test-cleanup'));

  it('keeps the caller event loop responsive during a real 20,000-row Dexie worker transaction', async () => {
    const messages = Array.from({ length: 20_000 }, (_, index) => ({
      id: `message-${index}`,
      channel_id: 'channel-1',
      body: `Synthetic row ${index}`,
    }));
    const bundle = {
      mode: 'delta',
      next_cursor: 'cursor-20000',
      channel_bundles: [{ channel_id: 'channel-1', messages }],
    };
    client = new TowerPgMaterializationWorkerClient({
      workspaceKey: 'responsiveness-workspace',
      workerFactory: () => new NodeWorkerAdapter(
        new URL('./helpers/tower-pg-materialization-load-worker.js', import.meta.url),
      ),
    });

    let ticks = 0;
    let maxEventLoopDelayMs = 0;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, now - previous - 2);
      previous = now;
      ticks += 1;
    }, 2);
    const startedAt = performance.now();
    const result = await client.materialize({
      workspaceDbKey: 'responsiveness-db',
      store: {
        workspaceOwnerNpub: 'npub1owner',
        session: { npub: 'npub1viewer' },
        currentWorkspace: { workspaceId: 'workspace-1' },
      },
      bundle,
    });
    const totalMs = performance.now() - startedAt;
    clearInterval(timer);

    expect(result).toMatchObject({ applied: 20_000, cursor: 'cursor-20000' });
    expect(totalMs).toBeGreaterThanOrEqual(100);
    expect(ticks).toBeGreaterThan(25);
    expect(maxEventLoopDelayMs).toBeLessThan(50);
    console.info(JSON.stringify({
      benchmark: 'tower-pg-materialization-worker',
      rows: 20_000,
      totalMs: Math.round(totalMs),
      mainThreadTicks: ticks,
      maxEventLoopDelayMs: Number(maxEventLoopDelayMs.toFixed(1)),
    }));
  }, 10_000);
});

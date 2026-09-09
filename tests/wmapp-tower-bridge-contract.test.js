import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

// Optional cross-repository proof against the producer's generated production
// script. See docs/fips-transport.md for the reproducible generator command.
const fixturePath = process.env.WMAPP_TOWER_BRIDGE_SCRIPT;
const ports = [];
afterEach(() => { for (const port of ports.splice(0)) port.close(); });

describe.skipIf(!fixturePath)('production WMapp JS / Flight Deck worker contract', () => {
  it('pairs and transfers status, Authorization, binary uploads and streamed responses without public fetch', async () => {
    vi.resetModules();
    const consumer = await import('../src/tower-native-worker-transport.js');
    const endpoint = `http://${nip19.npubEncode('12'.repeat(32))}.fips:41080`;
    const window = new EventTarget();
    window.top = window;
    const requests = new Map();
    let nextId = 0;
    let canceled = false;
    const rpc = async (message) => {
      const { params, method } = message;
      if (method === 'connect') return { version: 2, transport: 'native', ...params };
      if (method === 'open') { const id = String(++nextId); requests.set(id, { ...params, chunks: [], pulls: 0 }); return id; }
      const request = requests.get(params.requestId);
      if (method === 'write') { request.chunks.push(params.chunk); return null; }
      if (method === 'finish') return { status: 201, headers: [['content-type', 'application/octet-stream'], ['x-test', 'preserved']] };
      if (method === 'pull') return request.pulls++ === 0 ? { done: false, chunk: 'AP8K' } : { done: true };
      if (method === 'cancel') { canceled = true; return null; }
      throw new Error('Unexpected producer RPC');
    };
    const context = {
      window, location: { origin: 'https://flightdeck.example' }, Request, Response,
      ReadableStream, AbortController, DOMException, Headers, Event, Uint8Array, atob, btoa, setTimeout, clearTimeout,
      MessageChannel: class extends MessageChannel { constructor() { super(); ports.push(this.port1, this.port2); } },
      WingmanTower: { postMessage(raw) {
        const message = JSON.parse(raw);
        rpc(message).then((result) => window.__wingmanTowerReply(message.token, message.id, result, null),
          () => window.__wingmanTowerReply(message.token, message.id, null, 'fixture error'));
      } },
    };
    runInNewContext(readFileSync(fixturePath, 'utf8'), context);
    const native = window.wingmanTowerTransport;
    expect(await native.connect({ endpoint, serviceNpub: nip19.npubEncode('34'.repeat(32)) })).toMatchObject({ version: 2, endpoint, transport: 'native' });
    const worker = { postMessage(message) { consumer.acceptNativeTowerPort(message); } };
    native.attachWorker(worker);
    const response = await consumer.nativeWorkerFetch(`${endpoint}/api/storage`, {
      method: 'PUT', headers: { Authorization: 'Nostr exact-intended-endpoint' }, body: Uint8Array.of(0, 255, 10),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-test')).toBe('preserved');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(0, 255, 10));
    const sent = [...requests.values()][0];
    expect(sent).toMatchObject({ url: `${endpoint}/api/storage`, method: 'PUT', headers: { authorization: 'Nostr exact-intended-endpoint' }, chunks: ['AP8K'] });
    const openStream = await consumer.nativeWorkerFetch(`${endpoint}/api/events`);
    // Recovering a worker must cancel its native idle streams before terminate.
    native.detachWorker(worker);
    await vi.waitFor(() => expect(canceled).toBe(true));
    await expect(openStream.text()).rejects.toThrow();
  });
});

import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let client;
const ports = [];
beforeEach(async () => {
  vi.resetModules();
  client = await import('../src/tower-native-worker-transport.js');
});
afterEach(() => { for (const port of ports.splice(0)) port.close(); });
function pair(onMessage) {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  port2.on('message', onMessage);
  client.acceptNativeTowerPort({ type: 'wingman-tower-transport-port', port: port1 });
  return port2;
}

it('cancels immediately before port readiness and does not issue a later request', async () => {
  const abort = new AbortController();
  const promise = client.nativeWorkerFetch('http://paired.fips/api', { signal: abort.signal });
  abort.abort();
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  const message = vi.fn();
  pair(message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(message).not.toHaveBeenCalled();
});

it('transfers binary body, status, headers and backpressured response over a real MessageChannel', async () => {
  const seen = [];
  let pulls = 0;
  const peer = pair((message) => {
    seen.push(message);
    if (message.type === 'request') peer.postMessage({ type: 'headers', id: message.id, status: 201, headers: [['content-type', 'application/octet-stream']] });
    if (message.type === 'pull') peer.postMessage(++pulls === 1
      ? { type: 'chunk', id: message.id, bodyBase64: 'AP8K' }
      : { type: 'end', id: message.id });
  });
  const response = await client.nativeWorkerFetch('http://paired.fips/storage', {
    method: 'PUT', body: Uint8Array.of(0, 255, 10), headers: { Authorization: 'signed' },
  });
  expect(response.status).toBe(201);
  expect(pulls).toBe(0);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(0, 255, 10));
  expect(seen[0]).toMatchObject({ method: 'PUT', bodyBase64: 'AP8K', headers: [['authorization', 'signed']] });
  expect(pulls).toBe(2);
});

it('preserves timeout cancellation after headers and forwards cancel to native', async () => {
  const seen = [];
  const peer = pair((message) => {
    seen.push(message);
    if (message.type === 'request') peer.postMessage({ type: 'headers', id: message.id, status: 200, headers: [] });
  });
  const abort = new AbortController();
  const response = await client.nativeWorkerFetch('http://paired.fips/events', { signal: abort.signal });
  const body = response.text();
  abort.abort(new DOMException('timeout', 'TimeoutError'));
  await expect(body).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.waitFor(() => expect(seen.some((message) => message.type === 'cancel')).toBe(true));
});

it('rejects pending requests and streams on port replacement and uses the new port', async () => {
  let opened;
  const old = pair((message) => {
    if (message.type === 'request') { opened = message; old.postMessage({ type: 'headers', id: message.id, status: 200, headers: [] }); }
  });
  const response = await client.nativeWorkerFetch('http://paired.fips/events');
  const body = response.text();
  const fresh = pair((message) => {
    if (message.type === 'request') fresh.postMessage({ type: 'headers', id: message.id, status: 204, headers: [] });
  });
  await expect(body).rejects.toThrow('replaced');
  expect(opened).toBeTruthy();
  expect((await client.nativeWorkerFetch('http://paired.fips/new')).status).toBe(204);
});

it('rejects oversized worker uploads before dispatch and cancels the input stream', async () => {
  const received = vi.fn();
  pair(received);
  const cancel = vi.fn();
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream({ pull(controller) { controller.enqueue(chunk); }, cancel });
  await expect(client.nativeWorkerFetch('http://paired.fips/storage', { method: 'PUT', body })).rejects.toThrow('16 MiB');
  expect(cancel).toHaveBeenCalled();
  expect(received).not.toHaveBeenCalled();
});

it('cancels a worker upload while its input stream is idle', async () => {
  const received = vi.fn();
  pair(received);
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  const abort = new AbortController();
  const request = client.nativeWorkerFetch('http://paired.fips/storage', { method: 'PUT', body, signal: abort.signal });
  await Promise.resolve();
  await Promise.resolve();
  abort.abort(new DOMException('timeout', 'TimeoutError'));
  await expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
  expect(cancel).toHaveBeenCalled();
  expect(received).not.toHaveBeenCalled();
});

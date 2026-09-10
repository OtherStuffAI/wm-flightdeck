import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  connectTowerBridge, exportTowerTransports, getTowerTransport, importTowerTransports,
  initializeTowerTransports, normalizeFipsEndpoint, resolveTowerSigningUrl,
  saveTowerTransportPreference, towerFetch,
} from '../src/tower-transport.js';
import { getSharedDb } from '../src/db.js';
import { NativeTowerEventSource } from '../src/tower-event-source.js';
import { TowerSyncService } from '../src/tower-sync-service.js';

const logicalTower = 'https://tower.example';
const endpoint = `http://${nip19.npubEncode('12'.repeat(32))}.fips:41080`;
const serviceNpub = nip19.npubEncode('34'.repeat(32));
const connection = { mode: 'fips', transport: 'native', endpoint, serviceNpub };
const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
};
const bridge = () => ({
  version: 2, pairingIdentity: 'service-npub',
  available: true,
  disconnect: vi.fn(),
  connect: vi.fn(async (input) => ({ version: 2, pairingIdentity: 'service-npub', transport: 'native', ...input })),
  fetch: vi.fn(async () => Response.json({ status: 'ok', service_npub: serviceNpub })),
});

beforeEach(async () => {
  importTowerTransports([]);
  await getSharedDb().tower_transport_preferences.clear();
});
afterEach(() => { importTowerTransports([]); vi.unstubAllGlobals(); });

describe('paired Tower transport', () => {
  it('accepts exact mesh origins and rejects public targets, userinfo, query/path and invalid npubs', () => {
    expect(normalizeFipsEndpoint(`${endpoint}/`)).toBe(endpoint);
    for (const bad of [logicalTower, 'http://npub1bad.fips:41080', `${endpoint}/api`, `${endpoint}?target=x`, endpoint.replace('http://', 'http://user@'), endpoint.replace('http:', 'https:')]) {
      expect(() => normalizeFipsEndpoint(bad)).toThrow();
    }
  });

  it('verifies Tower identity through the native bridge before persisting only a preference', async () => {
    const native = bridge();
    const paired = await connectTowerBridge(logicalTower, endpoint, serviceNpub, { bridge: native });
    expect(native.connect).toHaveBeenCalledWith({ serviceNpub, endpoint });
    expect(native.fetch).toHaveBeenCalledWith(`${endpoint}/health`, expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    const local = storage();
    await saveTowerTransportPreference(logicalTower, paired);
    expect(await getSharedDb().tower_transport_preferences.get(logicalTower)).toEqual({
      logicalTower, mode: 'fips', endpoint, serviceNpub,
    });
    expect(getTowerTransport(logicalTower)).toEqual({ mode: 'https' });
    await initializeTowerTransports({ storage: local, bridge: native });
    expect(getTowerTransport(logicalTower)).toEqual(connection);
    expect(exportTowerTransports()[0].logicalTower).toBe(logicalTower);
    expect(resolveTowerSigningUrl(`${logicalTower}/api/v4/read?cursor=123`)).toBe(`${endpoint}/api/v4/read?cursor=123`);
    await saveTowerTransportPreference(logicalTower, { mode: 'https' });
    await initializeTowerTransports({ storage: local });
    expect(getTowerTransport(logicalTower).mode).toBe('https');
  });

  it('rejects wrong Tower, incompatible bridge and unsupported clients', async () => {
    const native = bridge();
    await expect(connectTowerBridge(logicalTower, endpoint, 'wrong', { bridge: native })).rejects.toThrow('does not identify');
    await expect(connectTowerBridge(logicalTower, endpoint, serviceNpub, { bridge: { version: 1 } })).rejects.toThrow('requires WMapp');
    native.available = false;
    await expect(connectTowerBridge(logicalTower, endpoint, serviceNpub, { bridge: native })).rejects.toThrow('requires WMapp');
  });

  it('preserves a saved FIPS selection on unavailable reload and never issues public requests', async () => {
    const local = storage();
    await saveTowerTransportPreference(logicalTower, connection);
    const publicFetch = vi.fn();
    vi.stubGlobal('fetch', publicFetch);
    await initializeTowerTransports({ storage: local, bridge: null });
    expect(getTowerTransport(logicalTower).mode).toBe('fips');
    await expect(towerFetch(`${logicalTower}/api/v4/read`)).rejects.toThrow('FIPS unavailable');
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('routes mapped reads/writes through native bytes without cookies, redirects or public fallback', async () => {
    importTowerTransports([{ logicalTower, ...connection }]);
    const native = bridge();
    const publicFetch = vi.fn();
    vi.stubGlobal('window', { wingmanTowerTransport: native });
    vi.stubGlobal('fetch', publicFetch);
    const body = new Uint8Array([0, 255, 10]);
    await towerFetch(`${logicalTower}/api/v4/storage/id`, { method: 'PUT', body, headers: { Authorization: 'exact-signature' }, credentials: 'include' });
    expect(native.fetch).toHaveBeenCalledWith(`${endpoint}/api/v4/storage/id`, expect.objectContaining({ body, credentials: 'omit', redirect: 'error', headers: { Authorization: 'exact-signature' } }));
    native.fetch.mockRejectedValue(new TypeError('offline'));
    await expect(towerFetch(`${logicalTower}/api/v4/read`)).rejects.toThrow('FIPS request failed');
    expect(publicFetch).not.toHaveBeenCalled();
    await expect(towerFetch(endpoint.replace(':41080', ':41081') + '/health')).rejects.toThrow('not been paired');
  });

  it('keeps HTTPS fetch behavior intact without any native capability', async () => {
    const publicFetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', publicFetch);
    const options = { method: 'GET', headers: { Authorization: 'https-signature' } };
    await towerFetch(`${logicalTower}/api/read`, options);
    expect(publicFetch).toHaveBeenCalledWith(`${logicalTower}/api/read`, options);
  });
});

it('parses native SSE across arbitrary UTF-8/CRLF boundaries and closes upstream on cancellation', async () => {
  importTowerTransports([{ logicalTower, ...connection }]);
  let upstream;
  const cancel = vi.fn();
  const native = bridge();
  native.fetch.mockImplementation(async () => new Response(new ReadableStream({ start(c) { upstream = c; }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } }));
  vi.stubGlobal('window', { wingmanTowerTransport: native });
  const source = new NativeTowerEventSource(`${logicalTower}/api/events?cursor=42&token=auth`);
  const received = new Promise((resolve) => source.addEventListener('flightdeck_pg.event', resolve, { once: true }));
  await vi.waitFor(() => expect(upstream).toBeTruthy());
  const bytes = new TextEncoder().encode(': heartbeat\r\nid: cursor43\r\nevent: flightdeck_pg.event\r\ndata: {"text":"é"}\r\ndata: second line\r\n\r\n');
  for (const byte of bytes) upstream.enqueue(Uint8Array.of(byte));
  const event = await received;
  expect(event.lastEventId).toBe('cursor43');
  expect(event.data).toBe('{"text":"é"}\nsecond line');
  expect(native.fetch.mock.calls[0][0]).toBe(`${endpoint}/api/events?cursor=42&token=auth`);
  source.close();
  upstream.close();
  expect(source.readyState).toBe(2);
});

it('settles in-flight service commands before transport reload without replacing workspace ownership', async () => {
  let acknowledge;
  const ports = { disconnectSSE: vi.fn(), stopFlushTimer: vi.fn() };
  const service = new TowerSyncService({ workspaceKey: 'unchanged-logical-workspace', ports });
  const pending = service.coalesce('command', () => new Promise((resolve) => { acknowledge = resolve; }));
  await Promise.resolve();
  let settled = false;
  const reload = service.prepareTransportReload().then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  acknowledge({ row_version: 3 });
  await Promise.all([pending, reload]);
  expect(ports.disconnectSSE).toHaveBeenCalledTimes(1);
  expect(service.workspaceKey).toBe('unchanged-logical-workspace');
  expect(service.disposed).toBe(false);
});

it('retains local rows, queued writes and cursors across FIPS reload and HTTPS selection', async () => {
  const { openWorkspaceDb, addPendingWrite, getPendingWrites, setSyncState, getSyncState, getCurrentWorkspaceDbKey } = await import('../src/db.js');
  const workspaceKey = 'transport-test-workspace';
  const db = openWorkspaceDb(workspaceKey);
  const local = storage();
  try {
    await db.tasks.put({ record_id: 'local-task', owner_npub: 'owner', title: 'Pending edit', version: 7 });
    await addPendingWrite({ record_id: 'local-task', record_family_hash: 'task-family', envelope: { version: 7, previous_version: 6 } });
    await setSyncState('logical-cursor', 'committed-42');
    const writes = await getPendingWrites();
    await saveTowerTransportPreference(logicalTower, connection);
    await initializeTowerTransports({ storage: local, bridge: bridge() });
    expect(getCurrentWorkspaceDbKey()).toBe(workspaceKey);
    expect(await db.tasks.get('local-task')).toMatchObject({ title: 'Pending edit', version: 7 });
    expect(await getPendingWrites()).toEqual(writes);
    expect(await getSyncState('logical-cursor')).toBe('committed-42');
    await saveTowerTransportPreference(logicalTower, { mode: 'https' });
    await initializeTowerTransports({ storage: local });
    expect(await getPendingWrites()).toEqual(writes);
    expect(await db.tasks.count()).toBe(1);
  } finally { await db.delete(); }
});

it('waits for WMapp page-finished injection on saved FIPS reload', async () => {
  const local = storage();
  await saveTowerTransportPreference(logicalTower, connection);
  const window = new EventTarget();
  vi.stubGlobal('window', window);
  const initializing = initializeTowerTransports({ storage: local });
  window.wingmanTowerTransport = bridge();
  window.dispatchEvent(new Event('wingman-tower-transport-ready'));
  await initializing;
  expect(getTowerTransport(logicalTower).transport).toBe('native');
});

it.each(['AbortError', 'TimeoutError'])('preserves %s through page fetch cancellation', async (name) => {
  importTowerTransports([{ logicalTower, ...connection }]);
  const native = bridge();
  const abort = new AbortController();
  native.fetch.mockImplementation(() => new Promise((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('native canceled')))));
  vi.stubGlobal('window', { wingmanTowerTransport: native });
  const request = towerFetch(`${logicalTower}/api/read`, { signal: abort.signal });
  abort.abort(new DOMException('canceled', name));
  await expect(request).rejects.toMatchObject({ name });
});

it('service identity is the native authority even when compatibility URL changes', async () => {
  const native = bridge();
  const publicFetch = vi.fn(() => { throw new Error('HTTPS unavailable'); });
  vi.stubGlobal('fetch', publicFetch);
  await connectTowerBridge('https://unreachable.invalid', endpoint, serviceNpub, { bridge: native });
  expect(native.connect).toHaveBeenCalledWith({ endpoint, serviceNpub });
  expect(publicFetch).not.toHaveBeenCalled();
  native.fetch.mockResolvedValue(Response.json({ service_npub: 'mismatch' }));
  await expect(connectTowerBridge(logicalTower, endpoint, serviceNpub, { bridge: native })).rejects.toThrow('does not identify');
  expect(native.disconnect).toHaveBeenCalledOnce();
});

it('recognizes older native v2 before approval and asks for an update', async () => {
  const native = bridge();
  delete native.pairingIdentity;
  await expect(connectTowerBridge(logicalTower, endpoint, serviceNpub, { bridge: native })).rejects.toThrow('Update WMapp');
  expect(native.connect).not.toHaveBeenCalled();
  expect(native.fetch).not.toHaveBeenCalled();
});

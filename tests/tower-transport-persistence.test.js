import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import { getSharedDb } from '../src/db.js';
import { connectSettingsManagerMixin } from '../src/connect-settings-manager.js';
import {
  getTowerTransport, getTowerTransportPreference, importTowerTransports,
  initializeTowerTransports, saveTowerTransportPreference, towerFetch,
} from '../src/tower-transport.js';

const db = getSharedDb();
const key = 'flightdeck:tower-transports:v1';
const tower = 'https://tower.example';
const other = 'https://other.example';
const serviceNpub = nip19.npubEncode('34'.repeat(32));
const endpoint = `http://${nip19.npubEncode('12'.repeat(32))}.fips:41080`;
const preference = { mode: 'fips', endpoint, serviceNpub };
const bridge = {
  version: 2, pairingIdentity: 'service-npub',
  connect: vi.fn(async input => ({ version: 2, transport: 'native', ...input })),
  fetch: vi.fn(async () => Response.json({ service_npub: serviceNpub })),
};
beforeEach(async () => {
  await db.tower_transport_preferences.clear();
  await initializeTowerTransports({ bridge: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); importTowerTransports([]); });

it('retains endpoint and identity through FIPS, HTTPS, database reopen, settings and FIPS reconnect', async () => {
  await saveTowerTransportPreference(tower, preference);
  await initializeTowerTransports({ bridge });
  await saveTowerTransportPreference(tower, { mode: 'https' });
  // Simulate a full page restart: drop runtime connections and reopen IndexedDB.
  importTowerTransports([]);
  db.close();
  await db.open();
  await initializeTowerTransports({ bridge });
  expect(getTowerTransport(tower)).toEqual({ mode: 'https' });
  const store = Object.create(connectSettingsManagerMixin);
  store.backendUrl = tower;
  store.loadTowerTransportSettings();
  expect(store.towerTransportMode).toBe('https');
  expect(store.towerFipsEndpoint).toBe(endpoint);
  store.towerTransportMode = 'fips';
  expect(store.towerFipsEndpoint).toBe(endpoint);
  await saveTowerTransportPreference(tower, { ...getTowerTransportPreference(tower), mode: 'fips' });
  await initializeTowerTransports({ bridge });
  expect(bridge.connect).toHaveBeenLastCalledWith({ endpoint, serviceNpub });
  expect(getTowerTransport(tower)).toMatchObject({ ...preference, transport: 'native' });
});

it('migrates legacy configuration once, strips capabilities, and preserves separate Tower choices', async () => {
  localStorage.setItem(key, JSON.stringify({
    [tower + '/']: { ...preference, proxyBaseUrl: 'secret', capability: 'secret', signingToken: 'secret' },
    [other]: { ...preference, endpoint: endpoint.replace('41080', '41081') },
  }));
  await initializeTowerTransports({ bridge: null });
  expect(await db.tower_transport_preferences.get(tower)).toEqual({ logicalTower: tower, ...preference });
  expect(localStorage.getItem(key)).toBeNull();
  await saveTowerTransportPreference(tower, { mode: 'https' });
  // Simulate legacy cleanup failure/stale data from an earlier application.
  localStorage.setItem(key, JSON.stringify({ [tower]: preference }));
  await initializeTowerTransports({ bridge: null });
  expect(getTowerTransportPreference(tower)).toEqual({ ...preference, mode: 'https' });
  expect(getTowerTransportPreference(other)).toEqual({ ...preference, endpoint: endpoint.replace('41080', '41081') });
  expect(getTowerTransport(other).mode).toBe('fips');
});

it('keeps the legacy source on migration write failure and retries successfully', async () => {
  const raw = JSON.stringify({ [tower]: preference });
  localStorage.setItem(key, raw);
  vi.spyOn(db.tower_transport_preferences, 'add').mockRejectedValueOnce(new Error('disk full'));
  await expect(initializeTowerTransports({ bridge: null })).rejects.toThrow('disk full');
  expect(localStorage.getItem(key)).toBe(raw);
  expect(await db.tower_transport_preferences.count()).toBe(0);
  await initializeTowerTransports({ bridge: null });
  expect(getTowerTransportPreference(tower)).toEqual(preference);
});

it.each(['{broken', JSON.stringify({ [tower]: { ...preference, endpoint: 'https://wrong.example' } })])(
  'fails initialization closed and retains malformed legacy data for recovery: %s', async raw => {
    localStorage.setItem(key, raw);
    vi.stubGlobal('fetch', vi.fn());
    await expect(initializeTowerTransports({ bridge })).rejects.toThrow();
    expect(localStorage.getItem(key)).toBe(raw);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it('retains the committed choice and draft when an actual IndexedDB write fails, without reload or sync shutdown', async () => {
  await saveTowerTransportPreference(tower, preference);
  await initializeTowerTransports({ bridge: null });
  const reload = vi.fn();
  const prepareTransportReload = vi.fn();
  vi.stubGlobal('window', { location: { reload } });
  const store = Object.create(connectSettingsManagerMixin);
  Object.assign(store, { backendUrl: tower, towerTransportMode: 'https', towerFipsEndpoint: endpoint,
    getTowerSyncService: () => ({ prepareTransportReload }) });
  vi.spyOn(db.tower_transport_preferences, 'put').mockRejectedValueOnce(new Error('disk full'));
  await store.saveTowerTransportSettings();
  expect(store.towerTransportError).toBe('disk full');
  expect(reload).not.toHaveBeenCalled();
  expect(prepareTransportReload).not.toHaveBeenCalled();
  expect(store.towerFipsEndpoint).toBe(endpoint);
  expect(getTowerTransportPreference(tower)).toEqual(preference);
  expect(await db.tower_transport_preferences.get(tower)).toEqual({ logicalTower: tower, ...preference });
});

it('rejects unsupported modes and persists only nonsecret fields on new FIPS saves', async () => {
  await expect(saveTowerTransportPreference(tower, { mode: 'automatic' })).rejects.toThrow();
  await saveTowerTransportPreference(tower, { ...preference, transport: 'native', proxyBaseUrl: 'secret', token: 'secret' });
  expect(await db.tower_transport_preferences.get(tower)).toEqual({ logicalTower: tower, ...preference });
  await initializeTowerTransports({ bridge: null });
  vi.stubGlobal('fetch', vi.fn());
  await expect(towerFetch(`${tower}/api/v4/read`)).rejects.toThrow('FIPS unavailable');
  expect(fetch).not.toHaveBeenCalled();
});

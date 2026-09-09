import { nativeWorkerFetch } from './tower-native-worker-transport.js';
import { nip19 } from 'nostr-tools';

// A connection preference never becomes a workspace/Dexie identity. Native
// route capabilities are ephemeral and must never be persisted or logged.
const STORAGE_KEY = 'flightdeck:tower-transports:v1';
let connections = new Map();

function transportError(message) {
  return Object.assign(new Error(message), { code: 'fips_unavailable' });
}

export function normalizeFipsEndpoint(value) {
  const endpoint = new URL(String(value || '').trim());
  const node = endpoint.hostname.replace(/\.fips$/, '');
  let validNode = false;
  try { validNode = nip19.decode(node).type === 'npub'; } catch { /* invalid pairing */ }
  if (endpoint.protocol !== 'http:' || !endpoint.hostname.endsWith('.fips') || !validNode
    || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== '/') {
    throw transportError('Use one exact http://<node-npub>.fips:<port>/ Tower endpoint.');
  }
  return endpoint.origin;
}

function logicalOrigin(value) {
  const url = new URL(String(value || '').trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Tower must be an HTTP(S) origin.');
  return url.origin;
}

function readPreferences(storage = globalThis.localStorage) {
  const raw = storage?.getItem(STORAGE_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Tower transport preferences.');
  return parsed;
}

export function getTowerTransport(logicalTower) {
  if (!logicalTower) return { mode: 'https' };
  try { return connections.get(new URL(logicalTower).origin) || { mode: 'https' }; }
  catch { return { mode: 'https' }; }
}

export function exportTowerTransports() {
  return [...connections.entries()].map(([logicalTower, connection]) => ({ logicalTower, ...connection }));
}

export function importTowerTransports(snapshot = []) {
  connections = new Map(snapshot.map(({ logicalTower, ...connection }) => [logicalTower, connection]));
}

export async function connectTowerBridge(logicalTower, endpoint, expectedServiceNpub, {
  bridge = globalThis.window?.wingmanTowerTransport,
} = {}) {
  logicalTower = logicalOrigin(logicalTower);
  endpoint = normalizeFipsEndpoint(endpoint);
  if (!bridge || bridge.version !== 2 || bridge.available === false || typeof bridge.connect !== 'function' || typeof bridge.fetch !== 'function') {
    throw transportError('FIPS requires WMapp with the paired Tower bridge. Public HTTPS remains available in Connection settings.');
  }
  const descriptor = await bridge.connect({ endpoint, logicalTower });
  if (descriptor?.version !== 2 || descriptor.endpoint !== endpoint || descriptor.logicalTower !== logicalTower || descriptor.transport !== 'native') {
    throw transportError('WMapp returned an incompatible paired Tower bridge.');
  }
  const response = await bridge.fetch(`${endpoint}/health`, {
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw transportError(`FIPS Tower health failed (${response.status}).`);
  const health = await response.json();
  if (!expectedServiceNpub || health.service_npub !== expectedServiceNpub) {
    throw transportError('The paired endpoint does not identify the configured Tower.');
  }
  return { mode: 'fips', endpoint, transport: 'native', serviceNpub: expectedServiceNpub };
}

export async function initializeTowerTransports(options = {}) {
  const preferences = readPreferences(options.storage);
  const windowObject = globalThis.window;
  if (!Object.hasOwn(options, 'bridge') && Object.values(preferences).some((p) => p.mode === 'fips')
    && !windowObject?.wingmanTowerTransport && windowObject?.addEventListener) {
    // WMapp injects at onPageFinished, after module boot has begun.
    await new Promise((resolve) => {
      const ready = () => {
        clearTimeout(timer);
        windowObject.removeEventListener('wingman-tower-transport-ready', ready);
        resolve();
      };
      const timer = setTimeout(ready, 5000);
      windowObject.addEventListener('wingman-tower-transport-ready', ready, { once: true });
    });
  }
  connections = new Map();
  await Promise.all(Object.entries(preferences).map(async ([logicalTower, preference]) => {
    if (preference.mode !== 'fips') return;
    // Register the unavailable state before awaiting native pairing. No request
    // may silently use HTTPS while a saved FIPS preference reconnects.
    connections.set(logicalTower, { mode: 'fips', endpoint: preference.endpoint, serviceNpub: preference.serviceNpub, error: 'FIPS bridge is connecting.' });
    try {
      connections.set(logicalTower, await connectTowerBridge(logicalTower, preference.endpoint, preference.serviceNpub, options));
    } catch (error) {
      connections.set(logicalTower, { mode: 'fips', endpoint: preference.endpoint, serviceNpub: preference.serviceNpub, error: `FIPS unavailable: ${error.message}` });
    }
  }));
}

// Save only after pairing and identity validation. Activation occurs on reload,
// so in-flight acknowledgements are never reinterpreted under another route.
export function saveTowerTransportPreference(logicalTower, preference, storage = globalThis.localStorage) {
  const preferences = readPreferences(storage);
  const origin = logicalOrigin(logicalTower);
  if (preference.mode === 'https') delete preferences[origin];
  else {
    if (!preference.serviceNpub) throw new Error('Verified Tower identity is required.');
    preferences[origin] = {
      mode: 'fips', endpoint: normalizeFipsEndpoint(preference.endpoint), serviceNpub: preference.serviceNpub,
    };
  }
  if (!storage) throw new Error('Browser storage is unavailable; connection preference was not saved.');
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function resolveRequest(value) {
  const input = new URL(String(value));
  for (const [logicalTower, connection] of connections) {
    if (connection.mode !== 'fips') continue;
    if (input.origin !== logicalTower && input.origin !== connection.endpoint) continue;
    const path = `${input.pathname}${input.search}`;
    if (connection.error || connection.transport !== 'native') throw transportError(connection.error || 'FIPS bridge is unavailable.');
    if (input.username || input.password || input.hash) throw transportError('Invalid Tower request URL.');
    return { signingUrl: `${connection.endpoint}${path}`, networkUrl: `${connection.endpoint}${path}`, fips: true };
  }
  // An unmapped mesh URL must never fall through to browser HTTP or another node.
  if (input.hostname.endsWith('.fips')) throw transportError('This FIPS endpoint has not been paired with Tower.');
  return { signingUrl: String(value), networkUrl: String(value), fips: false };
}

export function resolveTowerSigningUrl(value) { return resolveRequest(value).signingUrl; }

export async function towerFetch(value, options) {
  const request = resolveRequest(value);
  try {
    if (!request.fips) return await (options === undefined ? globalThis.fetch(request.networkUrl) : globalThis.fetch(request.networkUrl, options));
    return await nativeTowerFetch(request.networkUrl, options);
  } catch (error) {
    if (options?.signal?.aborted) throw options.signal.reason;
    if (!request.fips || ['AbortError', 'TimeoutError'].includes(error?.name)) throw error;
    // Do not include the native capability URL or signed SSE token in errors.
    throw transportError(`FIPS request failed: ${error.name || 'network error'}. Check WMapp pairing or select Public HTTPS.`);
  }
}

export async function nativeTowerFetch(endpointUrl, options = {}) {
  const bridge = globalThis.window?.wingmanTowerTransport;
  if (globalThis.window && (bridge?.version !== 2 || bridge.available === false)) {
    throw transportError('WMapp native Tower transport is unavailable.');
  }
  const fetchNative = bridge?.version === 2 && bridge.available !== false
    ? bridge.fetch.bind(bridge)
    : nativeWorkerFetch;
  return fetchNative(endpointUrl, { ...options, credentials: 'omit', redirect: 'error' });
}

export function usesNativeTowerTransport(value) { return resolveRequest(value).fips; }

export function resolveTowerLogicalUrl(value) {
  let input;
  try { input = new URL(value); } catch { return value; }
  for (const [logicalTower, connection] of connections) {
    if (connection.mode === 'fips' && input.origin === connection.endpoint) {
      return `${logicalTower}${input.pathname === '/' && !input.search ? '' : input.pathname}${input.search}${input.hash}`;
    }
  }
  return value;
}

// Locators describe authority identity, not the route used to retrieve them.
// Normalize only contract-owned locator fields, never user metadata/content.
export function normalizeTowerConnectionResponse(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const locator = (value) => value && typeof value === 'object' && value.tower_base_url
    ? { ...value, tower_base_url: resolveTowerLogicalUrl(value.tower_base_url) } : value;
  const result = locator(payload);
  return {
    ...result,
    ...(result.descriptor ? { descriptor: locator(result.descriptor) } : {}),
    ...(Array.isArray(result.workspaces) ? { workspaces: result.workspaces.map(locator) } : {}),
    ...(result.service?.base_url ? { service: { ...result.service, base_url: resolveTowerLogicalUrl(result.service.base_url) } } : {}),
  };
}

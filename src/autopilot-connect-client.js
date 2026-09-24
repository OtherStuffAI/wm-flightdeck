import { nip19, verifyEvent } from 'nostr-tools';
import { createNip98AuthHeader } from './auth/nostr.js';

export const AUTOPILOT_CONNECT_KIND = 'wingman_autopilot_connect';
export const AUTOPILOT_CONNECT_VERSION = 1;
export const AUTOPILOT_CONNECT_SIGNATURE_KIND = 27236;

const SECRET_KEY_PATTERN = /(^|_)(nsec|secret|private_key|bearer|token|bunker_uri|nwc|wallet_connect)(_|$)/i;
const SECRET_VALUE_PATTERN = /^(nsec1|nostr\+walletconnect:|nostrconnect:|bunker:)/i;

export class AutopilotConnectError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'AutopilotConnectError';
    this.code = code;
    if (options.status != null) this.status = options.status;
  }
}

function fail(code, message, options) {
  throw new AutopilotConnectError(code, message, options);
}

function text(value) {
  return String(value ?? '').trim();
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  fail('package_invalid', 'Autopilot Connect Package contains a value that cannot be signed safely.');
}

function decodeNpub(value, label) {
  try {
    const decoded = nip19.decode(text(value));
    if (decoded.type !== 'npub' || typeof decoded.data !== 'string') throw new Error();
    return decoded.data;
  } catch {
    fail('package_invalid', `${label} must be a valid npub.`);
  }
}

function assertNoSecrets(value, path = 'package') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecrets(entry, `${path}[${index}]`));
    return;
  }
  if (!plainObject(value)) {
    if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value.trim())) {
      fail('package_secret', `Autopilot Connect Package contains forbidden secret material at ${path}.`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      fail('package_secret', `Autopilot Connect Package contains forbidden credential field ${path}.${key}.`);
    }
    assertNoSecrets(entry, `${path}.${key}`);
  }
}

function exactFipsOrigin(value) {
  let endpoint;
  try { endpoint = new URL(text(value)); } catch { fail('endpoint_invalid', 'The package FIPS endpoint is not a valid URL.'); }
  if (endpoint.protocol !== 'http:' || !endpoint.hostname.endsWith('.fips') || !endpoint.port
    || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    fail('endpoint_invalid', 'The package must advertise one exact http://<installation-npub>.fips:<port> endpoint.');
  }
  const endpointNpub = endpoint.hostname.slice(0, -'.fips'.length);
  decodeNpub(endpointNpub, 'FIPS endpoint identity');
  return { endpoint: endpoint.origin, endpointNpub };
}

function exactPath(value, label) {
  const path = text(value);
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('#')) {
    fail('package_invalid', `${label} must be an absolute path on the advertised FIPS endpoint.`);
  }
  return path;
}

function parseInput(input) {
  if (plainObject(input)) return input;
  try {
    const parsed = JSON.parse(text(input));
    if (!plainObject(parsed)) throw new Error();
    return parsed;
  } catch {
    fail('package_invalid', 'Autopilot Connect Package must be a JSON object.');
  }
}

export function createAutopilotConnectPackageEnvelope(manifest, signedEvent) {
  return { manifest, signature: signedEvent };
}

export function autopilotConnectManifestContent(manifest) {
  return canonicalJson(manifest);
}

export function verifyAutopilotConnectPackage(input) {
  const envelope = parseInput(input);
  assertNoSecrets(envelope);
  const manifest = envelope.manifest;
  const signature = envelope.signature;
  if (!plainObject(manifest) || !plainObject(signature)) {
    fail('package_invalid', 'Autopilot Connect Package requires manifest and signature objects.');
  }
  if (manifest.kind !== AUTOPILOT_CONNECT_KIND) {
    fail('package_invalid', 'This is not an Autopilot Connect Package.');
  }
  if (manifest.version !== AUTOPILOT_CONNECT_VERSION) {
    fail('package_version_unsupported', `Autopilot Connect Package version ${String(manifest.version)} is not supported; expected version ${AUTOPILOT_CONNECT_VERSION}.`);
  }
  if (signature.kind !== AUTOPILOT_CONNECT_SIGNATURE_KIND || !verifyEvent(signature)) {
    fail('package_signature_invalid', 'Autopilot Connect Package signature is invalid or the package was tampered with.');
  }
  if (signature.content !== canonicalJson(manifest)) {
    fail('package_tampered', 'Autopilot Connect Package content does not match its signed manifest.');
  }

  const installationId = text(manifest.installation?.id);
  const installationNpub = text(manifest.installation?.npub);
  if (!installationId) fail('package_invalid', 'Autopilot installation id is required.');
  const installationPubkey = decodeNpub(installationNpub, 'Autopilot installation identity');
  if (signature.pubkey !== installationPubkey) {
    fail('installation_mismatch', 'Package signer does not match the advertised Autopilot installation identity.');
  }
  const fips = exactFipsOrigin(manifest.endpoints?.fips);
  if (fips.endpointNpub !== installationNpub) {
    fail('endpoint_mismatch', 'FIPS endpoint identity does not match the signed Autopilot installation identity.');
  }
  if (manifest.api?.version !== 1) {
    fail('api_version_unsupported', `Autopilot discovery API version ${String(manifest.api?.version)} is not supported; expected version 1.`);
  }

  return Object.freeze({
    kind: manifest.kind,
    version: manifest.version,
    generatedAt: text(manifest.generated_at) || null,
    installationId,
    installationNpub,
    fipsEndpoint: fips.endpoint,
    httpsEndpoint: text(manifest.endpoints?.https) || null,
    apiVersion: manifest.api.version,
    capabilities: Object.freeze([...new Set((manifest.api.capabilities || []).map(text).filter(Boolean))]),
    healthPath: exactPath(manifest.api.health_path, 'Health route'),
    agentsPath: exactPath(manifest.api.agents_path, 'Agent discovery route'),
  });
}

function mapResponseFailure(response, operation) {
  if (response.status === 401 || response.status === 403) {
    return new AutopilotConnectError('auth_failed', `Autopilot rejected NIP-98 authorization for ${operation}.`, { status: response.status });
  }
  if (response.status === 404 || response.status === 405) {
    return new AutopilotConnectError('route_unavailable', `Autopilot does not expose the advertised ${operation} route.`, { status: response.status });
  }
  return new AutopilotConnectError('connection_failed', `Autopilot ${operation} failed with HTTP ${response.status}.`, { status: response.status });
}

function normalizeAgent(row) {
  if (!plainObject(row)) return null;
  const agentId = text(row.agent_id);
  const botNpub = text(row.bot_npub);
  if (!agentId || !botNpub) return null;
  try { decodeNpub(botNpub, 'Agent identity'); } catch { return null; }
  return Object.freeze({
    agentId,
    botNpub,
    name: text(row.name) || 'Agent',
    description: text(row.description),
    canInstruct: row.can_instruct === true,
  });
}

export function createAutopilotDiscoveryClient(verifiedPackage, {
  bridge = globalThis.window?.wingmanTowerTransport,
  authHeader = createNip98AuthHeader,
  timeoutMs = 20_000,
} = {}) {
  if (!verifiedPackage?.fipsEndpoint || !verifiedPackage?.installationNpub) {
    fail('package_unverified', 'Verify the Autopilot Connect Package before connecting.');
  }
  if (!bridge || bridge.version !== 2 || bridge.available === false || bridge.pairingIdentity !== 'service-npub'
    || typeof bridge.connect !== 'function' || typeof bridge.fetch !== 'function') {
    fail('fips_unavailable', 'Native FIPS transport is unavailable. Open Flight Deck in a supported, unlocked Wingman app.');
  }
  let connected = false;

  async function connect() {
    let descriptor;
    try {
      descriptor = await bridge.connect({
        endpoint: verifiedPackage.fipsEndpoint,
        serviceNpub: verifiedPackage.installationNpub,
      });
    }
    catch (error) { fail('fips_connection_failed', 'Could not connect to the signed Autopilot FIPS endpoint.', { cause: error }); }
    if (descriptor?.version !== 2 || descriptor.endpoint !== verifiedPackage.fipsEndpoint
      || descriptor.serviceNpub !== verifiedPackage.installationNpub || descriptor.transport !== 'native') {
      await bridge.disconnect?.();
      fail('endpoint_mismatch', 'Native FIPS bridge connected to a different endpoint than the signed package.');
    }
    connected = true;
  }

  async function request(path, operation, { method = 'GET', body } = {}) {
    if (!connected) await connect();
    const requestUrl = `${verifiedPackage.fipsEndpoint}${path}`;
    const normalizedMethod = text(method).toUpperCase();
    const serializedBody = body === undefined
      ? undefined
      : (typeof body === 'string' ? body : JSON.stringify(body));
    let authorization;
    try { authorization = await authHeader(requestUrl, normalizedMethod, serializedBody ?? null); }
    catch (error) { fail('auth_signing_failed', `Could not sign the exact Autopilot ${operation} request.`, { cause: error }); }
    let response;
    try {
      response = await bridge.fetch(requestUrl, {
        method: normalizedMethod,
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
          ...(serializedBody === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: serializedBody,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      fail('connection_failed', `Could not reach Autopilot ${operation} through FIPS.`, { cause: error });
    }
    if (!response.ok) throw mapResponseFailure(response, operation);
    try { return await response.json(); }
    catch (error) { fail('response_invalid', `Autopilot returned invalid JSON for ${operation}.`, { cause: error }); }
  }

  return Object.freeze({
    requestJson(path, options = {}) {
      if (![verifiedPackage.healthPath, verifiedPackage.agentsPath].includes(path)) {
        fail('route_unavailable', 'Request path was not signed into this Autopilot Connect Package.');
      }
      return request(path, 'control API', options);
    },
    async health() {
      const payload = await request(verifiedPackage.healthPath, 'health');
      if (payload?.installation_id !== verifiedPackage.installationId
        || payload?.installation_npub !== verifiedPackage.installationNpub
        || payload?.api_version !== verifiedPackage.apiVersion) {
        fail('installation_mismatch', 'Autopilot health identity or API version does not match the signed package.');
      }
      return Object.freeze({
        ok: payload.ok === true,
        installationId: payload.installation_id,
        installationNpub: payload.installation_npub,
        apiVersion: payload.api_version,
      });
    },
    async discoverAgents() {
      const payload = await request(verifiedPackage.agentsPath, 'agent discovery');
      if (payload?.installation_id !== verifiedPackage.installationId || !Array.isArray(payload?.agents)) {
        fail('response_invalid', 'Autopilot agent discovery response does not match the signed installation.');
      }
      return Object.freeze(payload.agents.map(normalizeAgent).filter(Boolean));
    },
    disconnect() {
      connected = false;
      return bridge.disconnect?.();
    },
  });
}

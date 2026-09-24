import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import {
  AUTOPILOT_CONNECT_KIND,
  AUTOPILOT_CONNECT_SIGNATURE_KIND,
  autopilotConnectManifestContent,
  createAutopilotDiscoveryClient,
  verifyAutopilotConnectPackage,
} from '../src/autopilot-connect-client.js';
import { createNip98AuthHeaderForSecret } from '../src/auth/nostr.js';

afterEach(() => vi.unstubAllGlobals());

function fixture(overrides = {}) {
  const secret = generateSecretKey();
  const npub = nip19.npubEncode(getPublicKey(secret));
  const manifest = {
    kind: AUTOPILOT_CONNECT_KIND,
    version: 1,
    generated_at: '2026-09-24T00:00:00.000Z',
    installation: { id: 'installation-test', npub },
    endpoints: { fips: `http://${npub}.fips:43101`, https: 'https://autopilot.example' },
    api: {
      version: 1,
      capabilities: ['health', 'agents.read'],
      health_path: '/api/control/v1/health',
      agents_path: '/api/control/v1/agents?visible=true',
    },
    ...overrides,
  };
  const signature = finalizeEvent({
    kind: AUTOPILOT_CONNECT_SIGNATURE_KIND,
    created_at: 1_795_000_000,
    tags: [['d', manifest.installation.id]],
    content: autopilotConnectManifestContent(manifest),
  }, secret);
  return { secret, manifest, signature, envelope: { manifest, signature } };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Autopilot Connect Package verification', () => {
  it('verifies a signed versioned package and binds its identity to the exact endpoint', () => {
    const { envelope, manifest } = fixture();
    expect(verifyAutopilotConnectPackage(JSON.stringify(envelope))).toMatchObject({
      installationId: 'installation-test',
      installationNpub: manifest.installation.npub,
      fipsEndpoint: `http://${manifest.installation.npub}.fips:43101`,
      apiVersion: 1,
    });
  });

  it('rejects tampering and unsupported package versions', () => {
    const tampered = fixture();
    tampered.envelope.manifest.installation.id = 'changed';
    expect(() => verifyAutopilotConnectPackage(tampered.envelope)).toThrowError(expect.objectContaining({ code: 'package_tampered' }));
    const unsupported = fixture({ version: 2 });
    expect(() => verifyAutopilotConnectPackage(unsupported.envelope)).toThrowError(expect.objectContaining({ code: 'package_version_unsupported' }));
  });

  it('rejects signer and FIPS endpoint identities that differ from the installation', () => {
    const wrongSigner = fixture();
    const otherSecret = generateSecretKey();
    wrongSigner.envelope.signature = finalizeEvent({
      kind: AUTOPILOT_CONNECT_SIGNATURE_KIND,
      created_at: 1_795_000_000,
      tags: [],
      content: autopilotConnectManifestContent(wrongSigner.manifest),
    }, otherSecret);
    expect(() => verifyAutopilotConnectPackage(wrongSigner.envelope)).toThrowError(expect.objectContaining({ code: 'installation_mismatch' }));

    const endpointMismatch = fixture();
    const otherNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));
    endpointMismatch.manifest.endpoints.fips = `http://${otherNpub}.fips:43101`;
    endpointMismatch.signature = finalizeEvent({
      kind: AUTOPILOT_CONNECT_SIGNATURE_KIND,
      created_at: 1_795_000_000,
      tags: [],
      content: autopilotConnectManifestContent(endpointMismatch.manifest),
    }, endpointMismatch.secret);
    expect(() => verifyAutopilotConnectPackage({ manifest: endpointMismatch.manifest, signature: endpointMismatch.signature }))
      .toThrowError(expect.objectContaining({ code: 'endpoint_mismatch' }));
  });

  it('rejects secret-bearing packages without persisting or logging their contents', () => {
    const value = 'nsec1forbiddenmaterial';
    const secretPackage = fixture({ credentials: { private_key: value } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem });
    expect(() => verifyAutopilotConnectPackage(secretPackage.envelope)).toThrowError(expect.objectContaining({ code: 'package_secret' }));
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('Autopilot NIP-98/FIPS discovery client', () => {
  let verified;

  beforeEach(() => {
    verified = verifyAutopilotConnectPackage(fixture().envelope);
  });

  it('uses only FIPS and exposes actionable missing-bridge and no-route failures', async () => {
    const publicFetch = vi.spyOn(globalThis, 'fetch');
    expect(() => createAutopilotDiscoveryClient(verified, { bridge: null })).toThrowError(expect.objectContaining({ code: 'fips_unavailable' }));
    expect(() => createAutopilotDiscoveryClient(verified, {
      bridge: { version: 1, connect: vi.fn(), fetch: vi.fn() },
    })).toThrowError(expect.objectContaining({ code: 'fips_unavailable' }));
    expect(publicFetch).not.toHaveBeenCalled();

    const bridge = {
      version: 2,
      pairingIdentity: 'service-npub',
      connect: vi.fn(async ({ endpoint, serviceNpub }) => ({ version: 2, endpoint, serviceNpub, transport: 'native' })),
      fetch: vi.fn(async () => response({ error: 'missing' }, 404)),
    };
    const client = createAutopilotDiscoveryClient(verified, { bridge, authHeader: vi.fn(async () => 'Nostr signed') });
    await expect(client.health()).rejects.toMatchObject({ code: 'route_unavailable', status: 404 });
    expect(publicFetch).not.toHaveBeenCalled();

    const disconnect = vi.fn();
    const mismatched = createAutopilotDiscoveryClient(verified, {
      bridge: {
        version: 2,
        pairingIdentity: 'service-npub',
        disconnect,
        connect: vi.fn(async ({ endpoint, serviceNpub }) => ({ version: 2, endpoint, serviceNpub, transport: 'proxy' })),
        fetch: vi.fn(),
      },
      authHeader: vi.fn(),
    });
    await expect(mismatched.health()).rejects.toMatchObject({ code: 'endpoint_mismatch' });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('signs and sends the exact URL, method, and serialized body', async () => {
    const signingSecret = generateSecretKey();
    const authHeader = vi.fn((url, method, body) => createNip98AuthHeaderForSecret(url, method, body, signingSecret));
    const bridge = {
      version: 2,
      pairingIdentity: 'service-npub',
      connect: vi.fn(async ({ endpoint, serviceNpub }) => ({ version: 2, endpoint, serviceNpub, transport: 'native' })),
      fetch: vi.fn(async () => response({ ok: true })),
    };
    const client = createAutopilotDiscoveryClient(verified, { bridge, authHeader });
    const body = { probe: 'body-hash-input', ordered: true };
    await client.requestJson(verified.agentsPath, { method: 'POST', body });
    expect(bridge.connect).toHaveBeenCalledWith({
      endpoint: verified.fipsEndpoint,
      serviceNpub: verified.installationNpub,
    });
    const exactUrl = `${verified.fipsEndpoint}${verified.agentsPath}`;
    const exactBody = JSON.stringify(body);
    expect(authHeader).toHaveBeenCalledWith(exactUrl, 'POST', exactBody);
    expect(bridge.fetch).toHaveBeenCalledWith(exactUrl, expect.objectContaining({
      method: 'POST', body: exactBody, redirect: 'error', credentials: 'omit',
    }));
    const sentAuthorization = bridge.fetch.mock.calls[0][1].headers.Authorization;
    const event = JSON.parse(atob(sentAuthorization.slice('Nostr '.length)));
    const expectedHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(exactBody))))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(event.tags).toContainEqual(['u', exactUrl]);
    expect(event.tags).toContainEqual(['method', 'POST']);
    expect(event.tags).toContainEqual(['payload', expectedHash]);
  });

  it('validates mocked health and returns only normalized, authorized discovery fields', async () => {
    const hidden = { agent_id: '', bot_npub: 'invalid', secret: 'must-not-escape' };
    const bridge = {
      version: 2,
      pairingIdentity: 'service-npub',
      connect: vi.fn(async ({ endpoint, serviceNpub }) => ({ version: 2, endpoint, serviceNpub, transport: 'native' })),
      fetch: vi.fn(async (url) => url.endsWith('/health')
        ? response({ ok: true, installation_id: verified.installationId, installation_npub: verified.installationNpub, api_version: 1, internal: 'drop' })
        : response({ installation_id: verified.installationId, agents: [
          { agent_id: 'agent-alpha', bot_npub: verified.installationNpub, name: 'Example Agent', description: 'Product-neutral fixture', can_instruct: true, working_directory: '/private', ...{} },
          hidden,
        ] })),
    };
    const client = createAutopilotDiscoveryClient(verified, { bridge, authHeader: vi.fn(async () => 'Nostr signed') });
    expect(await client.health()).toEqual({ ok: true, installationId: verified.installationId, installationNpub: verified.installationNpub, apiVersion: 1 });
    expect(await client.discoverAgents()).toEqual([{ agentId: 'agent-alpha', botNpub: verified.installationNpub, name: 'Example Agent', description: 'Product-neutral fixture', canInstruct: true }]);
  });

  it('reports authentication and health identity failures distinctly', async () => {
    const authBridge = {
      version: 2,
      pairingIdentity: 'service-npub',
      connect: vi.fn(async ({ endpoint, serviceNpub }) => ({ version: 2, endpoint, serviceNpub, transport: 'native' })),
      fetch: vi.fn(async () => response({ error: 'denied' }, 403)),
    };
    await expect(createAutopilotDiscoveryClient(verified, { bridge: authBridge, authHeader: vi.fn(async () => 'Nostr signed') }).health())
      .rejects.toMatchObject({ code: 'auth_failed' });

    const identityBridge = {
      version: 2,
      pairingIdentity: 'service-npub',
      connect: vi.fn(async ({ endpoint, serviceNpub }) => ({ version: 2, endpoint, serviceNpub, transport: 'native' })),
      fetch: vi.fn(async () => response({ ok: true, installation_id: 'other', installation_npub: verified.installationNpub, api_version: 1 })),
    };
    await expect(createAutopilotDiscoveryClient(verified, { bridge: identityBridge, authHeader: vi.fn(async () => 'Nostr signed') }).health())
      .rejects.toMatchObject({ code: 'installation_mismatch' });
  });
});

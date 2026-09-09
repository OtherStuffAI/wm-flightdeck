import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools';
import { BrowserTestError, createApi, rows, poll } from './browser-api.mjs';

test('setup/negative API signs exact URL, verb and serialized body with the generated identity', async () => {
  const key = generateSecretKey();
  const identity = { nsec: nip19.nsecEncode(key), npub: nip19.npubEncode(getPublicKey(key)) };
  const config = { towerUrl: 'http://127.0.0.1:12345', appNpub: identity.npub };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      const event = JSON.parse(Buffer.from(options.headers.authorization.slice(6), 'base64'));
      assert.equal(verifyEvent(event), true);
      assert.equal(event.pubkey, getPublicKey(key));
      assert.equal(event.kind, 27235);
      assert.equal(event.content, '');
      assert.deepEqual(event.tags, [['u', url], ['method', 'PATCH'], ['payload', createHash('sha256').update(options.body).digest('hex')]]);
      assert.equal(options.headers['x-flightdeck-pg-app-npub'], identity.npub);
      assert.equal(options.body, JSON.stringify({ name: 'quote " and newline\n' }));
      return new Response('private backend details', { status: 403 });
    };
    assert.deepEqual(await createApi(config, identity)('/api/v4/flightdeck-pg/workspaces/test', {
      method: 'PATCH', body: { name: 'quote " and newline\n' }, expectedStatus: 403,
    }), { status: 403 });
    globalThis.fetch = async () => new Response('sensitive response must never reach errors', { status: 500 });
    await assert.rejects(createApi(config, identity)('/test'), error => error instanceof BrowserTestError && !error.message.includes('sensitive'));
  } finally { globalThis.fetch = originalFetch; }
});

test('bounded readiness fails explicitly and malformed PG collections never become empty success', async () => {
  await assert.rejects(poll('agent readiness', async () => false, 1), /Timed out: agent readiness/);
  assert.throws(() => rows({ wrong: [] }, 'messages'), /missing messages array/);
  assert.deepEqual(rows({ messages: [{ id: 'public' }] }, 'messages'), [{ id: 'public' }]);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { finalizeEvent, nip19, verifyEvent } from 'nostr-tools';
import { createApi } from './browser-api.mjs';

export async function verifyDurableSignatures(config, report) {
  const api = createApi(config, config.identities.a);
  const prefix = `/api/v4/flightdeck-pg/workspaces/${report.workspace.workspaceId}`;
  const route = `${prefix}/channels/${report.workspace.channelId}/messages`;
  const { messages } = await api(`${route}?limit=200`);
  const expectedAuthors = [config.identities.a.npub, report.agent.npub, config.identities.b.npub, report.agent.npub, config.identities.a.npub];
  assert.equal(report.messageIds.length, expectedAuthors.length, 'Expected five signed durable messages');
  assert.deepEqual(messages.filter(row => row.thread_id === report.threadId).map(row => row.id), report.messageIds, 'Durable thread history changed');
  const evidence = report.messageIds.map((id, index) => {
    const message = messages.find(row => row.id === id);
    assert.ok(message, 'Durable message missing');
    const signature = message.metadata?.agent_instruction_signature;
    const event = signature?.nostr_event;
    assert.ok(event && verifyEvent(event), 'Invalid durable message event signature');
    assert.equal(event.kind, 33358);
    assert.equal(nip19.npubEncode(event.pubkey), expectedAuthors[index]);
    assert.equal(event.content, message.body);
    assert.equal(signature.body_sha256, createHash('sha256').update(message.body).digest('hex'));
    const tag = name => event.tags.find(item => item[0] === name)?.[1];
    assert.equal(tag('workspace_id'), report.workspace.workspaceId);
    assert.equal(tag('channel_id'), report.workspace.channelId);
    if (index) assert.equal(tag('thread_id'), report.threadId);
    return { messageId: id, authorNpub: expectedAuthors[index], signedEventId: event.id, kind: event.kind, bodySha256: signature.body_sha256 };
  });

  // Replay the owner's original root idempotency key through the normal API.
  const root = messages.find(row => row.id === report.messageIds[0]);
  assert.ok(root.client_request_id, 'Browser root omitted its idempotency key');
  const replay = await api(route, { method: 'POST', body: {
    body: root.body, create_thread: true, client_request_id: root.client_request_id,
    metadata: root.metadata, mentions: root.mentions, message_signature: root.metadata.agent_instruction_signature,
  } });
  assert.equal(replay.message?.id, root.id, 'Retry created a different authored root');
  assert.equal(replay.replayed, true, 'Tower did not acknowledge idempotent replay');
  const after = await api(`${route}?limit=200`);
  assert.deepEqual(after.messages.map(row => row.id), messages.map(row => row.id), 'Replay changed durable history');

  // A valid key signs different bytes: Tower must reject the request before any mutation.
  const url = new URL(prefix, config.towerUrl).href;
  const original = JSON.stringify({ name: report.workspace.workspaceName });
  const key = nip19.decode(config.identities.a.nsec).data;
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '',
    tags: [['u', url], ['method', 'PATCH'], ['payload', createHash('sha256').update(original).digest('hex')]],
  }, key);
  const response = await fetch(url, { method: 'PATCH', body: JSON.stringify({ name: 'Tampered release test request' }),
    headers: { authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`,
      'content-type': 'application/json', 'x-flightdeck-pg-app-npub': config.appNpub }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 401, 'Tower accepted a body different from the NIP-98 payload hash');
  await response.body?.cancel();
  return { signatures: evidence, rootReplayExactlyOnce: true, alteredNip98BodyRejected: true };
}

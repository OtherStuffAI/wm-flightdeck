import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { finalizeEvent, nip19, verifyEvent } from 'nostr-tools';

// Only the run-generated human identity signs this normal author edit. The
// original body/order remain; Tower requires a new message revision signature.
export async function editMessageAttachments(api, identity, prefix, message, attachments) {
  assert.ok(Number.isInteger(message.row_version));
  const prior = message.metadata.agent_instruction_signature;
  assert.equal(prior.signer_npub, identity.npub);
  const revision = message.row_version + 1;
  const bodySha256 = createHash('sha256').update(message.body).digest('hex');
  const tags = prior.nostr_event.tags.filter(row => !['message_id', 'revision'].includes(row[0]));
  tags.push(['message_id', message.id], ['revision', String(revision)]);
  const key = nip19.decode(identity.nsec);
  assert.equal(key.type, 'nsec');
  let event;
  try { event = finalizeEvent({ kind: 33358, created_at: Math.floor(Date.now() / 1000), content: message.body, tags }, key.data); }
  finally { key.data.fill(0); }
  const message_signature = { ...prior, body_sha256: bodySha256, nostr_event: event, message_id: message.id, revision };
  const result = await api(`${prefix}/messages/${message.id}`, { method: 'PATCH', body: {
    body: message.body, row_version: message.row_version,
    metadata: { ...message.metadata, attachments, agent_instruction_signature: message_signature }, message_signature,
  } });
  assert.equal(result.message?.id, message.id);
  assert.equal(result.message?.row_version, revision);
  return result.message;
}

export async function renderedSignedHistory(page, ids, workspaceId) {
  // Read exactly this run's workspace materialization, not a presentation getter
  // that can synthesize a thread parent without retaining message metadata.
  const records = await page.evaluate(async ({ messageIds, workspaceId }) => {
    const names = (await indexedDB.databases()).filter(entry => entry.name.startsWith('wingman-fd-ws-pg:')
      && entry.name.endsWith(`::id:${workspaceId}`));
    if (names.length !== 1) throw new Error('Expected one materialized database for this test workspace');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(names[0].name);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const table = db.transaction('chat_messages', 'readonly').objectStore('chat_messages');
      return await Promise.all(messageIds.map(id => new Promise((resolve, reject) => {
        const request = table.get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const row = request.result;
          if (row && row.pg_workspace_id !== workspaceId) { reject(new Error('Materialized message workspace mismatch')); return; }
          const signature = row?.pg_metadata?.agent_instruction_signature;
          resolve({ id, event: signature?.nostr_event || null, bodySha256: signature?.body_sha256 || null });
        };
      })));
    } finally { db.close(); }
  }, { messageIds: ids, workspaceId });
  return records.map(row => {
    if (row.event) {
      assert.ok(verifyEvent(row.event), 'Invalid materialized browser signature');
      assert.equal(row.event.kind, 33358);
      assert.equal(createHash('sha256').update(row.event.content).digest('hex'), row.bodySha256);
    }
    return { id: row.id, eventId: row.event?.id || null, bodySha256: row.bodySha256 };
  });
}

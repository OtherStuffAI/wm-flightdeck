import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyEvent, nip19 } from 'nostr-tools';
import { command, privateJson, waitFor } from './stack.mjs';
import { runtimeApi } from './runtime.mjs';
import { meshExec } from './fips-mesh.mjs';
import { assertNoPublicTowerTraffic, enableRuntimeFips } from './fips-runtime.mjs';

// Runs before A/B recording finalization, after the original exact five-message
// history has passed. Extra roots remain separate threads and separately counted.
export async function verifyFipsContinuity(config, ui) {
  const { a, b, report, channel, openThread, visibleHistory, messages, author, setPhase } = ui;
  const phase = JSON.parse(fs.readFileSync(path.join(config.runDir, 'fips-phase.json')));
  const route = `/api/agent-chat/backend-connections/${phase.id}/transport`;
  const compose = (...args) => command('docker', ['compose', '--project-name', config.runId, '-f', path.join(config.runDir, 'compose.json'), ...args], { env: config.dockerEnv });
  const subscription = async () => {
    const state = await runtimeApi(config, 'GET', '/api/agent-chat/subscriptions');
    const current = state.subscriptions.find(row => row.subscriptionId === phase.subscriptionId);
    assert.ok(current); assert.equal(current.backendConnectionId, phase.id);
    assert.equal(current.workspaceId, report.workspace.workspaceId);
    return current;
  };
  const cursor = row => JSON.parse(Buffer.from(row.lastSyncCursor, 'base64url').toString()).rowVersion;
  const records = [];
  const originalOutcomes = await runtimeApi(config, 'GET', '/api/agent-chat/dispatch-outcomes');
  assert.equal(originalOutcomes.total, 2);
  async function publish(label) {
    for (const user of [a, b]) await channel(user.page, report.workspace.channelName, report.workspace);
    const composer = a.page.getByRole('textbox', { name: 'Message channel', exact: true });
    await composer.pressSequentially(`@${report.agent.name}`, { delay: 30 });
    await a.page.locator('.mention-result-item:visible').filter({ has: a.page.locator('.mention-result-label', { hasText: report.agent.name }) }).first().click();
    await composer.press('End');
    const marker = `continuity-${label}-${config.runId}`;
    await composer.pressSequentially(` ${marker} Please reply once.`, { delay: 5 });
    await composer.press('Enter');
    const root = await waitFor(async () => (await messages()).find(row => row.body?.includes(marker)), `${label} root persisted`);
    for (const user of [a, b]) { await user.page.locator(`[data-message-id="${root.id}"]`).waitFor(); await openThread(user.page, root.id); }
    return root;
  }
  async function accept(label, root, before) {
    const reply = await waitFor(async () => (await messages()).find(row => row.thread_id === root.thread_id && author(row) === report.agent.npub), `${label} fresh reply`, 180000);
    for (const user of [a, b]) await visibleHistory(user.page, [root.id, reply.id]);
    await waitFor(async () => (await subscription()).healthStatus === 'healthy', `${label} subscription healthy`);
    const after = await subscription();
    assert.ok(cursor(after) >= cursor(before), `${label} durable cursor regressed`);
    const history = (await messages()).filter(row => row.thread_id === root.thread_id);
    assert.deepEqual(history.map(row => row.id), [root.id, reply.id]);
    const signatures = history.map((row, index) => {
      const signature = row.metadata.agent_instruction_signature;
      const event = signature.nostr_event;
      assert.ok(verifyEvent(event)); assert.equal(event.kind, 33358);
      assert.equal(nip19.npubEncode(event.pubkey), index ? report.agent.npub : config.identities.a.npub);
      assert.equal(event.content, row.body);
      assert.equal(signature.body_sha256, createHash('sha256').update(row.body).digest('hex'));
      for (const [tag, expected] of [['workspace_id', report.workspace.workspaceId], ['channel_id', report.workspace.channelId], ...(index ? [['thread_id', root.thread_id]] : [])]) {
        assert.equal(event.tags.find(item => item[0] === tag)?.[1], expected);
      }
      return { id: row.id, signedEventId: event.id, bodySha256: signature.body_sha256 };
    });
    records.push({ label, rootId: root.id, replyId: reply.id, threadId: root.thread_id, runtimeSessionId: reply.metadata.session_id,
      subscriptionId: after.subscriptionId, connectionId: after.backendConnectionId, cursorBefore: before.lastSyncCursor, cursorAfter: after.lastSyncCursor, signatures });
  }
  setPhase('FIPS fresh work queued across owned runtime restart');
  let before = await subscription();
  await compose('stop', 'autopilot');
  let root = await publish('restart');
  await compose('up', '-d', '--wait', '--wait-timeout', '120', 'autopilot');
  await accept('restart', root, before);
  await assertNoPublicTowerTraffic(config);
  fs.copyFileSync(path.join(config.runDir, 'fips-network-assertions.json'), path.join(config.runDir, 'fips-before-rollback-network.json'));
  fs.copyFileSync(path.join(config.runDir, 'fips-phase.json'), path.join(config.runDir, 'fips-before-rollback-phase.json'));

  setPhase('explicit HTTPS rollback delivers work queued during mesh outage');
  before = await subscription();
  // Hard mesh TCP block before the fresh trigger. Public Tower remains blocked
  // until the explicit operator transport change below; this is not fallback.
  await meshExec(config, 'mesh-runtime', ['nft', 'add', 'table', 'inet', 'switch_fault']);
  await meshExec(config, 'mesh-runtime', ['nft', 'add', 'chain', 'inet', 'switch_fault', 'output', '{ type filter hook output priority -2; policy accept; }']);
  await meshExec(config, 'mesh-runtime', ['nft', 'add', 'rule', 'inet', 'switch_fault', 'output', 'oifname', 'fips0', 'tcp', 'dport', '43100', 'counter', 'drop']);
  await meshExec(config, 'mesh-runtime', ['nft', 'add', 'chain', 'inet', 'switch_fault', 'input', '{ type filter hook input priority -2; policy accept; }']);
  await meshExec(config, 'mesh-runtime', ['nft', 'add', 'rule', 'inet', 'switch_fault', 'input', 'iifname', 'fips0', 'tcp', 'sport', '43100', 'counter', 'drop']);
  root = await publish('rollback');
  assert.equal((await messages()).filter(row => row.thread_id === root.thread_id).length, 1);
  await assertNoPublicTowerTraffic(config);
  await meshExec(config, 'mesh-runtime', ['nft', 'delete', 'table', 'inet', 'tower_release']);
  await runtimeApi(config, 'POST', route, { transport: { ...phase.transport, mode: 'https', httpsEndpoint: config.runtimeTowerUrl } });
  await accept('rollback', root, before);
  await meshExec(config, 'mesh-runtime', ['nft', 'delete', 'table', 'inet', 'switch_fault']);
  const rolled = await runtimeApi(config, 'GET', '/api/agent-chat/backend-connections');
  assert.ok(rolled.backendConnections.find(row => row.backendConnectionId === phase.id).transportDiagnostics.counters.https.requests > 0);

  setPhase('switch active HTTPS subscription back to FIPS with fresh work');
  before = await subscription();
  await meshExec(config, 'autopilot', ['bun', '-e', 'await Bun.write("/app/data/isolated-test/hold-model-response","held")']);
  root = await publish('return-fips');
  const accepted = await waitFor(async () => {
    const raw = await meshExec(config, 'autopilot', ['bun', '-e', 'const f=Bun.file("/app/data/isolated-test/model-response-waiting.json");console.log(await f.exists()?await f.text():"null")']);
    return JSON.parse(raw);
  }, 'old HTTPS runtime accepted held work');
  assert.equal((await messages()).filter(row => row.thread_id === root.thread_id).length, 1);
  const heldWork = { ...accepted };
  await enableRuntimeFips(config, before, report.agentProfileId, async () => {
    heldWork.switchRequestedAt = Date.now();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await meshExec(config, 'autopilot', ['rm', '/app/data/isolated-test/hold-model-response']);
    heldWork.releasedAt = Date.now();
  });
  assert.ok(heldWork.acceptedAt <= heldWork.switchRequestedAt && heldWork.switchRequestedAt < heldWork.releasedAt);
  report.heldSwitchWork = heldWork;
  await accept('return-fips', root, before);
  await assertNoPublicTowerTraffic(config);
  const outcomes = await runtimeApi(config, 'GET', '/api/agent-chat/dispatch-outcomes');
  assert.equal(outcomes.total, 5, 'Original two plus three continuity dispatches required');
  assert.deepEqual(outcomes.rows.map(row => row.recordId).sort(), [...originalOutcomes.rows.map(row => row.recordId), ...records.map(row => row.rootId)].sort());
  for (const record of records) assert.equal(outcomes.rows.find(row => row.recordId === record.rootId).actionId, record.runtimeSessionId);
  report.continuity = records;
  privateJson(path.join(config.runDir, 'fips-continuity.json'), { passed: true, records, outcomes, heldSwitchWork: report.heldSwitchWork, originalDispatches: 2, totalDispatches: 5 });
}

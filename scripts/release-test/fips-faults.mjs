import { runtimeApi } from './runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { meshExec } from './fips-mesh.mjs';
import { privateJson, waitFor } from './stack.mjs';

export function addMeshFaultProxy(definition, { runDir, runId }) {
  const dir = path.join(runDir, 'mesh-fixture');
  fs.copyFileSync(fileURLToPath(new URL('./fips-fault-proxy.mjs', import.meta.url)), path.join(dir, 'fault-proxy.mjs'));
  definition.services['mesh-fault-proxy'] = { image: `${runId}-autopilot`, user: 'root',
    network_mode: 'service:mesh-tower', command: ['bun', '/fixture/fault-proxy.mjs'],
    volumes: [`${dir}:/fixture:ro`, 'mesh-tower:/mesh'], environment: {},
    depends_on: { tower: { condition: 'service_healthy' } },
    healthcheck: { test: ['CMD-SHELL', 'ss -ln | grep -q 43102'], interval: '2s', timeout: '2s', retries: 20 },
  };
}

export async function installMeshFaults(config) {
  // This file is exclusively in the owned mesh volume, with no credentials.
  await meshExec(config, 'mesh-tower', ['bun', '-e', 'await Bun.write("/mesh/fault-state.json",JSON.stringify({blockSse:false,dropReply:false}))']);
  const rules = `table ip6 tower_fault { chain input { type nat hook prerouting priority dstnat; policy accept;
    iifname "fips0" tcp dport 43100 redirect to :43102
  }
}
`;
  fs.writeFileSync(path.join(config.runDir, 'mesh-fixture', 'faults.nft'), rules);
  await meshExec(config, 'mesh-tower', ['nft', '-f', '/fixture/faults.nft']);
}

export async function configureMeshFault(config, state) {
  await meshExec(config, 'mesh-tower', ['bun', '-e', 'await Bun.write("/mesh/fault-state.json",process.argv[1])', JSON.stringify(state)]);
}

export async function interruptMeshStream(config) {
  await waitFor(async () => {
    const ledger = await meshExec(config, 'mesh-tower', ['cat', '/mesh/fault-ledger.jsonl']);
    return ledger.trim().split('\n').some(line => { const row = JSON.parse(line); return row.status === 200 && row.path.includes('/events/stream'); });
  }, 'successful real mesh stream before interruption');
  await configureMeshFault(config, { blockSse: true, dropReply: true });
  await waitFor(async () => (await meshExec(config, 'mesh-tower', ['cat', '/mesh/fault-ledger.jsonl'])).includes('established-sse-closed'), 'established mesh stream closed');
  // All subscription streams were established through this proxy; its control
  // loop closes them before the production consumer enters recovery polling.
}

export async function meshOutage(config, enabled) {
  if (enabled) {
    config.meshOutageStartedAt = Date.now();
    await meshExec(config, 'mesh-runtime', ['nft', 'add', 'table', 'inet', 'mesh_outage']);
    await meshExec(config, 'mesh-runtime', ['nft', 'add', 'chain', 'inet', 'mesh_outage', 'output', '{ type filter hook output priority -1; policy accept; }']);
    await meshExec(config, 'mesh-runtime', ['nft', 'add', 'rule', 'inet', 'mesh_outage', 'output', 'udp', 'dport', '2121', 'counter', 'drop']);
    await meshExec(config, 'mesh-runtime', ['nft', 'add', 'chain', 'inet', 'mesh_outage', 'input', '{ type filter hook input priority -1; policy accept; }']);
    await meshExec(config, 'mesh-runtime', ['nft', 'add', 'rule', 'inet', 'mesh_outage', 'input', 'udp', 'sport', '2121', 'counter', 'drop']);
    const canary = await meshExec(config, 'mesh-runtime', ['curl', '--fail', '--silent', '--max-time', '15', 'https://example.com']);
    assert.ok(canary.includes('Example Domain'), 'Independent public internet canary unavailable during mesh outage');
    privateJson(path.join(config.runDir, 'mesh-outage-canary.json'), { at: new Date().toISOString(), url: 'https://example.com', passed: true });
  } else {
    const counters = JSON.parse(await meshExec(config, 'mesh-runtime', ['nft', '-j', 'list', 'table', 'inet', 'mesh_outage']));
    privateJson(path.join(config.runDir, 'mesh-outage-network.json'), { startedAt: config.meshOutageStartedAt, restoredAt: Date.now(), counters });
    await meshExec(config, 'mesh-runtime', ['nft', 'delete', 'table', 'inet', 'mesh_outage']);
  }
}

export async function verifyMeshFaults(config, report) {
  const ledger = (await meshExec(config, 'mesh-tower', ['cat', '/mesh/fault-ledger.jsonl'])).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const closed = ledger.findIndex(row => row.fault === 'established-sse-closed');
  assert.ok(closed > 0 && ledger.slice(0, closed).some(row => row.status === 200 && row.path === ledger[closed].path), 'No ordered established stream loss');
  const pollAfterLoss = ledger.findIndex((row, index) => index > closed && /\/events\?/.test(row.path) && row.status === 200);
  assert.ok(pollAfterLoss > closed, 'No recovery poll after established stream loss');
  const dropped = ledger.filter(row => row.fault === 'committed-response-dropped');
  assert.equal(dropped.length, 1, 'Exactly one committed reply response must be lost');
  const droppedIndex = ledger.indexOf(dropped[0]);
  assert.ok(pollAfterLoss < droppedIndex, 'Reply publication preceded recovery polling');
  assert.ok(!ledger.slice(closed + 1, droppedIndex).some(row => row.status === 200 && row.path.includes('/events/stream')), 'SSE reconnected before the polling-delivered first reply');
  const streamCursor = new URL(ledger[closed].path, 'http://fixture').searchParams.get('cursor');
  assert.equal(new URL(ledger[pollAfterLoss].path, 'http://fixture').searchParams.get('cursor'), streamCursor, 'Recovery poll did not resume the closed stream cursor');
  assert.ok(dropped[0].recordId && report.messageIds.includes(dropped[0].recordId), 'Dropped response must identify the durable reply');
  assert.ok(ledger.some(row => row.fault === 'sse-denied'), 'SSE interruption did not reach the runtime');
  assert.ok(ledger.some(row => /\/events\?/.test(row.path) && row.status === 200), 'No real FIPS recovery polling recorded');
  assert.ok(dropped[0].requestKey && ledger.some(row => row.requestKey === dropped[0].requestKey && row.recordId === dropped[0].recordId && row.replayed),
    'No idempotent retry of the committed reply was observed');
  const probeJson = await meshExec(config, 'autopilot', ['bun', '-e', `import {readdirSync,readFileSync} from 'node:fs';
    const dir='/app/data/isolated-test'; console.log(JSON.stringify(readdirSync(dir).filter(n=>/^fips-probe-.*\.json$/.test(n)).map(n=>JSON.parse(readFileSync(dir+'/'+n,'utf8')))))`]);
  const allProbes = JSON.parse(probeJson);
  const probes = allProbes.filter(row => row.sessionId === report.runtimeSessionId);
  assert.equal(probes.length, 1, 'One real child broker probe must complete in the reused runtime session');
  assert.equal(probes[0].sessionId, report.runtimeSessionId);
  for (const field of ['workspaceRead', 'actualCliMembersRead', 'unapprovedDestination', 'incorrectService', 'deniedWorkspace', 'exactTargetRejected', 'exactBodyRejected', 'wrongMeshPort', 'wrongMeshNode', 'forgedForwarding', 'wrongHost', 'changedMethodRejected', 'reorderedQueryRejected', 'storageAclRejected', 'incompleteObject', 'missingObject', 'documentConflict', 'ingress', 'attachment']) assert.ok(probes[0][field], `Missing probe ${field}`);
  assert.equal(report.attachmentAccessRevoked, true);
  const canary = JSON.parse(fs.readFileSync(path.join(config.runDir, 'mesh-outage-canary.json')));
  assert.equal(canary.passed, true);
  assert.ok(report.fipsOutageFailure?.errorCode, 'Mesh outage did not produce a new explicit runtime failure');
  const outage = JSON.parse(fs.readFileSync(path.join(config.runDir, 'mesh-outage-network.json')));
  assert.ok(new Date(report.fipsOutageFailure.failedAt).getTime() >= outage.startedAt);
  assert.ok(outage.counters.nftables.flatMap(row => row.rule?.expr || []).some(row => row.counter?.packets > 0), 'Mesh fault blocked no real peer traffic');
  privateJson(path.join(config.runDir, 'fips-fault-assertions.json'), { passed: true, droppedReply: dropped[0], probes, canary, outage, runtimeFailure: report.fipsOutageFailure, ledger, additionalProbes: allProbes.filter(row => row.sessionId !== report.runtimeSessionId) });
  return probes[0];
}

export async function captureFipsFaultEvidence(config) {
  const results = {};
  for (const [key, service, args] of [
    ['runtimeRules', 'mesh-runtime', ['nft', '-j', 'list', 'ruleset']],
    ['runtimePeers', 'mesh-runtime', ['fipsctl', '--socket', '/mesh/state/control.sock', 'show', 'peers']],
    ['towerRules', 'mesh-tower', ['nft', '-j', 'list', 'ruleset']],
    ...(config.fipsFaults ? [['ledger', 'mesh-tower', ['cat', '/mesh/fault-ledger.jsonl']]] : []),
  ]) {
    try { results[key] = await meshExec(config, service, args); }
    catch (error) { results[key] = { error: error.message }; }
  }
  try {
    const state = await runtimeApi(config, 'GET', '/api/agent-chat/subscriptions');
    results.subscriptions = state.subscriptions.map(row => ({ subscriptionId: row.subscriptionId, health: row.healthStatus, sse: row.sseStatus, lastErrorCode: row.lastErrorCode, lastEventPollErrorAt: row.lastEventPollErrorAt, lastEventPollErrorCode: row.lastEventPollErrorCode, lastSyncCursor: row.lastSyncCursor }));
  } catch (error) { results.subscriptions = { error: error.message }; }
  privateJson(path.join(config.runDir, 'fips-terminal-network.json'), results);
}

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runtimeApi } from './runtime.mjs';
import { meshExec } from './fips-mesh.mjs';
import { command, privateJson, waitFor } from './stack.mjs';

export async function enableRuntimeFips(config, subscription, profileId, onApplyStarted) {
  const endpoint = config.mesh.endpoint;
  const workspacePath = `/api/v4/flightdeck-pg/workspaces/${subscription.workspaceId}`;
  if (!config.fipsSigningPolicyProvisioned) {
  await runtimeApi(config, 'POST', '/api/admin/signing-policies', {
    id: `release-mesh-${config.runId}`, name: 'Isolated Tower mesh', description: 'Exact test-owned Tower origin and workspace', enabled: true,
    operations: ['nip98.sign'], eventKinds: [27235], nostrKindRules: [],
    assignments: { profileIds: [profileId], workspaceIds: [subscription.workspaceId] },
    nip98Targets: [
      { origin: endpoint, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], exactPaths: [], pathPrefixes: [workspacePath, '/api/v4/storage'], requireBodyHash: true },
    ],
  });
  config.fipsSigningPolicyProvisioned = true;
  }
  const id = subscription.backendConnectionId;
  assert.ok(id, 'Subscription must retain a backend connection ID');
  const before = await runtimeApi(config, 'POST', `/api/agent-chat/backend-connections/${id}/transport/test`, {});
  assert.equal(before.ok, true, 'Trusted TLS authorized workspace baseline failed');
  const transport = { mode: 'fips', httpsEndpoint: null, fipsEndpoint: endpoint, expectedServiceNpub: config.identities.tower.npub };
  const releaseHeldWork = onApplyStarted?.();
  try { await runtimeApi(config, 'POST', `/api/agent-chat/backend-connections/${id}/transport`, { transport }); }
  finally { await releaseHeldWork; }
  const tested = await runtimeApi(config, 'POST', `/api/agent-chat/backend-connections/${id}/transport/test`, {});
  assert.equal(tested.ok, true);
  assert.equal(tested.diagnostics.effectiveTransport, 'fips');
  const connections = await runtimeApi(config, 'GET', '/api/agent-chat/backend-connections');
  const connection = connections.backendConnections.find(row => row.backendConnectionId === id);
  assert.equal(connection.transport.httpsEndpoint, null);
  assert.equal(connection.transport.expectedServiceNpub, config.identities.tower.npub);
  await waitFor(async () => {
    const result = await runtimeApi(config, 'GET', '/api/agent-chat/subscriptions');
    const current = result.subscriptions.find(row => row.subscriptionId === subscription.subscriptionId);
    return current?.healthStatus === 'healthy' && current.backendConnectionId === id;
  }, 'FIPS subscription recovered after switch');
  // Retire baseline keep-alive sockets before the measurement window. Otherwise
  // their later FIN/ACK retransmits are correctly blocked but are not new requests.
  const socketsBefore = await meshExec(config, 'mesh-runtime', ['ss', '-Hnt', 'dst', config.mesh.nodes.tower.dockerAddress]);
  await command('docker', ['compose', '--project-name', config.runId, '-f', path.join(config.runDir, 'compose.json'), 'restart', 'tower-tls'], { env: config.dockerEnv });
  await waitFor(async () => Boolean(await meshExec(config, 'mesh-tower', ['curl', '--fail', '--silent', '--cacert', '/fixture/tls.crt', 'https://tower-tls:3443/health'])), 'TLS listener restored after baseline drain');
  await waitFor(async () => !(await meshExec(config, 'mesh-runtime', ['ss', '-Hnt', 'state', 'established', 'dst', config.mesh.nodes.tower.dockerAddress])).trim(), 'TLS baseline sockets closed');
  privateJson(path.join(config.runDir, 'tls-baseline-drain.json'), { socketsBefore, socketsAfter: '', closedBeforeMeasurement: true });
  const rules = `table inet tower_release { chain output { type filter hook output priority 0; policy accept;
    ip daddr ${config.mesh.nodes.tower.dockerAddress} meta l4proto tcp counter reject
    oifname != "fips0" tcp dport { 3100, 3443, 43101 } counter reject
  }
}
`;
  // Fixed run-owned rules, no host namespace or production network mutations.
  const ruleFile = path.join(config.runDir, 'mesh-fixture', 'egress.nft');
  fs.writeFileSync(ruleFile, rules);
  await meshExec(config, 'mesh-runtime', ['nft', '-f', '/fixture/egress.nft']);
  let blocked = false;
  try { await meshExec(config, 'mesh-runtime', ['curl', '--max-time', '3', '--fail', '-sS', `http://${config.mesh.nodes.tower.dockerAddress}:3100/health`]); }
  catch { blocked = true; }
  assert.ok(blocked, 'Public egress blocking positive control failed');
  const positiveControl = await meshExec(config, 'mesh-runtime', ['nft', '-j', 'list', 'table', 'inet', 'tower_release']);
  assert.ok(JSON.parse(positiveControl).nftables.flatMap(row => row.rule?.expr || []).some(row => row.counter?.packets > 0), 'Positive control blocked no observed packets');
  await meshExec(config, 'mesh-runtime', ['nft', 'delete', 'table', 'inet', 'tower_release']);
  await meshExec(config, 'mesh-runtime', ['nft', '-f', '/fixture/egress.nft']);
  const ingressBefore = await meshExec(config, 'mesh-tower', ['cat', '/mesh/tls-ingress.jsonl']);
  privateJson(path.join(config.runDir, 'fips-phase.json'), { id, transport, baseline: before, tested, positiveControl,
    startedAt: new Date().toISOString(), ingressBeforeLines: ingressBefore.trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line)).filter(row => row.source === config.mesh.nodes.runtime.dockerAddress).length,
    subscriptionId: subscription.subscriptionId, lastSyncCursor: subscription.lastSyncCursor });
}

export async function assertNoPublicTowerTraffic(config) {
  const nft = JSON.parse(await meshExec(config, 'mesh-runtime', ['nft', '-j', 'list', 'table', 'inet', 'tower_release']));
  const counters = nft.nftables.flatMap(item => item.rule?.expr || []).filter(item => item.counter).map(item => item.counter);
  assert.ok(counters.length >= 2);
  for (const counter of counters) assert.equal(counter.packets, 0, 'Autopilot attempted public Tower egress during FIPS phase');
  const phase = JSON.parse(fs.readFileSync(path.join(config.runDir, 'fips-phase.json')));
  const ingress = (await meshExec(config, 'mesh-tower', ['cat', '/mesh/tls-ingress.jsonl'])).trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line)).filter(row => row.source === config.mesh.nodes.runtime.dockerAddress);
  assert.equal(ingress.length, phase.ingressBeforeLines, 'Unexpected ordinary TLS ingress during FIPS phase');
  const connections = await runtimeApi(config, 'GET', '/api/agent-chat/backend-connections');
  const current = connections.backendConnections.find(row => row.backendConnectionId === phase.id);
  assert.equal(current.transport.mode, 'fips'); assert.equal(current.transport.httpsEndpoint, null);
  assert.equal(current.transportDiagnostics.counters.https.requests, 0);
  assert.ok(current.transportDiagnostics.counters.fips.requests > 0);
  privateJson(path.join(config.runDir, 'fips-network-assertions.json'), { passed: true, counters, tlsIngressLines: ingress.length,
    diagnostics: current.transportDiagnostics, positiveControlPassed: true });
}

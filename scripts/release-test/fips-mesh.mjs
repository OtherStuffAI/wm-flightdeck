import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { command, privateJson, waitFor } from './stack.mjs';

export function addFipsMesh(definition, { runDir, runId, runtimePort, towerPort }) {
  const fixture = path.join(runDir, 'mesh-fixture');
  fs.mkdirSync(fixture, { mode: 0o700 });
  fs.writeFileSync(path.join(fixture, 'fips.yaml'), `node:
  identity:
    persistent: true
  control:
    enabled: true
    socket_path: /mesh/state/control.sock
  rendezvous:
    nostr:
      enabled: false
    lan:
      enabled: false
tun:
  enabled: true
  name: fips0
  mtu: 1280
dns:
  enabled: false
transports:
  udp:
    bind_addr: "0.0.0.0:2121"
    advertise_on_nostr: false
    accept_connections: true
peers: []
`);
  fs.writeFileSync(path.join(fixture, 'boot.sh'), `#!/bin/bash
set -euo pipefail
mkdir -p /mesh/state
if [ -f /mesh/peers.yaml ]; then
  sed '/^peers:/d' /fixture/fips.yaml > /mesh/state/fips.yaml
  cat /mesh/peers.yaml >> /mesh/state/fips.yaml
else
  cp /fixture/fips.yaml /mesh/state/fips.yaml
fi
fips -c /mesh/state/fips.yaml > /mesh/daemon.log 2>&1 &
mesh_pid=$!
trap 'kill -TERM "$mesh_pid"; wait "$mesh_pid"' TERM INT
for attempt in $(seq 1 100); do
  if fipsctl --socket /mesh/state/control.sock show status > /mesh/status.json 2>/dev/null; then
    chmod 0666 /mesh/state/control.sock
    break
  fi
  sleep 0.1
done
wait "$mesh_pid"
`);
  for (const role of ['runtime', 'tower']) {
    const name = `mesh-${role}`;
    definition.services[name] = {
      image: `${runId}-autopilot`, user: 'root', command: ['bash', '/fixture/boot.sh'],
      cap_add: ['NET_ADMIN'], devices: ['/dev/net/tun:/dev/net/tun'],
      sysctls: { 'net.ipv6.conf.all.disable_ipv6': '0' },
      volumes: [`${name}:/mesh`, `${fixture}:/fixture:ro`],
      ports: [`127.0.0.1:${role === 'runtime' ? runtimePort : towerPort}:${role === 'runtime' ? 3600 : 3100}`],
      healthcheck: { test: ['CMD-SHELL', 'fipsctl --socket /mesh/state/control.sock show status >/dev/null'], interval: '2s', timeout: '2s', retries: 30 },
    };
    definition.volumes[name] = {};
  }
  for (const [service, role] of [['autopilot', 'runtime'], ['tower', 'tower']]) {
    delete definition.services[service].ports;
    definition.services[service].network_mode = `service:mesh-${role}`;
    definition.services[service].depends_on = { ...(definition.services[service].depends_on || {}), [`mesh-${role}`]: { condition: 'service_healthy' } };
    definition.services[service].volumes = [...(definition.services[service].volumes || []), `mesh-${role}:/mesh`];
  }
  definition.services.autopilot.environment.FIPS_CONTROL_SOCKET = '/mesh/state/control.sock';
  definition.services.autopilot.environment.FIPSCTL_PATH = '/usr/local/bin/fipsctl';
  // DNS service aliases follow the namespace-owning service.
  definition.services['mesh-tower'].networks = { default: { aliases: ['tower', 'tower-tls'] } };
  return fixture;
}

export async function meshExec(config, service, args, options = {}) {
  return command('docker', ['compose', '--project-name', config.runId, '-f', path.join(config.runDir, 'compose.json'),
    'exec', '-T', service, ...args], { env: config.dockerEnv, timeoutMs: 20_000, ...options });
}

export async function establishMesh(config, definition, saveDefinition) {
  const nodes = {};
  for (const role of ['runtime', 'tower']) {
    nodes[role] = await waitFor(async () => {
      const raw = JSON.parse(await meshExec(config, `mesh-${role}`, ['fipsctl', '--socket', '/mesh/state/control.sock', 'show', 'status']));
      const state = raw.data || raw;
      return state.tun_state === 'active' && state.state === 'running' && state.persistent === true ? state : false;
    }, `${role} real FIPS TUN ready`);
    nodes[role].dockerAddress = (await meshExec(config, `mesh-${role}`, ['hostname', '-i'])).split(/\s+/).find(value => /^\d+\./.test(value));
    assert.ok(nodes[role].dockerAddress);
  }
  for (const [from, to] of [['runtime', 'tower'], ['tower', 'runtime']]) {
    const peers = `peers:\n  - npub: "${nodes[to].npub}"\n    alias: "test-${to}"\n    addresses:\n      - transport: udp\n        addr: "${nodes[to].dockerAddress}:2121"\n    connect_policy: auto_connect\n`;
    await meshExec(config, `mesh-${from}`, ['bun', '-e', 'await Bun.write("/mesh/peers.yaml",process.argv[1])', peers]);
  }
  // Provision persistent approved peers before Tower/Autopilot start. This is
  // the same auto_connect contract used by native Wingman FIPS configuration.
  for (const role of ['runtime', 'tower']) {
    await command('docker', ['compose', '--project-name', config.runId, '-f', path.join(config.runDir, 'compose.json'),
      'restart', `mesh-${role}`], { env: config.dockerEnv });
    const addresses = await meshExec(config, `mesh-${role}`, ['hostname', '-i']);
    assert.ok(addresses.split(/\s+/).includes(nodes[role].dockerAddress), 'Owned mesh restart changed the approved UDP peer address');
  }
  for (const [from, to] of [['runtime', 'tower'], ['tower', 'runtime']]) {
    await waitFor(async () => {
      const raw = JSON.parse(await meshExec(config, `mesh-${from}`, ['fipsctl', '--socket', '/mesh/state/control.sock', 'show', 'status']));
      const state = raw.data || raw;
      assert.equal(state.npub, nodes[from].npub, 'Restart changed persistent test mesh identity');
      const peers = JSON.parse(await meshExec(config, `mesh-${from}`, ['fipsctl', '--socket', '/mesh/state/control.sock', 'show', 'peers']));
      return state.tun_state === 'active' && peers.peers?.some(peer => peer.npub === nodes[to].npub && peer.connectivity === 'connected');
    }, `${from} configured peer connected`);
  }
  Object.assign(definition.services.tower.environment, {
    TOWER_FIPS_ENABLED: 'true', TOWER_FIPS_NODE_NPUB: nodes.tower.npub,
    TOWER_FIPS_MESH_ADDRESS: nodes.tower.ipv6_addr, TOWER_FIPS_PORT: '43100', TOWER_FIPS_INGRESS_MODE: 'mesh',
  });
  if (definition.services['mesh-fault-proxy']) definition.services['mesh-fault-proxy'].environment.TOWER_MESH_ADDRESS = nodes.tower.ipv6_addr;
  saveDefinition();
  const evidence = { nodes, version: await meshExec(config, 'mesh-runtime', ['fipsctl', '--version']), endpoint: `http://${nodes.tower.npub}.fips:43100` };
  privateJson(path.join(config.runDir, 'mesh.json'), evidence);
  return evidence;
}

export async function verifyMeshNetwork(config, mesh) {
  const results = {};
  for (const role of ['runtime', 'tower']) {
    results[role] = {
      interface: await meshExec(config, `mesh-${role}`, ['ip', '-j', '-6', 'address', 'show', 'dev', 'fips0']),
      routes: await meshExec(config, `mesh-${role}`, ['ip', '-j', '-6', 'route']),
      peers: await meshExec(config, `mesh-${role}`, ['fipsctl', '--socket', '/mesh/state/control.sock', 'show', 'peers']),
    };
  }
  const health = await waitFor(async () => {
    const raw = await meshExec(config, 'mesh-runtime', ['curl', '--noproxy', '*', '--max-time', '5', '--fail', '-sS',
      '-H', `Host: ${new URL(mesh.endpoint).host}`, `http://[${mesh.nodes.tower.ipv6_addr}]:43100/health`]);
    return JSON.parse(raw);
  }, 'real UDP mesh to Tower ingress');
  assert.equal(health.service_npub, config.identities.tower.npub);
  assert.notEqual(mesh.nodes.tower.npub, health.service_npub);
  privateJson(path.join(config.runDir, 'mesh-network.json'), { ...results, serviceNpub: health.service_npub });
}

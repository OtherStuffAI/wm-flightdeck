import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createApi } from './browser-api.mjs';
import { privateJson, waitFor } from './stack.mjs';

export async function runtimeApi(config, method, route, body) {
  // Only the isolated container can access its generated bootstrap identity.
  // Request bodies use stdin, never command-line arguments or exported keys.
  const args = ['compose', '--project-name', config.runId, '-f', path.join(config.runDir, 'compose.json'),
    'exec', '-T', 'autopilot', 'bun', 'scripts/isolated-test/api.ts', method, route];
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { env: config.dockerEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    // Do not forward runtime error bodies: auth payloads may be included.
    child.stderr.resume();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('close', code => {
      clearTimeout(deadline);
      if (code !== 0) return reject(new Error(`Isolated runtime ${method} ${route} failed (${code})`));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString())); }
      catch { reject(new Error('Isolated runtime returned invalid JSON')); }
    });
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

export function addRuntime(definition, { runId, runtimePort }) {
  definition.services.autopilot = {
    image: `${runId}-autopilot`,
    environment: {
      WINGMAN_ISOLATED_TEST_RUNTIME: '1', WAPP_TOWER_URL: 'http://tower:3100',
      CONNECT_RELAYS: 'ws://relay:8080', WINGMAN_BASE_URL: `http://127.0.0.1:${runtimePort}`,
    },
    ports: [`127.0.0.1:${runtimePort}:3600`],
    volumes: ['runtime:/app/data'],
    depends_on: { tower: { condition: 'service_healthy' } },
  };
  definition.volumes.runtime = {};
  // Real local relay for normal profile announcements; chat dispatch uses Tower PG.
  definition.services.relay = {
    image: `${runId}-tower`, command: ['bun', '-e', `
      const {verifyEvent}=require('nostr-tools');
      const events=new Map();
      Bun.serve({port:8080,fetch(req,server){if(server.upgrade(req))return;return new Response('ready');},websocket:{
        message(ws,raw){try{const [op,id,...filters]=JSON.parse(String(raw));
          if(op==='EVENT'){const e=id;if(!verifyEvent(e)){ws.send(JSON.stringify(['OK',e.id,false,'invalid']));return;}
            events.set(e.id,e);ws.send(JSON.stringify(['OK',e.id,true,'']));}
          if(op==='REQ'){for(const e of events.values())if(filters.some(f=>(!f.kinds||f.kinds.includes(e.kind))&&(!f.authors||f.authors.includes(e.pubkey))))ws.send(JSON.stringify(['EVENT',id,e]));ws.send(JSON.stringify(['EOSE',id]));}
        }catch{ws.close(1003);}}
      }});`],
  };
}

export async function connectRuntime(config) {
  try {
    const workspace = await waitFor(() => {
      const file = path.join(config.runDir, 'workspace.json');
      return fs.existsSync(file) && JSON.parse(fs.readFileSync(file));
    }, 'browser workspace setup', 180_000);
    const agentsResult = await runtimeApi(config, 'GET', '/api/agent-chat/agents');
    const profileId = agentsResult.defaults?.defaultAgentProfileId;
    const agent = agentsResult.agents?.find(item => item.agentId === profileId);
    if (!agent?.botNpub) throw new Error('Isolated Autopilot has no default bot identity');
    const api = createApi(config, config.identities.a);
    const prefix = `/api/v4/flightdeck-pg/workspaces/${workspace.workspaceId}`;
    const name = 'Release Test Agent';
    const member = await api(`${prefix}/members`, { method: 'POST', body: {
      member_npub: agent.botNpub, role: 'member', kind: 'agent', display_name: name,
    } });
    await api(`${prefix}/channels/${workspace.channelId}/grants`, { method: 'POST', body: {
      principal_type: 'actor', principal_id: member.actor.actor_id, access_level: 'contribute',
    } });
    const descriptor = await api(`${prefix}/descriptor`);
    // Locator identity is unchanged; use the physical run-owned Docker endpoint.
    descriptor.tower_base_url = 'http://tower:3100';
    descriptor.capabilities = ['chat_intercept'];
    const imported = await runtimeApi(config, 'POST', '/api/agent-chat/agent-connect/import', {
      agentProfileId: profileId,
      package: { kind: 'coworker_agent_connect', version: 6, protocol: 'flightdeck_pg', generated_at: new Date().toISOString(),
        service: { direct_https_url: 'http://tower:3100' }, auth: { scheme: 'NIP-98', app_npub: config.appNpub }, workspace_descriptor: descriptor },
    });
    privateJson(path.join(config.runDir, 'runtime-import.json'), imported);
    const subscription = await waitFor(async () => {
      const response = await runtimeApi(config, 'GET', '/api/agent-chat/subscriptions');
      const value = response.subscriptions?.find(item => item.workspaceId === workspace.workspaceId);
      if (value) privateJson(path.join(config.runDir, 'runtime-health.json'), value);
      return value?.healthStatus === 'healthy' ? value : false;
    }, 'Autopilot Tower subscription healthy', 120_000);
    const ready = { runId: config.runId, ready: true, npub: agent.botNpub, name,
      agentProfileId: profileId, subscriptionId: subscription.subscriptionId };
    const target = path.join(config.runDir, 'agent.json');
    privateJson(`${target}.tmp`, ready); fs.renameSync(`${target}.tmp`, target);
    return ready;
  } catch (error) {
    privateJson(path.join(config.runDir, 'agent.json'), { runId: config.runId, error: error.message });
    throw error;
  }
}

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { command, freePort, privateJson, snapshot, towerCompose, waitFor } from './stack.mjs';
import { addRuntime, connectRuntime, runtimeApi } from './runtime.mjs';
import { cleanupRun } from './finalize.mjs';
import { verifyDurableSignatures } from './verify.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.umask(0o077);
const args = process.argv.slice(2);
const action = args[0] || 'run';
if (['run', 'up'].includes(action) && (process.versions.bun || Number(process.versions.node.split('.')[0]) !== 22)) {
  const supportedNode = process.env.RELEASE_TEST_NODE || path.join(repo, 'test-results/release/node-v22.21.1-darwin-arm64/bin/node');
  if (!process.env.FLIGHTDECK_TEST_NODE_REEXEC && fs.existsSync(supportedNode) && supportedNode !== process.execPath) {
    const result = spawnSync(supportedNode, [fileURLToPath(import.meta.url), ...args], { stdio: 'inherit', env: { ...process.env, FLIGHTDECK_TEST_NODE_REEXEC: '1' } });
    process.exit(result.status ?? 1);
  }
  throw new Error('Use Node 22 LTS for Playwright 1.51 (set RELEASE_TEST_NODE to its executable); Node 26 and Bun are not validated');
}
const retained = args.includes('--retain');
const cleanEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const runsRoot = path.join(repo, 'test-results/release');
fs.mkdirSync(runsRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(runsRoot, 0o700);
const dockerConfig = path.join(runsRoot, 'docker-config');
fs.mkdirSync(dockerConfig, { recursive: true, mode: 0o700 });
privateJson(path.join(dockerConfig, 'config.json'), {
  auths: {},
  cliPluginsExtraDirs: ['/Applications/Docker.app/Contents/Resources/cli-plugins'],
});
cleanEnv.DOCKER_CONFIG = dockerConfig;
cleanEnv.DOCKER_HOST ||= 'unix:///var/run/docker.sock';
cleanEnv.DOCKER_BUILDKIT = process.env.RELEASE_TEST_BUILDKIT || '0';

function identity() {
  const secret = generateSecretKey();
  return { nsec: nip19.nsecEncode(secret), npub: nip19.npubEncode(getPublicKey(secret)) };
}

async function compose(runDir, ...argv) {
  const metadata = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json')));
  return command('docker', ['compose', '--project-name', metadata.project, '-f', path.join(runDir, 'compose.json'), ...argv],
    { cwd: runDir, env: cleanEnv, log: path.join(runDir, 'lifecycle.log') });
}

function ownedRun(value) {
  const target = path.resolve(value || '');
  if (path.dirname(target) !== runsRoot || !/^fd-release-[a-z0-9-]+$/.test(path.basename(target))) throw new Error('Expected a run directory created by this runner');
  const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json')));
  if (manifest.project !== path.basename(target)) throw new Error('Run ownership mismatch');
  return target;
}

if (['down', 'health'].includes(action)) {
  const runDir = ownedRun(args[1]);
  const metadata = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json')));
  if (action === 'down') {
    await compose(runDir, 'down', '--volumes', '--remove-orphans');
    metadata.cleanedUp = true;
    metadata.stoppedAt = new Date().toISOString();
    privateJson(path.join(runDir, 'manifest.json'), metadata);
    console.log(`down: ${runDir}/lifecycle.log`);
  } else {
    const raw = await command('docker', ['compose', '--project-name', metadata.project, '-f', path.join(runDir, 'compose.json'), 'ps', '--all', '--format', 'json'], { env: cleanEnv });
    const parsed = raw.trim().startsWith('[') ? JSON.parse(raw) : raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const health = { checkedAt: new Date().toISOString(), services: parsed.map(row => ({ service: row.Service, state: row.State, health: row.Health })) };
    health.healthy = ['tower', 'postgres', 'autopilot', 'storage', 'relay'].every(name => health.services.some(row => row.service === name && row.state === 'running' && (!['tower', 'postgres', 'autopilot'].includes(name) || row.health === 'healthy')));
    privateJson(path.join(runDir, 'health.json'), health);
    console.log(`health: ${health.healthy ? 'healthy' : 'not running or unhealthy'}; ${runDir}/health.json`);
    if (!health.healthy) process.exitCode = 1;
  }
} else if (action === 'run' || action === 'up') {
  const runId = `fd-release-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(runsRoot, runId);
  fs.mkdirSync(runDir, { mode: 0o700 });
  const manifest = { runId, project: runId, runnerPid: process.pid, nodeVersion: process.version, startedAt: new Date().toISOString(), status: 'starting', assertions: [], sources: {} };
  const save = () => privateJson(path.join(runDir, 'manifest.json'), manifest);
  save();
  console.log(`Run: ${runDir}`);
  let server;
  try {
    const identities = { a: identity(), b: identity(), tower: identity(), app: identity() };
    privateJson(path.join(runDir, 'identities.secret'), identities);
    manifest.identities = Object.fromEntries(Object.entries(identities).map(([key, item]) => [key, { npub: item.npub }]));
    const towerPort = await freePort();
    const runtimePort = await freePort();
    const towerUrl = `http://127.0.0.1:${towerPort}`;
    const sources = path.join(runDir, 'sources');
    const towerRepo = path.resolve(process.env.RELEASE_TEST_TOWER_REPO || path.join(repo, '../tower'));
    const runtimeRepo = path.resolve(process.env.RELEASE_TEST_AUTOPILOT_REPO || path.join(repo, '../autopilot'));
    for (const [name, source] of [['tower', towerRepo], ['flightdeck', repo], ['autopilot', runtimeRepo]]) {
      manifest.sources[name] = await snapshot(source, path.join(sources, name));
    }
    manifest.dockerVersion = await command('docker', ['version', '--format', '{{.Server.Version}}'], { env: cleanEnv });
    manifest.towerUrl = towerUrl;
    const definition = towerCompose({ towerSource: path.join(sources, 'tower'), towerPort, appNpub: identities.app.npub, identities, password: randomBytes(32).toString('hex') });
    delete definition.services.tower.build;
    definition.services.tower.image = `${runId}-tower`;
    addRuntime(definition, { runId, runtimePort });
    privateJson(path.join(runDir, 'compose.json'), definition);
    save();
    console.log('Building and starting isolated Tower/Postgres/storage');
    await command('docker', ['build', '-t', `${runId}-tower`, path.join(sources, 'tower')], { env: cleanEnv, log: path.join(runDir, 'build-tower.log') });
    console.log('Building isolated Autopilot source');
    await command('docker', ['build', '-f', path.join(sources, 'autopilot/scripts/isolated-test/Dockerfile'),
      '--build-arg', `SOURCE_REVISION=${manifest.sources.autopilot.revision}`, '-t', `${runId}-autopilot`, path.join(sources, 'autopilot')],
    { env: cleanEnv, log: path.join(runDir, 'build-autopilot.log') });
    await compose(runDir, 'up', '-d', '--wait', '--wait-timeout', '180');
    await waitFor(async () => (await fetch(`${towerUrl}/health`)).ok, 'Tower health');
    manifest.towerHealthyAt = new Date().toISOString();
    manifest.runtimeUrl = `http://127.0.0.1:${runtimePort}`;
    for (const service of ['tower', 'autopilot']) manifest.sources[service].imageId = await command('docker', ['image', 'inspect', `${runId}-${service}`, '--format', '{{.Id}}'], { env: cleanEnv });
    const frontend = path.join(sources, 'flightdeck');
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(frontend, 'node_modules'), 'dir');
    const meta = JSON.parse(fs.readFileSync(path.join(frontend, '.build-meta.json')));
    const buildEnv = { ...cleanEnv, FLIGHT_DECK_PG_APP_NPUB: identities.app.npub,
      VITE_DEFAULT_SUPERBASED_URL: towerUrl, VITE_FLIGHT_DECK_BACKEND_MODE: 'tower-pg',
      FLIGHTDECK_BUILD_NUMBER: String(meta.absoluteVersion), FLIGHTDECK_BUILD_ID: `${runId}-${meta.absoluteVersion}`,
      SOURCE_DATE_EPOCH: String(Math.floor(Date.now() / 1000)) };
    console.log('Building isolated Flight Deck source');
    await command('bun', ['run', 'build'], { cwd: frontend, env: buildEnv, log: path.join(runDir, 'build-flightdeck.log') });
    manifest.frontendBuild = JSON.parse(fs.readFileSync(path.join(frontend, 'dist/version.json')));
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
    server = createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = path.resolve(frontend, 'dist', `.${pathname}`);
      if (!file.startsWith(path.join(frontend, 'dist') + path.sep)) file = path.join(frontend, 'dist/index.html');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        if (pathname.startsWith('/assets/')) { response.writeHead(404); response.end(); return; }
        file = path.join(frontend, 'dist/index.html');
      }
      response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    manifest.baseURL = baseURL;
    manifest.status = 'healthy'; save();
    console.log(`Isolated Flight Deck: ${baseURL}; Tower: ${towerUrl}`);
    privateJson(path.join(runDir, 'browser-config.secret'), { runDir, runId, baseURL, towerUrl, appNpub: identities.app.npub, identities });
    if (action === 'up') {
      console.log('Stack retained until SIGINT; run-owned Docker services can be stopped with down');
      await new Promise(resolve => process.once('SIGINT', resolve));
    } else {
      const { runBrowserTest } = await import(pathToFileURL(path.join(frontend, 'scripts/release-test/browser.mjs')).href);
      const config = { runDir, runId, baseURL, towerUrl, appNpub: identities.app.npub, identities, dockerEnv: cleanEnv };
      const results = await Promise.allSettled([runBrowserTest(config), connectRuntime(config)]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      manifest.browser = results[0].value;
      manifest.runtime = results[1].value;
      manifest.integrity = await verifyDurableSignatures(config, manifest.browser);
      const verifyOutcomes = async () => {
        const outcomes = await runtimeApi(config, 'GET', '/api/agent-chat/dispatch-outcomes');
        assert.equal(outcomes.total, 2, 'Expected exactly two real runtime dispatch outcomes');
        assert.deepEqual(outcomes.rows.map(row => row.recordId).sort(), [manifest.browser.messageIds[0], manifest.browser.messageIds[2]].sort());
        for (const row of outcomes.rows) {
          assert.equal(row.actionId, manifest.browser.runtimeSessionId);
          assert.equal(row.details.thread_id, manifest.browser.threadId);
          assert.equal(row.details.channel_id, manifest.browser.workspace.channelId);
        }
        privateJson(path.join(runDir, 'dispatch-outcomes.json'), outcomes);
      };
      await verifyOutcomes();
      for (const video of manifest.browser.videos) assert.ok(video.path && fs.statSync(video.path).size > 1000, 'Missing or empty browser video');
      assert.equal(manifest.browser.videos.length, 2, 'Expected A and B recordings');
      console.log("Restarting only this run's Autopilot and checking durable replay");
      await compose(runDir, 'restart', 'autopilot');
      await compose(runDir, 'up', '-d', '--wait', '--wait-timeout', '120');
      await waitFor(async () => {
        const subscriptions = await runtimeApi(config, 'GET', '/api/agent-chat/subscriptions');
        return subscriptions.subscriptions?.some(row => row.subscriptionId === manifest.runtime.subscriptionId && row.healthStatus === 'healthy');
      }, 'restarted runtime subscription healthy');
      const agents = await runtimeApi(config, 'GET', '/api/agent-chat/agents');
      assert.ok(agents.agents.some(agent => agent.botNpub === manifest.runtime.npub), 'Runtime restart changed its generated bot identity');
      await verifyOutcomes();
      await verifyDurableSignatures(config, manifest.browser);
      manifest.runtimeRestart = { healthyAt: new Date().toISOString(), identityPreserved: true, dispatchCount: 2, durableHistoryUnchanged: true };
      manifest.status = 'passed';
    }
  } catch (error) {
    manifest.status = 'failed'; manifest.failure = error.message;
    console.error(error.message); process.exitCode = 1;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (!retained) {
      try { await cleanupRun(manifest, () => compose(runDir, 'down', '--volumes', '--remove-orphans')); }
      catch { process.exitCode = 1; }
    }
    manifest.finishedAt = new Date().toISOString(); save();
    console.log(`Result: ${manifest.status}; ${runDir}/manifest.json`);
  }
} else throw new Error('Usage: node scripts/release-test/run.mjs [run|up] [--retain] | down|health <run-directory>');

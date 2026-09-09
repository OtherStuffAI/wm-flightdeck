import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export function privateJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export async function command(binary, args, { cwd, log, env = process.env, timeoutMs = 600000 } = {}) {
  const chunks = [];
  const output = log ? fs.openSync(log, 'a', 0o600) : undefined;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
        if (output !== undefined) fs.writeSync(output, chunk);
        else chunks.push(chunk);
      });
      let timedOut = false;
      const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      child.on('error', error => { clearTimeout(deadline); reject(error); });
      child.on('close', code => {
        clearTimeout(deadline);
        if (code === 0 && !timedOut) resolve(Buffer.concat(chunks).toString().trim());
        else reject(new Error(`${binary} ${args[0]} ${timedOut ? 'timed out' : `exited ${code}`}${log ? `; log: ${log}` : ''}`));
      });
    });
  } finally { if (output !== undefined) fs.closeSync(output); }
}

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

// Copy source, never a checkout's ignored env, identities, databases, or runtime state.
export async function snapshot(repo, destination) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const names = (await command('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo })).split('\0').filter(Boolean);
  const hash = createHash('sha256');
  const copied = [];
  for (const name of [...new Set(names)].sort()) {
    if ((/^docs\//.test(name) && !name.startsWith('docs/templates/'))
      || /^(data|tmp|temp|logs|\.git|\.env)(\/|\.|$)/.test(name)
      || /(^|\/)(node_modules|\.mcp\.json)(\/|$)/.test(name)
      || /\.(nsec|secret|secrets|key|pem|db|sqlite\d?)$/.test(name)) continue;
    const source = path.join(repo, name);
    if (!fs.existsSync(source)) continue;
    if (!fs.lstatSync(source).isFile()) throw new Error(`Source snapshot refuses non-file: ${name}`);
    const bytes = fs.readFileSync(source);
    const target = path.join(destination, name);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { mode: fs.statSync(source).mode & 0o777 });
    // Source is public build input inside the private run directory. Docker's
    // non-root runtime must be able to read COPY'd files despite runner umask.
    fs.chmodSync(target, 0o644 | (fs.statSync(source).mode & 0o111));
    hash.update(name).update('\0').update(bytes).update('\0');
    copied.push(name);
  }
  const readableDirectories = directory => {
    fs.chmodSync(directory, 0o755);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) readableDirectories(path.join(directory, entry.name));
    }
  };
  readableDirectories(destination);
  return {
    revision: await command('git', ['rev-parse', 'HEAD'], { cwd: repo }),
    status: await command('git', ['status', '--short'], { cwd: repo }),
    sourceSha256: hash.digest('hex'), files: copied.length,
  };
}

export async function waitFor(check, label, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error.message; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last}` : ''}`);
}

export function towerCompose({ towerSource, towerPort, appNpub, identities, password }) {
  return {
    services: {
      postgres: {
        image: 'postgres:16-alpine',
        environment: { POSTGRES_DB: 'release_test', POSTGRES_USER: 'release_test', POSTGRES_PASSWORD: password },
        volumes: ['postgres:/var/lib/postgresql/data'],
        healthcheck: { test: ['CMD-SHELL', 'pg_isready -U release_test -d release_test'], interval: '2s', timeout: '3s', retries: 30 },
      },
      tower: {
        build: { context: towerSource },
        depends_on: { postgres: { condition: 'service_healthy' } },
        ports: [`127.0.0.1:${towerPort}:3100`],
        environment: {
          PORT: '3100', SUPERBASED_DIRECT_HTTPS_URL: `http://127.0.0.1:${towerPort}`,
          ADMIN_NPUB: identities.a.npub, FLIGHT_DECK_PG_APP_NPUB: appNpub,
          SUPERBASED_SERVICE_NSEC: identities.tower.nsec,
          DB_HOST: 'postgres', DB_NAME: 'release_test', DB_USER: 'release_test', DB_PASSWORD: password,
          GRAPH_ENABLED: 'false', GRAPH_DB_ADMIN_USER: 'unused', GRAPH_DB_ADMIN_PASSWORD: password,
          GRAPH_DB_APP_USER: 'unused', GRAPH_DB_APP_PASSWORD: password,
          STORAGE_S3_ENDPOINT: 'http://storage:9000', STORAGE_S3_ENDPOINT_PUBLIC: 'http://storage:9000',
          STORAGE_S3_ACCESS_KEY: 'release_test', STORAGE_S3_SECRET_KEY: password, STORAGE_S3_BUCKET: 'release-test',
          SUPERBASED_BILLING_MODE: 'disabled',
        },
        healthcheck: { test: ['CMD', 'bun', '-e', "process.exit((await fetch('http://127.0.0.1:3100/health')).ok?0:1)"], interval: '2s', timeout: '3s', retries: 60 },
      },
      storage: {
        image: 'minio/minio:latest', command: ['server', '/data'],
        environment: { MINIO_ROOT_USER: 'release_test', MINIO_ROOT_PASSWORD: password },
        volumes: ['storage:/data'],
      },
    },
    volumes: { postgres: {}, storage: {} },
  };
}

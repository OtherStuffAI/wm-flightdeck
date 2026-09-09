import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { command, snapshot, towerCompose } from './stack.mjs';

test('source snapshot excludes credentials and runtime data while preserving current source under private umask', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-snapshot-check-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  try {
    await command('git', ['init', '-q', repo]);
    fs.writeFileSync(path.join(repo, 'app.js'), 'initial');
    await command('git', ['add', 'app.js'], { cwd: repo });
    await command('git', ['-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid', 'commit', '-qm', 'test: source fixture'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'app.js'), 'current source');
    fs.writeFileSync(path.join(repo, '.env'), 'private fixture');
    fs.mkdirSync(path.join(repo, 'data'));
    fs.writeFileSync(path.join(repo, 'data', 'identity.json'), 'private fixture');
    fs.mkdirSync(path.join(repo, 'scripts'));
    fs.writeFileSync(path.join(repo, 'scripts', 'entrypoint.js'), 'current untracked source');
    const previous = process.umask(0o077);
    let result;
    try { result = await snapshot(repo, path.join(root, 'snapshot')); }
    finally { process.umask(previous); }
    assert.equal(fs.readFileSync(path.join(root, 'snapshot/app.js'), 'utf8'), 'current source');
    assert.equal(fs.existsSync(path.join(root, 'snapshot/.env')), false);
    assert.equal(fs.existsSync(path.join(root, 'snapshot/data')), false);
    assert.equal(fs.statSync(path.join(root, 'snapshot/scripts')).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(root, 'snapshot/scripts/entrypoint.js')).mode & 0o777, 0o644);
    const repeat = await snapshot(repo, path.join(root, 'second'));
    assert.equal(result.sourceSha256, repeat.sourceSha256);
    fs.writeFileSync(path.join(repo, 'app.js'), 'changed source');
    const changed = await snapshot(repo, path.join(root, 'third'));
    assert.notEqual(result.sourceSha256, changed.sourceSha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('isolated Tower exposes only loopback and declares only run-owned named storage', () => {
  const value = towerCompose({ towerSource: '/fixture', towerPort: 43210, appNpub: 'generated-app', password: 'generated-test',
    identities: { a: { npub: 'generated-owner' }, tower: { nsec: 'generated-service' } } });
  assert.deepEqual(value.services.tower.ports, ['127.0.0.1:43210:3100']);
  for (const service of Object.values(value.services)) {
    assert.equal(service.container_name, undefined);
    for (const mount of service.volumes || []) assert.ok(Object.hasOwn(value.volumes, mount.split(':')[0]));
  }
});

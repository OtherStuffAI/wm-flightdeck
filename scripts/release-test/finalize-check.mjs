import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { finalizeBrowser, cleanupRun } from './finalize.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'release-finalize-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const closed = new Set();
  const persisted = [];
  const report = { status: 'running' };
  const contexts = ['a', 'b'].map(user => ({ close: async () => { closed.add(user); } }));
  const recordedPages = ['a', 'b'].map(user => ({ user, page: { video: () => ({ path: async () => {
    assert.equal(closed.size, 2, 'Both contexts must close before resolving videos');
    const path = join(dir, `${user}.webm`);
    await writeFile(path, Buffer.alloc(1001));
    return path;
  } }) } }));
  return { report, contexts, recordedPages, persisted, persist: async value => persisted.push(structuredClone(value)) };
}

test('pass is persisted only after both closures and nonempty recordings', async t => {
  const f = await fixture(t);
  await finalizeBrowser(f);
  assert.deepEqual(f.persisted.map(r => r.status), ['finalizing', 'passed']);
  assert.equal(f.report.videos.length, 2);
});

test('context closure failure fails result even with valid videos and attempts all closures', async t => {
  const f = await fixture(t);
  const close = f.contexts[0].close;
  f.contexts[0].close = async () => { await close(); throw new Error('close rejected'); };
  await assert.rejects(finalizeBrowser(f), /context closure failed/);
  assert.equal(f.report.videos.length, 2);
  assert.equal(f.persisted.at(-1).status, 'failed');
});

for (const kind of ['missing', 'rejected', 'empty']) test(`${kind} video fails result`, async t => {
  const f = await fixture(t);
  f.recordedPages[0].page.video = () => kind === 'missing' ? null : { path: async () => {
    if (kind === 'rejected') throw new Error('video rejected');
    const path = join(await mkdtemp(join(tmpdir(), 'release-empty-')), 'empty.webm');
    t.after(() => rm(path.replace(/\/empty.webm$/, ''), { recursive: true, force: true }));
    await writeFile(path, Buffer.alloc(1000));
    return path;
  } };
  await assert.rejects(finalizeBrowser(f), /recording finalization failed/);
  assert.equal(f.persisted.at(-1).status, 'failed');
});

test('original assertion remains primary when finalization also fails', async t => {
  const f = await fixture(t);
  const error = new Error('original assertion');
  f.originalError = error;
  f.report.failure = { phase: 'assertion', reason: error.message };
  f.contexts[0].close = async () => { throw new Error('close rejected'); };
  await assert.rejects(finalizeBrowser(f), actual => actual === error);
  assert.equal(f.report.failure.reason, 'original assertion');
  assert.ok(f.report.finalizationFailure.length);
  assert.equal(f.persisted.at(-1).status, 'failed');
});

test('required cleanup failure changes passed status, preserves failure, and exits nonzero', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { cleanupRun } from ${JSON.stringify(new URL('./finalize.mjs', import.meta.url).href)};
    const manifest = { status: 'passed', failure: 'earlier assertion' };
    try { await cleanupRun(manifest, async () => { throw new Error('cleanup rejected'); }); }
    catch { process.exitCode = 1; }
    console.log(JSON.stringify(manifest));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'failed', cleanedUp: false, failure: 'earlier assertion', cleanupFailure: 'cleanup rejected' });
});

test('successful required cleanup retains passing result', async () => {
  const manifest = { status: 'passed' };
  await cleanupRun(manifest, async () => {});
  assert.deepEqual(manifest, { status: 'passed', cleanedUp: true });
});

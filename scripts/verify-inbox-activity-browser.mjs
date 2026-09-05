// In-memory routing only; uses production worker, real sidebar/Inbox templates
// and source projections. Optional captures stay local and never enter artifacts.
import { chromium, webkit } from 'playwright';
import { JSDOM } from 'jsdom';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(process.env.FLIGHTDECK_VERIFY_DIST || 'dist');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
const worker = (await readFile(path.join(root, entry), 'utf8')).match(/tower-pg-materialization-worker-[\w-]+\.js/)[0];
const document = new JSDOM(html).window.document;
const find = (node, selector) => node.querySelector(selector) || [...node.querySelectorAll('template')].map(t => find(t.content, selector)).find(Boolean);
const sidebar = find(document, 'template[x-for="group in $store.chat.sidebarScopeChannelGroups"]').outerHTML;
const inbox = ['inbox', 'wapp-updates', 'recent'].map(id => find(document, `[data-deck-column="${id}"]`).outerHTML).join('');
const stylesheet = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.outerHTML).join('');
const pageHtml = `<!doctype html><html><head><meta charset="utf-8">${stylesheet}<style>body{display:block;padding:24px}main{display:grid;grid-template-columns:180px 1fr 1fr 1fr;gap:28px}.deck-column{max-height:740px;overflow:auto;width:100%}aside{max-height:780px;overflow:auto}[x-cloak]{display:none!important}</style></head><body x-data><h1>Flight Deck · isolated navigation and Inbox verification</h1><main><aside>${sidebar}</aside>${inbox}</main><script type="module" src="/probe.js"></script></body></html>`;
const temporary = await mkdtemp(path.join(tmpdir(), 'fd-inbox-probe-'));
execFileSync('bun', ['build', 'scripts/browser-inbox-activity-entry.js', '--target=browser', `--outfile=${temporary}/probe.js`, '--define', '__FLIGHT_DECK_PG_APP_NPUB__="npub1fixture"'], { stdio: 'pipe' });
const browser = await (process.env.FLIGHTDECK_VERIFY_BROWSER === 'webkit' ? webkit.launch() : chromium.launch({ channel: 'chrome' }));
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.route('**/*', async route => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/') return route.fulfill({ contentType: 'text/html', body: pageHtml });
    const file = p === '/probe.js' ? `${temporary}/probe.js` : path.resolve(root, `.${p}`);
    if (p !== '/probe.js' && !file.startsWith(root + path.sep)) return route.abort();
    try { return route.fulfill({ contentType: p.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(file) }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  await page.goto('http://flightdeck-inbox.test/');
  await page.waitForFunction(() => typeof window.startInboxProbe === 'function');
  const fixture = JSON.parse(await readFile('tests/fixtures/flightdeck-record-delta-v1.json', 'utf8'));
  const pages = [];
  if (process.env.FLIGHTDECK_CHANNEL_CAPTURE_PREFIX) {
    for (let i = 0; i < 100; i++) {
      const bundle = JSON.parse(await readFile(`${process.env.FLIGHTDECK_CHANNEL_CAPTURE_PREFIX}${i}.json`, 'utf8'));
      pages.push(bundle); if (!bundle.has_more && bundle.mode === 'delta') break;
    }
  } else pages.push(fixture.canonical_upserts);
  const canonical = new Map();
  for (const bundle of pages) for (const change of bundle.changes) if (change.family === 'channel') {
    if (change.operation === 'upsert') canonical.set(change.id, change.row); else canonical.delete(change.id);
  }
  await page.evaluate(async ({ worker, pages }) => {
    await window.prepareInboxV25(pages.flatMap(page => page.changes).find(row => row.family === 'message' && row.row)?.row);
    const instance = new Worker(`/assets/${worker}`, { type: 'module' });
    let cursor = null;
    for (const bundle of pages) {
      const workspaceId = bundle.changes[0]?.workspace_id || pages[0].changes[0].workspace_id;
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker timed out')), 30000);
        instance.onerror = e => { clearTimeout(timer); reject(new Error(e.message)); };
        instance.onmessage = e => { clearTimeout(timer); resolve(e.data); };
        instance.postMessage({ type: 'tower-pg-materializer:request', id: 'inbox-probe', workspaceKey: 'inbox-browser', workspaceDbKey: 'inbox-browser',
          store: { workspaceId, workspaceOwnerNpub: 'npub1owner', currentWorkspace: { workspaceId }, session: { npub: 'npub1viewer' } },
          bundle: { ...bundle, local_apply_options: { expectedCursor: cursor, expectedGeneration: 0, viewBaselineInitialized: true } } });
      });
      if (!result.ok) throw new Error(result.error.message);
      cursor = result.value.cursor;
    }
    instance.terminate(); await window.startInboxProbe();
  }, { worker, pages });
  await page.waitForFunction(() => !window.probeStore.inboxActivityLoading && window.probeStore.channels.length > 0);
  const captureEvidence = await page.evaluate(() => ({
    channels: window.probeStore.channels.length,
    chats: window.probeStore.autopilotOverviewThreads.length,
    recent: window.probeStore.deckRecentChannels.length,
    ownerless: window.probeStore.fileMessages.filter(row => !row.owner_npub).length,
  }));
  assert(captureEvidence.chats > 0); assert(captureEvidence.recent > 0); assert(captureEvidence.ownerless > 0);
  await page.screenshot({ path: '/tmp/flightdeck-canonical-inbox-restored.png', fullPage: true });
  const select = page.getByRole('combobox', { name: 'Inbox type', exact: true });
  for (const [value, kind] of [['all', null], ['chat', 'chat'], ['task', 'task'], ['document', 'document'], ['file', 'file']]) {
    await select.selectOption(value);
    await page.waitForFunction(() => !window.probeStore.inboxActivityLoading);
    const kinds = await page.evaluate(() => window.probeStore.visibleAutopilotOverviewInbox.map(row => row.inboxKind));
    if (kind) assert(kinds.every(value => value === kind));
    assert.equal(await page.locator('.attention-card').count(), kinds.length);
  }
  // Add canonical records via the same production worker, after the upgrade
  // check. Each type has older records behind >100 unrelated scoped updates.
  const synthetic = fixture.canonical_upserts.changes;
  await page.evaluate(async ({ worker, synthetic, pageTemplate }) => {
    const instance = new Worker(`/assets/${worker}`, { type: 'module' });
    const channels = window.probeStore.channels;
    const channel = channels.find(row => row.scope_id) || channels[0];
    const workspaceId = channel.pg_workspace_id || synthetic[0].workspace_id;
    const changes = [];
    for (const family of ['task', 'doc', 'file', 'message']) {
      const original = synthetic.find(row => row.family === family);
      for (let i = 0; i < 125; i++) {
        const id = `activity-probe-${family}-${i}`;
        changes.push({ ...original, id, workspace_id: workspaceId, channel_id: channel.record_id, scope_id: channel.scope_id, version: String(900000 + i),
          row: { ...original.row, id, workspace_id: workspaceId, channel_id: channel.record_id, scope_id: channel.scope_id,
            thread_id: family === 'message' ? id : null, title: `Probe ${family} ${i}`, body: `Probe chat ${i}`, display_name: `Probe file ${i}`,
            storage_object_id: family === 'file' ? `probe-object-${i}` : original.row.storage_object_id,
            updated_at: new Date(Date.UTC(2030, 0, 1) - i * 1000).toISOString() } });
      }
    }
    for (let i = 0; i < changes.length; i += 100) {
      const result = await new Promise((resolve, reject) => {
        instance.onmessage = e => resolve(e.data); instance.onerror = e => reject(Error(e.message));
        instance.postMessage({ type: 'tower-pg-materializer:request', id: `probe-${i}`, workspaceKey: 'inbox-browser', workspaceDbKey: 'inbox-browser',
          store: { workspaceId, workspaceOwnerNpub: 'npub1owner', currentWorkspace: { workspaceId }, session: { npub: 'npub1viewer' } },
          bundle: { ...pageTemplate, changes: changes.slice(i, i + 100), next_cursor: `probe-${i}` } });
      });
      if (!result.ok) throw Error(result.error.message);
    }
    instance.terminate();
    window.probeScope = channel.scope_id;
  }, { worker, synthetic, pageTemplate: fixture.one_message_delta });
  for (const value of ['chat', 'task', 'document', 'file']) {
    await select.selectOption(value);
    await page.waitForFunction(() => !window.probeStore.inboxActivityLoading && window.probeStore.visibleAutopilotOverviewInbox.length === 50);
    await page.getByRole('button', { name: 'Load 50 more Inbox cards or older activity' }).click();
    await page.waitForFunction(() => window.probeStore.visibleAutopilotOverviewInbox.length === 100);
    assert.equal(await page.locator('.attention-card').count(), 100);
  }
  const sparseEvidence = await page.evaluate(async () => {
    const channel = window.probeStore.channels.find(row => row.scope_id && row.scope_id !== window.probeScope
      && window.probeStore.recentChannelMessages.some(message => message.channel_id === row.record_id));
    if (!channel) return null;
    window.probeStore.selectedBoardId = channel.scope_id;
    window.probeStore.setDeckInboxType('chat');
    return { scope: channel.scope_id, channel: channel.record_id };
  });
  if (sparseEvidence) {
    await page.waitForFunction(() => !window.probeStore.inboxActivityLoading && window.probeStore.visibleAutopilotOverviewInbox.length > 0);
    assert(await page.evaluate(({ channel }) => window.probeStore.deckRecentChannels.some(row => row.channelId === channel), sparseEvidence));
    assert(await page.evaluate(() => window.probeStore.visibleAutopilotOverviewInbox.every(row => !row.id.startsWith('activity-probe'))));
  }
  await page.evaluate(() => { window.probeStore.selectedBoardId = 'all'; window.probeStore.resetDeckInboxSources(); });
  await page.waitForFunction(() => !window.probeStore.inboxActivityLoading);
  const recentBefore = await page.evaluate(() => window.probeStore.deckRecentChannels.map(row => row.channelId));
  await select.selectOption('task');
  await page.evaluate(async () => {
    await window.probeDb.wapp_activity_items.put({ record_id: 'live-feed', title: 'Live Feed insert', summary: 'Independent subscription', occurred_at: '2030-01-01T00:00:00Z' });
    const row = window.probeStore.recentChannelMessages.find(row => row.record_id.startsWith('activity-probe-message'));
    window.latestProbeId = row.record_id;
    await window.probeDb.chat_messages.update(row.record_id, { body: 'Live Recent edit' });
  });
  await page.evaluate(async () => {
    const row = window.probeStore.recentChannelMessages.find(row => row.record_id === window.latestProbeId);
    window.probeAttentionId = row.pg_thread_id || row.record_id;
    await window.probeDb.pg_resource_attention.put({ record_id: `thread:${window.probeAttentionId}`, resource_type: 'thread', resource_id: window.probeAttentionId, unread: true });
  });
  await page.waitForFunction(() => window.probeStore.deckRecentChannels.some(row => row.id === window.probeAttentionId && row.isUnread));
  await page.evaluate(() => window.probeDb.pg_resource_attention.update(`thread:${window.probeAttentionId}`, { unread: false }));
  await page.waitForFunction(() => window.probeStore.deckRecentChannels.some(row => row.id === window.probeAttentionId && !row.isUnread));
  await page.getByText('Live Feed insert', { exact: true }).waitFor();
  await page.locator('.deck-recent-thread-preview').filter({ hasText: 'Live Recent edit' }).waitFor();
  await page.evaluate(async () => {
    await window.probeDb.wapp_activity_items.update('live-feed', { title: 'Live Feed edit' });
    await window.probeDb.chat_messages.delete(window.latestProbeId);
    window.probeStore.selectedBoardId = window.probeScope;
    window.probeStore.startWorkspaceLiveQueries();
  });
  await page.getByText('Live Feed edit', { exact: true }).waitFor();
  await page.waitForFunction(() => !window.probeStore.deckRecentChannels.some(row => row.latestMessage === 'Live Recent edit'));
  await page.evaluate(() => window.probeDb.wapp_activity_items.delete('live-feed'));
  await page.getByText('Live Feed edit', { exact: true }).waitFor({ state: 'hidden' });
  await select.selectOption('chat');
  await page.waitForFunction(() => !window.probeStore.inboxActivityLoading);
  await page.locator('#deck-inbox-search').fill('No matching historical phrase');
  await page.locator('.inbox-search-submit').click();
  await page.waitForFunction(() => !window.probeStore.inboxActivityLoading && window.probeStore.visibleAutopilotOverviewInbox.length === 0);
  const historyAvailable = await page.evaluate(() => window.probeStore.hasMoreAutopilotOverviewInbox);
  assert.equal(await page.getByRole('button', { name: 'Load 50 more Inbox cards or older activity' }).isVisible(), historyAvailable);
  if (historyAvailable) {
    const before = await page.evaluate(() => window.probeStore.inboxActivityVisibleCount);
    await page.getByRole('button', { name: 'Load 50 more Inbox cards or older activity' }).click();
    assert.equal(await page.evaluate(() => window.probeStore.inboxActivityVisibleCount), before + 50);
  }
  const output = process.env.FLIGHTDECK_INBOX_SCREENSHOT || '/tmp/flightdeck-inbox-activity.png';
  await page.screenshot({ path: output, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: 'main{grid-template-columns:1fr}aside{display:none}body{padding:12px}' });
  const searchWidth = await page.locator('#deck-inbox-search').evaluate(el => el.getBoundingClientRect().width);
  assert(searchWidth >= 150, `Mobile search width ${searchWidth}`);
  await page.screenshot({ path: output.replace('.png', '-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), pages: pages.length, captureEvidence, types: 5, pagination: '50/100 for each type', liveRecent: true, liveFeed: true, boundedHistoricalProgress: true, cachedV25Upgrade: true, sparseScopeVerified: Boolean(sparseEvidence), liveUnread: true, recentBefore, screenshot: output, errors }));

} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }

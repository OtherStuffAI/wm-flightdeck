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
const inbox = find(document, '[data-deck-column="inbox"]').outerHTML;
const stylesheet = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.outerHTML).join('');
const pageHtml = `<!doctype html><html><head><meta charset="utf-8">${stylesheet}<style>body{display:block;padding:24px}main{display:grid;grid-template-columns:230px 1fr;gap:28px}.deck-column{max-height:740px;overflow:auto;width:100%}aside{max-height:780px;overflow:auto}[x-cloak]{display:none!important}</style></head><body x-data><h1>Flight Deck · isolated navigation and Inbox verification</h1><main><aside>${sidebar}</aside>${inbox}</main><script type="module" src="/probe.js"></script></body></html>`;
const temporary = await mkdtemp(path.join(tmpdir(), 'fd-inbox-probe-'));
execFileSync('bun', ['build', 'scripts/browser-inbox-navigation-entry.js', '--target=browser', `--outfile=${temporary}/probe.js`, '--define', '__FLIGHT_DECK_PG_APP_NPUB__="npub1fixture"'], { stdio: 'pipe' });
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
  await page.waitForFunction(() => window.probeStore.visibleAutopilotOverviewInbox.length === 50);
  const mapping = await page.evaluate(() => window.probeStore.sidebarScopeChannelGroups.flatMap(g => g.channels.map(c => [c.record_id, g.scope.record_id])));
  for (const [id, c] of canonical) if (!c.archived_at) assert.deepEqual(mapping.find(row => row[0] === id), [id, c.scope_id]);
  assert(mapping.some(([id]) => id === 'probe-old')); assert(mapping.some(([id]) => id === 'probe-empty'));
  const cards = page.locator('[data-deck-column="inbox"] .attention-card');
  await page.waitForFunction(() => document.querySelectorAll('[data-deck-column="inbox"] .attention-card').length === 50);
  assert.equal(await cards.count(), 50);
  const footer = page.getByRole('button', { name: 'Load 50 more Inbox cards or older activity' });
  const output = process.env.FLIGHTDECK_INBOX_SCREENSHOT || '/tmp/flightdeck-inbox-navigation.png';
  await page.screenshot({ path: output.replace(/\.png$/, '-top.png'), fullPage: true });
  await page.locator('[data-deck-column="inbox"]').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300); assert.equal(await cards.count(), 50);
  await page.screenshot({ path: output, fullPage: true });
  await footer.click(); await page.waitForFunction(() => window.probeStore.visibleAutopilotOverviewInbox.length === 100);
  await footer.click(); await page.waitForFunction(() => window.probeStore.visibleAutopilotOverviewInbox.length === 150);
  await page.locator('#deck-inbox-search').fill('Older match');
  await page.locator('.inbox-search-submit').click();
  await page.waitForFunction(() => !window.probeStore.inboxActivityLoading && window.probeStore.visibleAutopilotOverviewInbox.length === 25);
  await page.waitForFunction(() => !window.probeStore.hasMoreAutopilotOverviewInbox);
  await footer.waitFor({ state: 'hidden' });
  assert.equal(await footer.isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.probeStore.sidebarScopeChannelGroups.flatMap(g => g.channels.map(c => [c.record_id, g.scope.record_id]))), mapping);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), canonicalChannels: canonical.size, mappedChannels: mapping.length, pages: pages.length, initial: 50, next: 100, sourceExpansion: 150, filteredOlder: 25, exhausted: true, screenshot: output, errors }));
} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }

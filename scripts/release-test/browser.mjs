import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { mkdir, stat, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { finalizeBrowser } from './finalize.mjs';
import { BrowserTestError, createApi, rows, poll } from './browser-api.mjs';

function check(condition, message) {
  if (!condition) throw new BrowserTestError(message);
}

async function publicJson(path, value) {
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

async function continueAccessGate(page) {
  const gate = page.locator('.workspace-access-modal:visible');
  if (await gate.isVisible()) {
    await gate.getByRole('button', { name: 'Continue', exact: true }).click();
    await poll('workspace access gate finished loading', async () => {
      check(!await gate.getByText('Workspace data could not be loaded', { exact: true }).isVisible(), 'Workspace access gate reported a production loading error; see failure screenshot');
      return !await gate.isVisible();
    }, 90000);
  }
}

async function connect(page, towerUrl) {
  await continueAccessGate(page);
  const input = page.getByPlaceholder('URL or workspace descriptor JSON');
  if (!await input.isVisible()) {
    const add = page.getByRole('button', { name: 'Add workspace...', exact: true });
    if (!await add.isVisible()) await page.locator('.sidebar-workspace-trigger').click();
    await add.click();
  }
  await input.fill(towerUrl);
  await page.locator('.connect-manual-form').getByRole('button', { name: 'Connect', exact: true }).click();
  await page.locator('.connect-v8-flow').waitFor({ state: 'visible' });
}

async function channel(page, name, workspace) {
  const url = new URL(page.url());
  url.pathname = '/chat';
  url.search = '';
  url.searchParams.set('workspaceid', workspace.workspaceId);
  url.searchParams.set('scopeid', workspace.scopeId);
  url.searchParams.set('channelid', workspace.channelId);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await continueAccessGate(page);
  await page.locator('.chat-channel-tab:visible').filter({ has: page.locator('.chat-channel-tab-label', { hasText: name }) }).first().click();
  await page.locator('.sidebar-chat-row:visible').click();
  await page.getByRole('textbox', { name: 'Message channel', exact: true }).waitFor();
  await poll('requested channel selected by public deep link', async () => {
    const labels = await page.locator('.chat-channel-tab[aria-selected="true"]:visible').allTextContents();
    return labels.some(label => label.includes(name));
  });
}

async function openThread(page, rootId) {
  const reply = page.getByRole('textbox', { name: 'Reply to thread', exact: true });
  if (await reply.isVisible()) return;
  await page.locator(`[data-message-id="${rootId}"] .chat-post-content`).press('Enter');
  await reply.waitFor();
}

async function visibleHistory(page, ids) {
  await poll('exactly once visible thread history in durable order', async () => {
    const visible = await page.locator('[data-thread-message-id]:visible').evaluateAll(elements => elements.map(el => el.getAttribute('data-thread-message-id')));
    return JSON.stringify(visible) === JSON.stringify(ids);
  });
}

/** Standalone library: deliberately never imports playwright.config or dotenv.
 * workspace.json: {runId, workspaceId, scopeId, channelId, workspaceName, channelName}
 * agent.json: {runId, ready:true, npub, name}; or {runId,error:<public reason>}.
 * Runner owns runtime provisioning and consumes public workspace.json atomically.
 * Membership/channel grant are explicit owner-signed current PG setup API steps.
 * Login and all messages/mentions are real UI actions; no page/store injection.
 */
export async function runBrowserTest(config) {
  const runDir = resolve(config.runDir);
  check((await stat(runDir)).isDirectory() && ((await stat(runDir)).mode & 0o077) === 0, 'runDir must be an existing owner-only directory (0700)');
  for (const target of [config.baseURL, config.towerUrl]) {
    const url = new URL(target);
    check(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Release browser requires isolated loopback URLs');
    check(!url.username && !url.password, 'URLs must not contain credentials');
  }
  check(config.identities.a.npub !== config.identities.b.npub, 'A and B must be independent identities');
  // Playwright DEBUG=pw:api can log fill arguments even without tracing.
  check(!process.env.DEBUG && !process.env.PWDEBUG, 'Unset DEBUG and PWDEBUG before importing/running the release browser');
  const evidence = join(runDir, 'browser');
  await mkdir(evidence, { mode: 0o700 });
  const report = { runId: config.runId, status: 'running', startedAt: new Date().toISOString(), assertions: [], setup: [], videos: [], screenshots: [] };
  const contexts = [];
  const recordedPages = [];
  let phase = 'prerequisites';
  let originalError;
  const setPhase = value => {
    phase = value;
    writeFileSync(join(evidence, 'progress.json'), JSON.stringify({ phase, at: new Date().toISOString(), assertions: report.assertions }), { mode: 0o600 });
  };
  const launch = async (user, recording) => {
    const profile = join(runDir, `browser-profile-${user}`);
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(profile, {
      headless: true, viewport: { width: 1440, height: 1000 },
      ...(recording ? { recordVideo: { dir: evidence, size: { width: 1440, height: 1000 } } } : {}),
    });
    contexts.push(context);
    context.setDefaultTimeout(30000);
    // Chrome's restored startup page may predate Playwright's video recorder.
    // Open the recorded page explicitly after the recorder is attached.
    const initialPages = context.pages();
    const page = recording ? await context.newPage() : initialPages[0] || await context.newPage();
    if (recording) await Promise.all(initialPages.map(initial => initial.close()));
    if (recording) recordedPages.push({ user, page });
    await page.goto(config.baseURL, { waitUntil: 'domcontentloaded' });
    return { context, page };
  };
  const api = createApi(config, config.identities.a);
  const apiB = createApi(config, config.identities.b);
  const assert = message => report.assertions.push({ message, at: new Date().toISOString() });
  try {
    // No recording, tracing, screenshots, console listeners, or state export here.
    for (const user of ['a', 'b']) {
      setPhase(`unrecorded UI login ${user}`);
      const { context, page } = await launch(user, false);
      await page.getByText('Advanced options', { exact: true }).click();
      const secret = page.locator('input[name="secret"]');
      check(await secret.getAttribute('type') === 'password', 'Nsec input must remain password masked');
      try {
        await secret.fill(config.identities[user].nsec);
        await page.getByRole('button', { name: 'BYO Nsec', exact: true }).click();
        await secret.waitFor({ state: 'hidden' });
      } catch {
        // Playwright errors can contain action arguments. Never propagate them.
        throw new BrowserTestError(`User ${user.toUpperCase()} nsec UI login failed (details intentionally suppressed)`);
      }
      await context.close();
      contexts.splice(contexts.indexOf(context), 1);
      assert(`User ${user.toUpperCase()} completed password-masked UI nsec login without recording`);
    }
    setPhase('PG workspace onboarding');
    const a = await launch('a', true);
    const b = await launch('b', true);
    const cdp = await a.context.newCDPSession(a.page);
    report.browserVersion = (await cdp.send('Browser.getVersion')).product;
    await cdp.detach();
    const name = `Release ${config.runId}`;
    setPhase('A Tower connection');
    await connect(a.page, config.towerUrl);
    setPhase('A PG workspace wizard');
    await a.page.locator('.connect-v8-flow').getByPlaceholder('My workspace').fill(name);
    const next = a.page.locator('.connect-v8-flow .connect-modal-actions .connect-primary-action');
    await next.click();
    await a.page.getByRole('button').filter({ hasText: 'Team workspace' }).click();
    await next.click();
    await next.click();
    // The first chat slice needs one shared scope/channel. Select that shape in
    // the real wizard rather than creating unused template spaces.
    const scopeOptions = a.page.locator('.connect-scope-button:visible');
    await scopeOptions.first().click();
    for (let index = 0; index < await scopeOptions.count(); index++) {
      await scopeOptions.nth(index).locator('input[type="checkbox"]').setChecked(index === 0);
    }
    const channelOptions = a.page.locator('.connect-channel-card:visible input[type="checkbox"]');
    for (let index = 0; index < await channelOptions.count(); index++) await channelOptions.nth(index).setChecked(index === 0);
    await next.click();
    await poll('PG workspace wizard completed bootstrap', async () => {
      check(!await a.page.getByText('Workspace setup failed.', { exact: true }).isVisible(), 'PG workspace wizard reported bootstrap failure; see failure screenshot');
      return !await a.page.locator('.connect-modal').isVisible();
    }, 90000);
    setPhase('UI-created workspace and starter channel verification');
    const workspace = await poll('UI-created workspace in Tower', async () => rows(await api(`/api/v4/flightdeck-pg/workspaces?app_npub=${encodeURIComponent(config.appNpub)}`), 'workspaces').find(w => w.label === name));
    const workspaceId = workspace.identity?.workspace_id;
    check(workspaceId, 'Workspace listing omitted public workspace ID');
    const prefix = `/api/v4/flightdeck-pg/workspaces/${workspaceId}`;
    const scopes = rows(await api(`${prefix}/scopes`), 'scopes');
    let selected;
    for (const scope of scopes) {
      const channels = rows(await api(`${prefix}/scopes/${scope.id || scope.scope_id}/channels`), 'channels');
      const item = channels.find(c => c.name && c.kind !== 'dm');
      if (item) { selected = { scope, item }; break; }
    }
    check(selected, 'UI workspace bootstrap did not create a usable channel');
    const channelId = selected.item.id || selected.item.channel_id;
    const channelName = selected.item.name;
    const scopeName = selected.scope.name;
    setPhase('B member and channel grant setup API');
    const member = await api(`${prefix}/members`, { method: 'POST', body: { member_npub: config.identities.b.npub, role: 'member', kind: 'human' } });
    await api(`${prefix}/channels/${channelId}/grants`, { method: 'POST', body: { principal_type: 'actor', principal_id: member.actor.actor_id, access_level: 'contribute' } });
    report.setup.push('Workspace created through PG UI wizard; A signed POST members (B role member) and POST channel grants (B contribute) through current PG API. No legacy groups or database seeds.');
    setPhase('B Tower connection and workspace selection');
    await connect(b.page, config.towerUrl);
    await b.page.locator('.connect-v8-flow .connect-workspace-row').filter({ hasText: name }).click();
    await b.page.locator('.connect-modal').waitFor({ state: 'hidden', timeout: 90000 });
    const workspacePublic = { runId: config.runId, workspaceId, scopeId: selected.scope.id || selected.scope.scope_id, channelId, workspaceName: name, channelName, scopeName };
    report.workspace = workspacePublic;
    await publicJson(join(runDir, 'workspace.json'), workspacePublic);
    assert('A created workspace via UI and B connected via UI with ordinary member access');
    setPhase('runtime agent readiness handshake');
    const agent = await poll('runtime agent.json readiness after workspace.json (runtime must report public error on failure)', async () => {
      let value;
      try { value = JSON.parse(await readFile(join(runDir, 'agent.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return false; throw new BrowserTestError('Runtime agent.json is unreadable or not valid JSON; publish atomically'); }
      check(value.runId === config.runId, 'Runtime agent.json belongs to a different run');
      if (value.error) throw new BrowserTestError('Runtime reported agent readiness failure in agent.json; inspect its public error reason');
      return value.ready === true && /^npub1/.test(value.npub) && value.name ? value : false;
    }, 180000);
    report.agent = { npub: agent.npub, name: agent.name };
    // Reload after infrastructure bootstrap only; subsequent live delivery is
    // observed without refresh until the explicit reconnect/reload assertion.
    setPhase('select shared scope and channel');
    await channel(a.page, channelName, workspacePublic);
    await channel(b.page, channelName, workspacePublic);
    setPhase('root composer mention and live delivery');
    const marker = `release-root-${config.runId}`;
    const followupMarker = `release-followup-${config.runId}`;
    const composer = a.page.getByRole('textbox', { name: 'Message channel', exact: true });
    await composer.pressSequentially(`@${agent.name}`, { delay: 40 });
    await publicJson(join(evidence, 'mention-diagnostic.json'), await a.page.evaluate(() => {
      const store = window.Alpine.store('chat');
      return {
        active: store.mentionActive,
        query: store.mentionQuery,
        results: store.mentionResults.map(({ type, id, label }) => ({ type, id, label })),
        members: store.pgWorkspaceMembers.map(({ npub, kind, display_name }) => ({ npub, kind, display_name })),
      };
    }));
    await a.page.locator('.mention-result-item:visible').filter({ has: a.page.locator('.mention-result-label', { hasText: agent.name }) }).first().click({ timeout: 90000 });
    await composer.press('End');
    await composer.pressSequentially(` ${marker} Please reply once.`, { delay: 10 });
    await composer.press('Enter');
    const messages = async () => {
      const data = await api(`${prefix}/channels/${channelId}/messages?limit=200`);
      check(!data.next_cursor, 'Release channel unexpectedly exceeds bounded 200-message history');
      return rows(data, 'messages');
    };
    const root = await poll('A root persisted', async () => (await messages()).find(m => m.body?.includes(marker)));
    const rootId = root.id || root.message_id;
    await b.page.locator(`[data-message-id="${rootId}"]`).waitFor();
    assert('B saw A root without refresh through live synchronization');
    await openThread(a.page, rootId);
    await openThread(b.page, rootId);
    const directory = rows(await api(`${prefix}/members`), 'members').map(member => member.actor);
    const author = m => m.sender_npub || m.created_by_actor_npub || directory.find(p => (p.actor_id || p.id) === (m.sender_actor_id || m.created_by_actor_id))?.npub;
    check(author(root) === config.identities.a.npub, 'Root attribution is not A');
    check(JSON.stringify(root.mentions || root.metadata?.mentions || []).includes(agent.npub), 'Root is missing structured agent mention');
    check(root.thread_id && root.channel_id === channelId && root.workspace_id === workspaceId, 'Root routing does not match the created workspace/channel/thread');
    const first = await poll('first agent reply', async () => (await messages()).find(m => author(m) === agent.npub && m.thread_id === root.thread_id), 180000);
    await visibleHistory(a.page, [rootId, first.id]);
    await visibleHistory(b.page, [rootId, first.id]);
    assert('Both users saw exactly one first agent reply in the bound thread');
    setPhase('B continuing thread and second reply');
    const reply = b.page.getByRole('textbox', { name: 'Reply to thread', exact: true });
    await reply.pressSequentially(`@${agent.name}`, { delay: 40 });
    await b.page.locator('.mention-result-item:visible').filter({ has: b.page.locator('.mention-result-label', { hasText: agent.name }) }).first().click({ timeout: 90000 });
    await reply.press('End');
    await reply.pressSequentially(` ${followupMarker} Please reply once again.`, { delay: 10 });
    await reply.press('Enter');
    const followup = await poll('B followup persisted', async () => (await messages()).find(m => m.body?.includes(followupMarker)));
    check(author(followup) === config.identities.b.npub && followup.thread_id === root.thread_id, 'B followup attribution or thread routing is wrong');
    const second = await poll('second agent reply', async () => (await messages()).find(m => author(m) === agent.npub && m.thread_id === root.thread_id && m.id !== first.id), 180000);
    const ids = [rootId, first.id, followup.id, second.id];
    for (const user of [a, b]) await visibleHistory(user.page, ids);
    assert('B mentioned followup produced exactly one continuing-thread agent reply live for both users');
    setPhase('two terminal agent activities');
    const activities = await poll('two completed agent turns on the same bound thread', async () => {
      const data = await api(`${prefix}/agent-activities?channel_id=${channelId}&thread_id=${root.thread_id}&limit=50&history_limit=0`);
      const completed = rows(data, 'agent_activities').filter(activity => activity.agent_npub === agent.npub && activity.state === 'completed');
      return completed.length === 2 ? completed : false;
    }, 180000);
    check(new Set(activities.map(activity => activity.turn_id)).size === 2, 'Expected two distinct completed runtime turns');
    check(first.metadata?.session_id && first.metadata.session_id === second.metadata?.session_id, 'Continuing thread did not stay in one bound runtime session');
    check(first.metadata.turn_id !== second.metadata.turn_id, 'Replies must represent two distinct runtime turns');
    report.runtimeSessionId = first.metadata.session_id;
    report.runtimeTurnIds = [first.metadata.turn_id, second.metadata.turn_id];
    report.activities = activities.map(({ id, session_id, turn_id, trigger_message_id, state }) => ({ id, session_id, turn_id, trigger_message_id, state }));
    for (const user of [a, b]) {
      await user.page.locator('.thread-input-actions:visible').getByRole('button', { name: 'Menu', exact: true }).click();
      await user.page.getByRole('menuitem', { name: 'Working history & diagnostics' }).click();
      await poll('both completed turns visible in browser working history', async () => await user.page.locator('.agent-activity-retained:visible summary').filter({ hasText: 'Earlier activity · completed' }).count() === 2);
      await user.page.getByRole('button', { name: 'Close working history' }).click();
    }
    assert('Both browsers rendered two completed activities; two turns belong to one continuing runtime session');
    setPhase('permission negative and reconnect');
    await apiB(prefix, { method: 'PATCH', body: { name: 'Forbidden member rename' }, expectedStatus: 403 });
    assert('B workspace administration PATCH rejected with HTTP 403');
    await b.context.setOffline(true);
    await b.page.waitForFunction(() => navigator.onLine === false);
    setPhase('A publishes while B remains offline');
    const offlineMarker = `release-offline-${config.runId}`;
    const aReply = a.page.getByRole('textbox', { name: 'Reply to thread', exact: true });
    await aReply.pressSequentially(offlineMarker, { delay: 10 });
    await aReply.press('Enter');
    const offlineMessage = await poll('A offline-window message persisted', async () => (await messages()).find(m => m.body === offlineMarker));
    check(author(offlineMessage) === config.identities.a.npub && offlineMessage.thread_id === root.thread_id, 'Offline-window message attribution or routing is wrong');
    check(!(offlineMessage.mentions || []).length && !(offlineMessage.metadata?.mentions || []).length, 'Offline-window marker must not mention an agent');
    await visibleHistory(a.page, [...ids, offlineMessage.id]);
    check(await b.page.evaluate(() => navigator.onLine === false), 'B must remain offline during A publication');
    await visibleHistory(b.page, ids);
    check(await b.page.locator(`[data-thread-message-id="${offlineMessage.id}"]`).count() === 0, 'B received the new message while offline');
    assert('A published a new unmentioned thread message through UI while B was offline; B lacked it after Tower persistence');
    ids.push(offlineMessage.id);
    setPhase('B live reconnect before any navigation or reload');
    await b.context.setOffline(false);
    await b.page.waitForFunction(() => navigator.onLine === true);
    await visibleHistory(b.page, ids);
    assert('B received the missed message exactly once through live synchronization before any navigation or reload');
    setPhase('reload both browsers after live reconnect acceptance');
    await channel(a.page, channelName, workspacePublic);
    await channel(b.page, channelName, workspacePublic);
    for (const user of [a, b]) { await openThread(user.page, rootId); await visibleHistory(user.page, ids); }
    const final = (await messages()).filter(m => m.thread_id === root.thread_id);
    check(JSON.stringify(final.map(m => m.id)) === JSON.stringify(ids), 'Tower durable history differs from the exact five-message ordered conversation');
    check((await messages()).filter(m => m.body?.includes(marker)).length === 1, 'Duplicate root exists');
    assert('Offline reconnect and both reloads preserved identical order and exactly-once Tower and rendered history');
    report.messageIds = ids;
    report.threadId = root.thread_id;
    for (const [key, user] of [['a', a], ['b', b]]) {
      check(!await user.page.locator('input[name="secret"]:visible').count(), 'Refusing screenshot while login is visible');
      const path = join(evidence, `${key}-complete.png`);
      await user.page.screenshot({ path });
      report.screenshots.push(path);
    }
  } catch (error) {
    report.status = 'failed';
    // Only retain a fixed phase label: Playwright errors may include DOM values.
    const reason = phase.startsWith('unrecorded UI login')
      ? 'Login failed; action details suppressed'
      : String(error?.message || 'Browser/runtime operation failed')
        .replace(/nsec1[023456789acdefghjklmnpqrstuvwxyz]+/gi, '[redacted]')
        .replace(/Nostr [A-Za-z0-9+/=]+/g, 'Nostr [redacted]');
    report.failure = { phase, reason };
    for (const { user, page } of recordedPages) {
      try {
        if (page.isClosed() || await page.locator('input[type="password"]:visible, input[name="secret"]:visible').count()) continue;
        const path = join(evidence, `${user}-failure.png`);
        await page.screenshot({ path, timeout: 5000 });
        report.screenshots.push(path);
      } catch { /* Evidence capture must not replace the original failure. */ }
    }
    originalError = new Error(`Release browser failed during ${phase}: ${reason}. See browser/report.json.`);
  } finally {
    await finalizeBrowser({ report, contexts, recordedPages, originalError,
      persist: value => publicJson(join(evidence, 'report.json'), value) });
  }
  return report;
}

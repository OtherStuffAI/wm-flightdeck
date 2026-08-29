const { test, expect, devices } = require('playwright/test');

const TEST_AGENT_NPUB = 'npub1mobilelatencytestagent';
const THREAD_ID = 'thread-mobile-latency';
const CHANNEL_ID = 'channel-mobile-latency';

async function waitForStore(page) {
  await page.waitForFunction(() => Boolean(window.Alpine?.store?.('chat')));
}

async function seedThread(page, { historySize = 600, workspaceRows = 2_000 } = {}) {
  await page.evaluate(({ agentNpub, channelId, historySize, threadId, workspaceRows }) => {
    const store = window.Alpine.store('chat');
    const now = new Date().toISOString();
    const row = (prefix, index) => ({
      record_id: `${prefix}-${index}`,
      title: `${prefix} ${index}`,
      record_state: 'active',
      created_at: now,
      updated_at: now,
    });
    const root = {
      record_id: threadId,
      pg_thread_id: threadId,
      thread_id: threadId,
      channel_id: channelId,
      sender_npub: 'npub1operator',
      body: 'Representative mobile thread root',
      metadata: { mentions: [{ type: 'agent', npub: agentNpub, label: 'Test Agent' }] },
      record_state: 'active',
      sync_status: 'synced',
      created_at: now,
      updated_at: now,
    };
    const replies = Array.from({ length: historySize }, (_, index) => ({
      record_id: `reply-${index}`,
      pg_thread_id: threadId,
      thread_id: threadId,
      parent_message_id: threadId,
      channel_id: channelId,
      sender_npub: index % 2 ? agentNpub : 'npub1operator',
      body: `Representative reply ${index}`,
      metadata: index % 7 === 0
        ? { mentions: [{ type: 'agent', npub: agentNpub, label: 'Test Agent' }] }
        : {},
      record_state: 'active',
      sync_status: 'synced',
      created_at: new Date(Date.now() - ((historySize - index) * 1_000)).toISOString(),
      updated_at: new Date(Date.now() - ((historySize - index) * 1_000)).toISOString(),
    }));

    store.startWorkspaceLiveQueries = () => {};
    store.syncRoute = () => {};
    store.scheduleStorageImageHydration = () => {};
    store.session = { ...(store.session || {}), npub: 'npub1operator' };
    store.currentPgActorNpub = 'npub1operator';
    store.navSection = 'chat';
    store.channels = [{
      record_id: channelId,
      title: 'implementation',
      name: 'implementation',
      record_state: 'active',
      metadata: {},
    }];
    store.selectedChannelId = channelId;
    store.pgContextSelectedChannelId = channelId;
    store.pgWorkspaceMembers = [
      { npub: 'npub1operator', display_name: 'Operator', kind: 'person' },
      { npub: agentNpub, display_name: 'Test Agent', kind: 'agent' },
    ];
    store.groups = [{ name: 'Agents', member_npubs: [agentNpub] }];
    store.currentWorkspaceGroups = store.groups;
    store.addressBookPeople = [{ npub: agentNpub, label: 'Test Agent', name: 'Test Agent' }];
    store.channelGrants = [];
    store.channelGrantRows = [];
    store.messages = [root, ...replies];
    store.documents = Array.from({ length: workspaceRows }, (_, index) => row('Document', index));
    store.tasks = Array.from({ length: workspaceRows }, (_, index) => row('Task', index));
    store.scopes = Array.from({ length: Math.ceil(workspaceRows / 10) }, (_, index) => ({ ...row('Scope', index), level: 'project' }));
    store.flows = Array.from({ length: Math.ceil(workspaceRows / 10) }, (_, index) => row('Flow', index));
    store.opportunities = Array.from({ length: Math.ceil(workspaceRows / 10) }, (_, index) => row('Opportunity', index));
    store.openThread(threadId, { preserveChannelContext: true, scrollToLatest: false, syncRoute: false });
  }, { agentNpub: TEST_AGENT_NPUB, channelId: CHANNEL_ID, historySize, threadId: THREAD_ID, workspaceRows });
  await expect(page.locator('.chat-thread-panel')).toBeVisible();
  await expect(page.locator('.thread-input-bar [data-chat-composer="thread"]')).toHaveAttribute('contenteditable', 'true');
}

async function installInstrumentation(page) {
  await page.evaluate(() => {
    const store = window.Alpine.store('chat');
    const composer = document.querySelector('.thread-input-bar [data-chat-composer="thread"]');
    const samples = {
      beforeInput: [],
      input: [],
      paintLatency: [],
      frameGaps: [],
      longTasks: [],
      composerMutations: 0,
      bodyMutations: 0,
      visualViewportEvents: 0,
      calls: {},
      durations: {},
      queryLengths: [],
      initialDomNodes: document.querySelectorAll('*').length,
      initialHeap: performance.memory?.usedJSHeapSize || null,
    };
    window.__mobileComposerSamples = samples;
    const wrap = (name, onCall = null) => {
      const original = store[name];
      store[name] = function wrappedComposerMethod(...args) {
        const started = performance.now();
        samples.calls[name] = (samples.calls[name] || 0) + 1;
        onCall?.(args);
        try {
          return original.apply(this, args);
        } finally {
          (samples.durations[name] ||= []).push(performance.now() - started);
        }
      };
    };
    wrap('syncMentionComposerModel');
    wrap('syncMentionComposerFromModel');
    wrap('handleMentionInput');
    wrap('searchMentions', (args) => samples.queryLengths.push(String(args[0] || '').length));
    wrap('getRecentMentionChips');
    wrap('applyMessages');
    wrap('performSync');
    composer.addEventListener('beforeinput', (event) => {
      samples.beforeInput.push({ at: performance.now(), timeStamp: event.timeStamp, inputType: event.inputType });
    }, true);
    composer.addEventListener('input', (event) => {
      const at = performance.now();
      samples.input.push({ at, timeStamp: event.timeStamp, length: composer.textContent.length });
      requestAnimationFrame(() => requestAnimationFrame(() => samples.paintLatency.push(performance.now() - at)));
    }, true);
    new MutationObserver((records) => { samples.composerMutations += records.length; })
      .observe(composer, { childList: true, characterData: true, subtree: true, attributes: true });
    new MutationObserver((records) => { samples.bodyMutations += records.length; })
      .observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => { samples.visualViewportEvents += 1; });
      window.visualViewport.addEventListener('scroll', () => { samples.visualViewportEvents += 1; });
    }
    if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) samples.longTasks.push(entry.duration);
      }).observe({ type: 'longtask' });
    }
    window.__mobileComposerRunning = true;
    let previousFrame = performance.now();
    const onFrame = (at) => {
      const gap = at - previousFrame;
      if (gap > 24) samples.frameGaps.push(gap);
      previousFrame = at;
      if (window.__mobileComposerRunning) requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
  });
}

async function insertAgentMention(page) {
  const composer = page.locator('.thread-input-bar [data-chat-composer="thread"]');
  await composer.focus();
  await composer.pressSequentially('@Test', { delay: 20 });
  const option = page.locator('.mention-result-item').filter({ hasText: 'Test Agent' }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(composer.locator('[data-mention-token]')).toHaveCount(1);
  return composer;
}

async function resetPostMentionSamples(page) {
  await page.evaluate(() => {
    const samples = window.__mobileComposerSamples;
    samples.beforeInput.length = 0;
    samples.input.length = 0;
    samples.paintLatency.length = 0;
    samples.frameGaps.length = 0;
    samples.longTasks.length = 0;
    samples.composerMutations = 0;
    samples.bodyMutations = 0;
    samples.visualViewportEvents = 0;
    samples.calls = {};
    samples.durations = {};
    samples.queryLengths.length = 0;
    samples.initialDomNodes = document.querySelectorAll('*').length;
    samples.initialHeap = performance.memory?.usedJSHeapSize || null;
  });
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function readMetrics(page, extra = {}) {
  return page.evaluate(({ extraMetrics }) => {
    const samples = window.__mobileComposerSamples;
    window.__mobileComposerRunning = false;
    if (window.__mobileComposerBackgroundTimer) clearInterval(window.__mobileComposerBackgroundTimer);
    const percentileInPage = (values, ratio) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
    };
    const durationSummary = Object.fromEntries(Object.entries(samples.durations).map(([name, values]) => [name, {
      count: values.length,
      median: percentileInPage(values, 0.5),
      p95: percentileInPage(values, 0.95),
      max: Math.max(0, ...values),
      total: values.reduce((sum, value) => sum + value, 0),
    }]));
    return {
      ...extraMetrics,
      calls: samples.calls,
      durations: durationSummary,
      beforeInputCount: samples.beforeInput.length,
      inputCount: samples.input.length,
      paintMedian: percentileInPage(samples.paintLatency, 0.5),
      paintP95: percentileInPage(samples.paintLatency, 0.95),
      paintMax: Math.max(0, ...samples.paintLatency),
      longTasks: samples.longTasks,
      maxFrameGap: Math.max(0, ...samples.frameGaps),
      composerMutations: samples.composerMutations,
      bodyMutations: samples.bodyMutations,
      visualViewportEvents: samples.visualViewportEvents,
      maxMentionQueryLength: Math.max(0, ...samples.queryLengths),
      domNodes: document.querySelectorAll('*').length,
      domGrowth: document.querySelectorAll('*').length - samples.initialDomNodes,
      composerChildNodes: document.querySelector('.thread-input-bar [data-chat-composer="thread"]')?.childNodes.length || 0,
      heap: performance.memory?.usedJSHeapSize || null,
      heapGrowth: samples.initialHeap && performance.memory?.usedJSHeapSize
        ? performance.memory.usedJSHeapSize - samples.initialHeap
        : null,
      threadInputLength: window.Alpine.store('chat').threadInput.length,
      mentionActive: window.Alpine.store('chat').mentionActive,
    };
  }, { extraMetrics: extra });
}

const { defaultBrowserType: _defaultBrowserType, ...iphoneProfile } = devices['iPhone 13'];
test.use(iphoneProfile);

test('mobile thread typing after an agent pill does not keep searching the workspace', async ({ page, browserName }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  let cdp = null;
  if (browserName === 'chromium') {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const rate = Number(process.env.CHAT_LATENCY_CPU_RATE || 1);
    if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }
  await page.goto('/');
  await waitForStore(page);
  await seedThread(page, {
    historySize: Number(process.env.CHAT_LATENCY_HISTORY || 600),
    workspaceRows: Number(process.env.CHAT_LATENCY_ROWS || 2_000),
  });
  const reopenCycles = Number(process.env.CHAT_LATENCY_REOPEN_CYCLES || 0);
  if (reopenCycles > 0) {
    await page.evaluate(({ reopenCount, threadId }) => {
      const store = window.Alpine.store('chat');
      for (let index = 0; index < reopenCount; index += 1) {
        store.closeThread({ saveDraft: false, syncRoute: false });
        store.openThread(threadId, {
          preserveChannelContext: true,
          scrollToLatest: false,
          syncRoute: false,
        });
      }
    }, { reopenCount: reopenCycles, threadId: THREAD_ID });
    await expect(page.locator('.chat-thread-panel')).toBeVisible();
  }
  await installInstrumentation(page);
  const withMention = process.env.CHAT_LATENCY_MENTION !== '0';
  const composer = withMention
    ? await insertAgentMention(page)
    : page.locator('.thread-input-bar [data-chat-composer="thread"]');
  if (!withMention) await composer.focus();
  if (process.env.CHAT_LATENCY_SETTLE_MS) await page.waitForTimeout(Number(process.env.CHAT_LATENCY_SETTLE_MS));
  await resetPostMentionSamples(page);
  requests.length = 0;
  const cdpBefore = cdp ? await cdp.send('Performance.getMetrics') : null;
  if (process.env.CHAT_LATENCY_BACKGROUND === '1') {
    await page.evaluate(() => {
      const store = window.Alpine.store('chat');
      let revision = 0;
      window.__mobileComposerBackgroundTimer = setInterval(() => {
        revision += 1;
        const messages = store.messages.map((message, index) => index === 1
          ? { ...message, body: `Background live update ${revision}`, updated_at: new Date().toISOString() }
          : message);
        void store.applyMessages(messages);
        if (revision >= 3) clearInterval(window.__mobileComposerBackgroundTimer);
      }, 500);
    });
  }

  const text = process.env.CHAT_LATENCY_LONG === '1'
    ? ' Continuous mobile typing should remain visible without a sentence-scale backlog.'.repeat(5)
    : ' Continuous mobile typing remains visible.';
  const delay = process.env.CHAT_LATENCY_LONG === '1' ? 90 : 5;
  const started = Date.now();
  await composer.pressSequentially(text, { delay });
  await page.waitForTimeout(100);
  const elapsedMs = Date.now() - started;
  const cdpAfter = cdp ? await cdp.send('Performance.getMetrics') : null;
  const metricMap = (payload) => Object.fromEntries((payload?.metrics || []).map((metric) => [metric.name, metric.value]));
  const beforeMap = metricMap(cdpBefore);
  const afterMap = metricMap(cdpAfter);
  const cdpDelta = Object.fromEntries([
    'LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize', 'Nodes',
  ].map((name) => [name, (afterMap[name] || 0) - (beforeMap[name] || 0)]));
  const metrics = await readMetrics(page, {
    browserName,
    cdpDelta,
    elapsedMs,
    requestCountDuringRun: requests.length,
  });
  console.log(`MOBILE_CHAT_LATENCY ${JSON.stringify(metrics)}`);

  expect(metrics.beforeInputCount).toBe(text.length);
  expect(metrics.inputCount).toBe(text.length);
  // This assertion captures the regression: the existing mention pill is not
  // an active typeahead query while ordinary text is entered after it.
  if (process.env.CHAT_LATENCY_BASELINE !== '1') {
    expect(metrics.calls.searchMentions || 0).toBe(0);
  }
  expect(metrics.threadInputLength).toBeGreaterThan(text.length);
  expect(percentile(metrics.longTasks, 0.95)).toBeLessThan(250);
});

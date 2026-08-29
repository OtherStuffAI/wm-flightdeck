const { test, expect, devices } = require('playwright/test');

const TEST_AGENT_NPUB = 'npub1mobilelatencytestagent';
const THREAD_ID = 'thread-mobile-latency';
const CHANNEL_ID = 'channel-mobile-latency';

async function waitForStore(page) {
  await page.waitForFunction(() => Boolean(window.Alpine?.store?.('chat')));
}

async function installLifecycleInstrumentation(page) {
  await page.addInitScript(() => {
    const lifecycle = {
      listenersAdded: 0,
      listenersRemoved: 0,
      activeIntervals: 0,
      pendingAnimationFrames: 0,
      mutationObserversCreated: 0,
      mutationObserversDisconnected: 0,
    };
    window.__mobileComposerLifecycle = lifecycle;
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function trackedAdd(...args) {
      lifecycle.listenersAdded += 1;
      return originalAdd.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(...args) {
      lifecycle.listenersRemoved += 1;
      return originalRemove.apply(this, args);
    };
    const originalSetInterval = window.setInterval.bind(window);
    const originalClearInterval = window.clearInterval.bind(window);
    const activeIntervals = new Set();
    window.setInterval = (...args) => {
      const id = originalSetInterval(...args);
      activeIntervals.add(id);
      lifecycle.activeIntervals = activeIntervals.size;
      return id;
    };
    window.clearInterval = (id) => {
      activeIntervals.delete(id);
      lifecycle.activeIntervals = activeIntervals.size;
      return originalClearInterval(id);
    };
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const pendingFrames = new Set();
    window.requestAnimationFrame = (callback) => {
      let id = 0;
      id = originalRequestAnimationFrame((time) => {
        pendingFrames.delete(id);
        lifecycle.pendingAnimationFrames = pendingFrames.size;
        callback(time);
      });
      pendingFrames.add(id);
      lifecycle.pendingAnimationFrames = pendingFrames.size;
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pendingFrames.delete(id);
      lifecycle.pendingAnimationFrames = pendingFrames.size;
      return originalCancelAnimationFrame(id);
    };
    const NativeMutationObserver = window.MutationObserver;
    window.MutationObserver = class TrackedMutationObserver extends NativeMutationObserver {
      constructor(callback) {
        super(callback);
        lifecycle.mutationObserversCreated += 1;
      }
      disconnect() {
        lifecycle.mutationObserversDisconnected += 1;
        return super.disconnect();
      }
    };
  });
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
      rangeCloneContents: 0,
      rangeCloneNodes: 0,
      rangeCloneBytes: 0,
      rangeCloneDuration: 0,
      computedStyleCalls: 0,
      calls: {},
      durations: {},
      queryLengths: [],
      initialDomNodes: document.querySelectorAll('*').length,
      initialHeap: performance.memory?.usedJSHeapSize || null,
    };
    window.__mobileComposerSamples = samples;
    const originalCloneContents = Range.prototype.cloneContents;
    Range.prototype.cloneContents = function instrumentedCloneContents(...args) {
      const started = performance.now();
      const fragment = originalCloneContents.apply(this, args);
      samples.rangeCloneContents += 1;
      samples.rangeCloneNodes += fragment.querySelectorAll?.('*').length || 0;
      samples.rangeCloneBytes += fragment.textContent?.length || 0;
      samples.rangeCloneDuration += performance.now() - started;
      return fragment;
    };
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    window.getComputedStyle = (...args) => {
      samples.computedStyleCalls += 1;
      return originalGetComputedStyle(...args);
    };
    window.__mobileComposerRestoreInstrumentation = () => {
      Range.prototype.cloneContents = originalCloneContents;
      window.getComputedStyle = originalGetComputedStyle;
    };
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
    wrap('scheduleComposerElementAutosize');
    wrap('autosizeComposer');
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
    const composerObserver = new MutationObserver((records) => { samples.composerMutations += records.length; });
    composerObserver.observe(composer, { childList: true, characterData: true, subtree: true, attributes: true });
    const bodyObserver = new MutationObserver((records) => { samples.bodyMutations += records.length; });
    bodyObserver.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true });
    samples.composerObserver = composerObserver;
    samples.bodyObserver = bodyObserver;
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
    samples.rangeCloneContents = 0;
    samples.rangeCloneNodes = 0;
    samples.rangeCloneBytes = 0;
    samples.rangeCloneDuration = 0;
    samples.computedStyleCalls = 0;
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
    samples.composerObserver?.disconnect();
    samples.bodyObserver?.disconnect();
    window.__mobileComposerRestoreInstrumentation?.();
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
      rangeCloneContents: samples.rangeCloneContents,
      rangeCloneNodes: samples.rangeCloneNodes,
      rangeCloneBytes: samples.rangeCloneBytes,
      rangeCloneDuration: samples.rangeCloneDuration,
      computedStyleCalls: samples.computedStyleCalls,
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
      lifecycle: { ...window.__mobileComposerLifecycle },
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
  await installLifecycleInstrumentation(page);
  await page.goto('/');
  await waitForStore(page);
  await seedThread(page, {
    historySize: Number(process.env.CHAT_LATENCY_HISTORY || 600),
    workspaceRows: Number(process.env.CHAT_LATENCY_ROWS || 2_000),
  });
  const reopenCycles = Number(process.env.CHAT_LATENCY_REOPEN_CYCLES || 0);
  if (cdp) await cdp.send('HeapProfiler.collectGarbage');
  const lifecycleBeforeReopen = await page.evaluate(() => ({
    ...window.__mobileComposerLifecycle,
    domNodes: document.querySelectorAll('*').length,
    heap: performance.memory?.usedJSHeapSize || null,
  }));
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
  if (cdp) await cdp.send('HeapProfiler.collectGarbage');
  const lifecycleAfterReopen = await page.evaluate(() => ({
    ...window.__mobileComposerLifecycle,
    domNodes: document.querySelectorAll('*').length,
    heap: performance.memory?.usedJSHeapSize || null,
  }));
  await installInstrumentation(page);
  const withMention = process.env.CHAT_LATENCY_MENTION !== '0';
  const composer = withMention
    ? await insertAgentMention(page)
    : page.locator('.thread-input-bar [data-chat-composer="thread"]');
  if (!withMention) await composer.focus();
  const initialCharacters = Number(process.env.CHAT_LATENCY_INITIAL_CHARS || 0);
  const extraPills = Number(process.env.CHAT_LATENCY_EXTRA_PILLS || 0);
  if (initialCharacters > 0 || extraPills > 0) {
    await page.evaluate(({ agentNpub, characterCount, pillCount }) => {
      const store = window.Alpine.store('chat');
      const element = document.querySelector('.thread-input-bar [data-chat-composer="thread"]');
      const token = `@[Test Agent](mention:agent:${agentNpub})`;
      const pills = Array.from({ length: pillCount }, (_, index) => `${token} pill-${index}`).join(' ');
      const text = 'long mobile draft '.repeat(Math.ceil(characterCount / 18)).slice(0, characterCount);
      const next = [store.threadInput, pills, text].filter(Boolean).join(' ');
      store.threadInput = next;
      store.syncMentionComposerFromModel(element, 'thread', next);
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      element.focus();
    }, { agentNpub: TEST_AGENT_NPUB, characterCount: initialCharacters, pillCount: extraPills });
  }
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
    reopenCycles,
    lifecycleBeforeReopen,
    lifecycleAfterReopen,
  });
  console.log(`MOBILE_CHAT_LATENCY ${JSON.stringify(metrics)}`);
  await page.close();

  expect(metrics.beforeInputCount).toBe(text.length);
  expect(metrics.inputCount).toBe(text.length);
  // This assertion captures the regression: the existing mention pill is not
  // an active typeahead query while ordinary text is entered after it.
  if (process.env.CHAT_LATENCY_BASELINE !== '1') {
    expect(metrics.calls.searchMentions || 0).toBe(0);
    expect(metrics.rangeCloneContents).toBe(0);
    expect(metrics.computedStyleCalls).toBeLessThanOrEqual(Math.max(4, Math.floor(metrics.inputCount / 20)));
  }
  if (reopenCycles > 0) {
    expect(metrics.lifecycleAfterReopen.listenersAdded).toBe(metrics.lifecycleBeforeReopen.listenersAdded);
    expect(metrics.lifecycleAfterReopen.activeIntervals).toBe(metrics.lifecycleBeforeReopen.activeIntervals);
    expect(metrics.lifecycleAfterReopen.mutationObserversCreated).toBe(metrics.lifecycleBeforeReopen.mutationObserversCreated);
    expect(metrics.lifecycleAfterReopen.domNodes).toBe(metrics.lifecycleBeforeReopen.domNodes);
  }
  if (withMention) expect(metrics.threadInputLength).toBeGreaterThan(text.length);
  else expect(metrics.threadInputLength).toBe(text.length);
  if (process.env.CHAT_LATENCY_BACKGROUND === '1') {
    const liveUpdates = metrics.calls.applyMessages || 0;
    expect(metrics.bodyMutations).toBeLessThanOrEqual(metrics.inputCount + (liveUpdates * 60));
  }
  expect(percentile(metrics.longTasks, 0.95)).toBeLessThan(300);
});

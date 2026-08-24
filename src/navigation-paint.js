export const NAVIGATION_TIMING_LIMIT = 12;

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function nextTick(store) {
  if (typeof store?.$nextTick === 'function') {
    return new Promise((resolve) => store.$nextTick(resolve));
  }
  return Promise.resolve();
}

export async function waitForNavigationPaint(store, {
  requestFrame = globalThis.requestAnimationFrame,
  afterNextTick = null,
} = {}) {
  await nextTick(store);
  afterNextTick?.();
  if (typeof requestFrame !== 'function') {
    await Promise.resolve();
    return { browserPaintBoundary: false };
  }
  await new Promise((resolve) => requestFrame(() => requestFrame(resolve)));
  return { browserPaintBoundary: true };
}

export function recordNavigationPointer(store, kind, destinationId, event = null) {
  store.pendingNavigationPointer = {
    kind: String(kind || 'navigation'),
    destinationId: String(destinationId || ''),
    at: Number(event?.timeStamp) || now(),
  };
}

export function beginNavigationTiming(store, kind, destinationId, details = {}) {
  const entryAt = now();
  const pending = store?.pendingNavigationPointer;
  const pointerAt = pending?.kind === kind && pending?.destinationId === String(destinationId || '')
    ? pending.at
    : entryAt;
  store.pendingNavigationPointer = null;
  const timing = {
    kind,
    destinationId: String(destinationId || ''),
    cacheHit: Boolean(details.cacheHit),
    pointerAt,
    handlerEntryAt: entryAt,
    stateAssignedAt: null,
    alpineTickAt: null,
    paintAt: null,
    postPaintStartAt: null,
    postPaintEndAt: null,
    browserPaintBoundary: false,
  };
  return timing;
}

export function markNavigationTiming(timing, mark) {
  if (timing && Object.prototype.hasOwnProperty.call(timing, mark)) timing[mark] = now();
  return timing;
}

export function publishNavigationTiming(store, timing) {
  if (!timing) return null;
  const base = Number(timing.pointerAt || timing.handlerEntryAt || 0);
  const relative = (value) => value == null ? null : Math.max(0, Number(value) - base);
  const summary = {
    kind: timing.kind,
    destinationId: timing.destinationId,
    cacheHit: timing.cacheHit,
    clickToHandlerMs: relative(timing.handlerEntryAt),
    clickToStateMs: relative(timing.stateAssignedAt),
    clickToAlpineTickMs: relative(timing.alpineTickAt),
    clickToPaintMs: relative(timing.paintAt),
    postPaintWorkMs: timing.postPaintStartAt == null || timing.postPaintEndAt == null
      ? null
      : Math.max(0, timing.postPaintEndAt - timing.postPaintStartAt),
    browserPaintBoundary: timing.browserPaintBoundary,
    recordedAt: new Date().toISOString(),
  };
  const recent = Array.isArray(store?.recentNavigationTimings) ? store.recentNavigationTimings : [];
  store.recentNavigationTimings = [...recent, summary].slice(-NAVIGATION_TIMING_LIMIT);
  return summary;
}

export function formatNavigationTimings(timings = []) {
  return (Array.isArray(timings) ? timings : []).map((timing) => {
    const fmt = (value) => Number.isFinite(value) ? `${value.toFixed(1)}ms` : 'n/a';
    return [
      timing.recordedAt,
      `${timing.kind}:${timing.destinationId}`,
      timing.cacheHit ? 'cached' : 'pending',
      `click→state ${fmt(timing.clickToStateMs)}`,
      `click→paint ${fmt(timing.clickToPaintMs)}`,
      `post-paint ${fmt(timing.postPaintWorkMs)}`,
      timing.browserPaintBoundary ? '2×rAF' : 'test fallback',
    ].join(' | ');
  }).join('\n');
}

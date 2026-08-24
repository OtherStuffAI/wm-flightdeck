const RUNNING_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
const IS_DEV = import.meta.env.DEV;
export const NOTIFICATION_CLICK_MESSAGE_TYPE = 'flightdeck:notification-click';
export const SERVICE_WORKER_SCRIPT_URL = '/service-worker.js';

let registrationPromise = null;
const UPDATE_TIMEOUT_MS = 10_000;
const RELEASE_RETRY_MS = 250;

function timeoutError(message) {
  const error = new Error(message);
  error.code = 'flightdeck_update_timeout';
  return error;
}

function withTimeout(promise, timeoutMs, message, timers = globalThis) {
  return new Promise((resolve, reject) => {
    const timeoutId = timers.setTimeout(() => reject(timeoutError(message)), timeoutMs);
    promise.then(
      (value) => {
        timers.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        timers.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function waitForWorkerState(worker, registration) {
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const finish = (value, error) => {
      worker.removeEventListener('statechange', handleStateChange);
      if (error) reject(error);
      else resolve(value);
    };
    const handleStateChange = () => {
      if (registration.waiting || worker.state === 'installed') finish(registration.waiting || worker);
      else if (worker.state === 'activated') finish(null);
      else if (worker.state === 'redundant') finish(null, new Error('The new application worker could not be installed.'));
    };
    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  });
}

function waitForActivationOrController(serviceWorkerContainer, registration, expectedWorker, timeoutMs, timers, signal) {
  const initialController = serviceWorkerContainer.controller;
  const initialActiveWorker = registration.active;
  const replacementActivated = () => (
    registration.active
    && registration.active !== initialActiveWorker
    && registration.active.state === 'activated'
  );
  if (serviceWorkerContainer.controller === expectedWorker || expectedWorker?.state === 'activated') {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      serviceWorkerContainer.removeEventListener('controllerchange', handleControllerChange);
      expectedWorker?.removeEventListener?.('statechange', handleWorkerStateChange);
      signal?.removeEventListener?.('abort', handleAbort);
      timers.clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve();
    };
    const handleControllerChange = () => {
      const controller = serviceWorkerContainer.controller;
      if (controller === expectedWorker || (controller && controller !== initialController)) finish();
    };
    const handleWorkerStateChange = () => {
      if (expectedWorker?.state === 'activated') finish();
      else if (expectedWorker?.state === 'redundant') {
        if (replacementActivated()) finish();
        else finish(new Error('The new application worker could not be activated.'));
      }
    };
    const handleAbort = () => finish(timeoutError('Updating to the latest application release timed out.'));
    const timeoutId = timers.setTimeout(
      () => finish(timeoutError('Activating the new application worker timed out.')),
      timeoutMs,
    );
    serviceWorkerContainer.addEventListener('controllerchange', handleControllerChange);
    expectedWorker?.addEventListener?.('statechange', handleWorkerStateChange);
    signal?.addEventListener?.('abort', handleAbort, { once: true });
    handleWorkerStateChange();
  });
}

function assetContentTypeIsValid(url, response) {
  const contentType = response.headers?.get?.('content-type')?.toLowerCase() || '';
  if (url.pathname.endsWith('.css')) return contentType.includes('text/css');
  if (url.pathname.endsWith('.js')) return contentType.includes('javascript') || contentType.includes('ecmascript');
  return true;
}

export function readReleaseDocument(html, baseUrl) {
  const buildMatch = String(html).match(/<meta\s+name=["']flightdeck-build-id["']\s+content=["']([^"']+)["'][^>]*>/i)
    || String(html).match(/<meta\s+content=["']([^"']+)["']\s+name=["']flightdeck-build-id["'][^>]*>/i);
  const assets = [...String(html).matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["'][^>]*>/gi)]
    .map((match) => new URL(match[1], baseUrl));
  return { buildId: buildMatch?.[1] || '', assets };
}

export async function probeCoherentRelease(expectedBuildNumber = 0, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const locationImpl = deps.locationImpl ?? window.location;
  const origin = locationImpl.origin || new URL(locationImpl.href).origin;
  const versionUrl = new URL('/version.json', origin);
  versionUrl.searchParams.set('flightdeck-update-probe', String(Date.now()));
  const versionResponse = await fetchImpl(versionUrl, { cache: 'no-store' });
  if (!versionResponse.ok) throw new Error('The latest release metadata is not available yet.');
  const metadata = await versionResponse.json();
  if (!metadata?.buildId || !Number.isSafeInteger(metadata.buildNumber) || metadata.buildNumber < expectedBuildNumber) {
    throw new Error('The latest release metadata is not coherent yet.');
  }

  const documentUrl = new URL(locationImpl.href);
  documentUrl.hash = '';
  documentUrl.searchParams.set('flightdeck-update-probe', metadata.buildId);
  const documentResponse = await fetchImpl(documentUrl, { cache: 'no-store' });
  if (!documentResponse.ok) throw new Error('The latest application shell is not available yet.');
  const releaseDocument = readReleaseDocument(await documentResponse.text(), documentUrl);
  if (releaseDocument.buildId !== metadata.buildId || releaseDocument.assets.length === 0) {
    throw new Error('The latest application shell is still changing.');
  }

  for (const assetUrl of releaseDocument.assets) {
    assetUrl.searchParams.set('flightdeck-update-probe', metadata.buildId);
    const assetResponse = await fetchImpl(assetUrl, { cache: 'no-store' });
    if (!assetResponse.ok || !assetContentTypeIsValid(assetUrl, assetResponse)) {
      throw new Error(`A required application asset is not available yet (${assetUrl.pathname}).`);
    }
  }
  return metadata;
}

export async function waitForCoherentRelease(expectedBuildNumber = 0, deps = {}) {
  const timeoutMs = deps.timeoutMs ?? UPDATE_TIMEOUT_MS;
  const retryMs = deps.retryMs ?? RELEASE_RETRY_MS;
  const timers = deps.timers ?? globalThis;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      return await probeCoherentRelease(expectedBuildNumber, deps);
    } catch (error) {
      lastError = error;
      if (Date.now() + retryMs > deadline) break;
      await new Promise((resolve) => timers.setTimeout(resolve, retryMs));
    }
  } while (Date.now() < deadline);
  throw timeoutError(lastError?.message || 'The latest release did not become ready in time.');
}

export async function registerBuildServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || IS_DEV) {
    return null;
  }
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker.register(
    SERVICE_WORKER_SCRIPT_URL,
    { updateViaCache: 'none' },
  ).catch(() => null);

  return registrationPromise;
}

export async function refreshNotificationChatRoute(store, rawUrl, deps = {}) {
  if (!store || !(store.currentWorkspace?.pgBackendMode || store.pgBackendMode)) return false;

  let target;
  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://flightdeck.invalid';
    target = new URL(String(rawUrl || '').trim(), baseUrl);
  } catch {
    return false;
  }

  const section = target.pathname.split('/').filter(Boolean).at(-1) || '';
  const channelId = String(target.searchParams.get('channelid') || '').trim();
  if (section !== 'chat' || !channelId) return false;

  const ensureLoaded = deps.ensureLoaded || ((family, id, options) => store.requestTowerSyncFamily?.(family, id, options));
  await ensureLoaded('channel-messages', channelId, { force: true });
  return true;
}

export function installNotificationClickRouteHandler(getStore = () => window.Alpine?.store?.('chat')) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  const handler = (event) => {
    const message = event?.data;
    if (!message || message.type !== NOTIFICATION_CLICK_MESSAGE_TYPE) return;
    const rawUrl = String(message.url || '').trim();
    if (!rawUrl) return;
    let target;
    try {
      target = new URL(rawUrl, window.location.origin);
    } catch {
      return;
    }
    if (target.origin !== window.location.origin) return;
    const nextUrl = `${target.pathname}${target.search}${target.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState({ source: 'notification-click' }, '', nextUrl);
    const store = getStore?.();
    Promise.resolve(store?.applyRouteFromLocation?.())
      .then(() => refreshNotificationChatRoute(store, target.href))
      .catch((error) => {
        // Routing and cached content remain usable when the targeted refresh is offline.
        console.warn('[flightdeck] notification click route refresh failed', error);
      });
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}

export async function forceRefreshToLatestBuild(metadata = {}, deps = {}) {
  if (typeof window === 'undefined' && !deps.windowImpl) return;
  const windowImpl = deps.windowImpl ?? window;
  const navigatorImpl = deps.navigatorImpl ?? navigator;
  const timers = deps.timers ?? globalThis;
  const isDev = deps.isDev ?? IS_DEV;
  const expectedBuildNumber = Number.isSafeInteger(metadata.buildNumber) ? metadata.buildNumber : 0;
  const prepareRelease = deps.waitForCoherentReleaseImpl ?? waitForCoherentRelease;
  const reload = deps.reload ?? (() => windowImpl.location.reload());
  const timeoutMs = deps.timeoutMs ?? UPDATE_TIMEOUT_MS;
  const updateAbortController = new AbortController();
  let expired = false;
  const ensureActive = () => {
    if (expired) throw timeoutError('Updating to the latest application release timed out.');
  };
  const prepare = () => prepareRelease(expectedBuildNumber, {
    fetchImpl: deps.fetchImpl,
    locationImpl: windowImpl.location,
    timeoutMs: deps.timeoutMs,
    retryMs: deps.retryMs,
    timers,
  });

  const updateAndReload = async () => {
    if (!('serviceWorker' in navigatorImpl) || isDev) {
      await prepare();
      ensureActive();
      reload();
      return;
    }

    const registration = await (deps.registrationPromise
      ?? registrationPromise
      ?? registerBuildServiceWorker());
    ensureActive();
    if (!registration) {
      await prepare();
      ensureActive();
      reload();
      return;
    }

    await registration.update();
    ensureActive();
    let waitingWorker = registration.waiting;
    if (!waitingWorker && registration.installing) {
      waitingWorker = await waitForWorkerState(registration.installing, registration);
      ensureActive();
    }

    await prepare();
    ensureActive();
    if (waitingWorker) {
      const activationReady = waitForActivationOrController(
        navigatorImpl.serviceWorker,
        registration,
        waitingWorker,
        timeoutMs,
        timers,
        updateAbortController.signal,
      );
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      await activationReady;
      ensureActive();
    }
    reload();
  };

  try {
    await withTimeout(
      updateAndReload(),
      timeoutMs,
      'Updating to the latest application release timed out.',
      timers,
    );
  } catch (error) {
    if (error?.code === 'flightdeck_update_timeout') {
      expired = true;
      updateAbortController.abort();
    }
    throw error;
  }
}

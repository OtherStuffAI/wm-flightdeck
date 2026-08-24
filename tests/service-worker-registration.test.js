import { describe, expect, it, vi } from 'vitest';

import {
  forceRefreshToLatestBuild,
  probeCoherentRelease,
  readReleaseDocument,
  refreshNotificationChatRoute,
  SERVICE_WORKER_SCRIPT_URL,
} from '../src/service-worker-registration.js';

function response(body, contentType = 'application/json') {
  return {
    ok: true,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    json: async () => body,
    text: async () => String(body),
  };
}

describe('notification click route refresh', () => {
  it('immediately hydrates the notified Tower PG chat channel', async () => {
    const store = {
      pgBackendMode: true,
      currentWorkspace: { pgBackendMode: true },
    };
    const ensureLoaded = vi.fn(async () => []);

    const refreshed = await refreshNotificationChatRoute(
      store,
      'https://flightdeck.example/operator-a/chat?workspaceid=workspace-1&channelid=channel-1&threadid=thread-1',
      { ensureLoaded },
    );

    expect(refreshed).toBe(true);
    expect(ensureLoaded).toHaveBeenCalledOnce();
    expect(ensureLoaded).toHaveBeenCalledWith('channel-messages', 'channel-1', { force: true });
  });

  it('does not run a remote hydration outside Tower PG chat routes', async () => {
    const ensureLoaded = vi.fn(async () => []);

    await expect(refreshNotificationChatRoute(
      { pgBackendMode: false },
      'https://flightdeck.example/operator-a/chat?channelid=channel-1',
      { ensureLoaded },
    )).resolves.toBe(false);
    await expect(refreshNotificationChatRoute(
      { pgBackendMode: true },
      'https://flightdeck.example/operator-a/tasks?channelid=channel-1&taskid=task-1',
      { ensureLoaded },
    )).resolves.toBe(false);

    expect(ensureLoaded).not.toHaveBeenCalled();
  });
});

describe('application build refresh coordination', () => {
  it('uses one stable worker script URL across application builds', () => {
    expect(SERVICE_WORKER_SCRIPT_URL).toBe('/service-worker.js');
    expect(SERVICE_WORKER_SCRIPT_URL).not.toContain('build=');
  });

  it('reads the build marker and required assets from a generated release document', () => {
    const result = readReleaseDocument(`
      <meta name="flightdeck-build-id" content="build-104">
      <link rel="stylesheet" href="/assets/index-new.css">
      <script type="module" src="/assets/index-new.js"></script>
    `, 'https://flightdeck.example/operator-a/deck');

    expect(result.buildId).toBe('build-104');
    expect(result.assets.map((url) => url.pathname)).toEqual([
      '/assets/index-new.css',
      '/assets/index-new.js',
    ]);
  });

  it('proves version metadata, HTML, CSS, and JavaScript belong to one coherent release', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/version.json') return response({ buildId: 'build-104', buildNumber: 104 });
      if (parsed.pathname === '/operator-a/deck') return response(`
        <meta name="flightdeck-build-id" content="build-104">
        <link rel="stylesheet" href="/assets/index-new.css">
        <script type="module" src="/assets/index-new.js"></script>
      `, 'text/html');
      if (parsed.pathname.endsWith('.css')) return response('body {}', 'text/css');
      if (parsed.pathname.endsWith('.js')) return response('export {}', 'text/javascript');
      throw new Error(`Unexpected URL ${parsed}`);
    });

    await expect(probeCoherentRelease(104, {
      fetchImpl,
      locationImpl: { href: 'https://flightdeck.example/operator-a/deck?scope=one', origin: 'https://flightdeck.example' },
    })).resolves.toMatchObject({ buildId: 'build-104', buildNumber: 104 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('waits for release readiness and controller activation before reloading', async () => {
    const sequence = [];
    const listeners = new Set();
    const waitingWorker = {
      postMessage(message) {
        sequence.push(`worker:${message.type}`);
        serviceWorkerContainer.controller = waitingWorker;
        for (const listener of listeners) listener();
      },
    };
    const serviceWorkerContainer = {
      controller: { name: 'old-worker' },
      addEventListener(type, listener) {
        if (type === 'controllerchange') listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'controllerchange') listeners.delete(listener);
      },
    };
    const registration = {
      waiting: waitingWorker,
      installing: null,
      async update() { sequence.push('registration:update'); },
    };

    await forceRefreshToLatestBuild({ buildNumber: 104 }, {
      isDev: false,
      navigatorImpl: { serviceWorker: serviceWorkerContainer },
      windowImpl: { location: { href: 'https://flightdeck.example/operator-a/deck', origin: 'https://flightdeck.example' } },
      registrationPromise: Promise.resolve(registration),
      waitForCoherentReleaseImpl: async () => { sequence.push('release:ready'); },
      reload: () => sequence.push('reload'),
    });

    expect(sequence).toEqual([
      'registration:update',
      'release:ready',
      'worker:SKIP_WAITING',
      'reload',
    ]);
  });

  it('reloads when the new worker activates without replacing the current controller', async () => {
    const sequence = [];
    const stateListeners = new Set();
    const existingController = { name: 'stable-controller' };
    const waitingWorker = {
      state: 'installed',
      addEventListener(type, listener) {
        if (type === 'statechange') stateListeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'statechange') stateListeners.delete(listener);
      },
      postMessage(message) {
        sequence.push(`worker:${message.type}`);
        this.state = 'activated';
        for (const listener of stateListeners) listener();
      },
    };
    const serviceWorkerContainer = {
      controller: existingController,
      addEventListener() {},
      removeEventListener() {},
    };

    await forceRefreshToLatestBuild({ buildNumber: 104 }, {
      isDev: false,
      navigatorImpl: { serviceWorker: serviceWorkerContainer },
      windowImpl: { location: { href: 'https://flightdeck.example/', origin: 'https://flightdeck.example' } },
      registrationPromise: Promise.resolve({
        waiting: waitingWorker,
        installing: null,
        update: async () => sequence.push('registration:update'),
      }),
      waitForCoherentReleaseImpl: async () => sequence.push('release:ready'),
      reload: () => sequence.push('reload'),
    });

    expect(serviceWorkerContainer.controller).toBe(existingController);
    expect(sequence).toEqual([
      'registration:update',
      'release:ready',
      'worker:SKIP_WAITING',
      'reload',
    ]);
  });

  it('reloads when a concurrent tab supersedes the selected worker with an activated replacement', async () => {
    const sequence = [];
    const stateListeners = new Set();
    const oldActiveWorker = { state: 'activated', name: 'old-active' };
    const replacementWorker = { state: 'activated', name: 'replacement' };
    const registration = {
      active: oldActiveWorker,
      installing: null,
      update: async () => sequence.push('registration:update'),
    };
    const waitingWorker = {
      state: 'installed',
      addEventListener(type, listener) {
        if (type === 'statechange') stateListeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'statechange') stateListeners.delete(listener);
      },
      postMessage(message) {
        sequence.push(`worker:${message.type}`);
        registration.active = replacementWorker;
        this.state = 'redundant';
        for (const listener of stateListeners) listener();
      },
    };
    registration.waiting = waitingWorker;

    await forceRefreshToLatestBuild({ buildNumber: 104 }, {
      isDev: false,
      navigatorImpl: {
        serviceWorker: {
          controller: oldActiveWorker,
          addEventListener() {},
          removeEventListener() {},
        },
      },
      windowImpl: { location: { href: 'https://flightdeck.example/', origin: 'https://flightdeck.example' } },
      registrationPromise: Promise.resolve(registration),
      waitForCoherentReleaseImpl: async () => sequence.push('release:ready'),
      reload: () => sequence.push('reload'),
    });

    expect(sequence).toEqual([
      'registration:update',
      'release:ready',
      'worker:SKIP_WAITING',
      'reload',
    ]);
    expect(stateListeners.size).toBe(0);
  });

  it('uses the coherent-release gate before the no-service-worker fallback reload', async () => {
    const sequence = [];
    await forceRefreshToLatestBuild({ buildNumber: 104 }, {
      isDev: false,
      navigatorImpl: {},
      windowImpl: { location: { href: 'https://flightdeck.example/', origin: 'https://flightdeck.example' } },
      waitForCoherentReleaseImpl: async () => { sequence.push('release:ready'); },
      reload: () => sequence.push('reload'),
    });
    expect(sequence).toEqual(['release:ready', 'reload']);
  });

  it('does not reload when release readiness times out', async () => {
    const reload = vi.fn();
    await expect(forceRefreshToLatestBuild({ buildNumber: 104 }, {
      isDev: false,
      navigatorImpl: {},
      windowImpl: { location: { href: 'https://flightdeck.example/', origin: 'https://flightdeck.example' } },
      waitForCoherentReleaseImpl: async () => {
        throw new Error('The latest release did not become ready in time.');
      },
      reload,
    })).rejects.toThrow('did not become ready in time');
    expect(reload).not.toHaveBeenCalled();
  });

  it('times out without reloading when the new worker never becomes the controller', async () => {
    const listeners = new Set();
    const waitingWorker = { postMessage: vi.fn() };
    const serviceWorkerContainer = {
      controller: { name: 'old-worker' },
      addEventListener(_type, listener) { listeners.add(listener); },
      removeEventListener(_type, listener) { listeners.delete(listener); },
    };
    const reload = vi.fn();

    await expect(forceRefreshToLatestBuild({ buildNumber: 104 }, {
      isDev: false,
      navigatorImpl: { serviceWorker: serviceWorkerContainer },
      windowImpl: { location: { href: 'https://flightdeck.example/', origin: 'https://flightdeck.example' } },
      registrationPromise: Promise.resolve({
        waiting: waitingWorker,
        installing: null,
        update: async () => {},
      }),
      waitForCoherentReleaseImpl: async () => {},
      timeoutMs: 5,
      reload,
    })).rejects.toThrow('Updating to the latest application release timed out');

    expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('bounds a stalled coherence request and prevents a late reload', async () => {
    let finishCoherence;
    const reload = vi.fn();
    const stalledCoherence = new Promise((resolve) => { finishCoherence = resolve; });

    await expect(forceRefreshToLatestBuild({ buildNumber: 104 }, {
      isDev: false,
      navigatorImpl: {},
      windowImpl: { location: { href: 'https://flightdeck.example/', origin: 'https://flightdeck.example' } },
      waitForCoherentReleaseImpl: () => stalledCoherence,
      timeoutMs: 5,
      reload,
    })).rejects.toThrow('Updating to the latest application release timed out');

    finishCoherence();
    await Promise.resolve();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
  });
});

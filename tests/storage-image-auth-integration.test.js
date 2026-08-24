/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cacheStorageImageMock,
  createNip98AuthHeaderForSecretMock,
  createNip98AuthHeaderMock,
  flightDeckLogMock,
  getActiveWorkspaceKeySecretForAuthMock,
  getCachedStorageImageMock,
} = vi.hoisted(() => ({
  cacheStorageImageMock: vi.fn(),
  createNip98AuthHeaderForSecretMock: vi.fn(),
  createNip98AuthHeaderMock: vi.fn(),
  flightDeckLogMock: vi.fn(),
  getActiveWorkspaceKeySecretForAuthMock: vi.fn(),
  getCachedStorageImageMock: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  cacheStorageImage: cacheStorageImageMock,
  getCachedStorageImage: getCachedStorageImageMock,
}));

vi.mock('../src/auth/nostr.js', () => ({
  createNip98AuthHeader: createNip98AuthHeaderMock,
  createNip98AuthHeaderForSecret: createNip98AuthHeaderForSecretMock,
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKeyNpub: vi.fn(() => 'npub1workspacekey'),
  getActiveWorkspaceKeySecretForAuth: getActiveWorkspaceKeySecretForAuthMock,
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  getActiveSessionNpub: vi.fn(() => 'npub1operator-a'),
}));

vi.mock('../src/logging.js', () => ({
  flightDeckLog: flightDeckLogMock,
}));

import { storageImageManagerMixin } from '../src/storage-image-manager.js';
import { downloadStorageObjectBlob } from '../src/api.js';

function createStore(overrides = {}) {
  return {
    ...storageImageManagerMixin,
    storageImageUrlCache: {},
    storageImageLoadPromises: {},
    storageImageFailureCache: {},
    backendUrl: 'https://fallback-tower.example',
    currentWorkspace: { directHttpsUrl: 'https://workspace-tower.example' },
    scheduleChatPreviewMeasurement: vi.fn(),
    scheduleTaskCommentPreviewMeasurement: vi.fn(),
    captureScrollAnchor: vi.fn(() => null),
    restoreScrollAnchor: vi.fn(),
    ...overrides,
  };
}

describe('PG storage image auth integration', () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;

  beforeEach(() => {
    document.body.innerHTML = '';
    cacheStorageImageMock.mockReset().mockResolvedValue(undefined);
    createNip98AuthHeaderForSecretMock.mockReset().mockResolvedValue('Nostr workspace-key');
    createNip98AuthHeaderMock.mockReset().mockResolvedValue('Nostr browser-signer');
    flightDeckLogMock.mockReset();
    getActiveWorkspaceKeySecretForAuthMock.mockReset();
    getCachedStorageImageMock.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL,
    });
    vi.restoreAllMocks();
  });

  it('hydrates multiple private PG attachments through the workspace Tower without browser signer calls', async () => {
    const workspaceSecret = new Uint8Array([7, 8, 9]);
    getActiveWorkspaceKeySecretForAuthMock.mockReturnValue(workspaceSecret);
    const fetchMock = vi.fn(async (requestUrl, options) => ({
      ok: true,
      status: 200,
      blob: async () => new Blob([requestUrl], { type: 'image/png' }),
      text: async () => '',
      requestOptions: options,
    }));
    globalThis.fetch = fetchMock;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob) => `blob:pg-image-${blob.size}`),
    });
    document.body.innerHTML = `
      <div data-chat-feed>
        <img class="md-storage-image md-storage-image-pending" data-storage-object-id="image-one" />
        <img class="md-storage-image md-storage-image-pending" data-storage-object-id="image-two" />
      </div>
    `;

    createStore().hydrateStorageImages();

    await vi.waitFor(() => {
      expect(document.querySelectorAll('img[data-storage-resolved="true"]')).toHaveLength(2);
    });

    const expectedUrls = [
      'https://workspace-tower.example/api/v4/storage/image-one/content',
      'https://workspace-tower.example/api/v4/storage/image-two/content',
    ];
    expect(fetchMock.mock.calls.map(([requestUrl]) => requestUrl)).toEqual(expectedUrls);
    expect(fetchMock.mock.calls.map(([, options]) => options.headers.Authorization)).toEqual([
      'Nostr workspace-key',
      'Nostr workspace-key',
    ]);
    expect(createNip98AuthHeaderForSecretMock).toHaveBeenCalledTimes(2);
    expect(createNip98AuthHeaderForSecretMock.mock.calls.map(([requestUrl]) => requestUrl)).toEqual(expectedUrls);
    expect(createNip98AuthHeaderForSecretMock.mock.calls.every(([, method, body, secret]) => (
      method === 'GET' && body === null && secret === workspaceSecret
    ))).toBe(true);
    expect(createNip98AuthHeaderMock).not.toHaveBeenCalled();
  });

  it('reports the exact storage request when browser signing fails before fetch', async () => {
    getActiveWorkspaceKeySecretForAuthMock.mockReturnValue(null);
    createNip98AuthHeaderMock.mockRejectedValue(Object.assign(
      new Error('Extension signing denied'),
      { code: 'sign_rejected' },
    ));
    globalThis.fetch = vi.fn();

    await expect(downloadStorageObjectBlob('private-image', {
      backendUrl: 'https://workspace-tower.example',
    })).rejects.toMatchObject({
      code: 'sign_rejected',
      method: 'GET',
      requestUrl: 'https://workspace-tower.example/api/v4/storage/private-image/content',
      message: 'Storage download failed GET https://workspace-tower.example/api/v4/storage/private-image/content: Extension signing denied',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('records the request URL and signer cause when hydration fails', async () => {
    getActiveWorkspaceKeySecretForAuthMock.mockReturnValue(null);
    createNip98AuthHeaderMock.mockRejectedValue(Object.assign(
      new Error('Extension signing denied'),
      { code: 'sign_rejected' },
    ));
    globalThis.fetch = vi.fn();
    document.body.innerHTML = `
      <img class="md-storage-image md-storage-image-pending" data-storage-object-id="private-image" />
    `;

    createStore().hydrateStorageImages();

    await vi.waitFor(() => {
      expect(document.querySelector('img').dataset.storageResolved).toBe('error');
    });
    expect(document.querySelector('img').dataset.storageError).toBe(
      'Storage download failed GET https://workspace-tower.example/api/v4/storage/private-image/content: Extension signing denied',
    );
    expect(flightDeckLogMock).toHaveBeenCalledWith(
      'warn',
      'storage',
      'storage image fetch failed; suppressing retries temporarily',
      expect.objectContaining({
        objectId: 'private-image',
        requestUrl: 'https://workspace-tower.example/api/v4/storage/private-image/content',
        method: 'GET',
        code: 'sign_rejected',
        cause: 'Extension signing denied',
      }),
    );
  });
});

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/pg-read-hydrator.js', () => ({ resolveTowerPgWorkspaceContext: (s) => s.context }));
vi.mock('../src/api.js', () => ({ fetchTowerPgDriveShares: vi.fn() }));
vi.mock('../src/auth/nostr.js', () => ({ signNostrEvent: vi.fn() }));
import {
  DriveClient,
  driveBreadcrumbs,
  driveMediaType,
  driveManagerMixin,
  DRIVE_PREVIEW_IMAGE_LIMIT,
  driveContextKey,
  driveError,
  formatDriveDiagnostics,
  driveReference,
  parseDriveReference,
  listingFresh,
  DRIVE_LISTING_TTL,
  hydrateDriveShares,
} from '../src/drive.js';
import { openWorkspaceDb, getWorkspaceDb } from '../src/db.js';
import { fetchTowerPgDriveShares } from '../src/api.js';
const share = {
  id: 'share-a',
  workspace_id: 'workspace-a',
  endpoint: 'http://host-a.fips:7345',
  host_npub: 'host-a',
  revision: 1,
};
describe('Drive boundaries', () => {
  it('keeps 30 minute listing TTL distinct and does not refresh age on failure', () => {
    const row = { fetched_at: 1000 };
    expect(listingFresh(row, 1001)).toBe(true);
    expect(listingFresh(row, 1000 + DRIVE_LISTING_TTL)).toBe(false);
    expect(listingFresh(row, 999)).toBe(false);
    driveError(new Error('offline'));
    expect(row.fetched_at).toBe(1000);
  });
  it('scopes caches to Tower, workspace and viewer; links contain references only', () => {
    const context = { baseUrl: 'https://tower-a', workspaceId: 'a', sessionNpub: 'owner' };
    for (const change of [
      { baseUrl: 'https://tower-b' },
      { workspaceId: 'b' },
      { sessionNpub: 'other' },
    ])
      expect(driveContextKey({ ...context, ...change })).not.toBe(driveContextKey(context));
    const link = driveReference(share, 'folder/file.txt', 'file');
    expect(parseDriveReference(link)).toEqual({
      workspace: 'workspace-a',
      share: 'share-a',
      path: 'folder/file.txt',
      kind: 'file',
    });
    expect(link).not.toContain('host-a');
  });
  it('signs exact endpoint/workspace/share/query with unique nonce for each host; transfer save remains native', async () => {
    const events = [];
    const transport = {
      connectDrive: vi.fn(async (o) => o),
      fetch: vi.fn(async () => new Response('file')),
      save: vi.fn(async (r, o) => {
        o.onProgress?.(4);
        return { saved: true };
      }),
    };
    const client = new DriveClient({
      transport,
      sign: async (e) => {
        events.push(e);
        return e;
      },
    });
    await client.listing({ ...share }, 'folder').catch(() => {});
    await client.save({ ...share, id: 'share-b', endpoint: 'http://host-b.fips:7345' }, 'file', {
      revision: 'rev',
      name: 'file',
      onProgress: () => {},
    });
    expect(transport.connectDrive.mock.calls.map((c) => c[0].endpoint)).toEqual([
      share.endpoint,
      'http://host-b.fips:7345',
    ]);
    expect(events[0].tags[0][1]).toContain('host-a');
    expect(events[1].tags[0][1]).toContain('host-b');
    expect(events[1].tags[3]).toEqual(['share', 'share-b']);
    expect(events[0].tags[4][1]).not.toBe(events[1].tags[4][1]);
    expect(transport.save).toHaveBeenCalledTimes(1);
  });
  it('distinguishes missing transport, denial, missing file, changed file, offline and cancel', async () => {
    await expect(new DriveClient({ transport: null }).listing(share, '')).rejects.toThrow(
      'missing-transport',
    );
    expect(driveError({ status: 403 })).toBe('denied');
    expect(driveError({ status: 404 })).toBe('missing');
    expect(driveError({ status: 409 })).toBe('changed');
    expect(driveError({ name: 'AbortError' })).toBe('cancelled');
    expect(driveError(new Error('network'))).toBe('unavailable');
  });
  it('records sanitized listing diagnostics without paths, ids, signatures or raw error text', async () => {
    const diagnostics = [];
    const transport = {
      connectDrive: vi.fn(async () => ({})),
      fetch: vi.fn(async () => {
        throw new TypeError('leaked /private/root capability-secret file-name.txt');
      }),
    };
    const sign = vi.fn(async () => ({ id: 'signed-secret', sig: 'signature-secret' }));
    const client = new DriveClient({ transport, sign, diagnostics: (row) => diagnostics.push(row) });
    await expect(
      client.listing(
        {
          ...share,
          id: 'share-secret-id',
          endpoint: 'http://host-a.fips:7345/private/file-name.txt?token=secret',
        },
        'folder/file-name.txt',
      ),
    ).rejects.toThrow();
    const text = formatDriveDiagnostics(diagnostics, { build: 'test-build', context: 'active' });
    expect(text).toContain('flightdeck-drive-diagnostics-v1 build=test-build');
    expect(text).toContain('stage="connect"');
    expect(text).toContain('stage="sign"');
    expect(text).toContain('stage="request"');
    expect(text).toContain('route="/drive/v1/<share>/<operation>"');
    expect(text).toContain('endpoint_host="host-a.fips"');
    expect(text).toContain('endpoint_port="7345"');
    expect(text).toContain('error="transport_error"');
    expect(text).not.toContain('share-secret-id');
    expect(text).not.toContain('signature-secret');
    expect(text).not.toContain('capability-secret');
    expect(text).not.toContain('/private/root');
    expect(text).not.toContain('file-name.txt');
    expect(text).not.toContain('token=secret');
  });
  it('records missing transport and stream failures without overriding the primary error', async () => {
    const missingDiagnostics = [];
    await expect(
      new DriveClient({ transport: null, diagnostics: (row) => missingDiagnostics.push(row) }).listing(
        share,
        '',
      ),
    ).rejects.toThrow('missing-transport');
    expect(formatDriveDiagnostics(missingDiagnostics)).toContain('error="missing_transport"');

    const streamDiagnostics = [];
    const primary = new TypeError('primary secret local-file.txt');
    const transport = {
      connectDrive: vi.fn(async () => ({})),
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              throw primary;
            },
            cancel: async () => {
              throw new TypeError('cancel secret local-file.txt');
            },
          }),
        },
      })),
    };
    const client = new DriveClient({
      transport,
      sign: async (e) => e,
      diagnostics: (row) => streamDiagnostics.push(row),
    });
    await expect(client.listing(share, '')).rejects.toBe(primary);
    const text = formatDriveDiagnostics(streamDiagnostics);
    expect(text).toContain('stage="read"');
    expect(text).toContain('error="transport_error"');
    expect(text).not.toContain('local-file.txt');
    expect(text).not.toContain('primary secret');
    expect(text).not.toContain('cancel secret');
  });
  it('drops stale Drive client diagnostics after the workspace context changes', async () => {
    const { driveManagerMixin } = await import('../src/drive.js');
    await openWorkspaceDb('drive-stale-diagnostics');
    const state = Object.defineProperties({}, Object.getOwnPropertyDescriptors(driveManagerMixin));
    state.context = { baseUrl: 'https://tower', workspaceId: 'workspace-a', sessionNpub: 'owner' };
    state.navSection = 'files';
    state.requestTowerSyncFamily = vi.fn(async () => {});
    const oldWindow = globalThis.window,
      oldLocation = globalThis.location;
    globalThis.window = { fipsTransport: { connectDrive() {} } };
    globalThis.location = { hash: '' };
    try {
      await state.startDrive();
      const client = state._driveClient;
      state.context = { ...state.context, workspaceId: 'workspace-b' };
      client.recordDiagnostic(share, { stage: 'request', operation: 'list', elapsed_ms: 1 });
      expect(state.driveDiagnostics).toEqual([]);
    } finally {
      state.stopDrive();
      globalThis.window = oldWindow;
      globalThis.location = oldLocation;
    }
  });
  it('bounds copyable listing diagnostics to newest records', () => {
    const rows = Array.from({ length: 45 }, (_, index) => ({
      ts: `2026-09-12T00:00:${String(index).padStart(2, '0')}Z`,
      stage: 'request',
      operation: 'list',
      endpoint_protocol: 'http',
      endpoint_host: 'host.fips',
      endpoint_port: '7345',
      elapsed_ms: index,
    }));
    const text = formatDriveDiagnostics(rows);
    expect(text).not.toContain('00:00:04Z');
    expect(text).toContain('00:00:05Z');
    expect(text).toContain('00:00:44Z');
  });
  it('aborted consent never sends a signed request', async () => {
    const abort = new AbortController();
    abort.abort();
    const sign = vi.fn();
    const client = new DriveClient({ transport: { connectDrive: async () => {} }, sign });
    await expect(client.listing(share, '', { signal: abort.signal })).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });
  it('sync replacement purges revoked listings and suppresses identity changes in flight', async () => {
    openWorkspaceDb('drive-test');
    const db = getWorkspaceDb();
    const context = {
        baseUrl: 'https://tower.example',
        workspaceId: 'workspace-a',
        sessionNpub: 'owner',
      },
      store = { context };
    const key = driveContextKey(context);
    fetchTowerPgDriveShares.mockResolvedValue({ shares: [share] });
    await hydrateDriveShares(store);
    const saved = (await db.drive_shares.toArray())[0];
    await db.drive_listings.put({
      key: 'page',
      context: key,
      share_key: saved.key,
      entries: [{ name: 'private' }],
      fetched_at: 1000,
    });
    fetchTowerPgDriveShares.mockResolvedValue({ shares: [] });
    await hydrateDriveShares(store);
    expect(await db.drive_listings.count()).toBe(0);
    expect(await db.drive_shares.count()).toBe(0);
    fetchTowerPgDriveShares.mockImplementation(async () => {
      store.context = { ...context, sessionNpub: 'other' };
      return { shares: [share] };
    });
    await hydrateDriveShares(store);
    expect(await db.drive_shares.count()).toBe(0);
  });
});

describe('Drive refresh outage behavior', () => {
  it('contacts host on manual refresh during bounded Tower outage and stops on denial/expiry', async () => {
    const { driveManagerMixin } = await import('../src/drive.js');
    const state = {
      driveSelected: { verified_at: Date.now() },
      drivePath: 'folder',
      requestTowerSyncFamily: vi.fn(async () => {
        throw new Error('Tower offline');
      }),
      browseDrive: vi.fn(),
      cancelDriveTransfer: vi.fn(),
      closeDrivePreview: vi.fn(),
      driveEntries: ['cached'],
    };
    await driveManagerMixin.refreshDrive.call(state);
    expect(state.browseDrive).toHaveBeenCalledWith(state.driveSelected, 'folder', true);
    state.browseDrive.mockClear();
    state.requestTowerSyncFamily.mockRejectedValue({ status: 403 });
    await driveManagerMixin.refreshDrive.call(state);
    expect(state.browseDrive).not.toHaveBeenCalled();
    expect(state.driveEntries).toEqual([]);
    state.requestTowerSyncFamily.mockRejectedValue(new Error('offline'));
    state.driveSelected.verified_at = Date.now() - 900000;
    await driveManagerMixin.refreshDrive.call(state);
    expect(state.browseDrive).not.toHaveBeenCalled();
  });
});

it('captures a cold reference before slow sync, finds a later file page, and follows a warm hash change', async () => {
  const { driveManagerMixin } = await import('../src/drive.js');
  await openWorkspaceDb('drive-links');
  const db = getWorkspaceDb();
  const state = Object.defineProperties({}, Object.getOwnPropertyDescriptors(driveManagerMixin));
  state.context = { baseUrl: 'https://tower', workspaceId: 'workspace-a', sessionNpub: 'owner' };
  state.navSection = 'files';
  const oldWindow = globalThis.window,
    oldLocation = globalThis.location;
  globalThis.window = { fipsTransport: { connectDrive() {} } };
  globalThis.location = { hash: driveReference(share, 'folder/later.txt', 'file') };
  let resume;
  const metadata = new Promise((resolve) => {
    resume = resolve;
  });
  state.requestTowerSyncFamily = vi.fn(async () => {
    await metadata;
    await db.drive_shares.put({
      ...share,
      context: state.driveScope,
      key: JSON.stringify([state.driveScope, share.id]),
      verified_at: Date.now(),
    });
  });
  state.browseDrive = vi.fn(async (_share, path, _force, offset = 0) => {
    state.driveEntries = offset ? [{ name: 'later.txt' }] : [{ name: 'first.txt' }];
    state.driveNextOffset = offset ? null : 100;
    state.driveState = 'online';
  });
  try {
    const start = state.startDrive();
    await vi.waitFor(() => expect(state.requestTowerSyncFamily).toHaveBeenCalled());
    globalThis.location.hash = '';
    resume();
    await start;
    expect(state.browseDrive.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ['folder', undefined],
      ['folder', 100],
    ]);
    globalThis.location.hash = driveReference(share, 'other');
    await state.startDrive();
    expect(state.browseDrive.mock.lastCall[1]).toBe('other');
  } finally {
    state.stopDrive();
    globalThis.window = oldWindow;
    globalThis.location = oldLocation;
  }
});

it('shows committed save and native export outcomes after a late cancel', async () => {
  const { driveManagerMixin } = await import('../src/drive.js');
  for (const [outcome, expected] of [
    [{ exportCompleted: true }, 'exported'],
    [{ exportCompleted: false }, 'export-dismissed'],
    [{ exportPresented: true }, 'export-presented'],
    [{}, 'saved'],
  ]) {
    const state = {
      drivePath: '',
      driveScope: 'scope',
      driveSelected: share,
      cancelDriveTransfer() {},
      _driveClient: {
        save: async (_share, _path, { signal }) => {
          state._driveTransfer.abort();
          return { saved: true, committed: true, ...outcome };
        },
      },
    };
    await driveManagerMixin.openDriveEntry.call(state, {
      name: 'file',
      kind: 'file',
      revision: 'revision',
    });
    expect(state.driveState).toBe(expected);
  }
});


describe('Drive media and navigation', () => {
  const imageEntry = { name: 'photo.JPG', kind: 'file', size: 4, revision: 'r' };
  const makeState = () => Object.defineProperties({}, Object.getOwnPropertyDescriptors(driveManagerMixin));
  it('builds each ancestor without decoding or confusing repeated names', () => {
    expect(driveBreadcrumbs({ name: 'Output' }, 'a/a/hello%20')).toEqual([
      { name: 'Output', path: '' }, { name: 'a', path: 'a' }, { name: 'a', path: 'a/a' }, { name: 'hello%20', path: 'a/a/hello%20' },
    ]);
    expect(driveMediaType(imageEntry)).toBe('image/jpeg');
    for (const name of ['a.svg', 'a.html', 'a.txt', 'a.__proto__', 'a.constructor']) expect(driveMediaType({ kind: 'file', name })).toBeNull();
  });
  it('reads media through signed transport with revision and a hard streaming bound', async () => {
    const events = [];
    const cancelled = vi.fn();
    const transport = {
      connectDrive: vi.fn(async () => ({})),
      fetch: vi.fn(async () => new Response(new ReadableStream({
        start(c) { c.enqueue(new Uint8Array(5)); }, cancel: cancelled,
      }))),
    };
    const client = new DriveClient({ transport, sign: async (e) => { events.push(e); return e; } });
    await expect(client.preview(share, 'photo.JPG', { type: 'image/jpeg', revision: 'r', limit: 4, size: 4 })).rejects.toThrow('Preview too large');
    expect(cancelled).toHaveBeenCalled();
    expect(events[0].tags[0][1]).toContain('revision=r');
    transport.fetch.mockImplementation(async () => new Response('file'));
    const blob = await client.preview(share, 'photo.JPG', { type: 'image/jpeg', limit: 4, size: 4 });
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(4);
    await expect(client.preview(share, 'photo.JPG', { type: 'image/jpeg', limit: 4, size: 5 })).rejects.toThrow('Incomplete preview');
  });
  it('does not request large media, revokes previews, and ignores late context results', async () => {
    const state = makeState();
    state.context = { baseUrl: 'tower', workspaceId: 'one', sessionNpub: 'user' };
    state.driveSelected = share;
    state._driveClient = { preview: vi.fn() };
    await state.previewDriveEntry({ ...imageEntry, size: DRIVE_PREVIEW_IMAGE_LIMIT + 1 });
    expect(state._driveClient.preview).not.toHaveBeenCalled();
    expect(state.drivePreview.state).toBe('limited');
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    state._driveClient.preview.mockResolvedValue(new Blob(['file']));
    await state.previewDriveEntry(imageEntry);
    expect(state.drivePreview.url).toBe('blob:preview');
    state.showDriveSources();
    expect(revoke).toHaveBeenCalledWith('blob:preview');
    expect(state.drivePreview).toBeNull();
    state.driveSelected = share;
    let resolve;
    state._driveClient.preview.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const pending = state.previewDriveEntry(imageEntry);
    state.context = { ...state.context, workspaceId: 'other' };
    resolve(new Blob(['file']));
    await pending;
    expect(create).toHaveBeenCalledTimes(1);
    state.closeDrivePreview();
    create.mockRestore(); revoke.mockRestore();
  });
  it('cancels the prior preview when another file is selected', async () => {
    const state = makeState();
    state.context = { baseUrl: 'tower', workspaceId: 'one', sessionNpub: 'user' };
    state.driveSelected = share;
    const calls = [];
    state._driveClient = { preview: vi.fn((s, p, o) => new Promise((resolve) => calls.push({ resolve, signal: o.signal }))) };
    const first = state.previewDriveEntry(imageEntry);
    const second = state.previewDriveEntry({ ...imageEntry, name: 'two.jpg' });
    expect(calls[0].signal.aborted).toBe(true);
    state.closeDrivePreview();
    calls.forEach(c => c.resolve(new Blob(['file'])));
    await Promise.all([first, second]);
    expect(state.drivePreview).toBeNull();
  });
  it('logs native save failures and rejects an unconfirmed save', async () => {
    const rows = [];
    const transport = { connectDrive: vi.fn(async () => ({})), fetch: vi.fn(async () => new Response('file')), save: vi.fn(async () => undefined) };
    const client = new DriveClient({ transport, sign: async e => e, diagnostics: row => rows.push(row) });
    await expect(client.save(share, 'private.jpg', { name: 'private.jpg' })).rejects.toThrow('save-not-confirmed');
    expect(rows.at(-1)).toMatchObject({ stage: 'save', error: 'save_not_confirmed' });
    transport.save.mockRejectedValue(new Error('save-dialog-failed'));
    await expect(client.save(share, 'private.jpg', { name: 'private.jpg' })).rejects.toThrow('save-dialog-failed');
    expect(rows.at(-1)).toMatchObject({ stage: 'save', error: 'save_dialog_failed' });
    expect(formatDriveDiagnostics(rows)).not.toContain('private.jpg');
  });
});


it('closes decoded media when policy denies a download, and exposes the native error', async () => {
  const state = Object.defineProperties({}, Object.getOwnPropertyDescriptors(driveManagerMixin));
  state.context = { baseUrl: 'tower', workspaceId: 'one', sessionNpub: 'user' };
  state.driveSelected = share;
  state.drivePreview = { url: 'blob:private' };
  state._driveClient = { save: vi.fn(async () => { throw { status: 403 }; }) };
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  await state.openDriveEntry({ kind: 'file', name: 'a.jpg', revision: 'r' });
  expect(state.drivePreview).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:private');
  expect(state.driveState).toBe('denied');
  state._driveClient.save.mockRejectedValue(new Error('save-dialog-failed'));
  await state.openDriveEntry({ kind: 'file', name: 'a.jpg', revision: 'r' });
  expect(state.driveTransferError).toContain('save dialog could not open');
  revoke.mockRestore();
});

it('cancels and revokes media on stop, collapse, and folder navigation', async () => {
  await openWorkspaceDb('drive-preview-navigation-test');
  const state = Object.defineProperties({}, Object.getOwnPropertyDescriptors(driveManagerMixin));
  state.context = { baseUrl: 'tower', workspaceId: 'one', sessionNpub: 'user' };
  state.driveSelected = share;
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  state.drivePreview = { url: 'blob:collapse' };
  state.toggleFilesSharedPanel();
  expect(revoke).toHaveBeenCalledWith('blob:collapse');
  state.drivePreview = { url: 'blob:folder' };
  state._driveClient = { listing: vi.fn(async () => { throw new Error('offline'); }) };
  await state.browseDrive(share, 'next');
  expect(revoke).toHaveBeenCalledWith('blob:folder');
  state.drivePreview = { url: 'blob:stop' };
  state.stopDrive();
  expect(revoke).toHaveBeenCalledWith('blob:stop');
  revoke.mockRestore();
});

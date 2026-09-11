import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/pg-read-hydrator.js', () => ({ resolveTowerPgWorkspaceContext: (s) => s.context }));
vi.mock('../src/api.js', () => ({ fetchTowerPgDriveShares: vi.fn() }));
vi.mock('../src/auth/nostr.js', () => ({ signNostrEvent: vi.fn() }));
import {
  DriveClient,
  driveContextKey,
  driveError,
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
    expect(driveError(new Error('network'))).toBe('offline');
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
  state.navSection = 'drive';
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

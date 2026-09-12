import { liveQuery } from 'dexie';
import { getWorkspaceDb } from './db.js';
import { resolveTowerPgWorkspaceContext } from './pg-read-hydrator.js';
import { fetchTowerPgDriveShares } from './api.js';
import { signNostrEvent } from './auth/nostr.js';

export const DRIVE_LISTING_TTL = 30 * 60 * 1000;
export const DRIVE_POLICY_MAX_AGE = 15 * 60 * 1000;
const DRIVE_DIAGNOSTIC_LIMIT = 40;
const DRIVE_DIAGNOSTIC_VERSION = 'flightdeck-drive-diagnostics-v1';
const DRIVE_ROUTE_TEMPLATE = '/drive/v1/<share>/<operation>';
const DRIVE_SAFE_ERROR_CODES = new Map([
  ['AbortError', 'cancelled'],
  ['NotAllowedError', 'consent_denied'],
  ['SecurityError', 'security_error'],
  ['TypeError', 'transport_error'],
  ['SyntaxError', 'parse_error'],
]);
export const driveContextKey = (c) => JSON.stringify([c.baseUrl, c.workspaceId, c.sessionNpub]);
export const listingFresh = (row, now = Date.now()) =>
  row && now >= row.fetched_at && now - row.fetched_at < DRIVE_LISTING_TTL;
export function driveReference(share, path = '', kind = 'directory') {
  return `#drive?${new URLSearchParams({ workspace: share.workspace_id, share: share.id, path, kind })}`;
}
export function parseDriveReference(hash) {
  if (!hash.startsWith('#drive?')) return null;
  const p = new URLSearchParams(hash.slice(7));
  return {
    workspace: p.get('workspace'),
    share: p.get('share'),
    path: p.get('path') || '',
    kind: p.get('kind') || 'directory',
  };
}
export function driveError(e) {
  if (e?.name === 'AbortError') return 'cancelled';
  if (e?.status === 403 || e?.status === 401) return 'denied';
  if (e?.status === 404) return 'missing';
  if (e?.status === 409) return 'changed';
  if (e?.message === 'missing-transport') return 'missing-transport';
  if (/denied/i.test(e?.message || '')) return 'consent-denied';
  return 'unavailable';
}

function safeEndpoint(endpoint = '') {
  try {
    const url = new URL(endpoint);
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname || '<unknown>',
      port: url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : ''),
    };
  } catch {
    return { protocol: '<unknown>', host: '<unknown>', port: '' };
  }
}

function safeErrorCode(error) {
  if (!error) return '';
  if (error.status) return `http_${Number(error.status) || 'unknown'}`;
  if (error.message === 'missing-transport') return 'missing_transport';
  if (/denied/i.test(error.message || '')) return 'consent_denied';
  if (error.message === 'Listing too large') return 'listing_too_large';
  if (error instanceof SyntaxError) return 'parse_error';
  return DRIVE_SAFE_ERROR_CODES.get(error.name) || 'unknown';
}

function formatDiagnosticValue(value) {
  return `"${String(value ?? '').replace(/[\\"]/g, '\\$&').replace(/\s+/g, ' ').slice(0, 160)}"`;
}

export function formatDriveDiagnostics(rows = [], header = {}) {
  const lines = [
    `${DRIVE_DIAGNOSTIC_VERSION} build=${header.build || 'unknown'} context=${header.context || 'unknown'}`,
  ];
  for (const row of rows.slice(-DRIVE_DIAGNOSTIC_LIMIT)) {
    const parts = [
      `ts=${formatDiagnosticValue(row.ts)}`,
      `stage=${formatDiagnosticValue(row.stage || 'unknown')}`,
      `operation=${formatDiagnosticValue(row.operation || 'unknown')}`,
      `method=${formatDiagnosticValue(row.method || 'GET')}`,
      `route=${formatDiagnosticValue(DRIVE_ROUTE_TEMPLATE)}`,
      `endpoint_protocol=${formatDiagnosticValue(row.endpoint_protocol || '')}`,
      `endpoint_host=${formatDiagnosticValue(row.endpoint_host || '')}`,
      `endpoint_port=${formatDiagnosticValue(row.endpoint_port || '')}`,
      `elapsed_ms=${Number.isFinite(row.elapsed_ms) ? Math.max(0, Math.round(row.elapsed_ms)) : 0}`,
    ];
    if (row.status) parts.push(`status=${Number(row.status)}`);
    if (row.error) parts.push(`error=${formatDiagnosticValue(row.error)}`);
    lines.push(parts.join(' '));
  }
  return lines.join('\n');
}

// Called only by TowerSyncService. Atomic replacement removes inaccessible shares
// and their local listings; no file bytes or directory indexes enter Tower sync.
export async function hydrateDriveShares(store) {
  const context = resolveTowerPgWorkspaceContext(store),
    key = driveContextKey(context),
    db = getWorkspaceDb();
  if (!context.sessionNpub || !context.workspaceId) throw new Error('No Drive identity');
  const current = () => driveContextKey(resolveTowerPgWorkspaceContext(store)) === key;
  let payload;
  try {
    payload = await fetchTowerPgDriveShares(context.workspaceId, context);
  } catch (e) {
    if (current() && (e.status === 403 || e.status === 401)) {
      await db.transaction('rw', db.drive_shares, db.drive_listings, async () => {
        await db.drive_shares.where('context').equals(key).delete();
        await db.drive_listings.where('context').equals(key).delete();
      });
    }
    throw e;
  }
  if (!current()) return;
  const rows = (payload.shares || []).map((s) => ({
    ...s,
    key: JSON.stringify([key, s.id]),
    context: key,
    verified_at: Date.now(),
  }));
  await db.transaction('rw', db.drive_shares, db.drive_listings, async () => {
    const previous = await db.drive_shares.where('context').equals(key).toArray();
    const keep = new Map(rows.map((s) => [s.id, s]));
    for (const old of previous) {
      const next = keep.get(old.id);
      if (
        !next ||
        Number(next.revision) !== Number(old.revision) ||
        next.host_npub !== old.host_npub
      )
        await db.drive_listings.where('share_key').equals(old.key).delete();
    }
    await db.drive_shares.where('context').equals(key).delete();
    await db.drive_shares.bulkPut(rows);
  });
  return rows;
}

export class DriveClient {
  constructor({
    transport = globalThis.window?.fipsTransport,
    sign = signNostrEvent,
    diagnostics = null,
  } = {}) {
    this.transport = transport;
    this.sign = sign;
    this.connecting = Promise.resolve();
    this.diagnostics = typeof diagnostics === 'function' ? diagnostics : null;
  }
  recordDiagnostic(share, fields = {}) {
    const endpoint = safeEndpoint(share?.endpoint);
    this.diagnostics?.({
      ts: new Date().toISOString(),
      method: 'GET',
      endpoint_protocol: endpoint.protocol,
      endpoint_host: endpoint.host,
      endpoint_port: endpoint.port,
      ...fields,
    });
  }
  async request(share, operation, path, options = {}) {
    const started = performance.now?.() || Date.now();
    const elapsed = () => (performance.now?.() || Date.now()) - started;
    if (!this.transport?.connectDrive) {
      const error = new Error('missing-transport');
      this.recordDiagnostic(share, {
        stage: 'connect',
        operation,
        elapsed_ms: elapsed(),
        error: safeErrorCode(error),
      });
      throw error;
    }
    // Serialize consent panels without sharing endpoint grants.
    const connecting = this.connecting.then(async () => {
      this.recordDiagnostic(share, { stage: 'connect', operation, elapsed_ms: elapsed() });
      try {
        const result = await this.transport.connectDrive({ endpoint: share.endpoint });
        this.recordDiagnostic(share, { stage: 'consent', operation, elapsed_ms: elapsed() });
        return result;
      } catch (error) {
        this.recordDiagnostic(share, {
          stage: /denied/i.test(error?.message || '') ? 'consent' : 'connect',
          operation,
          elapsed_ms: elapsed(),
          error: safeErrorCode(error),
        });
        throw error;
      }
    });
    this.connecting = connecting.catch(() => {});
    await connecting;
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const url = new URL(`${share.endpoint}/drive/v1/${share.id}/${operation}`);
    url.searchParams.set('path', path);
    if (options.revision) url.searchParams.set('revision', options.revision);
    if (options.offset) url.searchParams.set('offset', options.offset);
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
    let event;
    try {
      this.recordDiagnostic(share, { stage: 'sign', operation, elapsed_ms: elapsed() });
      event = await this.sign({
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [
          ['u', url.href],
          ['method', 'GET'],
          ['workspace', share.workspace_id],
          ['share', share.id],
          ['nonce', nonce],
        ],
      });
    } catch (error) {
      this.recordDiagnostic(share, {
        stage: 'sign',
        operation,
        elapsed_ms: elapsed(),
        error: safeErrorCode(error),
      });
      throw error;
    }
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    let response;
    try {
      this.recordDiagnostic(share, { stage: 'request', operation, elapsed_ms: elapsed() });
      response = await this.transport.fetch(url.href, {
        signal: options.signal,
        headers: { Authorization: `Nostr ${btoa(JSON.stringify(event))}` },
      });
    } catch (error) {
      this.recordDiagnostic(share, {
        stage: 'request',
        operation,
        elapsed_ms: elapsed(),
        error: safeErrorCode(error),
      });
      throw error;
    }
    this.recordDiagnostic(share, {
      stage: 'status',
      operation,
      elapsed_ms: elapsed(),
      status: response.status,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error('Drive request failed'), { status: response.status });
    }
    return response;
  }
  async listing(share, path, options = {}) {
    const response = await this.request(share, 'list', path, options);
    const started = performance.now?.() || Date.now();
    const elapsed = () => (performance.now?.() || Date.now()) - started;
    let reader;
    let bytes = 0;
    const chunks = [];
    let primaryError = null;
    try {
      reader = response.body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.length;
        if (bytes > 1024 * 1024) {
          const error = new Error('Listing too large');
          this.recordDiagnostic(share, {
            stage: 'parse',
            operation: 'list',
            elapsed_ms: elapsed(),
            error: safeErrorCode(error),
          });
          throw error;
        }
        chunks.push(next.value);
      }
    } catch (error) {
      primaryError = error;
      this.recordDiagnostic(share, {
        stage: 'read',
        operation: 'list',
        elapsed_ms: elapsed(),
        error: safeErrorCode(error),
      });
      throw error;
    } finally {
      try {
        await reader?.cancel();
      } catch (error) {
        this.recordDiagnostic(share, {
          stage: 'read',
          operation: 'list',
          elapsed_ms: elapsed(),
          error: safeErrorCode(error),
        });
        if (!primaryError) throw error;
      }
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      const page = JSON.parse(new TextDecoder().decode(data));
      this.recordDiagnostic(share, { stage: 'parse', operation: 'list', elapsed_ms: elapsed() });
      return page;
    } catch (error) {
      this.recordDiagnostic(share, {
        stage: 'parse',
        operation: 'list',
        elapsed_ms: elapsed(),
        error: safeErrorCode(error),
      });
      throw error;
    }
  }
  async save(share, path, { revision, name, signal, onProgress, open = false }) {
    if (!this.transport?.save) throw new Error('missing-transport');
    const response = await this.request(share, 'read', path, { revision, signal });
    try {
      return await this.transport.save(response, { name, signal, onProgress, open });
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  }
}

export const driveManagerMixin = {
  driveRows: [],
  driveEntries: [],
  driveSelected: null,
  drivePath: '',
  driveState: '',
  driveFetchedAt: 0,
  driveNextOffset: null,
  driveRevision: '',
  driveProgress: 0,
  driveTransferring: false,
  driveContext: '',
  driveDiagnostics: [],
  get driveStatusLabel() {
    return (
      {
        ready: 'Choose a source folder',
        loading: 'Loading folder…',
        online: 'Source online',
        cached: 'Source online · cached listing',
        offline: 'Source offline · cached entries may be stale',
        unavailable: 'Shared folder unavailable · check diagnostics',
        denied: 'Access denied or authorization expired',
        'consent-denied': 'Connection permission denied',
        'missing-transport': 'Native FIPS transport unavailable',
        missing: 'File or folder no longer available',
        changed: 'File changed — refresh and try again',
        cancelled: 'Transfer cancelled',
        saved: 'File saved locally',
        exported: 'File saved locally · export completed',
        'export-dismissed': 'File saved locally · export dismissed',
        'export-presented': 'File saved locally · export chooser opened',
      }[this.driveState] || this.driveState
    );
  },
  get driveScope() {
    return driveContextKey(resolveTowerPgWorkspaceContext(this));
  },
  get driveSources() {
    return this.driveContext === this.driveScope ? this.driveRows : [];
  },
  get driveVisibleEntries() {
    return this.driveContext === this.driveScope &&
      this.driveSelected &&
      this.driveRows.some((s) => s.id === this.driveSelected.id)
      ? this.driveEntries
      : [];
  },
  get driveDiagnosticsText() {
    return formatDriveDiagnostics(this.driveDiagnostics, {
      build: globalThis.__FLIGHTDECK_BUILD_ID__ || globalThis.__FLIGHTDECK_BUILD_NUMBER__ || 'unknown',
      context: this.driveContext ? 'active' : 'none',
    });
  },
  recordDriveDiagnostic(row, expectedContext = this.driveContext, expectedGeneration = this._driveGeneration) {
    if (
      !this.driveContext ||
      this.driveContext !== expectedContext ||
      this.driveScope !== expectedContext ||
      this._driveGeneration !== expectedGeneration
    )
      return;
    this.driveDiagnostics = [...this.driveDiagnostics.slice(-(DRIVE_DIAGNOSTIC_LIMIT - 1)), row];
  },
  clearDriveDiagnostics() {
    this.driveDiagnostics = [];
  },
  async startDrive() {
    const reference = parseDriveReference(location.hash);
    const key = this.driveScope;
    if (
      key === this.driveContext &&
      this._driveReferenceHash === location.hash &&
      (this._driveSubscription || this._driveStartKey === key)
    )
      return;
    this.stopDrive();
    this.driveContext = key;
    this.clearDriveDiagnostics();
    this._driveReferenceHash = location.hash;
    this._driveStartKey = key;
    const generation = this._driveGeneration;
    this._driveClient = new DriveClient({
      diagnostics: (row) => this.recordDriveDiagnostic(row, key, generation),
    });
    const db = getWorkspaceDb();
    // Account switch purges other viewers' listing caches in this workspace DB.
    await db.drive_listings.filter((r) => r.context !== key).delete();
    if (this.driveScope !== key || this._driveGeneration !== generation) return;
    this._driveSubscription = liveQuery(() =>
      db.drive_shares.where('context').equals(key).toArray(),
    ).subscribe((rows) => {
      if (this.driveScope !== key) return;
      this.driveRows = rows.filter((s) => Date.now() - s.verified_at < DRIVE_POLICY_MAX_AGE);
      if (
        this.driveSelected &&
        !this.driveRows.some(
          (s) =>
            s.id === this.driveSelected.id &&
            Number(s.revision) === Number(this.driveSelected.revision),
        )
      ) {
        this.cancelDriveTransfer();
        this.driveEntries = [];
        this.driveSelected = null;
        this.driveState = 'denied';
      } else if (this.driveSelected) {
        this.driveSelected = this.driveRows.find((row) => row.id === this.driveSelected.id);
      }
    });
    // Listing TTL only refreshes the visited directory; metadata uses the sync owner's timer.
    this._driveTimer = setInterval(() => {
      if (this.driveScope !== key || this.navSection !== 'files') {
        this.stopDrive();
        return;
      }
      this.driveRows = this.driveRows.filter(
        (s) => Date.now() - s.verified_at < DRIVE_POLICY_MAX_AGE,
      );
      if (this.driveSelected && !this.driveRows.some((row) => row.id === this.driveSelected.id)) {
        this.cancelDriveTransfer();
        this._driveBrowseAbort?.abort();
        this.driveEntries = [];
        this.driveSelected = null;
        this.driveState = 'denied';
      }
      if (
        this.driveSelected &&
        Date.now() - this.driveFetchedAt >= DRIVE_LISTING_TTL &&
        !this._driveListingBusy
      )
        void this.browseDrive(this.driveSelected, this.drivePath);
    }, 30000);
    try {
      await this.requestTowerSyncFamily('drive-shares', '', { force: true });
      if (this._driveGeneration !== generation || this.driveScope !== key) return;
      this.driveState = window.fipsTransport?.connectDrive ? 'ready' : 'missing-transport';
      const ref = reference;
      if (ref?.workspace === resolveTowerPgWorkspaceContext(this).workspaceId) {
        const share = (await db.drive_shares.where('context').equals(key).toArray()).find(
          (s) => s.id === ref.share,
        );
        if (share) {
          const parent =
            ref.kind === 'file' ? ref.path.split('/').slice(0, -1).join('/') : ref.path;
          await this.browseDrive(share, parent);
          const name = ref.path.split('/').at(-1);
          // File references locate their containing page without caching an unbounded index.
          const visited = new Set();
          while (
            ref.kind === 'file' &&
            !this.driveEntries.some((entry) => entry.name === name) &&
            this.driveNextOffset != null &&
            !visited.has(this.driveNextOffset) &&
            ['online', 'cached'].includes(this.driveState) &&
            this._driveGeneration === generation
          ) {
            visited.add(this.driveNextOffset);
            await this.browseDrive(share, parent, false, this.driveNextOffset);
          }
          if (
            ref.kind === 'file' &&
            !this.driveEntries.some((entry) => entry.name === name) &&
            ['online', 'cached'].includes(this.driveState)
          )
            this.driveState = 'missing';
        } else this.driveState = 'missing';
      } else if (ref) {
        this.driveState = 'Select the referenced workspace to open this link';
      }
    } catch (e) {
      this.driveState = driveError(e);
    }
  },
  stopDrive() {
    this._driveGeneration = (this._driveGeneration || 0) + 1;
    this._driveStartKey = null;
    this.cancelDriveTransfer();
    this._driveBrowseAbort?.abort();
    this._driveSubscription?.unsubscribe();
    this._driveSubscription = null;
    clearInterval(this._driveTimer);
    this.driveRows = [];
    this.driveEntries = [];
    this.driveSelected = null;
    this.driveContext = '';
    this.clearDriveDiagnostics();
  },
  async browseDrive(share, path = '', force = false, offset = 0) {
    this._driveBrowseAbort?.abort();
    const controller = new AbortController();
    this._driveBrowseAbort = controller;
    const scope = this.driveScope,
      db = getWorkspaceDb(),
      key = JSON.stringify([scope, share.host_npub, share.id, path, offset]);
    const current = () => !controller.signal.aborted && this.driveScope === scope;
    this.driveSelected = share;
    this.drivePath = path;
    this.driveEntries = [];
    this.driveFetchedAt = 0;
    this.driveNextOffset = null;
    this.driveState = 'loading';
    this._driveListingBusy = true;
    try {
      const cached = await db.drive_listings.get(key);
      if (!current()) return;
      if (cached) {
        this.driveEntries = cached.entries;
        this.driveFetchedAt = cached.fetched_at;
        this.driveNextOffset = cached.next_offset;
        this.driveRevision = cached.revision;
        this.driveState = 'cached';
      }
      if (!force && listingFresh(cached)) {
        const response = await this._driveClient.request(share, 'status', '', {
          signal: controller.signal,
        });
        await response.body?.cancel();
        if (current()) this.driveState = 'cached';
        return;
      }
      const page = await this._driveClient.listing(share, path, {
        signal: controller.signal,
        offset,
        revision: offset ? this.driveRevision : undefined,
      });
      if (!current()) return;
      const authority = await db.drive_shares.get(share.key);
      if (!authority || Number(authority.revision) !== Number(share.revision))
        throw Object.assign(new Error('denied'), { status: 403 });
      const row = { ...page, key, context: scope, share_key: share.key, fetched_at: Date.now() };
      await db.drive_listings.put(row);
      if (!current()) return;
      this.driveEntries = page.entries;
      this.driveFetchedAt = row.fetched_at;
      this.driveNextOffset = page.next_offset;
      this.driveRevision = page.revision;
      this.driveState = 'online';
    } catch (e) {
      if (current()) {
        this.driveState = driveError(e);
        if (this.driveState === 'denied') {
          await db.drive_listings.where('share_key').equals(share.key).delete();
          this.driveEntries = [];
        }
      }
    } finally {
      if (current()) this._driveListingBusy = false;
    }
  },
  driveParent() {
    const path = this.drivePath.split('/');
    path.pop();
    return this.browseDrive(this.driveSelected, path.join('/'));
  },
  async refreshDrive() {
    try {
      await this.requestTowerSyncFamily('drive-shares', '', { force: true });
    } catch (e) {
      if (
        driveError(e) === 'denied' ||
        !this.driveSelected ||
        Date.now() - this.driveSelected.verified_at >= DRIVE_POLICY_MAX_AGE
      ) {
        this.driveState = driveError(e);
        this.cancelDriveTransfer();
        this.driveEntries = [];
        return;
      }
      // A Tower outage does not prevent contacting a host within the finite policy window.
    }
    if (this.driveSelected) await this.browseDrive(this.driveSelected, this.drivePath, true);
  },
  async openDriveEntry(entry, open = false) {
    const path = [this.drivePath, entry.name].filter(Boolean).join('/');
    if (entry.kind === 'directory') return this.browseDrive(this.driveSelected, path);
    this.cancelDriveTransfer();
    const controller = new AbortController();
    this._driveTransfer = controller;
    this.driveTransferring = true;
    this.driveProgress = 0;
    const scope = this.driveScope;
    try {
      const result = await this._driveClient.save(this.driveSelected, path, {
        revision: entry.revision,
        name: entry.name,
        signal: controller.signal,
        onProgress: (n) => {
          if (this.driveScope === scope) this.driveProgress = n;
        },
        open,
      });
      if (controller.signal.aborted && !result?.committed)
        throw new DOMException('Cancelled', 'AbortError');
      if (this.driveScope === scope)
        this.driveState =
          result?.exportCompleted === true
            ? 'exported'
            : result?.exportCompleted === false
              ? 'export-dismissed'
              : result?.exportPresented
                ? 'export-presented'
                : 'saved';
    } catch (e) {
      if (this.driveScope === scope) this.driveState = driveError(e);
    } finally {
      if (this._driveTransfer === controller) this.driveTransferring = false;
    }
  },
  cancelDriveTransfer() {
    this._driveTransfer?.abort();
    this._driveTransfer = null;
    this.driveTransferring = false;
  },
  async copyDriveLink(entry = null) {
    const path = entry ? [this.drivePath, entry.name].filter(Boolean).join('/') : this.drivePath;
    await navigator.clipboard.writeText(
      `${location.origin}${location.pathname}${driveReference(this.driveSelected, path, entry?.kind || 'directory')}`,
    );
  },
  async copyDriveDiagnostics() {
    await navigator.clipboard.writeText(this.driveDiagnosticsText);
  },
};

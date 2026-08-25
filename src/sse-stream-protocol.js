const PG_STREAM_PREFIX = '/api/v4/flightdeck-pg/workspaces/';
const LEGACY_STREAM_PREFIX = '/api/v4/workspaces/';

export function buildSSEStreamPath({ pgMode = false, workspaceId = '', ownerNpub = '' } = {}) {
  if (pgMode) {
    const workspace = String(workspaceId || '').trim();
    if (!workspace) throw new Error('SSE workspace id is required');
    return `${PG_STREAM_PREFIX}${encodeURIComponent(workspace)}/events/stream`;
  }

  const owner = String(ownerNpub || '').trim();
  if (!owner) throw new Error('SSE workspace owner is required');
  return `${LEGACY_STREAM_PREFIX}${encodeURIComponent(owner)}/stream`;
}

export function buildSSESigningUrl({
  backendUrl,
  pgMode = false,
  workspaceId = '',
  ownerNpub = '',
  cursor = null,
  lastEventId = null,
} = {}) {
  const signingUrl = new URL(
    buildSSEStreamPath({ pgMode, workspaceId, ownerNpub }),
    String(backendUrl || '').trim(),
  );
  if (pgMode && cursor != null) {
    signingUrl.searchParams.set('cursor', String(cursor));
  } else if (!pgMode && lastEventId != null) {
    signingUrl.searchParams.set('last_event_id', String(lastEventId));
  }
  return signingUrl.toString();
}

export function appendSSETransportToken(signingUrl, token) {
  const value = String(token || '').trim();
  if (!value) throw new Error('SSE transport token is required');
  const eventSourceUrl = new URL(signingUrl);
  if (eventSourceUrl.searchParams.has('token')) {
    throw new Error('SSE signing URL must not contain a transport token');
  }
  eventSourceUrl.searchParams.append('token', value);
  return eventSourceUrl.toString();
}

export function validateSSESigningUrl(signingUrl, {
  backendUrl,
  pgMode = false,
  workspaceId = '',
  ownerNpub = '',
} = {}) {
  let supplied;
  let backend;
  try {
    supplied = new URL(String(signingUrl || ''));
    backend = new URL(String(backendUrl || ''));
  } catch {
    return false;
  }

  const expectedPath = buildSSEStreamPath({ pgMode, workspaceId, ownerNpub });
  if (
    supplied.origin !== backend.origin
    || supplied.pathname !== expectedPath
    || supplied.username
    || supplied.password
    || supplied.hash
    || supplied.searchParams.has('token')
  ) {
    return false;
  }

  const allowedParam = pgMode ? 'cursor' : 'last_event_id';
  const keys = [...supplied.searchParams.keys()];
  return keys.every((key) => key === allowedParam)
    && supplied.searchParams.getAll(allowedParam).length <= 1;
}

export function createSSETokenRequestTracker() {
  let nextRequestId = 1;
  let pending = null;

  return {
    request(connectionKey, signingUrl) {
      pending = {
        requestId: `sse-token-${nextRequestId++}`,
        connectionKey,
        signingUrl,
      };
      return { ...pending };
    },
    accept({ requestId, connectionKey, token } = {}) {
      if (
        !pending
        || requestId !== pending.requestId
        || connectionKey !== pending.connectionKey
        || !String(token || '').trim()
      ) {
        return null;
      }
      const accepted = {
        ...pending,
        eventSourceUrl: appendSSETransportToken(pending.signingUrl, token),
      };
      pending = null;
      return accepted;
    },
    clear() {
      pending = null;
    },
    getPending() {
      return pending ? { ...pending } : null;
    },
  };
}

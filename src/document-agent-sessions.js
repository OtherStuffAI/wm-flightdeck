import { createNip98AuthHeader } from './auth/nostr.js';
import { normalizedAutopilotLaunchUrl } from './autopilot-agents.js';

function clean(value) {
  return String(value ?? '').trim();
}

export function documentSessionLookupUrl({ autopilotUrl, towerService, workspaceId, documentId } = {}) {
  const base = normalizedAutopilotLaunchUrl(autopilotUrl);
  if (!base) throw new Error('Autopilot URL is unavailable.');
  if (!clean(towerService) || !clean(workspaceId) || !clean(documentId)) {
    throw new Error('Document session identity is incomplete.');
  }
  const url = new URL(`/api/document-bindings/${encodeURIComponent(clean(workspaceId))}/${encodeURIComponent(clean(documentId))}/sessions`, base);
  url.searchParams.set('tower_service', clean(towerService));
  return url;
}

export function normalizeDocumentSession(row = {}, autopilotUrl = '') {
  const sessionId = clean(row.session_id || row.sessionId || row.id);
  const openReference = clean(row.open_session_url || row.openSessionUrl || row.open_session_reference || row.openSessionRef);
  let openUrl = '';
  try {
    openUrl = openReference
      ? new URL(openReference, normalizedAutopilotLaunchUrl(autopilotUrl)).toString()
      : (sessionId ? new URL(`/live/${encodeURIComponent(sessionId)}`, normalizedAutopilotLaunchUrl(autopilotUrl)).toString() : '');
  } catch {
    openUrl = '';
  }
  return {
    sessionId,
    agentNpub: clean(row.agent_npub || row.agentNpub || row.agent?.npub),
    agentLabel: clean(row.agent_label || row.agentLabel || row.agent?.label || row.agent?.name),
    status: clean(row.lifecycle_status || row.status) || 'unknown',
    generation: Number.isFinite(Number(row.generation)) ? Number(row.generation) : 1,
    trigger: clean(row.trigger || row.trigger_type) || 'unknown',
    lastActivityAt: clean(row.last_activity_at || row.lastActivityAt || row.updated_at),
    queuedUpdates: Number.isFinite(Number(row.queued_updates ?? row.queued_count ?? row.queuedCount)) ? Number(row.queued_updates ?? row.queued_count ?? row.queuedCount) : 0,
    callbackOutcome: clean(row.callback_outcome || row.callbackOutcome || row.callback?.outcome) || 'pending',
    callbackError: clean(row.callback_error || row.callbackError || row.callback?.error),
    openUrl,
  };
}

export async function fetchDocumentAgentSessions(identity, { fetchImpl = fetch, authHeader = createNip98AuthHeader } = {}) {
  const lookupUrl = documentSessionLookupUrl(identity);
  const authorization = await authHeader(lookupUrl.toString(), 'GET', null);
  const response = await fetchImpl(lookupUrl, { headers: { Authorization: authorization } });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Autopilot document sessions failed (${response.status}).`);
  }
  const payload = await response.json();
  const rows = Array.isArray(payload?.sessions) ? payload.sessions : [];
  return rows.map((row) => normalizeDocumentSession(row, identity.autopilotUrl));
}

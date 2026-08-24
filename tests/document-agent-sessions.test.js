// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { canonicalDocumentAgentMentions } from '../src/document-agent-mentions.js';
import {
  documentSessionLookupUrl,
  fetchDocumentAgentSessions,
  normalizeDocumentSession,
} from '../src/document-agent-sessions.js';
import { mapPgDocCommentToLocal, mapPgDocToLocal } from '../src/pg-read-hydrator.js';

describe('document-bound agent sessions', () => {
  it('canonicalises stable agent mentions without duplicating person spellings', () => {
    expect(canonicalDocumentAgentMentions(
      '@[Test Agent](mention:agent:npub1testagent) and @[Test Agent](mention:person:npub1testagent)',
    )).toEqual([{ type: 'agent', npub: 'npub1testagent', label: 'Test Agent' }]);
  });

  it('preserves body and comment mention metadata through PG hydration', () => {
    const mentions = [{ type: 'agent', npub: 'npub1testagent', label: 'Test Agent' }];
    expect(mapPgDocToLocal({ id: 'doc-1', title: 'Doc', mentions }).pg_metadata.mentions).toEqual(mentions);
    expect(mapPgDocCommentToLocal({ id: 'comment-1', doc_id: 'doc-1', body: 'Hi', mentions }).pg_metadata.mentions).toEqual(mentions);
  });

  it('keys lookup strictly by Tower service, workspace, and document', () => {
    const url = documentSessionLookupUrl({
      autopilotUrl: 'https://wingman.example/app',
      towerService: 'npub1tower',
      workspaceId: 'workspace-1',
      documentId: 'doc-1',
    });
    expect(url.pathname).toBe('/api/document-bindings/workspace-1/doc-1/sessions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tower_service: 'npub1tower',
    });
  });

  it('normalizes lifecycle, queue, callback, and authorized open reference fields', () => {
    expect(normalizeDocumentSession({
      session_id: 'session-1',
      agent_npub: 'npub1testagent',
      lifecycle_status: 'running',
      generation: 3,
      trigger: 'document_comment_mention_added',
      last_activity_at: '2026-08-05T08:00:00.000Z',
      queued_count: 2,
      callback: { outcome: 'incomplete', error: 'Document update callback missing' },
      openSessionRef: '/live?session=session-1',
    }, 'https://wingman.example')).toMatchObject({
      sessionId: 'session-1',
      status: 'running',
      generation: 3,
      queuedUpdates: 2,
      callbackOutcome: 'incomplete',
      callbackError: 'Document update callback missing',
      openUrl: 'https://wingman.example/live?session=session-1',
    });
  });

  it('authenticates the Autopilot lookup and maps only returned binding rows', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [{ session_id: 'session-1' }] }) }));
    const authHeader = vi.fn(async () => 'Nostr signed');
    const rows = await fetchDocumentAgentSessions({
      autopilotUrl: 'https://wingman.example',
      towerService: 'tower',
      workspaceId: 'workspace',
      documentId: 'doc',
    }, { fetchImpl, authHeader });
    expect(rows).toHaveLength(1);
    expect(authHeader).toHaveBeenCalledWith(expect.stringContaining('/api/document-bindings/workspace/doc/sessions'), 'GET', null);
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), { headers: { Authorization: 'Nostr signed' } });
  });
});

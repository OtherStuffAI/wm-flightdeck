import { beforeEach, describe, expect, it } from 'vitest';
import {
  openWorkspaceDb,
  getSharedDb,
  upsertDirectory,
  upsertDocument,
  replacePgDocumentsForChannel,
  getDirectoriesByOwner,
  getDocumentsByOwner,
  upsertAddressBookPerson,
  getAddressBookPeople,
  getDocumentDraft,
  upsertDocumentDraft,
  deleteDocumentDraft,
} from '../src/db.js';

const TEST_OWNER = 'npub_test_workspace';

beforeEach(async () => {
  const wsDb = openWorkspaceDb(TEST_OWNER);
  await wsDb.open();
  await Promise.all(wsDb.tables.map((table) => table.clear()));
  const shared = getSharedDb();
  await shared.open();
  await Promise.all(shared.tables.map((table) => table.clear()));
});

describe('docs db operations', () => {
  it('stores directories and documents by owner', async () => {
    await upsertDirectory({
      record_id: 'dir-1',
      owner_npub: 'npub_owner',
      title: 'Projects',
      parent_directory_id: null,
      shares: [],
      group_ids: [],
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-03-12T00:00:00.000Z',
    });

    await upsertDocument({
      record_id: 'doc-1',
      owner_npub: 'npub_owner',
      title: 'Spec',
      content: 'hello',
      parent_directory_id: 'dir-1',
      shares: [],
      group_ids: [],
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-03-12T00:01:00.000Z',
    });

    const directories = await getDirectoriesByOwner('npub_owner');
    const documents = await getDocumentsByOwner('npub_owner');

    expect(directories).toHaveLength(1);
    expect(documents).toHaveLength(1);
    expect(documents[0].parent_directory_id).toBe('dir-1');
  });

  it('stores address book entries for share suggestions', async () => {
    await upsertAddressBookPerson({
      npub: 'npub_friend',
      label: 'Agent B',
      avatar_url: 'https://example.com/avatar.png',
      source: 'chat',
      last_used_at: '2026-03-12T00:00:00.000Z',
    });

    const people = await getAddressBookPeople('agent');
    expect(people).toHaveLength(1);
    expect(people[0].npub).toBe('npub_friend');
    expect(people[0].label).toBe('Agent B');
  });

  it('stores document drafts by exact workspace and document identity', async () => {
    await upsertDocumentDraft({
      workspace_id: 'workspace-1',
      document_id: 'doc-1',
      content: 'One word changed',
      title: 'Draft title',
      base_row_version: 7,
      base_version_id: 'doc-1:7',
      base_body_sha256_hex: 'a'.repeat(64),
      dirty_at: '2026-08-27T01:00:00.000Z',
    });

    expect(await getDocumentDraft('workspace-1', 'doc-1')).toMatchObject({
      draft_key: 'workspace-1:doc-1',
      content: 'One word changed',
      base_row_version: 7,
    });
    expect(await getDocumentDraft('workspace-2', 'doc-1')).toBeUndefined();
    expect(await getDocumentDraft('workspace-1', 'doc-2')).toBeUndefined();

    await deleteDocumentDraft('workspace-1', 'doc-1');
    expect(await getDocumentDraft('workspace-1', 'doc-1')).toBeUndefined();
  });

  it('keeps complete same-version accepted content through sparse PG collection replacement', async () => {
    const accepted = {
      record_id: 'doc-pg-1',
      owner_npub: 'npub_owner',
      title: 'Accepted document',
      content: 'Accepted body',
      content_blocks: [{ id: 'block-1', raw: 'Accepted body' }],
      editor_state: { type: 'doc', content: [] },
      pg_backend: true,
      pg_record_type: 'doc',
      pg_channel_id: 'channel-1',
      sync_status: 'synced',
      record_state: 'active',
      version: 5,
      content_storage_object_id: 'object-5',
      content_storage_status: 'remote',
      content_sha256_hex: 'a'.repeat(64),
      pg_canonical_version_id: 'doc-pg-1:5',
      pg_canonical_storage_object_id: 'object-5',
      pg_canonical_body_sha256_hex: 'a'.repeat(64),
    };
    await upsertDocument(accepted);

    await replacePgDocumentsForChannel('channel-1', [{
      ...accepted,
      content_blocks: [],
      editor_state: null,
      content_storage_status: 'remote',
      content_sha256_hex: null,
      pg_canonical_body_sha256_hex: null,
    }]);

    expect(await getDocumentsByOwner('npub_owner')).toEqual([
      expect.objectContaining({
        content: 'Accepted body',
        content_blocks: accepted.content_blocks,
        editor_state: accepted.editor_state,
        content_sha256_hex: 'a'.repeat(64),
        pg_canonical_body_sha256_hex: 'a'.repeat(64),
      }),
    ]);
  });
});

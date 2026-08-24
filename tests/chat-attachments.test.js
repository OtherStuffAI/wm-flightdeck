import { describe, expect, it } from 'vitest';
import {
  mergeChatStorageAttachments,
  standaloneChatFileAttachments,
  storageAttachmentsFromMarkdown,
} from '../src/chat-attachments.js';

describe('chat storage attachments', () => {
  it('extracts file and image attachment metadata from storage Markdown once per object', () => {
    const body = [
      '[Brief.pdf](storage://file-1)',
      '![Screenshot](storage://image-1)',
      '[Brief duplicate](storage://file-1)',
    ].join('\n');

    expect(storageAttachmentsFromMarkdown(body)).toEqual([
      { kind: 'file', storage_object_id: 'file-1', filename: 'Brief.pdf' },
      { kind: 'image', storage_object_id: 'image-1', filename: 'Screenshot' },
    ]);
  });

  it('preserves richer draft metadata and only adds missing body-linked objects', () => {
    const draftAttachment = {
      kind: 'file',
      storage_object_id: 'file-1',
      filename: 'Brief.pdf',
      content_type: 'application/pdf',
      size_bytes: 4096,
    };

    expect(mergeChatStorageAttachments(
      '[Brief.pdf](storage://file-1) and [Notes.txt](storage://file-2)',
      [draftAttachment],
    )).toEqual([
      draftAttachment,
      { kind: 'file', storage_object_id: 'file-2', filename: 'Notes.txt' },
    ]);
  });

  it('leaves body-linked files to the Markdown card and keeps standalone picker cards', () => {
    expect(standaloneChatFileAttachments({
      body: '[Brief.pdf](storage://file-1)',
      attachments: [
        { kind: 'file', storage_object_id: 'file-1', filename: 'Brief.pdf' },
        { kind: 'file', storage_object_id: 'file-2', filename: 'Notes.txt' },
      ],
    })).toEqual([
      { kind: 'file', storage_object_id: 'file-2', filename: 'Notes.txt' },
    ]);
  });
});

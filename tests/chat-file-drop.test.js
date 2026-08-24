import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(resolve('src/app.js'), 'utf8');
const indexSource = readFileSync(resolve('index.html'), 'utf8');

describe('chat file drop upload', () => {
  it('wires file drops on both chat composers', () => {
    expect(indexSource).toContain('@drop.prevent="$store.chat.handleChatFileDrop($event, \'message\')"');
    expect(indexSource).toContain('@drop.prevent="$store.chat.handleChatFileDrop($event, \'thread\')"');
  });

  it('uploads dropped files through chat attachment drafts', () => {
    expect(appSource).toContain('async handleChatFileDrop(event, context = \'message\')');
    expect(appSource).toContain('async prepareStorageObjectForCurrentWorkspace(body)');
    expect(appSource).toContain('prepareTowerPgStorageObject(workspaceId, body');
    expect(appSource).toContain('this.prepareStorageObjectForCurrentWorkspace(buildStoragePrepareBody');
    expect(appSource).toContain('uploadStorageObject(prepared, bytes');
    expect(appSource).toContain('completeStorageObject(prepared.object_id');
    expect(appSource).toContain('this.addChatFileDraft(file, context)');
  });

  it('wires accessible attachment pickers, draft controls, and persisted rendering for both composers', () => {
    expect(indexSource.match(/Attach photo or file/g)).toHaveLength(2);
    expect(indexSource.match(/type="file" multiple aria-label=/g)).toHaveLength(2);
    expect(indexSource).toContain("handleChatAttachmentSelection($event, 'message')");
    expect(indexSource).toContain("handleChatAttachmentSelection($event, 'thread')");
    expect(indexSource).toContain("uploadChatFileDraft(draft.draft_id, 'message')");
    expect(indexSource).toContain("removeChatFileDraft(draft.draft_id, 'thread')");
    expect(indexSource).toContain('chatAttachmentMarkdown(attachment)');
    expect(appSource).toContain("status: 'uploading'");
    expect(appSource).toContain("status: 'ready'");
    expect(appSource).toContain("status: 'error'");
  });

  it('blocks sending while a dropped file upload token is still present', () => {
    expect(appSource).toContain("text.includes('[ Uploading file... ]')");
  });

  it('uses the existing thread composer DOM for Deck create mode instead of a parallel composer', () => {
    expect(indexSource).not.toContain('class="doc-modal-card deck-thread-composer-modal"');
    expect(indexSource).toContain('x-show="$store.chat.activeThreadId || $store.chat.deckThreadComposerOpen"');
    expect(indexSource).toContain("@change=\"$store.chat.handleChatAttachmentSelection($event, 'thread'); open = false\"");
    expect(indexSource).toContain("$store.chat.deckThreadComposerOpen ? $store.chat.sendDeckThread() : $store.chat.sendThreadReply()");
    expect(indexSource.match(/data-chat-composer="thread"/g)).toHaveLength(2);
  });

  it('disables only the pending composer and exposes immediate sending labels', () => {
    expect(indexSource).toContain('$store.chat.composerSendPending.message ? \'Sending…\' : \'Send\'');
    expect(indexSource).toContain('$store.chat.composerSendPending.thread ? \'Sending…\' : \'Reply\'');
    expect(indexSource).toContain(':aria-busy="$store.chat.composerSendPending.message.toString()"');
    expect(indexSource).toContain(':aria-busy="($store.chat.deckThreadComposerBusy || $store.chat.composerSendPending.thread).toString()"');
  });
});

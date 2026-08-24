import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('document agent surfaces', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('src/app.js', 'utf8');
  const styles = fs.readFileSync('src/styles.css', 'utf8');

  it('reuses the document Review action and exposes associated sessions in its ellipsis menu', () => {
    expect(html).toContain(`openInvocationModal('document')`);
    expect(html).not.toContain('Send for agent review');
    expect(html).toContain('Associated Autopilot sessions');
    expect(app).toContain("trigger: 'full_document_review_requested'");
    expect(app).toContain('client_request_id: this.invocationClientRequestId');
  });

  it('uses mention-token composers for document comments and inline replies', () => {
    expect(html).toContain("initMentionComposer($el, 'doc-comment')");
    expect(html).toContain("initMentionComposer($el, 'doc-reply')");
    expect(html).toContain("syncMentionComposerModel($event.currentTarget)");
  });

  it('does not treat a document edit or captured final turn as a comment response', () => {
    const docsManager = fs.readFileSync('src/docs-manager.js', 'utf8');
    expect(app).not.toContain('captured_final_turn');
    expect(docsManager).toContain('parent_comment_id: root.record_id');
  });

  it('renders every document comment descendant at one common reply indentation', () => {
    expect(html).toContain('x-for="reply in $store.chat.getDocCommentReplies(root.record_id)"');
    expect(html).not.toContain('--doc-comment-reply-depth');
    expect(styles).toMatch(/\.doc-thread-entry-reply\s*\{[\s\S]*?margin-left:\s*1rem;/);
    expect(styles).not.toContain('var(--doc-comment-reply-depth');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('thread branch UI', () => {
  it('offers Branch from here on channel roots, thread parents, and replies', () => {
    expect(html.match(/Branch from here/g)).toHaveLength(3);
    expect(html).toContain('$store.chat.branchFromMessage(msg.record_id)');
    expect(html).toContain('$store.chat.branchFromMessage($store.chat.getThreadParentMessage()?.record_id)');
    expect(html).toContain('$store.chat.branchFromMessage(reply.record_id)');
  });

  it('labels inherited rows read-only without exposing an automatic recipient', () => {
    expect(html).toContain('Inherited · read-only');
    expect(html).not.toContain('First message starts a fresh Agent Direct session with');
    expect(html).not.toContain('thread-branch-recipient');
  });
});

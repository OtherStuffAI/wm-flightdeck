import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const sidebarNav = html.match(/<ul class="sidebar-nav">([\s\S]*?)<\/ul>/)?.[1] ?? '';

describe('sidebar unread indicators', () => {
  it('does not render unread dots on top-level navigation entries', () => {
    expect(sidebarNav).not.toContain('class="unread-dot"');
    expect(sidebarNav).not.toContain('unreadDeck');
    expect(sidebarNav).not.toContain('unreadChat');
    expect(sidebarNav).not.toContain('unreadTasks');
    expect(sidebarNav).not.toContain('unreadDocs');
    expect(styles).not.toContain('.unread-dot:not(.unread-dot-channel)');
  });

  it('preserves channel unread dots in desktop, narrow, and expanded-sidebar channel rows', () => {
    expect(html.match(/class="unread-dot unread-dot-channel"/g)).toHaveLength(3);
    expect(html.match(/x-show="\$store\.chat\.isChannelUnread\([^)]*\)"/g)).toHaveLength(3);
    expect(html).toContain("'sidebar-scope-channel-unread': $store.chat.isChannelUnread(channel.record_id)");
    expect(styles).toContain('.unread-dot-channel');
  });
});

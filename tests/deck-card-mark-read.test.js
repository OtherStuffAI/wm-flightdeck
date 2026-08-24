import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { unreadStoreMixin } from '../src/unread-store.js';

const INDEX_PATH = resolve(process.cwd(), 'index.html');
const STYLES_PATH = resolve(process.cwd(), 'src/styles.css');

describe('Deck card Mark read action', () => {
  it('renders independently focusable actions only for unread chat, task, and document cards', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    const summary = html.slice(
      html.indexOf('data-testid="flightdeck-summary-inbox"'),
      html.indexOf('data-testid="flightdeck-summary-files"'),
    );
    const actions = summary.match(/<button type="button" class="attention-card-mark-read"[^>]*>Mark read<\/button>/g) || [];

    expect(actions).toHaveLength(6);
    expect(actions.every((action) => action.includes('data-deck-card-action'))).toBe(true);
    expect(actions.every((action) => action.includes('x-show=') && action.includes('.isUnread'))).toBe(true);
    expect(actions.every((action) => action.includes('@click.stop.prevent='))).toBe(true);
    expect(actions.every((action) => action.includes('@keydown.enter.stop') && action.includes('@keydown.space.stop'))).toBe(true);
    expect(actions.filter((action) => action.includes("markDeckResourceRead('thread'"))).toHaveLength(2);
    expect(actions.filter((action) => action.includes("markDeckResourceRead('task'"))).toHaveLength(2);
    expect(actions.filter((action) => action.includes("markDeckResourceRead('document'"))).toHaveLength(2);

    const fileCard = summary.slice(
      summary.indexOf("item.inboxKind === 'file'"),
      summary.indexOf('data-testid="deck-recent-channels"'),
    );
    expect(fileCard).not.toContain('attention-card-mark-read');
  });

  it('keeps card keyboard opening guarded while retaining the normal Open affordances', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    const inbox = html.slice(
      html.indexOf('data-testid="flightdeck-summary-inbox"'),
      html.indexOf('data-testid="deck-recent-channels"'),
    );

    expect(inbox.match(/@keydown\.enter\.prevent="if \(\$store\.chat\.shouldOpenDeckCard\(\$event\)\)/g)).toHaveLength(3);
    expect(inbox.match(/@keydown\.space\.prevent="if \(\$store\.chat\.shouldOpenDeckCard\(\$event\)\)/g)).toHaveLength(3);
    expect(inbox).toContain('<span class="attention-card-action">Open chat</span>');
    expect(inbox).toContain('<span class="attention-card-action">Open task</span>');
    expect(inbox).toContain('<span class="attention-card-action">Open doc</span>');
  });

  it('uses a compact focus-visible control and permits narrow metadata wrapping', () => {
    const styles = readFileSync(STYLES_PATH, 'utf8');

    expect(styles).toMatch(/\.attention-card-mark-read\s*\{[^}]*min-height:\s*1\.7rem;[^}]*font-size:\s*0\.7rem;[^}]*white-space:\s*nowrap;/s);
    expect(styles).toMatch(/\.attention-card-mark-read:focus-visible\s*\{[^}]*outline:\s*2px solid #2563eb;/s);
    expect(styles).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.attention-card-meta\s*\{[^}]*flex-wrap:\s*wrap;/s);
  });

  it('dispatches each supported family to exactly one focused read helper', async () => {
    const store = {
      markThreadRead: vi.fn(async () => 'thread'),
      markTaskRead: vi.fn(async () => 'task'),
      markDocRead: vi.fn(async () => 'document'),
    };

    await expect(unreadStoreMixin.markDeckResourceRead.call(store, 'thread', 'thread-1', 'channel-1')).resolves.toBe('thread');
    await expect(unreadStoreMixin.markDeckResourceRead.call(store, 'task', 'task-1')).resolves.toBe('task');
    await expect(unreadStoreMixin.markDeckResourceRead.call(store, 'document', 'doc-1')).resolves.toBe('document');
    await expect(unreadStoreMixin.markDeckResourceRead.call(store, 'file', 'file-1')).resolves.toBe(false);

    expect(store.markThreadRead).toHaveBeenCalledOnce();
    expect(store.markThreadRead).toHaveBeenCalledWith('thread-1', 'channel-1');
    expect(store.markTaskRead).toHaveBeenCalledOnce();
    expect(store.markTaskRead).toHaveBeenCalledWith('task-1');
    expect(store.markDocRead).toHaveBeenCalledOnce();
    expect(store.markDocRead).toHaveBeenCalledWith('doc-1');
  });

  it('marks one Tower thread through resource view state and preserves the legacy channel fallback', async () => {
    const towerStore = {
      isTowerPgMode: true,
      currentWorkspace: { pgBackendMode: true },
      markTowerPgResourceViewed: vi.fn(async () => true),
      markChannelRead: vi.fn(),
    };
    await expect(unreadStoreMixin.markThreadRead.call(towerStore, 'thread-1', 'channel-1')).resolves.toBe(true);
    expect(towerStore.markTowerPgResourceViewed).toHaveBeenCalledWith('thread', 'thread-1');
    expect(towerStore.markChannelRead).not.toHaveBeenCalled();

    const legacyStore = {
      isTowerPgMode: false,
      currentWorkspace: { pgBackendMode: false },
      markChannelRead: vi.fn(async () => undefined),
    };
    await expect(unreadStoreMixin.markThreadRead.call(legacyStore, 'thread-1', 'channel-1')).resolves.toBe(true);
    expect(legacyStore.markChannelRead).toHaveBeenCalledWith('channel-1');
  });
});

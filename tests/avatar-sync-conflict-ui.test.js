import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const unreadStore = readFileSync(new URL('../src/unread-store.js', import.meta.url), 'utf8');

describe('avatar sync conflict UI', () => {
  it('keeps local file clashes in the avatar menu instead of the main conflict banner', () => {
    expect(html).toContain('class="avatar-sync-conflict" x-show="$store.chat.avatarSyncConflictCount > 0"');
    expect(html).toContain('useTowerForAvatarSyncConflicts()');
    expect(html).toContain('dismissAvatarSyncConflicts()');
    expect(html).toContain('Tower will overwrite the older local file metadata');
    expect(html).not.toContain('x-show="$store.chat.recordSyncConflictCount > 0"');
    expect(html).not.toContain('local changes need review');
    expect(html).not.toContain('acceptRecordSyncRemoteConflict(conflict.key)');
    expect(html).not.toContain('x-show="$store.chat.avatarSyncConflictCount > 0" x-cloak>\n          <summary');
    expect(css).toContain('.avatar-sync-conflict');
    expect(app).toContain('avatarSyncConflictCount: 0');
    expect(unreadStore).toContain('this.recordSyncConflicts = projection.conflicts || [];');
    expect(unreadStore).toContain('this.avatarSyncConflicts = projection.avatarSyncConflicts || [];');
  });
});

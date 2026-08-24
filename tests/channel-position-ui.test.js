import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const template = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'index.html'), 'utf8');

describe('channel position settings UI', () => {
  it('shows the 1-based control only through the existing channel manage permission', () => {
    expect(template).toContain('x-show="$store.chat.isTowerPgMode && $store.chat.canReorderSelectedChannel" data-testid="channel-position-panel"');
    expect(template).toContain('x-model="$store.chat.channelSettingsPosition"');
    expect(template).toContain(':max="$store.chat.selectedChannelScopeOrderedChannels.length"');
    expect(template).toContain('@click="$store.chat.moveSelectedChannelToPosition()"');
    expect(template).toContain('aria-label="Move channel to position"');
  });

  it('gates PG drag handles through the same reorder permission path', () => {
    expect(template).toContain(':draggable="!$store.chat.isTowerPgMode || $store.chat.canReorderChannel(channel)"');
    expect(template).toContain(':draggable="!$store.chat.isTowerPgMode || $store.chat.canReorderChannel(ch)"');
    expect(template).toContain("'chat-channel-tab-drop-target': $store.chat.channelDragTargetId === channel.record_id");
  });
});

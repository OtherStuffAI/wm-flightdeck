import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('shared avatar image fallback templates', () => {
  it('wires main chat, thread, task comment, and document comment images to the shared error handler', () => {
    const requiredSurfaceImages = [
      '<img class="chat-post-avatar" :src="$store.chat.getSenderAvatar(msg.sender_npub)" alt="" @error="$store.chat.handleAvatarImageError($event)" />',
      '<img class="thread-avatar" :src="$store.chat.getSenderAvatar(reply.sender_npub)" alt="" @error="$store.chat.handleAvatarImageError($event)" />',
      '<img class="task-comment-avatar" :src="$store.chat.getSenderAvatar(comment.sender_npub)" alt="" @error="$store.chat.handleAvatarImageError($event)" />',
      '<img class="doc-comment-avatar" :src="$store.chat.getSenderAvatar(root.sender_npub)" alt="" @error="$store.chat.handleAvatarImageError($event)" />',
    ];

    for (const image of requiredSurfaceImages) expect(html).toContain(image);
  });

  it('makes every user or agent avatar image decorative and error-aware', () => {
    const identityAvatarImages = [...html.matchAll(
      /<img\b[^>]*:src="(?:\$store\.chat\.(?:getSenderAvatar\([^\"]*\)|identityCardProfile\.avatarUrl|avatarUrl|getDocShareAvatar\([^\"]*\))|person\.avatarUrl|suggestion\.avatarUrl)"[^>]*>/g,
    )].map((match) => match[0]);

    expect(identityAvatarImages.length).toBeGreaterThan(30);
    for (const image of identityAvatarImages) {
      expect(image).toContain('alt=""');
      expect(image).toContain('@error="$store.chat.handleAvatarImageError($event)"');
    }
  });

  it('uses the same failed-URL state for cached suggestion and mention-chip fallbacks', () => {
    expect(html).toContain('x-if="$store.chat.canRenderAvatarImage(person.avatarUrl)"');
    expect(html).toContain('x-if="!$store.chat.canRenderAvatarImage(person.avatarUrl)"');
    expect(html).toContain('x-show="$store.chat.canRenderAvatarImage(person.avatarUrl)"');
    expect(html).toContain('x-show="!$store.chat.canRenderAvatarImage(person.avatarUrl)"');
    expect(html).toContain("suggestion.type === 'person' && $store.chat.canRenderAvatarImage(suggestion.avatarUrl)");
    expect(html).toContain("suggestion.type === 'person' && !$store.chat.canRenderAvatarImage(suggestion.avatarUrl)");
  });

  it('does not expose broken avatar alternate text', () => {
    expect(html).not.toContain('alt="Profile picture"');
    expect(html).not.toContain('alt="Your profile picture"');
  });
});

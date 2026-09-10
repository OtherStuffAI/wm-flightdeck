// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import Alpine from 'alpinejs';
import { createShellState } from '../src/shell-state.js';

describe('view lock composer reactivity', () => {
  it('does not invalidate navigation effects when composer text changes', async () => {
    const store = Alpine.reactive(createShellState({ initialSection: 'chat' }));
    store.navCollapsed = false;
    store.toggleCurrentViewLock();
    let navigationRuns = 0;
    const runner = Alpine.effect(() => {
      void store.navSection;
      void store.isCurrentViewLocked;
      navigationRuns += 1;
    });
    try {
      for (let index = 0; index < 200; index += 1) {
        store.messageInput = `message ${index}`;
        store.threadInput = `reply ${index}`;
        store.navSection = 'chat';
      }
      await Promise.resolve();
      expect(navigationRuns).toBe(1);
      expect(store.isCurrentViewLocked).toBe(true);
      store.navSection = 'tasks';
      expect(store.lockedView).toBeNull();
      await Promise.resolve();
      expect(navigationRuns).toBeGreaterThan(1);
    } finally {
      Alpine.release(runner);
    }
  });
});

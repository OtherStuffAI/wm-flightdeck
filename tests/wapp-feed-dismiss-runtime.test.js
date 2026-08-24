// @vitest-environment jsdom

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Alpine from 'alpinejs';
import { wappPublishingManagerMixin } from '../src/wapp-publishing-manager.js';

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createRuntimeStore(items, updateUserState = vi.fn(async () => true)) {
  const store = Object.create(wappPublishingManagerMixin);
  Object.assign(store, {
    wappActivityItems: items,
    wappActivityCounts: { unread: items.filter((item) => item.unread).length },
    wappActivityFilterUnread: false,
    wappActivityFilterSource: '',
    wappActivityFilterCategory: '',
    wappActivityFilterChannel: '',
    wappActivityDismissAllBusy: false,
    wappActivityDismissNotice: '',
    wappActivityError: '',
  });
  store.updateWappActivityUserState = updateUserState;
  return store;
}

function mountFeed() {
  document.body.innerHTML = `
    <main x-data>
      <span class="outstanding" x-text="$store.chat.wappActivityUnreadCount"></span>
      <div class="cards">
        <template x-for="item in $store.chat.filteredWappActivityItems" :key="item.record_id">
          <article class="card" @click="window.feedCardOpened(item.record_id)">
            <span x-text="item.title"></span>
            <button class="dismiss" type="button" :aria-label="\`Dismiss \${item.title}\`" @click.stop.prevent="$store.chat.dismissWappActivity(item)">×</button>
          </article>
        </template>
      </div>
      <button class="dismiss-all" type="button" @click="$store.chat.dismissAllWappActivity()">Dismiss all</button>
    </main>`;
  Alpine.initTree(document.body);
}

describe('mounted Alpine Feed dismiss controls', () => {
  beforeAll(() => {
    globalThis.Alpine = Alpine;
    Alpine.start();
  });

  afterAll(() => {
    document.body.innerHTML = '';
    delete globalThis.Alpine;
  });

  it('handles real single and bulk clicks through the mounted store without card propagation', async () => {
    const store = createRuntimeStore([
      { record_id: 'one', title: 'One', unread: true },
      { record_id: 'two', title: 'Two', unread: true },
    ]);
    Alpine.store('chat', store);
    const opened = vi.fn();
    globalThis.feedCardOpened = opened;
    mountFeed();
    await tick();

    expect(document.querySelectorAll('.card')).toHaveLength(2);
    expect(document.querySelector('.outstanding').textContent).toBe('2');
    expect(document.querySelector('.dismiss').getAttribute('aria-label')).toBe('Dismiss One');
    document.querySelector('.dismiss').click();
    await tick();

    expect(opened).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.card')).toHaveLength(1);
    expect(document.querySelector('.card').textContent).toContain('Two');
    expect(document.querySelector('.outstanding').textContent).toBe('1');

    document.querySelector('.dismiss-all').click();
    await tick();

    expect(document.querySelectorAll('.card')).toHaveLength(0);
    expect(document.querySelector('.outstanding').textContent).toBe('0');
    expect(store.updateWappActivityUserState).toHaveBeenCalledTimes(2);
    delete globalThis.feedCardOpened;
  });

  it('restores the rendered card and outstanding amount when persistence fails', async () => {
    let finishPersistence;
    const updateUserState = vi.fn(() => new Promise((resolve) => {
      finishPersistence = resolve;
    }));
    const store = createRuntimeStore([
      { record_id: 'one', title: 'One', unread: true },
    ], updateUserState);
    Alpine.store('chat', store);
    globalThis.feedCardOpened = vi.fn();
    mountFeed();
    await tick();

    document.querySelector('.dismiss').click();
    await tick();
    expect(document.querySelectorAll('.card')).toHaveLength(0);
    expect(document.querySelector('.outstanding').textContent).toBe('0');

    finishPersistence(false);
    await tick();
    expect(document.querySelectorAll('.card')).toHaveLength(1);
    expect(document.querySelector('.outstanding').textContent).toBe('1');
    expect(store.wappActivityDismissNotice).toContain('restored');
    delete globalThis.feedCardOpened;
  });
});

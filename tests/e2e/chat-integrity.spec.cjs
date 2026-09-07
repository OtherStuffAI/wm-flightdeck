const { test, expect } = require('playwright/test');

// Browser presentation smoke; canonical transport ordering is covered with real
// Dexie transactions in pg-record-delta and chat-message-manager unit suites.
test('renders one authored root with cached history metadata and refreshes the mention menu', async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.Alpine?.store?.('chat')));
  await page.evaluate(() => {
    const s = window.Alpine.store('chat');
    s.startWorkspaceLiveQueries = () => {};
    s.syncRoute = () => {};
    s.scheduleStorageImageHydration = () => {};
    s.session = { npub: 'npub1testviewer' };
    s.navSection = 'chat';
    s.channels = [{ record_id: 'test-channel', title: 'Chat integrity', record_state: 'active' }];
    s.selectedChannelId = 'test-channel';
    s.pgContextSelectedChannelId = 'test-channel';
    s.messages = [
      { record_id: 'source', channel_id: 'test-channel', parent_message_id: null, pg_record_type: 'message', pg_thread_id: 'test-thread', body: 'Authored integrity source', sender_npub: 'npub1testviewer', sync_status: 'synced', record_state: 'active', updated_at: '2026-09-07T01:00:00Z' },
      { record_id: 'test-thread', channel_id: 'test-channel', parent_message_id: null, pg_record_type: 'thread', pg_thread_id: 'test-thread', pg_source_message_id: 'source', pg_effective_message_ids: ['source'], body: 'Phantom summary title', sync_status: 'synced', record_state: 'active', updated_at: '2026-09-07T02:00:00Z' },
    ];
    s.pgWorkspaceMembers = [];
  });
  await expect(page.locator('[data-message-id="source"]')).toBeVisible();
  await expect(page.locator('[data-message-id="test-thread"]')).toHaveCount(0);
  const composer = page.locator('[data-chat-composer="message"]:visible');
  await composer.fill('@Current');
  await page.evaluate(() => {
    const s = window.Alpine.store('chat');
    s.pgWorkspaceMembers = [{ actor_id: 'current-agent', npub: 'npub1currentagent', kind: 'agent', display_name: 'Current Agent' }];
    s.refreshActiveMentionResults();
  });
  await expect.poll(() => page.evaluate(() => window.Alpine.store('chat').mentionResults.map(row => row.label))).toContain('Current Agent');
  await page.evaluate(() => {
    const s = window.Alpine.store('chat');
    s.pgBackendMode = true;
    s.pgWorkspaceMembers = [];
    s.refreshActiveMentionResults();
  });
  await expect.poll(() => page.evaluate(() => window.Alpine.store('chat').mentionResults.map(row => row.label))).not.toContain('Current Agent');
});

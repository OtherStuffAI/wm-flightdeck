const { test, expect } = require('playwright/test');

async function blockExternalRequests(page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
}

async function seedAgentSpace(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.Alpine?.store?.('chat')));
  await page.evaluate(() => {
    const store = window.Alpine.store('chat');
    store.session = { npub: 'npub1operator' };
    store.currentWorkspaceKey = 'agent-space-workspace';
    store.workspaceOwnerNpub = 'npub1owner';
    store.currentWorkspace = { workspaceId: 'workspace-agent-space', workspaceKey: 'agent-space-workspace', pgBackendMode: true };
    store.startWorkspaceLiveQueries = () => {};
    store.ensureBackgroundSync = () => {};
    store.syncRoute = () => {};
    store.agentConnections = [{
      id: 'connection-one', installation_id: 'installation-one', fips_transport_npub: 'npub1transport',
      fips_endpoint: 'http://npub1transport.fips:3601', https_endpoint: 'https://autopilot.example',
      metadata: { installation_npub: 'npub1installation', health_path: '/health', agents_path: '/agents' }, capabilities: [], api_version: '1',
    }];
    store.workspaceAgents = [
      { id: 'installed-alpha', connection_id: 'connection-one', agent_id: 'agent-alpha', agent_npub: 'npub1alpha', display_name: 'Alpha', is_visible: true, metadata: { description: 'First installed agent', can_instruct: true } },
      { id: 'installed-beta', connection_id: 'connection-one', agent_id: 'agent-beta', agent_npub: 'npub1beta', display_name: 'Beta', is_visible: true, metadata: { description: 'Second installed agent', can_instruct: false } },
    ];
    store.loadSelectedAgentSpaceView = async function loadSelectedAgentSpaceView() {
      this.agentSpaceLoading = false; this.agentSpaceError = '';
      this.agentSpaceData = this.agentSpaceView === 'overview'
        ? { agent_id: this.selectedWorkspaceAgent.agent_id, enabled: true, archived: false, capabilities: ['chat.read'] }
        : this.agentSpaceView === 'pipelines'
          ? { availabilityMode: 'explicit', defaultMode: 'implicit_library', definitions: [{ id: 'shared:one', name: 'Shared one', description: 'Reusable', assigned: true, default: true, overrides: [{ kind: 'channel', contextId: 'channel-one' }], missing: false }], missing: [] }
          : [];
    };
    store.openAgentSpace('installed-alpha');
  });
}

test.beforeEach(async ({ page }) => blockExternalRequests(page));

test('shows two stable agents from one installation and read-only Agent Space data', async ({ page }) => {
  await seedAgentSpace(page);
  await expect(page.getByTestId('agent-space')).toBeVisible();
  await expect(page.locator('.agent-space-card')).toHaveCount(2);
  await expect(page.locator('.agent-space-card').first()).toContainText('Alpha');
  await expect(page.locator('.agent-space-detail')).toContainText('Can receive instructions');

  await page.locator('.agent-space-card').nth(1).click();
  await expect(page.locator('.agent-space-detail h1')).toHaveText('Beta');
  await expect(page.locator('.agent-space-detail')).toContainText('Read-only');
  await page.getByRole('button', { name: 'Pipelines' }).click();
  await expect(page.locator('.agent-space-detail')).toContainText('Shared one');
  await expect(page.locator('.agent-space-detail')).toContainText('channel: channel-one');
  await expect(page.getByRole('link', { name: 'Open in Autopilot' })).toHaveAttribute('href', 'https://autopilot.example');
});

test('keeps Agent Space usable at Peekaboo mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAgentSpace(page);
  await expect(page.getByTestId('agent-space')).toBeVisible();
  await expect(page.locator('.agent-space-list')).toBeVisible();
  await page.locator('.agent-space-card').nth(1).click();
  await expect(page.locator('.agent-space-detail h1')).toHaveText('Beta');
});

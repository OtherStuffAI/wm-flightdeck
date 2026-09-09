const { test, expect } = require('playwright/test');

// Synthetic browser UI proof against the configured managed runtime. No signer,
// real workspace, mesh traffic or external backend is used by this test.
test('Connection renders the switch and rejects the screenshot mesh override', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  await page.goto('/');
  await page.waitForFunction(() => window.Alpine?.store('chat'));
  await page.evaluate(() => {
    const store = Alpine.store('chat');
    store.session = { npub: 'npub1fixture' };
    store.backendUrl = 'https://node.fips:43100';
    store.superbasedTokenInput = 'http://node.fips:43100';
    Object.defineProperty(store, 'currentWorkspace', { configurable: true, get: () => ({
      workspaceId: 'fixture-workspace', directHttpsUrl: 'https://tower.example',
    }) });
    store.navSection = 'settings';
    store.settingsTab = 'connection';
  });
  const panel = page.locator('.tower-transport-settings');
  const publicButton = panel.getByRole('button', { name: 'Public HTTPS', exact: true });
  const fipsButton = panel.getByRole('button', { name: 'FIPS', exact: true });
  await expect(publicButton).toBeVisible();
  await expect(fipsButton).toBeVisible();
  await expect(panel.getByText('A FIPS address is in the HTTP backend override.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Apply and reload' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Restore workspace Tower: https://tower.example' })).toBeVisible();
  await expect(page.locator('.cvm-toggle')).toBeHidden();
  await fipsButton.click();
  await expect(fipsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByLabel('Manual Tower FIPS endpoint')).toHaveValue('http://node.fips:43100');
  await expect(panel.getByText('FIPS is unavailable in this client.', { exact: false })).toBeVisible();
  await page.screenshot({ path: '/tmp/fips-switch-rendered.png', fullPage: false });

  // Equivalent to a clean workspace after explicit recovery, without changing
  // any real browser storage or exercising a synthetic Tower over the network.
  await page.evaluate(() => {
    const store = Alpine.store('chat');
    store.backendUrl = 'https://tower.example';
    store.backendOverrideDraft = 'https://tower.example';
    store.superbasedTokenInput = '';
  });
  await fipsButton.click();
  await panel.getByRole('button', { name: 'Apply and reload' }).click();
  await expect(panel.getByRole('alert').filter({ hasText: 'FIPS requires WMapp' })).toBeVisible();
  await publicButton.click();
  await expect(publicButton).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByLabel('Manual Tower FIPS endpoint')).toBeHidden();
  await expect(page.getByLabel('HTTP backend override')).toHaveAttribute('readonly', 'readonly');
  await expect(page.getByText('Tower PG uses the verified workspace descriptor;', { exact: false })).toBeVisible();
  await page.evaluate(() => { Alpine.store('chat').backendOverrideDraft = 'http://node.fips:43100'; });
  expect(await page.evaluate(() => Alpine.store('chat').backendUrl)).toBe('https://tower.example');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByText('A FIPS address is not a connection key or HTTP backend override.', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await publicButton.scrollIntoViewIfNeeded();
  await expect(publicButton).toBeVisible();
  await expect(fipsButton).toBeVisible();
  const boxes = await Promise.all([publicButton.boundingBox(), fipsButton.boundingBox()]);
  for (const box of boxes) expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/fips-switch-mobile.png' });
});

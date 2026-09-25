const { test, expect } = require('playwright/test');

async function openConnectedShell(page, viewport) {
  await page.setViewportSize(viewport);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.Alpine?.store?.('chat')));
  await page.evaluate(() => {
    const store = window.Alpine.store('chat');
    store.session = { npub: 'npub1connectionfixture' };
    store.sseStatus = 'connected';
    store.towerReachabilityState = 'online';
    store.towerReachabilityReason = 'sse-connected';
  });
}

test('connected mobile viewport does not render the reconnect indicator', async ({ page }) => {
  await openConnectedShell(page, { width: 390, height: 844 });

  await expect(page.getByTestId('tower-connection-indicator')).toHaveCount(0);
});

test('reconnecting mobile viewport renders the intended feedback', async ({ page }) => {
  await openConnectedShell(page, { width: 390, height: 844 });
  await page.evaluate(() => {
    const store = window.Alpine.store('chat');
    store.sseStatus = 'reconnecting';
    store.towerReachabilityState = 'reconnecting';
    store.towerReachabilityReason = 'sse-reconnecting';
  });

  const indicator = page.getByTestId('tower-connection-indicator');
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveText('Reconnecting');
  await expect(indicator).toHaveAttribute('data-state', 'reconnecting');
});

test('connected desktop viewport keeps the reconnect indicator hidden', async ({ page }) => {
  await openConnectedShell(page, { width: 1280, height: 820 });

  await expect(page.getByTestId('tower-connection-indicator')).toHaveCount(0);
});

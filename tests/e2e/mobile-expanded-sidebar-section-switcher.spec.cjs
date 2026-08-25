const { test, expect } = require('playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const sourceStyles = readFileSync(path.join(repoRoot, 'src/styles.css'), 'utf8');

function sourceRule(selector) {
  const start = sourceStyles.indexOf(selector);
  if (start < 0) throw new Error(`Missing source CSS rule: ${selector}`);
  const end = sourceStyles.indexOf('}', start);
  return sourceStyles.slice(start, end + 1);
}

const renderedStyles = [
  ':root { --border: #e2e8f0; --muted: #64748b; --text: #0f172a; --radius-sm: 8px; --app-edge-gutter: 8px; }',
  '* { box-sizing: border-box; }',
  'html, body { width: 100%; height: 100%; margin: 0; font-family: Arial, sans-serif; color: var(--text); }',
  sourceRule('.app-shell {'),
  sourceRule('.page-header {'),
  sourceRule('.header-leading {'),
  sourceRule('.mobile-menu-btn {'),
  sourceRule('.app-layout {'),
  sourceRule('.sidebar {'),
  sourceRule('.sidebar-nav {'),
  sourceRule('.sidebar-scope-navigation {'),
  sourceRule('.sidebar-workspace-navigation-divider {'),
  sourceRule('.sidebar-workspace-overview {'),
  sourceRule('.sidebar-scope-group + .sidebar-scope-group {'),
  sourceRule('.sidebar-scope-heading {'),
  sourceRule('.sidebar-scope-heading-control {'),
  sourceRule('.sidebar-scope-channel-list {'),
  sourceRule('.sidebar-scope-channel-row {'),
  sourceRule('.sidebar-scope-channel {'),
  sourceRule('.main-content {'),
  sourceRule('.pg-work-context-bar,\n.global-pg-channel-bar {'),
  sourceRule('.global-pg-channel-bar {'),
  sourceRule('.chat-channel-header {'),
  sourceRule('.expanded-sidebar-section-switcher {'),
  sourceRule('.expanded-sidebar-section-switcher-btn {'),
  sourceRule('.expanded-sidebar-section-switcher-btn-active {'),
  sourceRule('.expanded-sidebar-section-switcher-btn-mobile-only {'),
  sourceRule('.chat-channel-header-actions {'),
  sourceRule('.chat-channel-header-icon-btn {'),
  '@media (max-width: 768px) { .expanded-sidebar-section-switcher-btn-mobile-only { display: inline-flex; } }',
  '.content-scroll-area { flex: 1; padding: 1rem; overflow: hidden; }',
  '.status-section h1 { margin: 0.25rem 0 1.5rem; font-size: 1.5rem; }',
  '.visual-panels { display: grid; grid-template-columns: 2fr 1fr; gap: 0.75rem; }',
  '.visual-panel { height: 190px; padding: 0.75rem; border: 1px solid var(--border); border-radius: 12px; }',
].join('\n');

test('rendered narrow expanded composition matches the corrective layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 720, height: 440 });
  await page.setContent(`<!doctype html><html><head><style>${renderedStyles}</style></head><body>
    <main class="app-shell">
      <header class="page-header">
        <div class="header-leading"><button class="mobile-menu-btn" aria-label="Toggle navigation">☰</button><strong>Wingman</strong></div>
        <button aria-label="Profile">PW</button>
      </header>
      <div class="app-layout">
        <nav class="sidebar" aria-label="Expanded left column">
          <ul class="sidebar-nav" style="display:none" aria-label="Section navigation"><li>Flight Deck</li><li>Chat</li><li>Tasks</li><li>Docs</li><li>Files</li><li>Setup</li></ul>
          <hr class="sidebar-workspace-navigation-divider" />
          <section class="sidebar-scope-navigation" aria-label="Workspace scopes and channels">
            <button class="sidebar-workspace-overview">Home</button>
            <section class="sidebar-scope-group"><h2 class="sidebar-scope-heading"><button class="sidebar-scope-heading-control">Dev Ops</button></h2><div class="sidebar-scope-channel-list"><div class="sidebar-scope-channel-row"><button class="sidebar-scope-channel"># Mini</button></div><div class="sidebar-scope-channel-row"><button class="sidebar-scope-channel"># Servers</button></div></div></section>
            <section class="sidebar-scope-group"><h2 class="sidebar-scope-heading"><button class="sidebar-scope-heading-control">Wingman Suite</button></h2><div class="sidebar-scope-channel-list"><div class="sidebar-scope-channel-row"><button class="sidebar-scope-channel"># Flight Deck</button></div></div></section>
          </section>
        </nav>
        <div class="main-content">
          <div class="global-pg-channel-bar global-pg-channel-bar-sidebar-expanded">
            <div class="chat-channel-header">
              <nav class="expanded-sidebar-section-switcher" aria-label="Flight Deck sections">
                <button class="expanded-sidebar-section-switcher-btn expanded-sidebar-section-switcher-btn-active" aria-current="page">Deck</button>
                <button class="expanded-sidebar-section-switcher-btn">Chat</button>
                <button class="expanded-sidebar-section-switcher-btn">Tasks</button>
                <button class="expanded-sidebar-section-switcher-btn">Docs</button>
                <button class="expanded-sidebar-section-switcher-btn">Files</button>
                <button class="expanded-sidebar-section-switcher-btn expanded-sidebar-section-switcher-btn-mobile-only">Setup</button>
              </nav>
              <div class="chat-channel-header-actions"><button class="chat-channel-header-icon-btn" aria-label="Full screen">↗</button></div>
            </div>
          </div>
          <div class="content-scroll-area"><section class="status-section"><h1>Welcome Wingman User,<br>where will we focus today?</h1><div class="visual-panels"><div class="visual-panel"><h2>Inbox</h2></div><div class="visual-panel"><h2>Feed</h2></div></div></section></div>
        </div>
      </div>
    </main>
  </body></html>`);

  const sidebar = page.locator('.sidebar');
  const topBar = page.locator('.global-pg-channel-bar');
  const topSections = topBar.locator('.expanded-sidebar-section-switcher');
  const fullScreen = topBar.getByRole('button', { name: 'Full screen' });

  await expect(sidebar.locator('.sidebar-nav')).toBeHidden();
  await expect(sidebar.locator('.sidebar-scope-navigation')).toBeVisible();
  await expect(topSections).toHaveCount(1);
  await expect(topSections.locator('.expanded-sidebar-section-switcher-btn')).toHaveCount(6);
  await expect(topSections.locator('.expanded-sidebar-section-switcher-btn')).toHaveText(['Deck', 'Chat', 'Tasks', 'Docs', 'Files', 'Setup']);
  await expect(fullScreen).toBeVisible();

  const setup = topSections.getByRole('button', { name: 'Setup' });
  await expect(setup).toBeVisible();
  await setup.scrollIntoViewIfNeeded();
  await expect(setup).toBeInViewport();

  const touchTargets = await topSections.locator('.expanded-sidebar-section-switcher-btn').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(touchTargets.every((height) => height >= 44)).toBe(true);

  const overflow = await topSections.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);

  const [sidebarBox, scopeBox, topBarBox, switcherBox, fullScreenBox] = await Promise.all([
    sidebar.boundingBox(),
    sidebar.locator('.sidebar-scope-navigation').boundingBox(),
    topBar.boundingBox(),
    topSections.boundingBox(),
    fullScreen.boundingBox(),
  ]);
  expect(scopeBox.y - sidebarBox.y).toBeLessThan(24);
  expect(topBarBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1);
  expect(switcherBox.x).toBeGreaterThanOrEqual(topBarBox.x);
  expect(fullScreenBox.x + fullScreenBox.width).toBeGreaterThan(topBarBox.x + topBarBox.width - 50);

  await page.screenshot({ path: testInfo.outputPath('expanded-mobile-composition.png'), fullPage: true });

  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(setup).toBeHidden();
  await expect(topSections.locator('.expanded-sidebar-section-switcher-btn:visible')).toHaveText(['Deck', 'Chat', 'Tasks', 'Docs', 'Files']);
});

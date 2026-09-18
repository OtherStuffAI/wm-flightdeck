const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');
const styles = fs.readFileSync(path.join(projectRoot, 'src/styles.css'), 'utf8');
const proseTitle = 'Build every proposal and advance past no-change outcomes without clipping at the activity sidebar boundary';
const tokenTitle = `https://example.test/${'unbroken-title-token'.repeat(18)}`;

function taskTitleFixture(title) {
  const escaped = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<!doctype html>
    <html>
      <head><style>${styles}</style></head>
      <body>
        <main class="app-shell">
          <div class="main-content">
            <div class="content-scroll-area">
              <section class="tasks-section">
                <div class="task-detail-panel">
                  <div class="task-detail-body">
                    <div class="task-detail-main">
                      <div class="task-detail-record-header">
                        <div class="task-detail-title-row">
                          <h1 class="task-detail-title-display task-title-long">${escaped}</h1>
                          <button class="task-detail-assignee-avatar" aria-label="Assignee">PW</button>
                        </div>
                      </div>
                      <textarea class="task-detail-title" rows="1" aria-label="Task title">${escaped}</textarea>
                    </div>
                    <aside class="task-comments-section">Activity</aside>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </body>
    </html>`;
}

async function titleMetrics(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const main = node.closest('.task-detail-main').getBoundingClientRect();
    const comments = document.querySelector('.task-comments-section').getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
    return {
      height: rect.height,
      lineHeight,
      left: rect.left,
      right: rect.right,
      mainLeft: main.left,
      mainRight: main.right,
      commentsLeft: comments.left,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
}

for (const viewport of [
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name} task detail titles wrap in read and edit states`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.setContent(taskTitleFixture(proseTitle));

    for (const selector of ['.task-detail-title-display', '.task-detail-title']) {
      const metrics = await titleMetrics(page, selector);
      expect(metrics.height).toBeGreaterThan(metrics.lineHeight * 1.5);
      expect(metrics.left).toBeGreaterThanOrEqual(metrics.mainLeft - 1);
      expect(metrics.right).toBeLessThanOrEqual(metrics.mainRight + 1);
      if (viewport.width > 768) expect(metrics.right).toBeLessThanOrEqual(metrics.commentsLeft + 1);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    }
  });

  test(`${viewport.name} task detail titles safely break unbroken tokens`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.setContent(taskTitleFixture(tokenTitle));

    for (const selector of ['.task-detail-title-display', '.task-detail-title']) {
      const metrics = await titleMetrics(page, selector);
      expect(metrics.height).toBeGreaterThan(metrics.lineHeight * 1.5);
      expect(metrics.right).toBeLessThanOrEqual(metrics.mainRight + 1);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    }
  });
}

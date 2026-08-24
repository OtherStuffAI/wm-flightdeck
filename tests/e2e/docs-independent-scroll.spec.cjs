const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');

function documentFixture() {
  const css = fs.readFileSync(path.join(projectRoot, 'src/styles.css'), 'utf8');
  const documentBlocks = Array.from({ length: 28 }, (_, index) => `
    <div class="doc-block-row">
      <div class="doc-block-main">
        <div class="doc-block"><p>Document block ${index + 1}: ${'content '.repeat(18)}</p></div>
      </div>
      <aside class="doc-block-gutter"></aside>
    </div>
  `).join('');
  const commentThreads = Array.from({ length: 20 }, (_, index) => `
    <div class="doc-thread-group">
      <div class="doc-thread-entry doc-thread-entry-root">
        <strong>Comment ${index + 1}</strong>
        <p>${'Independent comment panel content '.repeat(8)}</p>
      </div>
    </div>
  `).join('');

  return `<!doctype html>
    <html>
      <head><style>${css}</style></head>
      <body>
        <main class="app-shell">
          <div class="main-content">
            <div class="content-scroll-area">
              <section class="docs-section">
                <div class="docs-view">
                  <section class="docs-editor-v3">
                    <header class="doc-editor-header">Document toolbar</header>
                    <div class="doc-title-block"><h1>Independent scrolling</h1></div>
                    <div class="doc-content-block">
                      <nav class="mobile-detail-switcher doc-mobile-switcher" aria-label="Document sections">
                        <button class="mobile-detail-switcher-btn mobile-detail-switcher-btn-active">Docs</button>
                        <button class="mobile-detail-switcher-btn">Comments</button>
                      </nav>
                      <div class="doc-content-layout doc-content-layout-with-thread">
                        <div class="doc-preview-surface">${documentBlocks}</div>
                        <aside class="doc-comment-thread-panel">
                          <div class="doc-comment-thread-header"><h3>Comments</h3></div>
                          <div class="doc-thread-new-comment">
                            <textarea class="doc-thread-reply-input" rows="3">Comment draft remains usable</textarea>
                          </div>
                          <div class="doc-thread-list">${commentThreads}</div>
                        </aside>
                      </div>
                    </div>
                  </section>
                </div>
              </section>
            </div>
          </div>
        </main>
      </body>
    </html>`;
}

test('desktop document and comments keep independent vertical scroll positions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.setContent(documentFixture());

  const metrics = await page.evaluate(() => {
    const pageScroll = document.querySelector('.content-scroll-area');
    const documentSurface = document.querySelector('.doc-preview-surface');
    const commentsList = document.querySelector('.doc-thread-list');
    documentSurface.scrollTop = 260;
    const commentsBefore = commentsList.scrollTop;
    commentsList.scrollTop = 320;
    return {
      pageOverflowY: getComputedStyle(pageScroll).overflowY,
      pageCanScroll: pageScroll.scrollHeight > pageScroll.clientHeight,
      pageScrollTop: pageScroll.scrollTop,
      documentOverflowY: getComputedStyle(documentSurface).overflowY,
      documentCanScroll: documentSurface.scrollHeight > documentSurface.clientHeight,
      documentScrollTop: documentSurface.scrollTop,
      commentsOverflowY: getComputedStyle(commentsList).overflowY,
      commentsCanScroll: commentsList.scrollHeight > commentsList.clientHeight,
      commentsBefore,
      commentsScrollTop: commentsList.scrollTop,
    };
  });

  expect(metrics.pageOverflowY).toBe('auto');
  expect(metrics.pageCanScroll).toBe(false);
  expect(metrics.pageScrollTop).toBe(0);
  expect(metrics.documentOverflowY).toBe('auto');
  expect(metrics.documentCanScroll).toBe(true);
  expect(metrics.documentScrollTop).toBeGreaterThan(0);
  expect(metrics.commentsOverflowY).toBe('auto');
  expect(metrics.commentsCanScroll).toBe(true);
  expect(metrics.commentsBefore).toBe(0);
  expect(metrics.commentsScrollTop).toBeGreaterThan(0);
  await expect(page.locator('.doc-thread-reply-input')).toBeVisible();
  await expect(page.locator('.doc-thread-reply-input')).toBeEditable();
});

test('narrow document layout retains its stacked single-pane behavior', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.setContent(documentFixture());

  const metrics = await page.evaluate(() => {
    const layout = document.querySelector('.doc-content-layout');
    const comments = document.querySelector('.doc-comment-thread-panel');
    const switcher = document.querySelector('.doc-mobile-switcher');
    return {
      layoutDisplay: getComputedStyle(layout).display,
      layoutOverflowY: getComputedStyle(layout).overflowY,
      commentsPosition: getComputedStyle(comments).position,
      commentsHeight: getComputedStyle(comments).height,
      switcherDisplay: getComputedStyle(switcher).display,
    };
  });

  expect(metrics.layoutDisplay).toBe('block');
  expect(metrics.layoutOverflowY).toBe('visible');
  expect(metrics.commentsPosition).toBe('static');
  expect(metrics.commentsHeight).not.toBe('820px');
  expect(metrics.switcherDisplay).not.toBe('none');
});

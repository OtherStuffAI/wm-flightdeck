const { test, expect } = require('playwright/test');

async function waitForStore(page) {
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let index = 0; index < 100; index += 1) {
      if (window.Alpine?.store?.('chat')) return;
      await wait(50);
    }
    throw new Error('Alpine chat store did not initialize.');
  });
}

async function seedDocumentLinkState(page) {
  await page.evaluate(async () => {
    const store = window.Alpine.store('chat');
    const now = new Date().toISOString();
    store.session = { ...(store.session || {}), npub: 'npub1mobiletest' };
    store.documents = [{
      record_id: 'doc-mobile-link',
      owner_npub: 'npub1mobiletest',
      title: 'Mobile link document',
      content: '# Stable mobile body',
      content_blocks: [],
      content_storage_object_id: 'object-mobile-link',
      content_storage_status: 'loaded',
      version: 3,
      sync_status: 'synced',
      record_state: 'active',
      created_at: now,
      updated_at: now,
      shares: [],
      group_ids: [],
    }];
    store.docComments = [{
      record_id: 'comment-mobile-link',
      target_record_id: 'doc-mobile-link',
      target_record_family_hash: 'app:document',
      parent_comment_id: null,
      body: 'Target comment',
      record_state: 'active',
      created_at: now,
      updated_at: now,
    }];
    await store.openChatDocModal('doc-mobile-link', { title: 'Mobile link document' });
  });
}

test('mobile document links and late hydration keep the selected body stable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto('/');
  await waitForStore(page);
  await seedDocumentLinkState(page);

  const docsTab = page.getByRole('button', { name: 'Docs', exact: true }).last();
  const commentsTab = page.getByRole('button', { name: 'Comments', exact: true }).last();
  await expect(docsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.doc-preview-surface')).toContainText('Stable mobile body');

  await commentsTab.click();
  await expect(commentsTab).toHaveAttribute('aria-selected', 'true');
  await docsTab.click();
  await expect(docsTab).toHaveAttribute('aria-selected', 'true');

  await page.evaluate(async () => {
    const store = window.Alpine.store('chat');
    const current = store.documents.find((document) => document.record_id === 'doc-mobile-link');
    store.applyDocuments([{
      ...current,
      content: '',
      content_blocks: [],
      content_storage_status: 'remote',
    }]);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  });

  await expect(docsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.doc-preview-surface')).toContainText('Stable mobile body');

  await page.evaluate(() => {
    const store = window.Alpine.store('chat');
    store.openDoc('doc-mobile-link', {
      ensureSync: false,
      allowCommentBackfill: false,
      commentId: 'comment-mobile-link',
    });
  });
  await expect(commentsTab).toHaveAttribute('aria-selected', 'true');
});

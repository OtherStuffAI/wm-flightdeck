/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyCodeBlock, initMarkdownCodeBlocks } from '../src/markdown-code-blocks.js';
import { renderMarkdownToHtml } from '../src/markdown.js';

describe('markdown code block copying', () => {
  let cleanup;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = renderMarkdownToHtml('```js\nconst value = "<safe>";\n```');
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('copies the original code text despite highlighted span markup and shows brief feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const button = document.querySelector('[data-md-code-copy]');

    expect(document.querySelector('code').innerHTML).toContain('<span');
    await expect(copyCodeBlock(button, document)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('const value = "<safe>";');
    expect(button.dataset.copyState).toBe('copied');
    expect(button.querySelector('.md-code-copy-label').textContent).toBe('Copied');
    expect(button.querySelector('[aria-live="polite"]').textContent).toBe('Copied');

    vi.advanceTimersByTime(1800);
    expect(button.dataset.copyState).toBeUndefined();
    expect(button.querySelector('.md-code-copy-label').textContent).toBe('Copy');
  });

  it('uses delegated button activation and exposes copy failure feedback', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    cleanup = initMarkdownCodeBlocks(document);
    const button = document.querySelector('[data-md-code-copy]');

    button.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(button.dataset.copyState).toBe('failed'));
    expect(button.querySelector('.md-code-copy-label').textContent).toBe('Copy failed');
    expect(button.getAttribute('aria-label')).toBe('Could not copy code');
  });
});

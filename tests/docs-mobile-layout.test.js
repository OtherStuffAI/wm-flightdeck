import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(relativePath) {
  return readFileSync(resolve(import.meta.dirname, '..', relativePath), 'utf8');
}

describe('docs mobile layout', () => {
  it('renders a mobile Docs and Comments switcher inside the document editor', () => {
    const html = readProjectFile('index.html');
    const editorStart = html.indexOf('class="docs-editor-v3"');
    const editorEnd = html.indexOf('<!-- Doc Versioning View -->', editorStart);
    const editor = html.slice(editorStart, editorEnd);

    expect(editor).toContain('class="mobile-detail-switcher doc-mobile-switcher"');
    expect(editor).toContain("aria-label=\"Document sections\"");
    expect(editor).toContain("$store.chat.docMobilePane = 'document'");
    expect(editor).toContain("$store.chat.docCommentsVisible = true; $store.chat.docMobilePane = 'comments'");
    expect(editor).toContain('doc-content-layout-mobile-comments');
  });

  it('keeps one shared comments layout mounted across read and edit surfaces', () => {
    const html = readProjectFile('index.html');
    const editorStart = html.indexOf('class="docs-editor-v3"');
    const editorEnd = html.indexOf('<!-- Doc Versioning View -->', editorStart);
    const editor = html.slice(editorStart, editorEnd);

    expect(editor.match(/data-doc-content-layout/g)).toHaveLength(1);
    expect(editor.match(/data-doc-thread-panel/g)).toHaveLength(1);
    expect(editor).toContain("x-if=\"$store.chat.docEditorMode === 'rich'\"");
    expect(editor).toContain("x-if=\"$store.chat.docEditorMode === 'source'\"");
    expect(editor.indexOf('class="doc-rich-editor"')).toBeLessThan(editor.indexOf('data-doc-thread-panel'));
    expect(editor.indexOf('class="doc-source-editor"')).toBeLessThan(editor.indexOf('data-doc-thread-panel'));
    expect(editor).toContain("x-show=\"$store.chat.docCommentAnchorLine || $store.chat.showDocCommentModal\"");
  });

  it('shows selected quotes and line metadata in both the composer and saved thread', () => {
    const html = readProjectFile('index.html');
    const editorStart = html.indexOf('class="docs-editor-v3"');
    const editorEnd = html.indexOf('<!-- Doc Versioning View -->', editorStart);
    const editor = html.slice(editorStart, editorEnd);

    expect(editor).toContain('doc-thread-anchor-quote-pending');
    expect(editor).toContain('x-text="$store.chat.docCommentAnchorQuote"');
    expect(editor).toContain('x-text="$store.chat.getDocCommentAnchorLabel(root)"');
    expect(editor).toContain('x-text="$store.chat.getDocCommentAnchorQuote(root)"');
    expect(editor).toContain('x-text="$store.chat.getDocCommentAnchorFallbackLabel(root)"');
    expect(editor).toContain('Select document text, then click + to comment on it.');
  });

  it('keeps document breadcrumbs left and actions right on mobile without wrapping into a second row', () => {
    const css = readProjectFile('src/styles.css');
    const mobileStart = css.indexOf('@media (max-width: 720px)');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobileCss = css.slice(mobileStart, css.indexOf('.doc-content-block', mobileStart));

    expect(mobileCss).toMatch(/\.doc-editor-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;/);
    expect(mobileCss).toMatch(/\.doc-editor-actions\s*\{[\s\S]*max-width:\s*62vw;[\s\S]*margin-left:\s*auto;[\s\S]*overflow-x:\s*auto;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*justify-content:\s*flex-end;/);
    expect(mobileCss).toMatch(/\.doc-editor-breadcrumbs\s*\{[\s\S]*flex-wrap:\s*nowrap;[\s\S]*overflow-x:\s*auto;/);
    expect(mobileCss).not.toMatch(/\.doc-editor-actions\s*\{[\s\S]*width:\s*100%;[\s\S]*justify-content:\s*flex-start;/);
  });

  it('keeps the document editor toolbar sticky while the document body scrolls', () => {
    const css = readProjectFile('src/styles.css');

    expect(css).toMatch(/\.doc-editor-header\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;[\s\S]*z-index:\s*31;/);
  });

  it('uses mobile-only CSS to show either document content or document comments', () => {
    const css = readProjectFile('src/styles.css');
    const mobileStart = css.lastIndexOf('@media (max-width: 768px)');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobileCss = css.slice(mobileStart);

    expect(mobileCss).toContain('.doc-content-layout:not(.doc-content-layout-mobile-comments) .doc-comment-thread-panel');
    expect(mobileCss).toContain('.doc-content-layout-mobile-comments .doc-preview-surface');
    expect(mobileCss).toContain('.doc-content-layout-mobile-comments .doc-comment-thread-panel');
  });
});

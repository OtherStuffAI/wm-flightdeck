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

  it('keeps mobile document reader chrome compact before content', () => {
    const css = readProjectFile('src/styles.css');
    const mobileStart = css.indexOf('@media (max-width: 720px)');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobileCss = css.slice(mobileStart, css.indexOf('.doc-content-block', mobileStart));

    expect(mobileCss).toMatch(/\.doc-editor-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;/);
    expect(mobileCss).toMatch(/\.doc-editor-actions\s*\{[\s\S]*max-width:\s*54vw;[\s\S]*margin-left:\s*auto;[\s\S]*overflow-x:\s*auto;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*justify-content:\s*flex-end;/);
    expect(mobileCss).toMatch(/\.doc-title-block\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;[\s\S]*margin-bottom:\s*0\.15rem;/);
    expect(mobileCss).toMatch(/\.doc-title-display\s*\{[\s\S]*max-height:\s*1\.3em;[\s\S]*font-size:\s*1rem;[\s\S]*white-space:\s*nowrap;/);
    expect(mobileCss).toMatch(/\.doc-editor-breadcrumbs\s*\{[\s\S]*display:\s*none;/);
    expect(mobileCss).toMatch(/\.doc-title-block\s*>\s*\.doc-scope-pill-btn\s*\{[\s\S]*display:\s*none;/);
    expect(mobileCss).not.toMatch(/\.doc-editor-actions\s*\{[\s\S]*width:\s*100%;[\s\S]*justify-content:\s*flex-start;/);
  });

  it('collapses mobile Docs browser controls and renders documents as a phone-width list', () => {
    const html = readProjectFile('index.html');
    const css = readProjectFile('src/styles.css');
    const headerStart = html.indexOf('class="docs-header"');
    const header = html.slice(headerStart, html.indexOf('class="task-bulk-bar doc-bulk-bar"', headerStart));
    const mobileStart = css.indexOf('@media (max-width: 640px)');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobileCss = css.slice(mobileStart, css.indexOf('.sidebar-channels', mobileStart));

    expect(header).toContain('docsControlsOpen');
    expect(header).toContain('class="docs-mobile-header-actions"');
    expect(header).toContain("'docs-toolbar-mobile-open': docsControlsOpen");
    expect(header).toContain('class="btn-secondary docs-mobile-toolbar-only"');
    expect(mobileCss).toMatch(/\.docs-toolbar\s*\{[\s\S]*display:\s*none;/);
    expect(mobileCss).toMatch(/\.docs-toolbar-mobile-open\s*\{[\s\S]*display:\s*flex;/);
    expect(mobileCss).toMatch(/\.docs-browser-shell\s*>\s*\.folder-breadcrumb-row\s*\{[\s\S]*display:\s*none;/);
    expect(mobileCss).toMatch(/\.doc-table-scroll\s*\{[\s\S]*overflow-x:\s*hidden;/);
    expect(mobileCss).toMatch(/\.doc-table\s*\{[\s\S]*min-width:\s*0;/);
    expect(mobileCss).toMatch(/\.doc-item\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
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

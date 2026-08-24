// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');

function sourceButton(fragment) {
  const markup = (html.match(/<button\b[\s\S]*?<\/button>/g) || [])
    .find((candidate) => candidate.includes(fragment));
  const template = document.createElement('template');
  template.innerHTML = markup || '';
  return template.content.firstElementChild;
}

function wireClick(element, scope) {
  const directive = [...element.attributes].find((attribute) => attribute.name.startsWith('@click'));
  const expression = directive?.value || '';
  element.addEventListener('click', async (event) => {
    if (directive?.name.includes('.stop')) event.stopPropagation();
    if (directive?.name.includes('.prevent')) event.preventDefault();
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('$store', 'row', 'open', `${expression}; return typeof open === 'undefined' ? undefined : open;`)(
      scope.$store,
      scope.row,
      scope.open,
    );
  });
}

describe('document archive UI event wiring', () => {
  it('archives the selected documents from the selection action bar', async () => {
    const button = sourceButton("applyBulkDocAction('archive')");
    const applyBulkDocAction = vi.fn(async () => undefined);
    wireClick(button, { $store: { chat: { applyBulkDocAction } } });

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(applyBulkDocAction).toHaveBeenCalledWith('archive');
  });

  it('archives from the open-document overflow and waits for the active view to close', async () => {
    const button = sourceButton('archiveOpenDocument');
    const archiveOpenDocument = vi.fn(async () => undefined);
    wireClick(button, { $store: { chat: { archiveOpenDocument } }, open: true });

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(button.getAttribute('@click')).toContain('await $store.chat.archiveOpenDocument()');
    expect(archiveOpenDocument).toHaveBeenCalledTimes(1);
  });

  it('opens every document row menu without navigating, then archives that row', async () => {
    const menu = document.createElement('div');
    menu.className = 'doc-row-actions-menu';
    menu.setAttribute('x-show', "row.type === 'document' && $store.chat.isTowerPgMode");
    const toggle = sourceButton('aria-label="Document actions"');
    const archive = sourceButton('setDocumentArchived(row.item, true)');
    const row = { type: 'document', item: { record_id: 'doc-1' } };
    const setDocumentArchived = vi.fn(async () => undefined);
    const rowNavigation = vi.fn();
    const host = document.createElement('div');
    host.addEventListener('click', rowNavigation);
    menu.append(toggle, archive);
    host.append(menu);
    document.body.append(host);
    wireClick(toggle, { $store: { chat: {} }, row, open: false });
    wireClick(archive, { $store: { chat: { setDocumentArchived } }, row, open: true });

    toggle.click();
    archive.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(menu.getAttribute('x-show')).toBe("row.type === 'document' && $store.chat.isTowerPgMode");
    expect(rowNavigation).not.toHaveBeenCalled();
    expect(setDocumentArchived).toHaveBeenCalledWith(row.item, true);
  });
});

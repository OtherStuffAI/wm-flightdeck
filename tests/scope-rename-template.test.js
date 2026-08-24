import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('scope rename surface', () => {
  it('keeps safe scope actions reachable while gating rename independently', () => {
    expect(html).toContain('<div class="scope-card-actions">');
    expect(html).toContain('<button type="button" x-show="$store.chat.canManageScope(s1)" @click.stop="$store.chat.startEditScope(s1.record_id); actionsOpen = false">');
    expect(html).toContain('Rename scope</button>');
    expect(html).toContain("copyFlightDeckReference('scope', s1.record_id");
  });

  it('renders validation and saving state in the rename modal', () => {
    expect(html).toContain('class="scope-edit-error" role="alert"');
    expect(html).toContain('$store.chat.editingScopeSaving ? \'Saving…\'');
    expect(html).toContain('!$store.chat.editingScopeTitle.trim()');
  });

  it('defines readable scope menu hover, focus, selected, and disabled hooks', () => {
    const genericPopoverIndex = css.indexOf('.doc-actions-popover {');
    const scopePopoverIndex = css.indexOf('.scope-actions-menu .doc-actions-popover {');
    expect(genericPopoverIndex).toBeGreaterThan(-1);
    expect(scopePopoverIndex).toBeGreaterThan(genericPopoverIndex);

    const rule = (selector) => {
      const start = css.indexOf(`${selector} {`, scopePopoverIndex);
      expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(scopePopoverIndex);
      return css.slice(start, css.indexOf('}', start) + 1);
    };

    const popover = rule('.scope-actions-menu .doc-actions-popover');
    const button = rule('.scope-actions-menu .doc-actions-popover button');
    const disabled = rule('.scope-actions-menu .doc-actions-popover button:disabled');
    const destructive = rule('.scope-actions-menu .doc-actions-popover .doc-actions-delete');

    expect(popover).toContain('background: #ffffff;');
    expect(popover).toContain('color: #111827;');
    expect(button).toContain('color: #111827;');
    expect(disabled).toContain('color: #6b7280;');
    expect(destructive).toContain('color: #b91c1c;');
    expect(css).toContain('.scope-actions-menu .doc-actions-popover button:hover:not(:disabled)');
    expect(css).toContain('.scope-actions-menu .doc-actions-popover button:focus-visible');
    expect(css).toContain('.scope-actions-menu .doc-actions-popover button[aria-selected="true"]');
    expect(css).toContain('.scope-actions-menu .doc-actions-popover .doc-actions-delete:hover:not(:disabled)');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');

describe('WApp management permission UI', () => {
  it('provides the Setup Permissions path and lifecycle controls', () => {
    expect(html).toContain("openSettingsTab('permissions')");
    expect(html).toContain('data-testid="wapp-management-permissions"');
    expect(html).toContain('Grant WApp management');
    expect(html).toContain('Activate Book of Sand');
    expect(html).toContain('data-testid="wapp-activation-app"');
    expect(html).toContain('data-testid="wapp-feed-destination"');
    expect(html).toContain('reconcileManagedWapp(installation)');
    expect(html).toContain('revokeManagedWapp(installation)');
    expect(html).toContain('requestWappUninstallApproval()');
  });
  it('explains exact signing, narrow authority, and Feed-only Book of Sand', () => {
    expect(html).toContain('browser identity signs the exact Tower request');
    expect(html).toContain('never asks for or stores a private key');
    expect(html).toContain('Book of Sand View links are limited to its approved origin');
    expect(html).toContain('no channel or message write');
  });
  it('collapses editor grids and lifecycle rows on mobile', () => {
    expect(css).toMatch(/@media \(max-width:720px\)[\s\S]*\.wapp-management-filter-grid\{grid-template-columns:1fr\}/);
    expect(css).toMatch(/@media \(max-width:720px\)[\s\S]*\.wapp-management-row\{align-items:stretch;flex-direction:column\}/);
  });
});

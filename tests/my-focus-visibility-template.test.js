import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

describe('My Focus visibility preference wiring', () => {
  it('conditionally removes the complete My Focus card from layout', () => {
    expect(html).toMatch(/<section class="autopilot-daily-scope flightdeck-summary-daily" x-show="\$store\.chat\.myFocusEnabled" x-cloak/);
  });

  it('exposes a Setup control that persists through the app settings store', () => {
    expect(html).toContain('data-testid="deck-my-focus-enabled"');
    expect(html).toContain('@change="$store.chat.setMyFocusEnabled($event.target.checked)"');
    expect(appSource).toContain('this.myFocusEnabled = resolveMyFocusEnabled(settings);');
    expect(appSource).toMatch(/async setMyFocusEnabled\(enabled\)[\s\S]*saveSettings\(\{ \.\.\.settings, myFocusEnabled: this\.myFocusEnabled \}\)/);
  });
});

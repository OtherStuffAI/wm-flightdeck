import { describe, expect, it } from 'vitest';
import { resolveMyFocusEnabled } from '../src/my-focus-preference.js';

describe('My Focus preference', () => {
  it('defaults off when no preference has been stored', () => {
    expect(resolveMyFocusEnabled()).toBe(false);
    expect(resolveMyFocusEnabled({})).toBe(false);
  });

  it('restores an explicitly enabled preference', () => {
    expect(resolveMyFocusEnabled({ myFocusEnabled: true })).toBe(true);
  });

  it('keeps non-boolean legacy values off', () => {
    expect(resolveMyFocusEnabled({ myFocusEnabled: 'true' })).toBe(false);
    expect(resolveMyFocusEnabled({ myFocusEnabled: 1 })).toBe(false);
  });
});

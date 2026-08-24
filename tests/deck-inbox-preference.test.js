import { describe, expect, it } from 'vitest';
import { resolveDeckInboxEnabled } from '../src/deck-inbox-preference.js';

describe('Deck Inbox preference', () => {
  it('defaults Inbox on when no preference has been stored', () => {
    expect(resolveDeckInboxEnabled()).toBe(true);
    expect(resolveDeckInboxEnabled({})).toBe(true);
  });

  it('preserves an explicitly disabled Inbox preference', () => {
    expect(resolveDeckInboxEnabled({ deckInboxEnabled: false })).toBe(false);
  });
});

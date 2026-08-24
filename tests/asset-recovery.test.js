import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function recoveryScript() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const match = html.match(/<script data-flightdeck-asset-recovery>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Asset recovery bootstrap is missing.');
  return match[1];
}

function makeHarness(sharedStorage = new Map()) {
  const listeners = new Map();
  const replacements = [];
  const historyReplacements = [];
  const context = {
    URL,
    Date: { now: () => 12345 },
    location: {
      href: 'https://flightdeck.example/operator-a/deck?scope=one',
      replace(url) { replacements.push(url); },
    },
    history: {
      state: null,
      replaceState(_state, _title, url) { historyReplacements.push(url); },
    },
    sessionStorage: {
      getItem(key) { return sharedStorage.get(key) ?? null; },
      setItem(key, value) { sharedStorage.set(key, value); },
      removeItem(key) { sharedStorage.delete(key); },
    },
    window: {
      addEventListener(type, listener) { listeners.set(type, listener); },
    },
  };
  vm.runInNewContext(recoveryScript(), context);
  return { historyReplacements, listeners, replacements, sharedStorage };
}

describe('bootstrap stale-asset recovery', () => {
  it('cache-busts exactly once for a failed stylesheet and cannot reload-loop', () => {
    const sharedStorage = new Map();
    const first = makeHarness(sharedStorage);
    first.listeners.get('error')({
      target: { tagName: 'LINK', rel: 'stylesheet', href: 'https://flightdeck.example/assets/index-old.css' },
    });
    first.listeners.get('error')({
      target: { tagName: 'SCRIPT', src: 'https://flightdeck.example/assets/index-old.js' },
    });
    expect(first.replacements).toHaveLength(1);
    expect(new URL(first.replacements[0]).searchParams.has('flightdeck-asset-recovery')).toBe(true);

    const recoveryAttempt = makeHarness(sharedStorage);
    recoveryAttempt.listeners.get('error')({
      target: { tagName: 'SCRIPT', src: 'https://flightdeck.example/assets/still-missing.js' },
    });
    expect(recoveryAttempt.replacements).toHaveLength(0);
    expect(sharedStorage.get('flightdeck:asset-recovery-attempted')).toBe('1');
  });

  it('clears the one-attempt guard only after a document loads without an asset failure', () => {
    const sharedStorage = new Map([['flightdeck:asset-recovery-attempted', '1']]);
    const harness = makeHarness(sharedStorage);
    harness.listeners.get('load')();
    expect(sharedStorage.has('flightdeck:asset-recovery-attempted')).toBe(false);
  });
});

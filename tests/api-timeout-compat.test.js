import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFetchTimeoutSignal } from '../src/api.js';

describe('API fetch timeout compatibility', () => {
  const nativeTimeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');

  afterEach(() => {
    vi.useRealTimers();
    if (nativeTimeoutDescriptor) {
      Object.defineProperty(AbortSignal, 'timeout', nativeTimeoutDescriptor);
    } else {
      delete AbortSignal.timeout;
    }
  });

  it('falls back to AbortController when AbortSignal.timeout is unavailable', async () => {
    vi.useFakeTimers();
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: undefined,
    });

    const signal = createFetchTimeoutSignal(25);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(25);

    expect(signal.aborted).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { readDeterministicBuildVersion } from '../vite.config.js';

describe('deterministic Flight Deck build version', () => {
  it('derives stable build metadata from the release commit', () => {
    expect(readDeterministicBuildVersion({
      FLIGHTDECK_BUILD_NUMBER: '1787730000',
      FLIGHTDECK_BUILD_ID: 'ota-1787730000-abcdef123456',
      SOURCE_DATE_EPOCH: '1787730000',
    })).toEqual({
      buildNumber: 1787730000,
      buildId: 'ota-1787730000-abcdef123456',
      builtAt: '2026-08-26T07:40:00.000Z',
    });
  });

  it('keeps ordinary local builds on the existing counter path', () => {
    expect(readDeterministicBuildVersion({})).toBeNull();
  });

  it('rejects partial or unsafe deterministic metadata', () => {
    expect(() => readDeterministicBuildVersion({
      FLIGHTDECK_BUILD_NUMBER: '42',
    })).toThrow(/must be supplied together/);
    expect(() => readDeterministicBuildVersion({
      FLIGHTDECK_BUILD_NUMBER: '42',
      FLIGHTDECK_BUILD_ID: '../bad',
      SOURCE_DATE_EPOCH: '42',
    })).toThrow(/unsupported characters/);
  });
});

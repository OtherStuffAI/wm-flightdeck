import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createVersionMetadata,
  validateReleaseNotesManifest,
} from '../scripts/release-notes.mjs';

function manifestWith(releases) {
  return { schemaVersion: 1, releases };
}

describe('release-note build metadata', () => {
  it('keeps the repo manifest stable, ordered, and associated with the generated absolute build', () => {
    const source = JSON.parse(readFileSync(path.resolve('release-notes.json'), 'utf8'));
    const validated = validateReleaseNotesManifest(source);
    const latestRelease = validated.releases.at(-1);
    const input = {
      buildId: `20260804-0200-2-${latestRelease.buildNumber}`,
      buildNumber: latestRelease.buildNumber,
      builtAt: '2026-08-04T02:00:00.000Z',
      manifest: validated,
    };

    const first = createVersionMetadata(input);
    const second = createVersionMetadata(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      buildId: `20260804-0200-2-${latestRelease.buildNumber}`,
      buildNumber: latestRelease.buildNumber,
    });
    expect(first.releases).toHaveLength(validated.releases.length);
    expect(first.releases.at(-1)).toMatchObject({
      ...latestRelease,
      buildId: `20260804-0200-2-${latestRelease.buildNumber}`,
      publishedAt: '2026-08-04T02:00:00.000Z',
    });
  });

  it('preserves an explicitly recorded no-user-visible-change build without fake notes', () => {
    const result = validateReleaseNotesManifest(manifestWith([
      { buildNumber: 7, label: 'Internal packaging build', notes: [], noUserVisibleChanges: true },
    ]));

    expect(result.releases[0]).toEqual({
      buildNumber: 7,
      label: 'Internal packaging build',
      notes: [],
      noUserVisibleChanges: true,
    });
  });

  it.each([
    {
      name: 'duplicate build numbers',
      releases: [
        { buildNumber: 7, label: 'One', notes: ['First'] },
        { buildNumber: 7, label: 'Two', notes: ['Second'] },
      ],
      message: /duplicated/,
    },
    {
      name: 'out-of-order build numbers',
      releases: [
        { buildNumber: 8, label: 'Later', notes: ['Later'] },
        { buildNumber: 7, label: 'Earlier', notes: ['Earlier'] },
      ],
      message: /greater than the preceding/,
    },
    {
      name: 'empty visible notes',
      releases: [{ buildNumber: 7, label: 'Empty', notes: [] }],
      message: /at least one note/,
    },
    {
      name: 'ambiguous no-change notes',
      releases: [{ buildNumber: 7, label: 'Ambiguous', notes: ['Visible'], noUserVisibleChanges: true }],
      message: /cannot contain notes/,
    },
    {
      name: 'unknown fields',
      releases: [{ buildNumber: 7, label: 'Unknown', notes: ['Note'], html: '<b>unsafe</b>' }],
      message: /unknown field/,
    },
  ])('rejects $name', ({ releases, message }) => {
    expect(() => validateReleaseNotesManifest(manifestWith(releases))).toThrow(message);
  });

  it('rejects notes assigned beyond the build being generated', () => {
    expect(() => createVersionMetadata({
      buildId: '20260804-0200-2-1664',
      buildNumber: 1664,
      builtAt: '2026-08-04T02:00:00.000Z',
      manifest: manifestWith([{ buildNumber: 1665, label: 'Too soon', notes: ['Not built yet'] }]),
    })).toThrow(/newer than the generated build 1664/);
  });
});

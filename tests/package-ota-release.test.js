import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJson, packageOtaRelease } from '../scripts/package-ota-release.mjs';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'flightdeck-ota-test-'));
  temporaryDirectories.push(root);
  const dist = path.join(root, 'dist');
  const output = path.join(root, 'output');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<script src="/assets/app.js"></script>');
  writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("ok")\n');
  writeFileSync(path.join(dist, 'version.json'), JSON.stringify({
    buildNumber: 1787730000,
    buildId: 'ota-1787730000-abcdef123456',
    builtAt: '2026-08-26T07:40:00.000Z',
  }));
  return { root, dist, output };
}

function packageFixture(paths) {
  return packageOtaRelease({
    distDir: paths.dist,
    outputDir: paths.output,
    archiveBaseUrl: 'https://github.com/OtherStuffAI/wm-flightdeck/releases/download/flightdeck-1787730000/',
    sourceCommit: 'abcdef1234567890abcdef1234567890abcdef12',
    minimumWmappVersion: '0.1.2',
    minimumNativeBridge: 1,
    channel: 'flightdeck-release',
    releaseNotesUrl: 'https://github.com/OtherStuffAI/wm-flightdeck/releases/tag/flightdeck-1787730000',
  });
}

describe('Flight Deck OTA publisher', () => {
  it('emits a deterministic safe archive, digest, and canonical manifest', () => {
    const paths = fixture();
    const first = packageFixture(paths);
    const firstArchive = readFileSync(path.join(paths.output, first.archiveName));
    const firstManifest = readFileSync(path.join(paths.output, 'manifest.json'), 'utf8');
    const second = packageFixture(paths);
    const secondArchive = readFileSync(path.join(paths.output, second.archiveName));

    expect(secondArchive.equals(firstArchive)).toBe(true);
    expect(first.archiveSha256).toBe(createHash('sha256').update(firstArchive).digest('hex'));
    expect(readFileSync(path.join(paths.output, `${first.archiveName}.sha256`), 'utf8'))
      .toBe(`${first.archiveSha256}  ${first.archiveName}\n`);
    expect(firstManifest).toBe(`${canonicalJson(first.manifest)}\n`);
    expect(first.manifest).toMatchObject({
      schema_version: 1,
      build_number: 1787730000,
      channel: 'flightdeck-release',
      compatibility: {
        minimum_wmapp_version: '0.1.2',
        minimum_native_bridge: 1,
      },
      archive: {
        format: 'tar.gz',
        size_bytes: firstArchive.length,
      },
    });

    const tar = gunzipSync(firstArchive);
    expect(tar.length % 512).toBe(0);
    expect(tar.subarray(0, 100).toString().replaceAll('\0', '')).toBe('assets/app.js');
    expect(tar.includes(Buffer.from('index.html'))).toBe(true);
    expect(tar.subarray(-1024).every((byte) => byte === 0)).toBe(true);
  });

  it('rejects symlinks and non-HTTPS publication targets', () => {
    const paths = fixture();
    expect(() => packageOtaRelease({
      ...{
        distDir: paths.dist,
        outputDir: paths.output,
        archiveBaseUrl: 'http://example.test/releases/',
        sourceCommit: 'abcdef1234567890abcdef1234567890abcdef12',
        minimumWmappVersion: '0.1.2',
        minimumNativeBridge: 1,
        channel: 'flightdeck-release',
      },
    })).toThrow(/HTTPS/);

    symlinkSync(path.join(paths.dist, 'index.html'), path.join(paths.dist, 'linked-index.html'));
    expect(() => packageFixture(paths)).toThrow(/Symlinks are not allowed/);
  });
});

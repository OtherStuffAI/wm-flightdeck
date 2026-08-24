import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishStagedDist } from './dist-release.mjs';
import { verifyDistAssets } from './verify-dist-assets.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const stagingDir = path.join(rootDir, '.vite', `dist-build-${process.pid}`);

mkdirSync(path.dirname(stagingDir), { recursive: true });
rmSync(stagingDir, { recursive: true, force: true });

try {
  const build = spawnSync(
    'bunx',
    ['vite', 'build', '--outDir', stagingDir, '--emptyOutDir'],
    { cwd: rootDir, env: process.env, stdio: 'inherit' },
  );
  if (build.error) throw build.error;
  if (build.status !== 0) {
    throw new Error(`Vite build failed with exit code ${build.status ?? 'unknown'}`);
  }

  const verification = verifyDistAssets(stagingDir);
  const publication = publishStagedDist(stagingDir, distDir);
  console.log(
    `[build-flightdeck] published ${publication.publishedFiles} files after verifying ${verification.assetRefs.length} asset reference(s); retained ${publication.retainedPreviousAssets.length} previous asset(s).`,
  );
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}

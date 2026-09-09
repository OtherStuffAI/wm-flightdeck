import { stat } from 'node:fs/promises';

// Fixed failure labels avoid leaking browser action arguments into evidence.
export async function finalizeBrowser({ report, contexts, recordedPages, persist, originalError }) {
  report.status = originalError ? 'failed' : 'finalizing';
  const failures = [];
  try { await persist(report); }
  catch { failures.push('Browser preliminary report persistence failed'); }
  const closures = await Promise.allSettled(contexts.map(async context => context.close()));
  if (closures.some(result => result.status === 'rejected')) failures.push('Browser context closure failed');
  report.videos = [];
  for (const { user, page } of recordedPages) {
    try {
      const video = page.video();
      if (!video) throw new Error('Missing recording');
      const path = await video.path();
      const file = await stat(path);
      if (!file.isFile() || file.size <= 1000) throw new Error('Empty recording');
      report.videos.push({ user, path, bytes: file.size });
    } catch {
      failures.push(`User ${user.toUpperCase()} recording finalization failed`);
    }
  }
  if (report.videos.length !== 2 || new Set(report.videos.map(video => video.user)).size !== 2
      || !['a', 'b'].every(user => report.videos.some(video => video.user === user))
      || new Set(report.videos.map(video => video.path)).size !== 2) {
    failures.push('Expected two distinct finalized A/B recordings');
  }
  if (failures.length) report.finalizationFailure = failures;
  report.status = originalError || failures.length ? 'failed' : 'passed';
  if (failures.length && !report.failure) report.failure = { phase: 'browser finalization', reason: failures.join('; ') };
  report.finishedAt = new Date().toISOString();
  try { await persist(report); }
  catch {
    report.status = 'failed';
    failures.push('Browser final report persistence failed');
  }
  if (originalError) throw originalError;
  if (failures.length) throw new Error(`Release browser finalization failed: ${failures.join('; ')}. See browser/report.json.`);
}

export async function cleanupRun(manifest, cleanup) {
  try {
    await cleanup();
    manifest.cleanedUp = true;
  } catch (error) {
    manifest.status = 'failed';
    manifest.cleanedUp = false;
    manifest.cleanupFailure = error.message;
    throw error;
  }
}

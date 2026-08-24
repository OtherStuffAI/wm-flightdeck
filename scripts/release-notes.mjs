import { readFileSync } from 'node:fs';

export const RELEASE_NOTES_SCHEMA_VERSION = 1;

function fail(message) {
  throw new Error(`Invalid release notes manifest: ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertKnownKeys(entry, allowedKeys, context) {
  const unknownKeys = Object.keys(entry).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) fail(`${context} has unknown field(s): ${unknownKeys.join(', ')}`);
}

export function validateReleaseNotesManifest(manifest) {
  if (!isPlainObject(manifest)) fail('the root must be an object');
  assertKnownKeys(manifest, new Set(['schemaVersion', 'releases']), 'the root');
  if (manifest.schemaVersion !== RELEASE_NOTES_SCHEMA_VERSION) {
    fail(`schemaVersion must be ${RELEASE_NOTES_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(manifest.releases)) fail('releases must be an array');

  let previousBuildNumber = 0;
  const seenBuildNumbers = new Set();
  const releases = manifest.releases.map((entry, index) => {
    const context = `releases[${index}]`;
    if (!isPlainObject(entry)) fail(`${context} must be an object`);
    assertKnownKeys(
      entry,
      new Set(['buildNumber', 'label', 'notes', 'noUserVisibleChanges']),
      context,
    );

    if (!Number.isSafeInteger(entry.buildNumber) || entry.buildNumber < 1) {
      fail(`${context}.buildNumber must be a positive safe integer`);
    }
    if (seenBuildNumbers.has(entry.buildNumber)) {
      fail(`buildNumber ${entry.buildNumber} is duplicated`);
    }
    if (entry.buildNumber <= previousBuildNumber) {
      fail(`${context}.buildNumber must be greater than the preceding build number`);
    }
    seenBuildNumbers.add(entry.buildNumber);
    previousBuildNumber = entry.buildNumber;

    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) fail(`${context}.label must be a non-empty string`);
    if (label.length > 120) fail(`${context}.label must not exceed 120 characters`);
    if (!Array.isArray(entry.notes)) fail(`${context}.notes must be an array`);

    const notes = entry.notes.map((note, noteIndex) => {
      const normalized = typeof note === 'string' ? note.trim() : '';
      if (!normalized) fail(`${context}.notes[${noteIndex}] must be a non-empty string`);
      if (normalized.length > 280) fail(`${context}.notes[${noteIndex}] must not exceed 280 characters`);
      return normalized;
    });
    const noUserVisibleChanges = entry.noUserVisibleChanges === true;
    if (entry.noUserVisibleChanges !== undefined && typeof entry.noUserVisibleChanges !== 'boolean') {
      fail(`${context}.noUserVisibleChanges must be a boolean when present`);
    }
    if (noUserVisibleChanges && notes.length > 0) {
      fail(`${context} cannot contain notes when noUserVisibleChanges is true`);
    }
    if (!noUserVisibleChanges && notes.length === 0) {
      fail(`${context} must contain at least one note or set noUserVisibleChanges to true`);
    }

    return {
      buildNumber: entry.buildNumber,
      label,
      notes,
      ...(noUserVisibleChanges ? { noUserVisibleChanges: true } : {}),
    };
  });

  return { schemaVersion: RELEASE_NOTES_SCHEMA_VERSION, releases };
}

export function readReleaseNotesManifest(manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`could not read ${manifestPath}: ${error.message}`);
  }
  return validateReleaseNotesManifest(parsed);
}

export function createVersionMetadata({ buildId, buildNumber, builtAt, manifest }) {
  if (typeof buildId !== 'string' || !buildId.trim()) throw new Error('buildId must be a non-empty string');
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) throw new Error('buildNumber must be a positive safe integer');
  if (typeof builtAt !== 'string' || Number.isNaN(Date.parse(builtAt))) throw new Error('builtAt must be an ISO date string');

  const validated = validateReleaseNotesManifest(manifest);
  const futureRelease = validated.releases.find((release) => release.buildNumber > buildNumber);
  if (futureRelease) {
    fail(`build ${futureRelease.buildNumber} is newer than the generated build ${buildNumber}`);
  }

  return {
    schemaVersion: RELEASE_NOTES_SCHEMA_VERSION,
    buildId: buildId.trim(),
    buildNumber,
    builtAt,
    releases: validated.releases.map((release) => ({
      ...release,
      ...(release.buildNumber === buildNumber ? { buildId: buildId.trim(), publishedAt: builtAt } : {}),
    })),
  };
}

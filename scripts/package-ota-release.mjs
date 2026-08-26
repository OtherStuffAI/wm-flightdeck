import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function packageOtaRelease({
  distDir,
  outputDir,
  archiveBaseUrl,
  sourceCommit,
  minimumWmappVersion,
  minimumNativeBridge,
  channel,
  releaseNotesUrl = '',
}) {
  const resolvedDist = path.resolve(distDir);
  const resolvedOutput = path.resolve(outputDir);
  if (!existsSync(path.join(resolvedDist, 'index.html'))) {
    throw new Error('Flight Deck dist/index.html is required.');
  }
  const version = JSON.parse(readFileSync(path.join(resolvedDist, 'version.json'), 'utf8'));
  if (!Number.isSafeInteger(version.buildNumber) || version.buildNumber < 1) {
    throw new Error('dist/version.json buildNumber must be a positive safe integer.');
  }
  if (typeof version.buildId !== 'string' || !version.buildId.trim()) {
    throw new Error('dist/version.json buildId is required.');
  }
  const builtAt = new Date(version.builtAt);
  if (Number.isNaN(builtAt.valueOf())) throw new Error('dist/version.json builtAt is invalid.');
  const normalizedCommit = String(sourceCommit).trim().toLowerCase();
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(normalizedCommit)) {
    throw new Error('sourceCommit must be a 40- or 64-character hexadecimal commit.');
  }
  const baseUrl = validateHttpsUrl(archiveBaseUrl, 'archiveBaseUrl');
  const notesUrl = releaseNotesUrl ? validateHttpsUrl(releaseNotesUrl, 'releaseNotesUrl').toString() : '';
  if (!/^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/.test(minimumWmappVersion)) {
    throw new Error('minimumWmappVersion must be a semantic version.');
  }
  if (!Number.isSafeInteger(minimumNativeBridge) || minimumNativeBridge < 1) {
    throw new Error('minimumNativeBridge must be a positive integer.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(channel)) {
    throw new Error('channel contains unsupported characters.');
  }

  const archiveName = `flightdeck-${version.buildNumber}-${normalizedCommit.slice(0, 12)}.tar.gz`;
  const tar = createDeterministicTar(resolvedDist);
  const archive = gzipSync(tar, { level: 9, mtime: 0 });
  const archiveSha256 = sha256Hex(archive);
  const manifest = {
    schema_version: 1,
    build_number: version.buildNumber,
    build_id: version.buildId.trim(),
    source_commit: normalizedCommit,
    built_at: builtAt.toISOString(),
    channel,
    archive: {
      format: 'tar.gz',
      url: new URL(archiveName, ensureTrailingSlash(baseUrl)).toString(),
      sha256: archiveSha256,
      size_bytes: archive.length,
    },
    compatibility: {
      minimum_wmapp_version: minimumWmappVersion,
      minimum_native_bridge: minimumNativeBridge,
    },
    ...(notesUrl ? { release_notes_url: notesUrl } : {}),
  };

  rmSync(resolvedOutput, { recursive: true, force: true });
  mkdirSync(resolvedOutput, { recursive: true });
  writeFileSync(path.join(resolvedOutput, archiveName), archive);
  writeFileSync(
    path.join(resolvedOutput, `${archiveName}.sha256`),
    `${archiveSha256}  ${archiveName}\n`,
  );
  const canonicalManifest = `${canonicalJson(manifest)}\n`;
  writeFileSync(path.join(resolvedOutput, 'manifest.json'), canonicalManifest);
  writeFileSync(
    path.join(resolvedOutput, 'manifest.json.sha256'),
    `${sha256Hex(Buffer.from(canonicalManifest))}  manifest.json\n`,
  );
  return {
    archiveName,
    archiveSha256,
    archiveSizeBytes: archive.length,
    manifest,
  };
}

export function createDeterministicTar(distDir) {
  const entries = listRegularFiles(distDir);
  const chunks = [];
  for (const relativePath of entries) {
    const content = readFileSync(path.join(distDir, relativePath));
    chunks.push(createTarHeader(relativePath, content.length), content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function listRegularFiles(root) {
  const results = [];
  const visit = (relativeDirectory) => {
    const absoluteDirectory = path.join(root, relativeDirectory);
    for (const name of readdirSync(absoluteDirectory).sort()) {
      if (name === '.DS_Store' || name === '__MACOSX') continue;
      const relativePath = path.posix.join(relativeDirectory.split(path.sep).join('/'), name);
      const absolutePath = path.join(root, relativePath);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in dist: ${relativePath}`);
      if (stat.isDirectory()) visit(relativePath);
      else if (stat.isFile()) results.push(relativePath);
      else throw new Error(`Unsupported dist entry: ${relativePath}`);
    }
  };
  visit('');
  return results.sort();
}

function createTarHeader(relativePath, size) {
  const normalized = relativePath.replaceAll(path.sep, '/');
  if (normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  const { name, prefix } = splitUstarPath(normalized);
  const header = Buffer.alloc(512);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 345, 155, prefix);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  const encodedChecksum = `${checksum.toString(8).padStart(6, '0')}\0 `;
  writeString(header, 148, 8, encodedChecksum);
  return header;
}

function splitUstarPath(value) {
  if (Buffer.byteLength(value) <= 100) return { name: value, prefix: '' };
  for (let index = value.lastIndexOf('/'); index > 0; index = value.lastIndexOf('/', index - 1)) {
    const prefix = value.slice(0, index);
    const name = value.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`Archive path exceeds USTAR limits: ${value}`);
}

function writeString(buffer, offset, length, value) {
  const encoded = Buffer.from(value);
  if (encoded.length > length) throw new Error(`USTAR field exceeds ${length} bytes.`);
  encoded.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const encoded = `${value.toString(8).padStart(length - 1, '0')}\0`;
  writeString(buffer, offset, length, encoded);
}

function validateHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new Error(`${label} must be an HTTPS URL without credentials, query, or fragment.`);
  }
  return url;
}

function ensureTrailingSlash(url) {
  const value = url.toString();
  return value.endsWith('/') ? value : `${value}/`;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    result[key.slice(2)] = value;
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = packageOtaRelease({
      distDir: args.dist ?? path.join(rootDir, 'dist'),
      outputDir: args.out ?? path.join(rootDir, 'ota-release'),
      archiveBaseUrl: args['archive-base-url'],
      sourceCommit: args['source-commit'],
      minimumWmappVersion: args['minimum-wmapp-version'] ?? '0.1.2',
      minimumNativeBridge: Number(args['minimum-native-bridge'] ?? '1'),
      channel: args.channel ?? 'flightdeck-release',
      releaseNotesUrl: args['release-notes-url'] ?? '',
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`[package-ota-release] ${error.message}`);
    process.exitCode = 1;
  }
}

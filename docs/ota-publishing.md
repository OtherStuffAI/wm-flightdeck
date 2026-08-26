# Flight Deck OTA publishing

Flight Deck's native-shell release channel is `flightdeck-release`. A push to
that branch runs `.github/workflows/publish-flightdeck-ota.yml`; ordinary
`main` builds and Tower workspace sync do not publish application updates.

## Published contract

The workflow creates an immutable GitHub Release named
`flightdeck-<commit-epoch>` and publishes:

- `flightdeck-<build-number>-<commit-prefix>.tar.gz`;
- the archive's `.sha256` sidecar;
- the canonical `manifest.json` and its `.sha256` sidecar.

GitHub Pages receives only the stable channel manifest at:

```text
https://otherstuffai.github.io/wm-flightdeck/stable/manifest.json
```

The manifest points to the immutable Release archive. Example:

```json
{"archive":{"format":"tar.gz","sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","size_bytes":1234567,"url":"https://github.com/OtherStuffAI/wm-flightdeck/releases/download/flightdeck-1787730000/flightdeck-1787730000-abcdef123456.tar.gz"},"build_id":"ota-1787730000-abcdef123456","build_number":1787730000,"built_at":"2026-08-26T07:40:00.000Z","channel":"flightdeck-release","compatibility":{"minimum_native_bridge":1,"minimum_wmapp_version":"0.1.2"},"release_notes_url":"https://github.com/OtherStuffAI/wm-flightdeck/releases/tag/flightdeck-1787730000","schema_version":1,"source_commit":"abcdef1234567890abcdef1234567890abcdef12"}
```

JSON keys are sorted deterministically. The archive is a sorted USTAR stream
with fixed ownership, permissions, and timestamps, then deterministic gzip.
The build uses the source commit timestamp and SHA instead of mutating
`.build-meta.json`, so retrying the same commit produces the same build identity
and archive. The workflow refuses to overwrite an existing Release.

The archive SHA-256 protects download integrity. Manifest authenticity currently
rests on the configured HTTPS GitHub/Pages origins and repository permissions.
An independently pinned manifest-signing public key is the next security
hardening step; never add its private key to this repository.

## Local validation

```bash
bunx vitest run tests/deterministic-build-version.test.js tests/package-ota-release.test.js

source_epoch="$(git show -s --format=%ct HEAD)"
source_commit="$(git rev-parse HEAD)"
FLIGHTDECK_BUILD_NUMBER="$source_epoch" \
FLIGHTDECK_BUILD_ID="ota-${source_epoch}-${source_commit:0:12}" \
SOURCE_DATE_EPOCH="$source_epoch" \
bun run build

node scripts/package-ota-release.mjs \
  --dist dist \
  --out /tmp/flightdeck-ota-release \
  --archive-base-url "https://github.com/OtherStuffAI/wm-flightdeck/releases/download/flightdeck-${source_epoch}/" \
  --source-commit "$source_commit" \
  --minimum-wmapp-version 0.1.2 \
  --minimum-native-bridge 1 \
  --channel flightdeck-release
```

## One-time GitHub operator setup

No repository secret is required; the workflow uses its scoped `GITHUB_TOKEN`.
Before the first real publication, an administrator must:

1. Create/protect `flightdeck-release` from a reviewed commit.
2. In repository **Settings → Actions → General**, allow workflows to receive
   read/write repository permissions so the declared `contents: write` can
   create Releases.
3. In **Settings → Pages**, choose **GitHub Actions** as the Pages source.
4. Review the `github-pages` environment protection policy. A required approval
   is supported but will pause stable-manifest promotion.
5. Confirm the Pages URL above, or update the WMAPP feed build define if GitHub
   reports a different URL/custom domain.

Do not reuse a release tag, rewrite release assets, or force-push the release
branch. Commit timestamps form the monotonic native build number; if a commit
timestamp would not be newer than the last published number, create a new
reviewed commit rather than altering an existing release.

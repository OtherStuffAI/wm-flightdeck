# Flight Deck unused-code and dead-path report

Date: 2026-09-16

Command:

```bash
bun run unused
```

The report is intentionally non-blocking. It runs Knip with Flight Deck entry
points for the browser app, worker entry points, scripts, tests, Playwright,
Vite, and GitHub workflow files, then exits zero even when findings exist.
`bun run unused:report` is the underlying script and is equivalent.

## What this proves

Knip gives static evidence for unused files, dependencies, exports, duplicate
exports, unlisted imports, and unresolved imports. It does not prove runtime
deadness for feature-flag paths, backend-driven states, workspace-specific
branches, Alpine template expressions, or flows reached only by Tower/Autopilot
records. Treat runtime dead-path claims as hypotheses until covered by focused
unit tests, Playwright flows, production telemetry, or targeted browser probes.

## Current baseline

Latest run:

- Unused files: 1
- Unused dependencies: 1
- Unlisted dependencies: 2
- Unused exports: 68
- Duplicate exports: 4
- Unresolved imports: 0 after ignoring the intentional adjacent-suite schema
  validator path used by `tests/schema-sync.test.js`

## Likely safe cleanup candidates

- `src/crypto/group-key-store.js`: no imports found in source, scripts, tests,
  or templates. The active group key implementation appears to be
  `src/crypto/group-keys.js`. Remove only after confirming no external or
  older migration path imports it.
- `turndown`: present in `package.json` and `bun.lock`, but no source, test,
  script, or docs usage was found. A dependency-only cleanup pass can remove it
  if no pending editor/import work needs it.

## Review-needed candidates

- `scripts/validate-document-browser-replay.mjs` and
  `scripts/verify-retained-activity-browser.mjs` import `esbuild` directly while
  relying on Vite's transitive install. Decide whether to add `esbuild` as an
  explicit dev dependency or rewrite the scripts to use Bun/Vite-owned build
  paths.
- The 68 unused-export findings are mostly exported helpers/constants in active
  modules. Many are used internally in the same file or are plausible test,
  compatibility, or future-extension seams. Review by feature area before
  changing exports.
- `src/worker/sync-worker.js: heartbeatCheck` is exported and called in the same
  module. This is a low-risk export removal candidate only if no tests or
  external probes import it by name.

## Likely false positives or dynamic references

- Alpine template expressions and browser-only probes can hide references from
  static analysis. The Knip entry list keeps known browser probe scripts,
  release-test scripts, workers, and Playwright specs as entries, but any helper
  reached only through generated HTML, backend payloads, or eval-like script
  strings still needs manual review.
- Constants exported from modules such as `src/agent-direct-chat.js`,
  `src/approval-helpers.js`, and `src/workroom-creation-manager.js` are used
  inside their defining module. Knip is correctly reporting unused exports, not
  unused runtime values.

## Keep for migration or compatibility

- Duplicate exports in `src/app-identity.js`, `src/auth/nostr.js`, `src/db.js`,
  and `src/nostr-onboarding-announcements.js` may be compatibility aliases.
  Keep until callers and published contracts are audited.
- The ignored unresolved import
  `../../sb-publisher/src/schema-validate.js` is an intentional suite-level
  schema validator import for environments with the adjacent `sb-publisher`
  checkout.
- Generated schema bundle output under `src/generated/**`, generated `dist/**`,
  local runtime data, and Playwright/test artifacts are excluded from unused-file
  reporting.

## Recommended next cleanup passes

1. Dependency hygiene pass: remove `turndown` if no pending rich-editor import
   work needs it, and decide whether `esbuild` should become an explicit dev
   dependency for the two replay scripts.
2. File-level cleanup pass: verify and remove `src/crypto/group-key-store.js`
   if the old in-memory API has no external consumers.
3. Export-surface pass: review unused exports by domain, starting with helpers
   that are only used internally and have test coverage.
4. Runtime dead-path pass: add coverage-oriented checks for suspected stale
   feature paths before removing behavior. Good candidates are Playwright probes
   around feature flags, workspace/backend modes, and Tower payload-driven UI
   states.

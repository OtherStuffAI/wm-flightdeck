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

- Unused files: 0
- Unused dependencies: 0
- Unlisted dependencies: 0
- Unused exports: 68
- Duplicate exports: 4
- Unresolved imports: 0 after ignoring the intentional adjacent-suite schema
  validator path used by `tests/schema-sync.test.js`

## Completed first cleanup pass

- Removed `src/crypto/group-key-store.js` after confirming no imports in source,
  scripts, tests, docs, or templates. The active group key implementation is
  `src/crypto/group-keys.js`.
- Removed unused dependency `turndown` from `package.json` and `bun.lock`.
- Added `esbuild` as an explicit dev dependency because
  `scripts/validate-document-browser-replay.mjs` and
  `scripts/verify-retained-activity-browser.mjs` import it directly.

## Review-needed candidates

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

1. Export-surface pass: review unused exports by domain, starting with helpers
   that are only used internally and have test coverage.
2. Runtime dead-path pass: add coverage-oriented checks for suspected stale
   feature paths before removing behavior. Good candidates are Playwright probes
   around feature flags, workspace/backend modes, and Tower payload-driven UI
   states.

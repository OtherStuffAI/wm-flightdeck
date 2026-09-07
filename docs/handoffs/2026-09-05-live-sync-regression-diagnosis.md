# FD1874 live record-sync diagnosis — manager callback evidence

Diagnosis only, 2026-09-05 approximately 06:13–06:19 UTC. Flight Deck main c7e6064d8d79cac022f37ab88d667d7ff77401fe. No source/build/runtime changes, installs, cache clearing, sign-outs, DB writes beyond permitted read-sync bookkeeping/baseline read, external posts or task writes. All browser replay used fresh isolated contexts and in-memory HTTP routing, never the user's browser database or a standalone server. Existing operational handoffs were preserved.

## Confirmed failing path

FD1874's production module worker fails deterministically on its first canonical page in installed Playwright WebKit 18.4:

`No workspace database open — call openWorkspaceDb(workspaceDbKey) first`

Path: `src/sync-manager.js:509` runs negotiated workspace sync; `src/pg-read-hydrator.js:1783` awaits the view baseline, then sends the page to the worker; `src/worker/tower-pg-materialization-worker.js:26` opens the workspace singleton; `src/pg-read-hydrator.js:1512` dynamically imports the delta materializer; `src/pg-record-delta.js:123` calls getWorkspaceDb and throws before its transaction.

Built graph: `tower-pg-materialization-worker-C4j7eLLG.js` dynamically imports `pg-record-delta-CMSzEk3E.js`, which statically imports the worker entry again to access its exported database accessor and translators. In WebKit that worker entry evaluates twice. The dynamic child uses the second, unopened database singleton. Diagnostic instrumentation prepended to the served response (only in memory) prints ENTRY_EVALUATION 1 then 2. The second evaluation also registers another request listener.

First failing live page: snapshot, 81 changes / 2 actors, including all 31 channels, 41 audio notes, 1 daily note and 8 documents. Thus a server 200 can leave all channels unmaterialized on first worker use. This does not require a malformed record or a stale cache/cursor. Reset uses the same dynamic module and database accessor, so cache deletion is not an appropriate repair.

A same-worker retry probe is nuanced: first retry produces two replies (failure then success), and the next retry produces two replay-success replies. The production client settles a request on its first reply and ignores subsequent replies. Do not claim permanent failure on every retry; duplicate handlers can report an error while another handler later commits. A new worker recreates the first-use defect.

## Live and browser evidence

Broker helper GET /record-sync?protocol_version=1&limit=200 and GET /resource-view-states?limit=1 both succeeded for the authorized agent viewer. The baseline endpoint was not failing in this probe. No raw keys were accessed. This does not prove Pete's exact identity has the same API outcomes.

Unmodified FD1874 worker in Chrome 152.0.7977.76 applied all 54 captured pages through delta handover: 8,471 changes, 9,072 local applications including dependent rematerializations. First page applied all 31 channels. No canonical page validation/materialization failure reproduced in Chrome.

Unmodified FD1874 worker in WebKit 18.4 fails on that same first page with the above error. A tiny in-memory wrapper module importing the original worker makes entry evaluation occur once and all 54 pages apply successfully. Independently re-bundling the existing generated worker with Rollup `format:'es', inlineDynamicImports:true` into /tmp also makes all 54 pages apply successfully in WebKit. No source rebuild was performed.

Both dist and WMapp's packaged assets currently identify FD1874 and have byte-identical worker SHA-256:
`1189999a89f3191c730b879cc9ee30e204f23fba6b43ad24f83e8494706bba54`.

## Smallest proposed fix, not implemented

At `vite.config.js:399`, retain ES module workers and inline worker dynamic imports:

```js
worker: {
  format: 'es',
  rollupOptions: { output: { inlineDynamicImports: true } },
},
```

This removes the generated dynamic-child-to-worker-entry cycle, avoids duplicate database state/listeners, and requires no shared Tower contract, cache migration or reset. The isolated Rollup experiment validates that bundling mechanism, not a complete Vite release build. An alternative is a tiny worker entry with all implementation in an imported runner module; the wrapper experiment validates that mechanism too.

After implementation authorization: test actual Vite output in both Chrome and WebKit, first snapshot and delta, same-worker retries (exactly one reply), explicit reset, rollback/restoration and pending recovery. Run bounded full suite and normal release/build verification; verify both worker entry points because the build option applies globally. Then, with appropriate runtime/install authorization, verify the physical WMapp app and affected web instance. No source fix is justified for unrelated browser error strings until their exact errors/versions are captured.

## Reproduction and artifacts

Captured live pages: /tmp/fd1874-live-page-0.json through -53.json. These include private workspace records and opaque cursors; keep local, never commit/post them. /tmp/fd1874-live-view.json contains the baseline read response. The replay reads these captures; no keys or network are needed in offline mode.

From the existing checkout/environment:

```sh
DIAG_WEBKIT=1 DIAG_OFFLINE=1 node /tmp/fd1874-live-worker.mjs
DIAG_WEBKIT=1 DIAG_OFFLINE=1 node /tmp/fd1874-evaluation-probe.mjs
DIAG_WEBKIT=1 DIAG_OFFLINE=1 node /tmp/fd1874-retry-probe.mjs
DIAG_WEBKIT=1 DIAG_OFFLINE=1 DIAG_WRAPPER=1 node /tmp/fd1874-live-worker.mjs
DIAG_WEBKIT=1 DIAG_OFFLINE=1 DIAG_FLAT=1 node /tmp/fd1874-live-worker.mjs
```

Flat replay expects /tmp/fd1874-flat-worker.js, produced using installed Rollup with input dist/assets/tower-pg-materialization-worker-C4j7eLLG.js and output `{file:'/tmp/fd1874-flat-worker.js',format:'es',inlineDynamicImports:true}`. Omit DIAG_WEBKIT for Chrome. Instrumentation/retry probes use only the first captured page. Main replay script is capped at 100 pages. Result summaries/logs: /tmp/fd1874-live-worker-result.json, /tmp/fd1874-webkit-result.json, /tmp/fd1874-webkit-wrapper-result.json, /tmp/fd1874-webkit-flat-result.json and matching WebKit .log files.

Existing focused tests passed:
- `bun run test tests/pg-record-delta.test.js tests/pg-record-rollback.test.js tests/tower-pg-materialization-worker-client.test.js --maxWorkers=4`: 3 files / 53 tests.
- `bun run test tests/incremental-cache.test.js tests/pg-read-hydrator.test.js --maxWorkers=4`: 2 files / 107 tests. Includes synthetic old-schema upgrade preserving cached rows/pending commands/cursor.

## Limits

No live phone console, actual failed web error strings/browser versions, Pete-owned signing session, existing affected browser IndexedDB, or old live tab was available. WMapp packaging handoff reports iOS 26.6.1; Playwright WebKit 18.4 is not that physical WKWebView build. This is a confirmed shipped-artifact WebKit defect and a strong explanation for first-use failures, not proof that every reported error has this cause. API signing/CORS and full Alpine navigation were not exercised by isolated worker replay. Summary-backfill command was not invoked by the replay. Manager owns the independent live Tower migration/log diagnosis and final acceptance.

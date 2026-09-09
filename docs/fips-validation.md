# Tower FIPS delivery validation

Flight Deck build **1915**, build ID `20260909-0637-2-1915`, contains the native
v2 transport consumer. Setup and endpoint usage are in `fips-transport.md`.

## Source and build checks

- Final focused transport, connection controls, API, worker, SSE, service
  ownership and release-note tests: **89 passed** across nine files.
- Production WMapp generated JS connected to the actual Flight Deck worker
  transport over a real MessageChannel: **passed**, including binary bodies,
  Authorization/status/headers, streaming and `detachWorker` cancellation.
- `bun run build`: passed. `dist/version.json` reports build 1915.
- `bun run verify:dist`: passed. Generated `dist/` remains uncommitted.
- `git diff --check`: passed.
- `check:public-source`: fails on existing tracked handoff documents and markers.
  The staged changes introduce **zero** findings. No unrelated files or policy
  rules were removed or changed to make the check pass.

Final serial full suite (`bun run test --maxWorkers=1`): **3694 passed,
3 failed, 1 optional cross-repository test skipped**. The optional production
bridge test was run separately and passed. Final focused coverage also includes
connection approval-race and additional preference tests added after full-suite
collection.

Remaining full-suite failures:

1. `chat-file-drop.test.js` expects `type="file" multiple aria-label=` in the
   attachment template. The same exact-selector mismatch is present in HEAD
   before this work (zero matches); those controls were not changed here.
2. `inbox-bounded-reads.test.js` hit its 120-second limit for 100,000 replies in
   later runs. It passed in the initial full suite (56.6 seconds for that case).
3. `pg-materialization-responsiveness.test.js` hit its 10-second limit in full
   runs and passed separately (9.5 seconds). These stress tests and their DB
   implementation were not changed. The timeouts remain validation limitations;
   their thresholds were not relaxed.

The full-suite pass is therefore incomplete. Failed request-order expectations
introduced by the new transport snapshot message were corrected, with regression
coverage proving the selected route reaches the worker even if key export fails.

## Browser and native evidence

The configured managed Flight Deck runtime, serving the generated dist, was
opened using Playwright with installed Chrome. An isolated synthetic page state
exercised Connection → FIPS, the explicit unsupported-WMapp error, and returning
the selector to HTTPS. External requests were blocked for this UI smoke. This is
not authenticated workspace acceptance or a substitute for native WKWebView.

The WMapp producer and independent reviewer exercised production Dart/JS in
stock HTTPS WKWebView, including binary upload/download, SSE and a real worker
port. Native source also has exact mesh signer-pairing and revocation regressions.
Those results belong to WMapp's `docs/fips-tower-bridge.md`; running-binary claims
must identify the final bundle/version, not just a passing fixture.

Tower commits `f2f6d65` and `7ba8336` implement dedicated ingress and the native
host-to-Docker gateway. The primary worker independently reran **18 tests / 139
assertions** using Tower's documented synthetic environment. They cover exact
Host/URL/body/signature binding, forwarding-hint rejection, TCP streaming and
cancellation. The manager activated committed Tower source separately from
unrelated worktree changes and reported HTTPS/mesh health with the same service
identity and wrong-Host rejection.

## Remaining live acceptance

The manager owns final acceptance and task-state transition. Brokered live mesh
signing is currently denied by the session's allowed-origin grant. A narrowly
issued/reissued broker capability is required; no raw-key fallback was used and
no Autopilot restart was performed by this worker.

After that grant and final native bundle activation, exercise actual signed
workspace reads/writes and ACL denials over both transports, storage round trip,
SSE committed-cursor recovery, offline queued-write recovery, same-origin reload
and HTTPS/iPhone regression. Source, generated artifacts, native fixtures and
mesh health are not a claim that this entire live acceptance matrix has passed.

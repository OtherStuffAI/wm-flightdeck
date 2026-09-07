# Protocol rollback pickup — manager handoff

Task a39adf78-ce5e-4a26-834f-6d45b0e358ad, workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9. Source checkpoint 03de674; focused continuation committed on main as c7e6064 (`fix(sync): recover legacy sync after record protocol rollback`). Six public files, 247 insertions, 14 deletions. Task remains in_progress; manager owns acceptance and the Pete thread. No independent thread post, Tower edits, deployment or shared runtime restart.

## Result and reflection

Unsupported /record-sync 404/406/501 now selects legacy for that sync run after initial use, persisted partial snapshots/deltas, or disappearance between committed pages. Only the saved legacy cursor is sent to /sync; caller cursor and forceSnapshot hints cannot reset or cross-wire rollback cursors. Canonical/local cache, unresolved commands and saved v1 cursor/generation survive the protocol switch. The next service sync probes v1 with its own cursor; a restored producer either resumes it or returns explicit reset_required.

forceSnapshot is now a legacy-only refresh hint. V1 resumes its saved server-owned cursor rather than eagerly using the ACL purge path before negotiation. Explicit 403 still purges/hides and throws with pending recovery retained; reset-required409 retains existing bounded reset/retry behaviour. Generic400/409/500, network failures and malformed/materialisation errors never downgrade. Unsupported responses during reset recovery, including persisted resetting state, fail closed.

Reflection exposed an additional race: delayed legacy pages could otherwise repopulate revoked authority after a concurrent v1 reset. The existing worker transaction now compares the captured v1 cursor and localGeneration before applying each fallback page. This adds one sync_state primary-key lookup per legacy fallback page; no visible-view query/index/materialisation algorithm redesign or history scan was added. No unrelated large benchmark rerun was warranted. Prior benchmark numbers/limits remain in the earlier status and public performance JSON; this pickup makes no new latency claim.

## Exact validation

- `bun run test tests/pg-record-rollback.test.js tests/pg-record-delta.test.js tests/pg-read-hydrator.test.js tests/release-notes.test.js --maxWorkers=4`: PASS, 4 files / 151 tests, 1.48s. Includes 26 new rollback tests, stored/partial/first snapshots, all three unsupported statuses, independent restoration, mid-snapshot disappearance,403, reset409, malformed/error refusal, absent legacy cursor, v1 reset/advance races and force-refresh CAS.
- `bun run test --maxWorkers=4`: PASS, 250 files / 3421 tests, 27.59s. Default unrestricted concurrency was not rerun, per dispatch.
- `bun run check:public-source`: exit1, unchanged107 findings in existing tracked handoffs. Repeated after staging all six public files; `cmp /tmp/fd-rollback-public-before.log /tmp/fd-rollback-public-staged.log` exits0 (byte-identical reports). No checker changes, new findings, bypass or prohibited operational files committed.
- `bun run build`: PASS; Vite3.29s; generated dist/version.json buildNumber1874 / buildId20260905-0420-3-1874. Normal existing chunk-size warning retained.
- `bun run verify:dist`: PASS,2 asset references.
- `node scripts/verify-incremental-worker-browser.mjs`: PASS, Chrome152.0.7977.76, actual generated tower-pg-materialization-worker-C4j7eLLG.js. Canonical fixture applies14 local materialisations; stale v1 cursor rejected; valid independent legacy fallback commits; stale fallback generation rejected. In-memory HTTP routes only, no backend/runtime or standalone server.
- `bun run test tests/release-notes.test.js --maxWorkers=4` after build: PASS,8 tests,215ms.
- `git diff --check` and `git diff --cached --check`: PASS before commit.
- `cmp tests/fixtures/flightdeck-record-delta-v1.json ../tower/tests/fixtures/flightdeck-record-delta-v1.json`: PASS; producer contract path ../tower/docs/design/flightdeck-record-delta-v1.md at1ee972c. No Tower changes.

Public rollout semantics and regression references are committed in docs/design/incremental-cache-and-bounded-views.md. Release notes and metadata use1874. Generated dist remains ignored/uncommitted. Existing four untracked handoffs were preserved byte-for-byte; this new operational status stays untracked because handoffs are prohibited public source. No status updates were made to the previous handoff files.

## Manager acceptance still required

Review c7e6064 and keep broader task in_progress pending acceptance. Authenticated local-Tower rollback/restoration/ACL application flow and real scroll/load-more/old-tab pass remain necessary; isolated worker/fixture checks are not shared-runtime acceptance. Earlier physical desktop/mobile budgets, production migration/index storage measurements and cross-component runtime validation remain outstanding. No restart or deploy was authorized/performed. Manager handles final thread/review transition. Final callback reports this checkpoint and the task comment.

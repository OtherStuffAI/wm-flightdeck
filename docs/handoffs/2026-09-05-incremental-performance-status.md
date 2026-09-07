# Flight Deck incremental performance — manager evidence

Task a39adf78-ce5e-4a26-834f-6d45b0e358ad. Flight Deck implementation only on shared main. Tower changes belong to its concurrent worker. No restart, deployment, raw-key access, stash/reset, thread reply or task review-state mutation. Task remains in_progress for manager acceptance. Session goal is set and nextAction is reflect.

## Implemented

Dexie v25 additive migration/backfill; indexed message/task/comment client identities and guarded partial reconciliation; complete snapshots are explicit. Bounded root/reply/comment windows and actual visible older controls; all task sort modes and exact counts with indexed board keys; indexed substring/tag/assignee/recent candidates; overview/files source-history paging. Task index arrays stay out of Alpine cards. Equal-timestamp, huge-thread, deleted-comment, old timestamp and >80 pending/failed-message tests cover edge cases.

Negotiated /record-sync v1 consumer uses Tower's exact contract at ../tower/docs/design/flightdeck-record-delta-v1.md and byte-identical tests/fixtures/flightdeck-record-delta-v1.json. Atomic canonical rows/tombstones/BigInt guards/actors/related summaries/cursor; local entity-version protection; separate legacy cursor; reset-generation CAS; snapshot omission retirement only after handover. Actor identities support restricted viewers without workspace.read and remain available when independent assignments rematerialize their task. Metadata-only document updates preserve hydrated bytes and incoming canonical ID. Pending edits/commands survive; conflicts are visible, recoverable, resolvable and automatically rematerialized after acknowledgement. Local read-watermark counts clear atomically; first-view baseline and actor-aware unread equivalence retained. Bounded resumable summary backfill.

Detailed inventory, sorting semantics, rollout and limitations: docs/design/incremental-cache-and-bounded-views.md. Native final benchmark evidence: docs/design/incremental-cache-performance-results.json (final native run).

## Validation

- Focused latest cache/consumer pass: 2 files, 36 tests passed (13 cache + 23 consumer).
- Full suite: `bun run test --maxWorkers=4`: 249 files, 3395 tests passed, 27.31s.
- Default `bun run test`: 248 files passed, 1 failed; 3394 tests passed, 1 failed; 19.65s. Failure is the 20,000-row worker test's 10s timeout under broad parallel load. Same test passes focused and in the bounded-concurrency full suite; no timeout weakening applied.
- Focused 20k worker measurement: 3629ms total, 1558 caller ticks, maximum event-loop delay 5ms.
- Production module worker Chrome smoke: passes canonical snapshot (14 local materialisations), rejects stale cursor; Chrome 152.0.7977.76. Source-only worker tests would not have detected the Vite output-format issue; workers now use ES module chunks and actual dist chunks were exercised.
- Release notes authored for final build 1873. Initial build 1872 failed on Vite worker IIFE/code-splitting configuration; corrected module output, ordinary build 1873 passed. dist/version.json: buildNumber1873, buildId20260905-0405-2-1873.
- `bun run verify:dist`: passes (2 entry asset references); production worker smoke additionally loads worker chunks.
- `bun run check:public-source`: fails with 107 pre-existing findings, all in unchanged tracked handoff files (prohibited paths/private markers). Do not remove shared files or bypass the checker. Staged source/fixture/design checks have exactly the same107 findings, zero new findings.
- `git diff --check`: passed; staged check also passed.

## Performance and unmet acceptance

Native IndexedDB harness uses 1k/10k/100k messages, tasks and comments, 15 samples each, fixed21 chat/comment and fixed50 task windows. It counts IndexedDB-delivered values/keys and write requests, including Dexie hook reads, not internal B-tree visits. Native desktop and CPU4 mobile-emulation reports include payload bytes, queries, one-row materialization and a simple DOM/rAF harness. Exact final numbers follow in the JSON evidence. Preliminary 100k values: chat22, comments21, task51; local single-row update2 values/1 write; canonical one-message delta6 values/5 writes (canonical/local/summary/cursor/conflict bookkeeping). No unrelated history rewrite. Initial full-history baseline reads100000 values.

Index cost is material: representative327-byte task becomes2625-byte local JSON value with21 board-sort entries and20 search-token entries. This excludes physical index pages, storage-engine compression/overhead and long-description token growth. Schema migration is a one-time history operation. Fake-indexeddb update timings scale with its synthetic storage internals and are not browser latency claims.

Unmet acceptance explicitly: physical desktop/mobile comparison and agreed absolute budgets; authenticated local-Tower application/UI/scroll/load-more and real old-tab migration pass; cross-component shared-runtime negotiation/ACL smoke; production-sized migration/index storage measurements. No shared-runtime update is authorized here. Arbitrary common substring searches remain candidate-count dependent for exact matching/counts. Overview/files filters cover loaded source activity and expose an older-activity control. Optional metadata/unadvertised legacy families retain existing collection behavior. Do not interpret isolated fixture/native-worker checks as full runtime acceptance.

## Shared-tree checkpoint

Committed `03de674` (`perf(cache): reconcile record deltas and bound cached views`):34 files,3635 insertions,159 deletions. Final staged/source diff checks passed. Release/build configuration checks:4 files,30 tests passed (including8 release-note tests). Keep the two initially untracked handoffs and this requested manager status file on disk; docs/handoffs is explicitly prohibited by the repository public-source checker, so these files are unsafe to add to a public-source checkpoint. No existing handoff content was changed. Commit all compatible tested source, fixtures, scripts, public design/evidence, release notes and metadata; never generated dist.

## Final native evidence

Chrome152 native IndexedDB,15 samples,100k rows per message/task/comment family: desktop chat21 median1.1/p954.3ms, comments21 0.4/0.5ms, task50 2.8/4.6ms; canonical one-message delta0.7/1.3ms. CPU4 mobile emulation: chat4.5/11.7ms, comments1.9/3.4ms, task4.7/6.1ms, canonical delta2.7/6.0ms. Value reads remain22/21/51 and6 respectively; canonical writes5. Desktop full-history baseline310.5/364.0ms for messages and1387.0/1678.5ms for tasks; mobile baseline507.6/563.5ms messages and3381.1/3839.1ms tasks.

Do not omit the tail-latency limitations: one-task update mobile median4.2/p95176.6ms, desktop0.6/14.0ms; the21-row DOM/double-rAF harness measured desktop266.5/273.2ms and mobile216.1/300.8ms. These simple-frame timings are not authenticated app render measurements and are dominated by browser scheduling; they do not establish UI budgets. Full1k/10k/100k data, per-store instrumentation and payload sample319 bytes are saved in the public evidence JSON. Physical index storage is not measured (327-byte input task /2625-byte indexed local JSON value is only a value-size example).

Final tracked tree is clean; the three named handoffs remain untracked for the public-source policy reason above. No generated dist committed. Manager acceptance, physical/runtime measurements and task review-state transition remain outstanding.

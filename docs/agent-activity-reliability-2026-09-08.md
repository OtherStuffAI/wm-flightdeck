# Agent working update reliability — implement all five fixes
The requester explicitly requested implementation on 2026-09-08: "Please implement all these changes now."
User symptom: working updates disappear and return while the agent still works; history intermittently available. The requester proposed 60 seconds; agreed behavior below.

## Required deliverable
Implement and validate all five fixes across <suite-root>/flightdeck, <suite-root>/tower, <suite-root>/autopilot.
1. Preserve received working panel during connection loss. Start reconnect immediately; first 60 seconds show Reconnecting; thereafter Connection lost—status unknown, keeping content. Never infer stopped/completed from silence or expiry.
2. Automatically recover missed updates and reconcile authoritative state on reconnect/fallback recovery; retry activity-fetch failures visibly and boundedly. Preserve workspace/turn isolation and avoid duplicate polling.
3. Every received commentary enters ordered, deduplicated history consistently through live events and full reload. Do not coalesce away history while coalescing current snapshots.
4. Retain history independently of live freshness TTL. Confirmed completed/failed/cancelled becomes collapsed finished entry with accessible history after refresh; later runs must not make earlier history inaccessible. Avoid unbounded full-history hydration: appropriate scoped/limited API loading.
5. Autopilot publishes every unseen explicit user-visible commentary entry, checkpoints only after accepted delivery, retries pending failures durably including terminal/recovery paths; handle burst messages, equal timestamps, restart replay, and no duplicate history. Do not expose internal reasoning or tool secrets.

## Confirmed source evidence
Flightdeck src/agent-activity.js selector filters health !== live and terminal states; reconnect causes immediate hide. pg-read-hydrator.js around 2272 merges history only full GET and skips terminal; around 2810 coalesces live updates then writes latest only. db.js around 2393 removes commentary on authoritative absence. Activity hydration errors ignored around 2073.
Tower src/services/flightdeck-pg-api.ts listFlightDeckPgAgentActivities deletes expired rows; schema/001_init.sql commentary FK ON DELETE CASCADE. Publisher working TTL300s, terminal60s.
Autopilot src/agent-chat/agent-activity-publisher.ts advances latestCommentaryAt/lastBody before delivery; two attempts then skipped on later poll. src/agents/codex-session-messages.ts latest-only activity extraction. Publication store emitted claims also need safe recovery after crash.
Read live code; line numbers may move. Local publication sample Sept7 onward 203 accepted, zero recorded failed: delivery failure is a demonstrated code risk, not confirmed incident.

## Architecture and constraints
Latest local published architecture is v4 under <legacy-suite-root>/artifact-wapp/artifacts/Wingman_Suite/wingman-suite-arch/v4/excalidraw-scene.json (nested scene.elements). Read saved scene and visual relationships. Critical v4 contract: TowerSyncService sole network/update owner for SSE/cursor recovery, fallback polling, initial hydrate, ensureLoaded, coalescing and materialisation -> Dexie -> liveQuery -> Alpine. No component-owned fetch/poll workarounds.
Tower owns shared history, Autopilot execution/publication, Flightdeck UI. Implement backward-compatible Tower contract first then consumers. Do not redesign unrelated systems.
Read all applicable repo instructions. Default main in each repo, preserve concurrent work. Inspect full worktree and commit all nonignored tested state unless clear safety reason; no resets/rebases/force pushes or discarding others. Do not push deployment branches or restart Autopilot. Implementation/build/tests are authorized. Report runtime activation still needed accurately. Never raw-key signing; broker only.

## Validation and reporting
Add meaningful regression tests for reconnect (<60/>60 seconds), confirmed terminal, expiry history reload, burst SSE and commentary, duplicate/out-of-order replay, delivery failure then recovery, restart recovery, equal timestamps, workspace/turn boundaries. Run native repo relevant suites and builds/typechecks required by repo. Use isolated test databases only; no destructive live data tests.
Keep progress in local docs and report milestones via dispatch status output. Manager posts task/chat. Do not send external chat or task comments yourself; report validation, exact commits, remaining concerns, activation steps to manager. Task must reach review only after manager accepts.
This is implementation, not diagnosis. Work until all five complete or concrete blocker. You may delegate bounded independent repo subtasks if helpful, retaining integration responsibility.

## Implementation progress

- Tower committed af94b9f7f670bdcd8d627fd5d15a05c277a359d6; retained lifecycle/history, scoped bounded APIs, late commentary replay, 58 isolated native tests pass.
- Flight Deck retains received/finished panels, merges every SSE commentary before snapshot coalescing, recovers known turns through bounded forward pages, and supports older commentary/run paging via TowerSyncService. Scoped Inbox recovery and thread startup coverage are included.
- Focused browser-source suites pass. Full suite uncovered one updated-call assertion (fixed) plus a preexisting worker responsiveness timeout reproduced on unchanged HEAD in an isolated archive. Final suite excluding that known baseline test is running.
- Public-source check fails on existing tracked handoff documents. A concurrent shared checkpoint includes the supplied task briefs; they add handoff/personal-context findings to the existing quality-check failure. No unrelated cleanup performed.
- Autopilot durable publication and transcript recovery are being finalized. Manager owns external reporting/review acceptance and runtime activation. No inherited broker routing was available to read task comments here.
- Design and activation contract: docs/design/agent-activity-reliability.md.

## Final handoff

All five source fixes are implemented. Tower delivery-cursor follow-up is a8d1885c9e6dc7395451730b62114f3968b41aa4 (after af94b9f7); Autopilot is 4c516063691539ed14f812f64bdbe3880088ffc9. The shared Flight Deck implementation checkpoint is f192948; the final recovery guard/build checkpoint follows it. Final build: 20260908-0616-10-1908, build 1908. `verify:dist` and whitespace checks pass. Controlled full suite: 3659/3659 tests (265 files), excluding the unchanged-HEAD 20,000-row worker timeout; final guard/release/hydrator suite:113/113 including the new selection guard. Existing/public-context source quality failures are reported, not hidden. Full details and activation checklist: docs/design/agent-activity-reliability.md. Manager acceptance and activated local-Tower browser smoke remain necessary; no review-state mutation or external message was sent.

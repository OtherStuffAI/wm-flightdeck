# Agent working update reliability — implement all five fixes
Tracking task: @[Keep agent working updates visible and recover complete history](mention:task:74005209-69cb-4074-b548-e9eeffd3f435). Read task and latest comments through Flight Deck broker tools where available; local brief is complete if worker lacks inherited routing. Manager handles external reporting.
Pete explicitly requested implementation on 2026-09-08: "Please implement all these changes now."
Origin: @[Features](mention:channel:0617d526-88dc-4dc2-9876-08349ab60eca), thread baaca1d9-5bcb-49bb-8f7f-74e253e18af3, @[Implementation request](mention:message:d863e3f9-480b-478f-bc47-9d382d0f5cb0).
Workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9; scope 76d518f7-c477-4374-bf74-5d36fda570ed.
User symptom: working updates disappear and return while the agent still works; history intermittently available. Pete proposed 60 seconds; agreed behavior below.

## Required deliverable
Implement and validate all five fixes across /Users/mini/code/wm/flightdeck, /Users/mini/code/wm/tower, /Users/mini/code/wm/autopilot.
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
Latest local published architecture is v4 under /Users/mini/code/wingmanbefree/artifact-wapp/artifacts/Wingman_Suite/wingman-suite-arch/v4/excalidraw-scene.json (nested scene.elements). Read saved scene and visual relationships. Critical v4 contract: TowerSyncService sole network/update owner for SSE/cursor recovery, fallback polling, initial hydrate, ensureLoaded, coalescing and materialisation -> Dexie -> liveQuery -> Alpine. No component-owned fetch/poll workarounds.
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
- Public-source check fails on existing tracked handoff documents. Existing untracked private task briefs remain local, as committing them would add prohibited handoff/personal-context content. No unrelated cleanup performed.
- Autopilot durable publication and transcript recovery are being finalized. Manager owns external reporting/review acceptance and runtime activation. No inherited broker routing was available to read task comments here.
- Design and activation contract: docs/design/agent-activity-reliability.md.

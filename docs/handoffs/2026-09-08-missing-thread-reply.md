Fix newly sent replies missing from the open Flight Deck thread.

Pete reported 2026-09-08: "After sending a reply to a chat thread, i no longer see my reply i have to exit and then open the chat thread again at which point it loads."
Origin: @[features](mention:channel:0617d526-88dc-4dc2-9876-08349ab60eca), @[Reported missing reply](mention:message:52c7693e-aa41-438b-ace0-a4cf99e4fc93), thread 4b47be78-563c-476b-b807-6bd1f13b4d05.
Workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9; scope 76d518f7-c477-4374-bf74-5d36fda570ed; Tower https://sb4.otherstuff.studio.

Implement in /Users/mini/code/wm/flightdeck only. Strong hypothesis (unconfirmed): send persistence succeeds but visible thread projection/cache subscription fails to incorporate the reply; reopening reloads it. Investigate send acknowledgement, optimistic/canonical identity reconciliation, Dexie subscriptions, current thread selection and refresh races. Read applicable AGENTS and repo instructions. Existing concurrent changes touch chat-message-manager, app, db, sync and activity; preserve and integrate these. Default main; inspect complete worktree and commit all nonignored tested state, never discard concurrent edits. No pipelines. Do not restart Autopilot. Build authorized; routine affected app restart allowed if necessary with health verification, but no remote deployment/OTA publication requested. Do not claim installed-client activation from source/build alone.

Acceptance: sending in an already-open thread immediately displays the pending/accepted reply without navigation; accepted reply remains visible once with no duplicates after server/SSE echo; delayed refresh cannot erase it; switching threads mid-send does not leak messages. Add meaningful regression coverage for the failing path; run focused tests, bun run test, bun run build and relevant dist checks. Report exact tests, failures, commit, remaining runtime smoke checks. Stay in this repo unless evidence requires cross-repo changes; report before changing shared contracts (architecture reference required then).

Manager handles Pete-facing thread and task updates. Worker must read task/latest comments via CLI using explicit workspace; report progress and final evidence through supervised session output, no duplicate chat replies. Set worker metadata goal and next-action reflect; stop when handoff is complete.

Task: @[Show newly sent replies immediately](mention:task:6fa50d65-c797-45d7-a1cf-88c05f5a78a3).

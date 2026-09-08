Task: @[Fix agent mentions and orphaned chat/thread messages](mention:task:3d17ed15-244a-46c3-83e7-3e4151ad8fbf)

# Fix agent mention loading and orphaned chat messages
Pete reports on 2026-09-07:
1. Entering a chat often leaves agents unavailable for @ mentions until he opens channel settings or Setup Groups.
2. Messages starting threads or replying to threads repeatedly become orphaned; Pete suspects local-record-to-sync reconciliation. This is a hypothesis, not a proven cause.

Origin: @[Bug report](mention:message:c188448c-2750-4f68-b3b0-c03b820ff863) in @[features](mention:channel:0617d526-88dc-4dc2-9876-08349ab60eca).
Workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9; scope 76d518f7-c477-4374-bf74-5d36fda570ed; thread ccc081a8-8295-4813-89e5-81451cda1817.
Screenshots storage://006e5fba-848b-4768-80da-d23e47e5db2c and storage://b12623c3-be02-42f0-8325-ec5189c29835. Manager is downloading them to /tmp/<object-id>.png; inspect with image tool when available. If unavailable report limitation and investigate from code.

Workdir /Users/mini/code/wm/flightdeck, main. Read AGENTS.md, README.md, docs/checkout_semantics.md, relevant docs/design. Preserve concurrent work; commit all compatible nonignored tested state. No destructive Git, stash, ignored scaffolding or drive-by fixes. Dist is ignored. Work only in Flight Deck; if backend/shared-contract changes are proven necessary, report to manager before expanding. Resolve/read latest Suite architecture whiteboard before any architectural/cross-repo changes.

Investigate and implement both fixes. Reproduce each with meaningful regression tests first. Trace agent directory hydration, mention lookup and workspace isolation; trace optimistic/local message IDs, canonical IDs, thread roots/replies, translator/worker flush/pull/SSE reconciliation and navigation. Verify thread creation, reply while parent pending, canonical response before/after SSE, reload and retry cannot duplicate, lose or orphan messages. Preserve scroll and author-signed message semantics. Do not mutate historical chat data without an exact justified repair proposal.

Acceptance: @ agents available directly after entering chat from cold/reload state without settings workaround; switching workspaces does not leak agents. New thread roots and replies retain correct canonical parent/thread after send, sync, refresh, retry; no disappearing/duplicate/orphan messages. Cover realistic PG/local shapes and asynchronous ordering.

Validation: focused regressions, bun run check:public-source, bun run test, release-note tests and version per docs/release-notes.md, bun run build, bun run verify:dist, git diff --check. Confirm dist/version.json. Use configured Wingman runtime, no standalone server or remote deployment. Routine affected app restart authorized if needed; never restart Autopilot. Browser tests default local Tower; report real-browser limitations precisely.

Read latest task/comments and origin thread before work and handoff. Manager owns user-facing chat; worker posts concise diagnosis and validation evidence to task only, leaves in_progress for managerial review. Report commit, files, root causes, tests and counts, build version, runtime/deployment status and concrete Pete test steps through supervised callback. Set worker goal and nextAction reflect while working, stop at terminal handoff. Use broker-aware tools; never raw keys.

Work the Flight Deck task `@[Stabilize Nostr avatar loading and fallback for Rick](mention:task:752d5bcf-0af3-490e-a8f1-03d0b40c9556)` in workspace `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`.

Read the full task and its latest comments first. Then read the complete implementation brief at:

`/Users/mini/code/wm/flightdeck/docs/handoffs/2026-08-26-rick-nostr-avatar-reliability.md`

Core goal: reproduce and fix Rick's sporadically missing Nostr avatar without hardcoding Rick. Prove the actual URL/cache/render failure. Fix the Flight Deck-owned reliability issue and add a reusable browser image-error fallback so broken avatar URLs switch cleanly to initials, do not leak alt text or shift layout, and can recover when the resolved URL later changes. Cover main chat, thread, task/document comment, and other shared avatar surfaces through a coherent helper/pattern. Preserve Nostr profile refresh, address-book caching, workspace-key resolution, identity-card interactions, accessibility, and dimensions.

Use `/Users/mini/code/wm/flightdeck` on `main`. The shared worktree was clean and `main` was 14 commits ahead of `origin/main` at dispatch. Preserve concurrent work. Before committing, inspect the full worktree and commit all nonignored tested state after understanding it; do not discard or overwrite unfamiliar changes.

Report to the Flight Deck task, not the originating chat directly:

1. Post a concise investigation milestone once the exact failure path and implementation boundary are proven.
2. Implement the fix and regression tests.
3. Run focused Vitest coverage, relevant broader tests, and `bun run build`; include regenerated `dist/`.
4. Post a completion comment with diagnosis, changed files/behavior, exact test/build results, commit hash, and remaining manual verification.
5. Move the task to `review` only when it is validated and genuinely ready for Pete.

Use the broker-aware Flight Deck MCP/CLI. Task ID: `752d5bcf-0af3-490e-a8f1-03d0b40c9556`; workspace ID: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`; origin thread: `d3a8b3f2-e921-4f60-af2f-f3862db0fa0b`; origin message: `4e6523e3-8a85-4f3e-9142-f40cdb6d1058`.

Do not push, deploy, start a preview server, or restart Flight Deck/Autopilot managed processes. Stay in this repo unless evidence proves a cross-repo contract defect; report that before expanding scope.

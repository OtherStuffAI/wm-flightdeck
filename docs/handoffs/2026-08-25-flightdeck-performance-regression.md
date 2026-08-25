# Flight Deck performance regression investigation

## Goal

Diagnose and remediate the severe Flight Deck access slowdown Pete reported on 2026-08-25. The slowdown appeared during the preceding four hours and affects both wm-app and standard web browsers.

## Source and reporting

- Flight Deck workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`
- Scope: `76d518f7-c477-4374-bf74-5d36fda570ed`
- Channel: `0617d526-88dc-4dc2-9876-08349ab60eca`
- Thread: `3cc0213b-b1d9-4938-b1a9-9e4eb8a67df2`
- Trigger message: `0bafe600-9bd6-4325-98c8-97325a834862`
- Task: `1c4113b6-f8da-4d02-b7f9-ea4f519cfbbc` (`Investigate Flight Deck severe access slowdown`)

Pete's report: "in the last 4 hours the changes to flight deck have really really slowed down accessing the site in both wm-app and via a standard website"

Post durable technical progress and validation to the task. Post concise milestones to the originating thread after diagnosis, after the main fix, and after tests/build. Use Flight Deck mention tags in user-facing text rather than raw IDs.

## Working scope

Primary repo and workdir: `/Users/mini/code/wm/flightdeck`.

Start by establishing whether the delay is:

- document/app asset delivery or first-load latency;
- oversized or newly duplicated frontend initialization work;
- repeated or serial Flight Deck PG/Tower API requests;
- a render/event loop or reactive subscription regression;
- service worker/cache behavior shared by wm-app and browsers;
- a deployment/runtime/API issue outside this repo.

Use recent git history and current local state to narrow changes from the reported four-hour window. Inspect browser-visible network/request behavior or existing instrumentation where feasible. If the cause is outside this repo, stop short of unrelated cross-repo changes and report the concrete evidence and correct target repo/component.

## Implementation constraints

- Work on `main` unless there is a proven reason not to.
- The worktree is shared and currently has concurrent untracked handoff material. Preserve it.
- Do not reset, revert, discard, or overwrite changes you do not understand.
- Implement the smallest safe correction supported by evidence.
- Do not restart the Flight Deck/Autopilot managed process. If a restart is required, report exactly which process and why so Pete can approve it.
- When ready, commit all nonignored tested worktree state so the repo captures the tested state, including concurrent nonignored changes unless there is a clear safety reason to pause.
- Do not deploy unless Pete explicitly asks.

## Acceptance criteria

1. Identify the dominant slow path with concrete evidence (timings, request counts, profiling output, bundle delta, or a reproducible code path).
2. If repo-local, implement a focused fix and add or update regression coverage where practical.
3. Record before/after evidence where practical.
4. Run focused tests and `bun run build`; run broader tests if the change warrants them.
5. Commit the tested worktree state and report the commit hash.
6. Re-read current task comments before handoff, add validation evidence, and move the task to `review` if ready.
7. Send a concise completion or blocker update to the originating chat thread.

## Useful commands

```bash
bun ~/code/wm/autopilot/clis/wingman.ts flightdeck task show 1c4113b6-f8da-4d02-b7f9-ea4f519cfbbc --workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9 --json
bun ~/code/wm/autopilot/clis/wingman.ts flightdeck task comments 1c4113b6-f8da-4d02-b7f9-ea4f519cfbbc --workspace 2e5caefd-dd65-45d2-b747-ee874e8e5fc9 --json
```

# Hosted Flight Deck refresh / white-screen loop

## Goal

Restore the Autopilot-hosted Flight Deck so Pete can reach and remain on the authenticated UI without repeated refresh, relaunch, login, or blank-white-screen cycling.

## Primary records

- Flight Deck task: `79bfaf34-d52b-4f05-99ad-409acccd9219` — **Fix Autopilot-hosted Flight Deck refresh and blank-screen loop**
- Originating channel: `0617d526-88dc-4dc2-9876-08349ab60eca` — Features
- Originating thread: `96d3c720-bc07-48c7-98ce-1aa447a6752c`
- Trigger message: `880bd8cd-275b-47bf-b8f9-320a604a7222`
- Screenshot storage object: `f2da7ce4-099e-47e8-ae89-9bf853295e8d`
- Related broader performance task: `7bb908d2-0a7c-4348-8def-2bfdbff56a45`

Report durable diagnosis, progress, validation, and handoff evidence on the task. Rick will mirror meaningful milestones to the originating chat thread.

## User-reported failure

Pete is launching the latest hosted Flight Deck from the server through `wm-app`, not using the built-in/older Flight Deck. The app repeatedly refreshes and locks him out with a blank white screen. Previously a manual refresh and another login often recovered it; on 2026-08-29 the cycle continued and made the app unusable.

Treat this as an urgent production access incident, not merely a slow-startup complaint.

## Confirmed manager evidence

At approximately 2026-08-29 11:08 Australia/Perth:

- Active repo/workdir: `/Users/mini/code/wm/flightdeck`.
- Autopilot app: **WM Flight Deck**.
- App id: `6f0542c2-9688-4f5d-8bd6-0fcc8795bbee`.
- Public URL: `https://long-tin-knob.rick.runwingman.com`.
- Runtime port: `41045`.
- Managed process was running as PID `9845`, using about 33 MB RAM.
- Autopilot reported its last lifecycle action as a successful restart at `2026-08-29T02:00:03.273Z`.
- App logs contained only normal Vite preview startup output at 08:59 and 10:00 local time; no server-side exception was present.
- An unauthenticated manager probe of `/` returned HTTP 200 with `Cache-Control: no-cache` through Cloudflare.
- The served HTML referenced `/assets/index-CHiif1ZQ.js` and `/assets/index-DZvog6Wn.css`.

This evidence makes a browser/client boot, auth, navigation, wrapper, or stale-asset interaction more likely than a process crash, but that is a hypothesis until the actual loop source is proven.

## Investigation requirements

1. Read the repository instructions and inspect the full shared worktree before editing. Preserve every concurrent tracked and untracked change.
2. Reproduce or deterministically trace the automatic navigation/reload source. Do not infer a cause from the blank page alone.
3. Inspect these boundaries:
   - startup and authentication/session restoration;
   - login/launcher return routing when opened from `wm-app`;
   - code that calls `location.reload`, `location.replace`, `location.assign`, or changes `window.location`;
   - service worker registration, cache/version handling, and stale HTML/assets;
   - fatal bootstrap exceptions and Alpine store initialization;
   - Tower PG initial hydration and workspace selection;
   - SSE/reconnect and auth-failure handling;
   - any recent startup/auth/session/release changes;
   - the public Autopilot proxy only as read-only evidence unless the Flight Deck boundary is disproven.
4. Inspect the supplied screenshot through the current Flight Deck PG/Tower storage route if available. If the worker cannot retrieve it, say so on the task; do not invent visual details.
5. Capture concrete evidence: the initiating code path, request/status or exception, navigation sequence, and conditions required for repetition.
6. Distinguish this incident from the broader performance task. Link shared causes if proven, but keep task closeout specific to the access loop.

## Required fix

If the cause is in this repo, implement the smallest safe correction that:

- allows the hosted app to settle on the authenticated Flight Deck;
- prevents transient auth/API/SSE/bootstrap failures from causing an unbounded reload or navigation loop;
- presents a stable, recoverable error/login state when automatic recovery is exhausted;
- preserves valid login, logout, deep-link return, local-first Dexie data, PG cursor acknowledgement, and SSE recovery semantics;
- does not weaken authentication or suppress genuine fatal errors without surfacing them.

Add focused regression coverage for the exact proven failure. Prefer deterministic unit/integration coverage of the loop condition and recovery guard over a broad timing-only test.

If the dominant cause belongs in Autopilot, the wm-app wrapper, Tower, or the public proxy, stop before cross-repo edits. Post the exact evidence and proposed target change to the task so Rick can create and supervise a separately scoped worker.

## Validation

Run the most focused relevant tests first. Then run the repository's practical release checks required by its current instructions, including as applicable:

- focused regression tests;
- `bun run test`;
- `bun run check:public-source`;
- `bun run build`;
- `bun run verify:dist`;
- `git diff --check`;

Report exact commands, pass/fail counts, any known baseline failure, and whether hosted/browser confirmation still requires a managed-app restart or deploy.

Do not restart or stop the managed Flight Deck process, start a standalone preview server, push, or deploy. Pete has not authorized those actions in this conversation.

## Git and reporting semantics

- Work on `main` unless current repository evidence requires a different branch.
- The repo is a shared multi-agent worktree. Preserve concurrent work and never reset, revert, discard, or overwrite changes you do not understand.
- When the tested state is ready, commit all compatible nonignored worktree state so `main` accurately represents the tested repository state.
- Use a Conventional Commit.
- Post the proven cause, changed files, tests/build evidence, commit hash, cross-repo boundary if any, and remaining manual/hosted verification on the task.


# Rick Nostr avatar reliability

## Goal

Make Nostr profile avatars render consistently in Flight Deck and degrade cleanly to initials whenever an image URL cannot load. Pete reported that Rick's picture appears only sporadically.

## Source and evidence

- Originating chat: `@[Message](mention:message:4e6523e3-8a85-4f3e-9142-f40cdb6d1058)` in the Flight Deck features channel.
- Thread: `d3a8b3f2-e921-4f60-af2f-f3862db0fa0b`.
- Rick bot npub: `npub1llwrq3rtah3rg3r2dyfyht55ek7aa0ey7z47ujju407pzfp38shqa7zcvr`.
- Screenshot storage object: `358de7d4-a6a2-48a2-a705-f5645b15e668`.
- Manager-local screenshot copy: `/Users/mini/wingmen/wingman21/data/attachments/358de7d4-a6a2-48a2-a705-f5645b15e668.png`.

The screenshot shows Pete's avatar rendering normally while Rick's avatar area is broken in multiple thread rows. The image alternate text `Profile picture` leaks into the message layout beside Rick's name. This proves the UI has a truthy avatar URL, renders an `<img>`, and does not switch to the initials fallback when the browser fails to load that URL.

## Current implementation clues

- `src/people-profiles-manager.js` resolves profile and address-book URLs through `getSenderAvatar()`.
- `normalizeProfilePictureUrl()` currently rewrites `cdn.satellite.earth` images through `images.fountain.fm/profile/...`.
- Many templates in `index.html` choose image versus fallback only from `getSenderAvatar(...)` truthiness. Chat/thread/task/doc avatar `<img>` elements do not appear to maintain a load-error state.
- Existing profile-manager tests cover URL resolution and the Satellite/Fountain rewrite but not browser image failure.

The likely failure chain is an intermittently unavailable or unsuitable resolved image URL plus missing client-side error fallback. Treat this as a hypothesis: inspect Rick's actual cached/resolved Nostr picture URL and browser/network behavior before choosing the final fix. Do not special-case Rick.

## Required work

1. Reproduce the failure using Rick's npub in the current Flight Deck chat/thread surfaces and identify the exact URL/source and failure response or browser condition.
2. Trace profile resolution, workspace-key mapping, address-book caching, URL normalization/proxying, and template rendering. Determine whether the intermittent source is relay metadata, stale cache, the Fountain rewrite, remote host behavior, CSP/referrer policy, or another concrete cause.
3. Fix the proven source of unreliable resolution where Flight Deck owns it. Avoid replacing one fragile third-party dependency with another undocumented one.
4. Add a reusable avatar-image failure state so a non-empty URL that fails to load immediately swaps to the existing initials fallback. Broken-image icons/alt text must never disturb layout.
5. Apply the behavior consistently to user/agent avatars on chat messages, thread replies, task comments, document comments, assignees, identity cards, mention chips, and other shared avatar surfaces. Prefer a small shared Alpine/store/helper pattern over many unrelated one-off handlers.
6. If a later profile refresh produces a different valid URL, allow the avatar to recover; do not permanently blacklist an npub because one request failed. Prevent retry/render loops.
7. Preserve identity-card clicks, accessible names/tooltips, fixed avatar dimensions, lazy profile lookup, workspace-key-to-real-npub resolution, and existing initials behavior.

## Acceptance and validation

- Rick's avatar loads reliably when its current Nostr image is reachable.
- If the image request fails, initials replace it without broken-image UI or layout shift.
- A changed/recovered avatar URL can render after refresh.
- Regression coverage exercises successful load, failed load, URL change/recovery, and at least the main chat plus thread/comment templates.
- Run focused Vitest coverage, the relevant broader test suite, and `bun run build`; include regenerated `dist/` with source.
- Inspect the complete diff and commit all nonignored tested state on `main`, preserving and understanding concurrent work. The repository was clean and `main` was 14 commits ahead of `origin/main` when dispatched.

## Constraints and reporting

- Work only in `/Users/mini/code/wm/flightdeck` unless evidence proves a cross-repo contract defect; report that before expanding scope.
- Do not push, deploy, start a preview server, or restart the managed Flight Deck/Autopilot processes.
- Post an investigation milestone to the Flight Deck task when the exact failure path is known, then a completion comment with files, tests/build, commit hash, and any manual verification still needed. Move the task to `review` only when the implementation is validated and ready for Pete.

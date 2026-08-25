# Complete-URL NIP-98: Flight Deck implementation handoff

## Goal

Change the Flight Deck SSE worker protocol so each initial connection and reconnect signs the exact semantic stream URL, including the current cursor or last event id, before appending the transport-only token.

Flight Deck task: `d6c4e6fe-9d3e-4d11-8b5d-46ea512efb0c` in workspace `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`.

Source: Flight Deck document `Tower Live Updates` (`261f5fbf-e981-479c-ab6c-bc2c45bd0b98`) and originating message `ec98abd2-b28c-4a09-9293-08245815a5ac`.

## Current defect

`src/sync-manager.js` signs the base stream URL. `src/worker/sync-worker-runner.js` later appends `cursor` or `last_event_id` along with the transport token. Strict Tower complete-URL verification will reject the request.

## Required protocol

1. The worker constructs the complete semantic stream URL without `token`, including the current PG cursor or legacy `last_event_id`.
2. The worker posts `token-needed` with a unique request/connection id and `signingUrl`.
3. The main thread validates that `signingUrl` uses the active Tower origin and the exact expected stream path for the active workspace/owner.
4. The main thread signs that exact URL with the current scoped workspace key or active signer.
5. The response is tied to the request/connection id; stale responses are discarded after cursor changes, workspace changes, disconnects or newer requests.
6. The worker appends only `token` and opens `EventSource`.
7. Every reconnect repeats the handshake so the newest cursor is signed.

Preserve the current reconnect backoff and polling fallback. Never log the token or complete signing URL.

## Tests

Extend the SSE lifecycle, worker and worker-client tests to cover:

- initial PG and legacy signing URLs;
- reconnect signs the newest cursor or last_event_id;
- cursor changes before signing completes;
- workspace/context switches before signing completes;
- stale and duplicate token responses are discarded;
- origin/path validation rejects worker-supplied unexpected targets;
- transport token is appended only after signing;
- existing backoff and fallback polling remain intact;
- token and signing URL are absent from logs.

Also add ordinary API regression coverage where missing to prove the final URL string, including encoding and repeated parameters, is both signed and fetched.

Run focused tests, the full test suite and `bun run build`. Regenerate `dist/` and update release metadata according to the repo's current convention.

## Repo and Git constraints

Work in `/Users/mini/code/wm/flightdeck` on `main`. The branch was ahead of `origin/main` and already contained an untracked `docs/handoffs/` directory before dispatch. Preserve all concurrent and pre-existing work and commit all nonignored tested worktree state. Do not push, deploy, start a preview server or restart a managed Flight Deck process.

Report the diagnosis, changed files, validation commands/results, commit SHA and any remaining rollout concern through the supervised dispatch callback only. Rick will update the Flight Deck task and originating chat thread.

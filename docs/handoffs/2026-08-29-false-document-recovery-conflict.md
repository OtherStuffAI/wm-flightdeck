# False document recovery conflict after a normal save

## Goal

Fix the Flight Deck regression that classifies a newly created/edited document as a Tower-advanced recovery conflict even though the displayed draft base and current head are the same version.

This is implementation work in `/Users/mini/code/wm/flightdeck` on `main`, not a design-only review.

## Flight Deck source

- Workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`.
- Scope: `76d518f7-c477-4374-bf74-5d36fda570ed`.
- Channel/thread: `0617d526-88dc-4dc2-9876-08349ab60eca` / `1866d92b-0aeb-42e6-9825-9f8bf33c6e94`.
- User report: message `79a0a618-1daa-46a8-bc94-a78039babb14`.
- Screenshot storage object: `28e491d5-7bb4-43aa-9aa9-633d29e7f1f0`.
- Screenshot text: `Tower advanced from this draft's base. The draft is preserved locally and will save only as a recovery version.` followed by `Draft base v5 · Current head v5`.

Pete's exact reproduction:

1. Create a document locally on one machine in Beacon > dialogue.
2. Edit it and click Save.
3. Flight Deck reports that Tower advanced/overwrote the local draft even though no other version, device, or writer is involved.

The same outcome occurred on two documents. Treat the user's saved content as important: do not discard local drafts or recovery evidence during diagnosis.

## Current code context

- `137970b feat(documents): add recoverable autosave branches` added durable drafts and optimistic recovery branches.
- `47508c5 fix(documents): clear unchanged local drafts` is the most recent document follow-up.
- `src/docs-manager.js` currently compares restored draft base identity with the current head around `draftBaseMatchesHead()` and sets the warning around the recovery-state helpers.
- The screenshot is logically inconsistent: the visible row versions are both v5, but the UI still declares that Tower advanced. A hash/version-ID normalization mismatch, missing head identity during hydration, or an own-save acknowledgement race are stronger starting hypotheses than a genuine concurrent writer.
- Existing focused tests already cover accepted-save acknowledgement, delayed hydration after own save, genuine external head advances, and stale local draft recovery. Add the exact fresh-create/single-writer regression rather than weakening genuine-conflict protection.
- The worktree is shared, ahead of origin, and currently contains unrelated untracked handoff documents. Preserve all concurrent state. Do not stash, reset, clean, discard, or overwrite unfamiliar files.

## Required investigation

1. Trace the full new-document lifecycle: create response, initial body/version identity, local durable draft, manual save response, base identity advancement, Dexie materialisation, SSE/hydration, and recovery-state recomputation.
2. Determine precisely which identity field differs or is absent when the UI shows `Draft base v5 · Current head v5` and why that becomes a false conflict.
3. Verify whether the warning is raised before save, from the accepted save response, or from a later self-authored hydration/materialisation event.
4. Confirm the fix against both newly created documents and already existing documents without relying on a second writer.
5. Preserve Tower's authoritative optimistic-concurrency contract. Do not turn off hash/version checks or automatically overwrite a genuinely advanced head.

## Required behavior

- A document created, edited, and saved by one client must finish in the normal `Saved` state without a recovery/conflict banner.
- An accepted canonical save must advance the editor's local base identity atomically enough that its own Tower acknowledgement and subsequent Dexie/SSE hydration cannot be mistaken for an external advance.
- Equivalent base/head identities must compare equivalently after normalization. If the UI cannot prove a genuine advance, it must not assert that Tower advanced merely because an optional identity field is temporarily missing.
- A local draft whose content is already identical to the canonical head must be cleared or marked saved, not retained as a conflict.
- Genuine stale-base saves and external head advances must continue to create/present recovery versions without overwriting canonical content.
- Do not regress long-document integrity, incomplete-body protection, leases, comments, title editing, autosave, or reload recovery.

## Acceptance tests

- Add a regression reproducing a fresh document whose local draft and hydrated current head both display row version 5 but whose optional hash/version identity arrives through different lifecycle stages; it must not enter `conflict` or `recovery`.
- Add/extend a manual-save test proving an accepted save advances the base before a delayed self-authored hydration arrives.
- Prove an unchanged local draft is removed after canonical content catches up.
- Keep the existing genuine external-advance and stale-base recovery tests green.
- Run focused document tests first, then `bun run check:public-source`, `bun run test`, release-note/version validation and update, `bun run build`, `bun run verify:dist`, and `git diff --check` per `AGENTS.md`.

## Delivery

- Work on `main` and preserve concurrent changes.
- Inspect the full worktree before committing. Commit all compatible nonignored tested state required by the repository semantics with a Conventional Commit.
- Do not push, deploy, start a standalone server, or restart the managed Flight Deck/Autopilot process.
- Keep the linked Flight Deck task current with a concise diagnosis milestone and final validation evidence. Move it to `review` only when the fix is ready for Pete to test.
- Report the root cause, files changed, test/build evidence, build version, commit hash, and any live/manual verification gap. Do not reply directly in Pete's chat thread; Rick owns chat updates.
- Stay in the Flight Deck repo unless concrete evidence proves the Tower contract is wrong. If a Tower change is required, stop before editing Tower, put the evidence on the task, and return it to Rick for a separately scoped Tower dispatch.

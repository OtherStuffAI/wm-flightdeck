# Recoverable document autosave and conflict UX

## Goal

Implement the Flight Deck half of recoverable document editing after Tower's typed recovery-version contract lands. Fix the current complete-body load/save deadlock without removing the long-document truncation protection.

This is implementation work, not a design-only review.

## Flight Deck source

- Task: `1d821a21-8ec9-44ff-953d-d793107a2a5e` — **Make document autosave recoverable with optimistic version branching**.
- Workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`.
- Originating channel/thread: `855d79ef-94cd-4661-9f45-f9ce225f69c4` / `996ccc51-8103-4465-a0d8-f154570a7100`.
- Approved implementation request: message `47742be9-4fcc-45b8-b44a-658396ebd985`.
- Original failure evidence:
  - message `8be146a3-e5bd-41e4-83f7-f503a21a3873`, screenshot storage object `7431efa7-90b7-48f9-95cc-89e50dacc2db`;
  - message `e0a8dca0-b7b7-4ad0-a58c-e42fa5e7ee44`, screenshot storage object `fe604fb2-5147-4628-b274-c34883d6421e`.

## Architecture and current state

- Read `agents.md`, `README.md`, `docs/checkout_semantics.md`, relevant `docs/design/` material, and `docs/handoffs/2026-08-26-long-document-save-truncation.md` before editing.
- Architecture board: `https://pale-log-tank.rick.runwingman.com/artifacts/Wingman_Suite/wingman-suite-arch/v4/` and saved scene. v4 places shared/versioned truth in Tower and local materialization/UI state in Flight Deck/Dexie; edit-lease renewal is separate from workspace sync.
- Active repo is `/Users/mini/code/wm/flightdeck` on `main`.
- The worktree is ahead of origin and has concurrent untracked handoffs. Preserve them. Do not stash, reset, clean, discard, or overwrite unfamiliar state.
- Recent commits `d448a86` and `02585c6` added long-document integrity and complete-storage-body guards. They correctly prevent a partial body from overwriting Tower, but the failure state now deadlocks both autosave and manual Save.
- Current remote autosave delay in `src/docs-manager.js` is about 900 ms and is gated on `docEditAccessState === 'editing'` and complete-body readiness. Dirty state currently lives mainly in Alpine memory (`docEditDraftDirty`) and is not a durable local draft record.
- Current conflict handling disables the editor and offers Copy draft / Discard draft. Pete explicitly rejected clipboard as the only escape.

## Tower dependency

Tower commit `f1f9dbd` (`feat(flightdeck-pg): add document recovery versions`) is landed on local `main`. Its full contract and focused worker brief are:

- `/Users/mini/code/wingmanbefree/wingman-tower/docs/handoffs/2026-08-27-document-version-branching.md`
- `/Users/mini/code/wingmanbefree/wingman-tower/docs/handoffs/2026-08-27-document-version-branching-worker.md`

Inspect that commit and its `src/openapi.ts`, routes, and serializers before coding. The consumer contract is:

- Canonical/recovery save: `PATCH /api/v4/flightdeck-pg/workspaces/:workspaceId/docs/:docId` with the completed `storage_object_id`, `base_available`, `row_version`, `base_version_id`, `base_body_sha256_hex`, edited title/summary/metadata where applicable, and the document edit lease for a canonical advance.
- Accepted canonical save: HTTP 200 with `doc` plus `canonical_version: { version_id, row_version, storage_object_id, body_sha256_hex, size_bytes }`.
- Preserved stale/no-base save: HTTP 409 with `code: document_recovery_created`, `canonical_advanced: false`, `current_head`, `recovery`, `idempotent_replay`, storage link, audit, and outbox evidence. Recovery retries are idempotent from the submitted storage/body/base/patch identity rather than a UI-generated request ID.
- Recovery lifecycle:
  - `GET .../docs/:docId/recoveries` (open by default; optional `state=open|promoted|discarded|all`)
  - `GET .../recoveries/:recoveryId`
  - `GET .../recoveries/:recoveryId/body`
  - `POST .../recoveries/:recoveryId/promote` with the then-current `row_version`, optional `base_version_id`, required `base_body_sha256_hex`, and `lease_token`
  - `POST .../recoveries/:recoveryId/discard`
- `recovery` includes `reason_code`, `resolution_state`, nullable `base`, `head_at_creation`, `submitted_body`, provenance/resolution data, timestamps, and stable `actions` routes. Promotion conflicts return HTTP 409 `recovery_promotion_conflict` plus `current_head`.

Tower validation passed: full suite 427 pass / 4 expected storage skips / 0 failures (4,236 assertions); focused API+OpenAPI 26 pass / 0 failures (2,334 assertions). The running Tower process was not rebuilt/restarted, so do not use its current live behavior to infer that the new routes are absent.

The intended semantics are:

- matching submitted base atomically advances canonical head;
- stale or unprovable base preserves the submitted body as an idempotent, non-head recovery version;
- structured recovery evidence is listable/readable/resolvable;
- promotion is another optimistic operation, never a force overwrite.

## Required Flight Deck behavior

1. Add a durable, workspace-scoped local document draft store in Dexie/IndexedDB (or extend the correct existing local-only structure after inspection). It must capture document ID, workspace, editor content model/source, title if edited, base row/version/hash identity, dirty time, last remote-save outcome, and recovery ID when one exists.
2. Persist the local draft promptly as edits occur, independently of remote autosave, so reload/navigation/browser interruption does not lose it. Coalesce writes sensibly; do not send every keystroke to Tower.
3. Remote autosave approximately every 15 seconds while dirty, plus manual Save. Separate the fast local-draft persistence timer from the remote-save timer.
4. Restore an applicable local draft when reopening/reloading the same workspace/document. Never silently apply a draft from another workspace or another canonical base. If the canonical head advanced, present it as a recoverable conflict draft.
5. Every canonical save must send the exact base identity captured when the editor loaded/last accepted a save. Advance the editor base only from the accepted canonical response, before SSE/Dexie reconciliation can misclassify its own acknowledgement.
6. On a stale base, consume Tower's structured response and keep the submitted draft recoverable/editable. Store the recovery ID locally and provide a usable minimum conflict UI: show current head versus recovery metadata, allow opening/continuing the recovery draft, and invoke the typed resolve/promote/discard actions with optimistic checks. Copy draft can remain an auxiliary action.
7. On a stalled or failed authoritative body load:
   - keep bounded retry/backoff running;
   - if a provably complete cached base exists, permit normal save against it;
   - if no complete base exists, manual/remote persistence must use Tower's non-head recovery route and must never promote partial content as canonical.
8. Preserve the long-document integrity validator. A serialization/content-model failure must not upload or promote truncated content. Persist enough local recovery evidence to keep the user's actual draft available.
9. Normal dirty/saving/saved state must be compact beside Save: `Unsaved changes` -> `Saving…` -> `Saved`. Do not show a page-wide banner or change page height for ordinary states. Reserve the larger panel for genuine conflict/recovery/error action.
10. Do not disable the whole editor merely because a recovery branch exists. Make the safe state understandable and actionable while preventing a stale canonical overwrite.
11. Keep comments, mentions, paste/upload state, edit leases, title editing, source/block/rich modes, storage hydration, selection/caret, and normal remote reconciliation working.

## Required tests

- A one-word edit is immediately persisted locally and remotely autosaves around 15 seconds, not on every keystroke.
- Compact status renders without the full-width warning for ordinary dirty/saving/saved states.
- Reload/reopen restores an unsaved local draft for the same workspace/document.
- Workspace/document mismatch never applies the wrong draft.
- Matching-base save advances base identity and clears the local draft only after accepted canonical persistence.
- Delayed old hydration after an accepted save does not create a false conflict.
- Stale-base response preserves/opens the recovery draft and does not overwrite canonical head.
- Failed/no-complete-body load can still persist a non-head recovery version; manual Save is not permanently disabled.
- Recovery promotion/discard uses the Tower contract and remains optimistic.
- Existing long-document multi-cycle/integrity tests remain green and the truncation guard still prevents a partial canonical write.
- Add focused API/translator/Dexie/UI tests plus an end-to-end browser flow if practical without an external backend. State any manual pass that remains.

## Validation and delivery

- Run focused tests first, then `bun run check:public-source`, `bun run test`, release-note validation/update, `bun run build`, `bun run verify:dist`, and `git diff --check` per `agents.md`.
- Do not start a standalone server, deploy, or restart the managed Flight Deck/Autopilot process. Pete did not approve a restart.
- Inspect the full worktree before committing. Per Rick's worktree semantics, commit all compatible nonignored tested state on `main`, including this handoff and the pre-existing untracked handoffs unless a public-source/safety rule explicitly prevents it. Use a Conventional Commit.
- Do not push or deploy.
- Report diagnosis, implementation, tests/build/version, commit hash, and any live/manual verification gap on the Flight Deck task. Do not reply directly in Pete's chat thread; Rick owns chat updates.

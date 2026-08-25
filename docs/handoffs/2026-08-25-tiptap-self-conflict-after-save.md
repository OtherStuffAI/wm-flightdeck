# TipTap falsely conflicts with its own successful save

## Work record

- Flight Deck task: @[Make TipTap document editing feel instant while acquiring the lease](mention:task:6367742a-2763-44a3-a57f-d03a0a1c9e8c)
- Original lease UX request: @[Message](mention:message:abe95f61-55b7-4bcb-be85-c0db5798c23a)
- Failure report and screenshot: @[Message](mention:message:ae16a46b-8970-4572-a9e1-de0b95cf873a)
- Repo/workdir: `/Users/mini/code/wm/flightdeck`, branch `main`
- Affected document: `1ced25fc-03f4-4e8b-b778-9353f1861b00`, “Spiral AI Grant — Wingman Interview Notes and Proposal Draft”
- Screenshot storage object: `ee582aba-6d69-4b23-a47a-caa1f9c81aba`

## User-visible failure

Pete made one simple change in a document that was not being edited elsewhere. The editor displayed:

- `Draft preserved — document changed in Tower`
- `Tower has a newer version. Your draft is preserved; copy it or discard it before retrying.`

This is the new safe-conflict UI, but it fired incorrectly for a single-client edit. Draft preservation prevented data loss, but the workflow still failed.

## Confirmed Tower evidence

The edit did not wholly fail. Tower accepted three consecutive document versions during the same short editing period:

- version/row_version 43 at `2026-08-25T12:45:03.166Z`
- version/row_version 44 at `2026-08-25T12:45:47.691Z`
- version/row_version 45 at `2026-08-25T12:45:51.544Z`

The current document is row version 45 and `updated_by_actor_id` is Pete (`186dc374-aa4e-4068-9ee7-a768185b582e`). The screenshot was taken at approximately 12:46 UTC. This strongly indicates a client-side post-save version/hydration race: one or more saves succeeded, then a subsequent autosave/manual-save used an older local base and classified the client’s own earlier save as an external conflict.

Do not weaken Tower optimistic concurrency or lease enforcement. Confirm the exact race in code/tests before fixing it.

## Investigation seams

Start with:

- `src/docs-manager.js`
  - `saveSelectedDocItem()` save deduplication
  - `saveSelectedPgDocItem()` accepted canonical row handling
  - `docEditBaseRowVersion`, `docEditDraftDirty`, and stale conflict handling
  - document refresh/SSE/hydration while a save is in flight or immediately after it
- `src/pg-read-hydrator.js` and document Dexie materialisation
- `src/sync-manager.js` document SSE/delta refresh ordering
- `src/api.js` `updateTowerPgDoc` response shape
- `tests/docs-manager-mixin.test.js`
- `tests/e2e/docs-rich-editor.spec.cjs`

Check whether:

- the successful PATCH response’s new row version is immediately stored in every local representation used by the next save;
- an older Dexie/liveQuery/hydration result can overwrite the newly accepted canonical row;
- a queued autosave captures `item`/base version before the previous save resolves;
- rich-editor update callbacks re-dirty the document while applying the accepted canonical state;
- unchanged content causes repeat versions after a successful save;
- the body upload/PATCH sequence can leave a prepared storage object while a duplicate save is queued.

## Required outcome

- A single user can type one change and autosave/manual-save without ever conflicting with their own successful prior save.
- A successful PATCH immediately advances the authoritative local row/base version before any queued save or hydration can run.
- Save calls remain serialized per document and re-read the latest canonical document/base after awaiting an in-flight save.
- Older hydration/SSE/Dexie rows cannot replace a newer locally accepted canonical version.
- Applying a successful canonical response does not spuriously mark the same content dirty.
- An unchanged editor state does not create another Tower document version.
- A genuine external change from another actor/client still preserves the draft and shows the safe conflict UI.
- Lease token and expected row version remain mandatory; never retry a genuinely stale body over newer Tower content.

## Required regression coverage

Add deterministic tests for:

1. Successful save from version N returns N+1, followed immediately by autosave: no second PATCH if content is unchanged and no conflict.
2. Successful save followed by an older hydration/liveQuery row: local canonical/base remains N+1.
3. Edits entered while the first save is in flight: the queued second save uses N+1, not N, and succeeds once.
4. Success response/editor synchronization does not re-dirty or duplicate content.
5. A genuinely newer external N+1 response while the local draft is dirty still enters conflict safely.
6. The supplied long rich document remains serializable and stable across save/reopen.

Run focused document/editor/API tests, the managed-local rich-editor Playwright test if practical, then:

```bash
bun run check:public-source
bun run test
bun run build
bun run verify:dist
git diff --check
```

Follow `agents.md` release/version rules. Work on `main`, preserve concurrent changes, and commit the complete compatible nonignored tested state. Do not push, deploy, start a separate server, or restart the managed Flight Deck process.

## Reporting

Comment on the task with the confirmed root cause, exact regression tests, full validation/build evidence, commit and clean-state status. Move the task back to `review` only after the fix is genuinely ready. Return through the supervised dispatch callback; Rick will update the originating thread.

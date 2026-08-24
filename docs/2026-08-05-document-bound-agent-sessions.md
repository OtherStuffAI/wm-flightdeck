# Flight Deck handoff: document-bound agent sessions

Implement the Flight Deck surfaces for document-bound agent sessions requested by Operator A in features thread `07a81a5d-2175-4cf0-9e5c-d6f0dd4da619`, latest dispatch request `6892994a-8b85-4860-9cac-61d8733d362b`.

## Product contract

Triggers: newly added agent mention in a saved document body, newly tagged document comment, and full-document review through the existing agent dispatch that already targets Operator A's default agent. Reuse/extend that existing action; do not add a competing **Send for agent review** menu item or agent selector.

Add agent mention picker/token behavior to the document editor and document comments; send canonical mention metadata; preserve/render it after PG hydration. Document edits never count as answering comments, and inline reply nesting must remain intact.

Add **Associated Autopilot sessions** to the document ellipsis menu. Query Autopilot by Tower service + workspace + document ID and show agent, lifecycle status, generation, trigger, last activity, queued updates, callback outcome, and **Open session**. Do not infer sessions from local history.

Document sessions explicitly update docs and reply inline; no captured final turn is posted. UI should expose incomplete/failed callback outcomes without inventing a document response.

## Validation

- Body/comment mentions survive save and refresh; unchanged body mention does not create a new UI invocation.
- Existing default-agent dispatch produces one full-review request and routes to the document binding.
- Associated sessions are document-specific, update safely, and open the right session.
- Optimistic comments and inline parents remain continuously visible.
- Existing leases, row conflicts, movement, and doc editing remain correct.
- Focused tests, full relevant suite, `bun run build`, regenerated `dist/`, release note/build number, and commit.

The worktree already contains unrelated concurrent changes in `src/sync-manager.js` and `docs/handoffs/2026-08-05-tower-sync-service-stages-3-4.md`. Preserve, understand, test, and include them per repository semantics; do not discard or overwrite them.

Work on `main`. Commit all understood nonignored tested state. Do not push or restart the managed Flight Deck app; Test Agent will review and coordinate live verification.

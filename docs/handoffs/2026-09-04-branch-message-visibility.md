# Branch messages disappear after successful send

## Objective

Fix the Flight Deck child-branch transcript so every accepted outgoing user message remains visible during optimistic send, Tower/Dexie reconciliation, active agent work, and subsequent reopen/reload.

Flight Deck task: @[Keep sent messages visible in branched chat threads](mention:task:63ecba5a-f055-4de4-ba83-0e156dadc036)

Origin: @[Message](mention:message:0d00bceb-2d4a-461f-8f97-f76b5880b769) in @[Features](mention:channel:0617d526-88dc-4dc2-9876-08349ab60eca), thread `d425ccfd-34fa-4901-b34b-a57b48a21436`.

Affected surface: @[Chat thread](mention:chat:855d79ef-94cd-4661-9f45-f9ce225f69c4#1497b317-b40d-4980-84b1-4c18d6a9fa9c) in Wingman > Dialogue.

## User-visible symptom and evidence

Pete branched a Dialogue conversation and submitted essentially the same question twice. Each submitted question disappeared from the open branch modal, although Rick visibly began working.

The source screenshot is attached to the origin message as storage object `c04612fc-8867-4e0f-87de-85f4cb089eb9`. Rick downloaded and inspected it: the modal displays inherited branch history and a live `Rick is Working` row, but the newly submitted question is absent from the visible transcript.

Tower's authoritative thread read proves that the writes succeeded:

- `d7d55bf2-f872-4b95-a43c-805482c2d610`, Pete, `2026-09-04T00:40:58.193Z`, child thread `1497b317-b40d-4980-84b1-4c18d6a9fa9c`.
- `60015aa5-fb13-4592-8634-ebbaaca8ce0c`, Pete, `2026-09-04T00:41:44.052Z`, same child thread.
- `8d63574b-1116-4915-b644-682ba1074da1`, Rick, `2026-09-04T00:42:03.258Z`, same child thread. Its metadata names only the first Pete message in `source_message_ids`, proving that the first submission reached Agent Direct.

This is therefore a Flight Deck branch projection/reconciliation/rendering defect, not backend message loss.

## Investigation boundary

Work in `/Users/mini/code/wm/flightdeck` on `main`.

Trace the complete child-branch path:

1. Composer submit and optimistic row creation.
2. PG write response and `client_request_id` reconciliation.
3. Dexie upsert/liveQuery state.
4. Effective transcript materialisation (`owning_thread_id`, `effective_thread_id`, inherited/read-only flags).
5. Active branch modal filtering and ordering.
6. Agent activity insertion while the final reply is pending.

Likely seams include `src/chat-message-manager.js`, `src/pg-write-adapter.js`, `src/pg-read-hydrator.js`, chat translators/ordering, and their tests. Prove the cause before editing; the task does not authorize a Tower or Autopilot change. If evidence places the defect outside Flight Deck, stop and report that repo boundary to Rick.

## Required behavior

- A newly sent child-owned message appears immediately and remains visible after Tower acceptance and background materialisation.
- A second sequential send does not hide the first or second accepted user message.
- Agent activity can appear without replacing or filtering the triggering user message.
- Reopen/reload renders inherited history plus every child-owned message in correct order.
- Sibling-branch and parent-only messages do not leak into the child transcript.
- Preserve composer clearing, scroll anchoring, optimistic failure/retry behavior, duplicate prevention, ordinary threads, and branch creation.
- Agent Direct remains one dispatch per eligible message; delivered messages do not duplicate visually.

Add focused regression coverage that crosses the optimistic-to-authoritative boundary for two sequential child-branch messages, including active agent activity and reopen/rematerialisation.

## Repository and Git constraints

- Follow `AGENTS.md` and relevant docs.
- Shared `main` worktree: preserve concurrent changes and inspect all tracked/untracked state before editing and committing.
- Commit all compatible nonignored tested state. Do not stash, reset, restore, clean, rebase, force-push, or overwrite changes you do not understand.
- Use Conventional Commits.
- Do not push, deploy, start a standalone preview server, or restart Flight Deck/Autopilot/Tower.

## Validation and reporting

Run focused tests, then:

```bash
bun run check:public-source
bun run test
bun run build
bun run verify:dist
git diff --check
```

Follow release-note and `.build-meta.json` requirements. Report on the task:

- proven root cause;
- files and behavior changed;
- focused and baseline validation results;
- commit SHA;
- whether a manual browser check remains outstanding.

Move the task to `review` only after the implementation is committed and all available validation passes. Do not post a separate final chat reply; Rick owns the originating thread handoff.

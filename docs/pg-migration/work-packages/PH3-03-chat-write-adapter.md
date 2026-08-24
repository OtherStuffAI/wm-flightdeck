# PH3-03 Chat Write Adapter

## Workdir

`/home/operator/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- Existing chat composer/thread paths
- `/home/operator/code/wingmanbefree/wingman-tower/src/routes/flightdeck-pg.ts`

## Scope

Route existing channel message, thread, and reply creation to Tower PG in PG mode.

## Acceptance

- Create a new thread and first message.
- Reply in an existing thread.
- Existing composer UX remains intact.
- Commit changes before handoff.

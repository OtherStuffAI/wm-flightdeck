# PH1-04 Wingmen Community Bootstrap

## Workdir

Primary: `/home/operator/code/wingmanbefree/wingman-tower`

Secondary test client: `/home/operator/code/wingmanbefree/flightdeck-cli`

## Supporting Docs

- `docs/pg-migration/wingmen-community-bootstrap.md`
- `/home/operator/code/wingmanbefree/wingman-tower/src/scripts/setup-flightdeck-pg-workspace.ts`
- `/home/operator/code/wingmanbefree/flightdeck-pg/implementation`

## Scope

Seed a Tower PG workspace for `wm-fd-2` migration testing with synthetic identities.

## Required Work

- Create or update a setup script for the Wingmen workspace.
- Bootstrap minimum groups: Managers, Admins, Viewers, AIAgents.
- Seed scope `Wingman Suite` and initial channels.
- Add generic Operator A and Agent B grants.
- Output descriptor JSON suitable for import into `wm-fd-2`.

## Acceptance

- Script is idempotent.
- Descriptor can be used by `wm-fd-2`.
- `flightdeck-cli` can create/read a minimal test record.
- Commit changes before handoff.

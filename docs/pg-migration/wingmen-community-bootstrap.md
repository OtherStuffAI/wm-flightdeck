# Wingmen Community PG Bootstrap

Define a reusable Tower PG bootstrap example for `wm-fd-2` migration testing.

## Workspace

Label: `Wingmen`

Purpose: exercise the classic Flight Deck migration with deterministic synthetic identities.

## Minimum Groups

- Managers
- Admins
- Viewers
- AIAgents

## Initial IA

Scope: `Wingman Suite`

Channels:

- `Flight Deck PG`
- `Tower PG`
- `Implementation`

Each channel should support chat, task board, docs/files, comments, reactions, and thread-level context.

## Seed Users

- Operator A: `npub1ccz8l9zpa47k6vz9gphftsrumpw80rjt3nhnefat4symjhrsnmjs38mnyd`
- Agent B: `npub1lycg5qvjtrp3qjf5f7zl382j9x6nrjz9sdhenvyxq8c3808qxmus6gq266`

## Acceptance

- Tower setup script can create or update the workspace idempotently.
- Descriptor JSON can be imported into `wm-fd-2`.
- Operator A can log in with Nostr and see the seeded scope/channel structure.
- Agent B can authenticate through NIP-98 and create test data through `flightdeck-cli`.

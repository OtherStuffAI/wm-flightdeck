# Public-source documentation policy

This repository keeps current product, architecture, protocol, schema,
operations, and contributor documentation. Those documents describe the active
Flight Deck system and are expected to remain operator-neutral.

Personal implementation handoffs, worker prompts, chat transcripts, incident
chronologies, and one-off session logs are not authoritative product
documentation and are not retained in the public-source tree. Durable lessons
from that material should be rewritten into the relevant design or operations
document without personal identities, private hosts, machine paths, or local
credentials.

Generated build output is not retained either. Public and deployed builds must
be produced from the reviewed source snapshot, so `dist/` is ignored and the
public-source check rejects it if it is tracked again.

Git history predating the public-source sanitization may still contain removed
material. A later public repository export must begin from the sanitized tree
or a purpose-built clean history; it must not publish the existing private Git
object database as-is.

## Clean repository export

Create a new repository from the reviewed tracked snapshot, not from this
repository's object database:

1. Make the current tree pass `bun run check:public-source`, `bun run test`,
   `bun run build`, `bun run verify:dist`, and `git diff --check`.
2. Rotate or retire every credential that has ever appeared in the old
   repository before making any replacement repository accessible.
3. Export only tracked files with `git archive HEAD`. Do not copy the working
   directory, because it contains ignored local configuration and runtime data.
4. Initialize a new repository inside the extracted archive and create a new
   root commit using an appropriate public or no-reply author identity.
5. Add only the new repository as its origin. Do not mirror, bundle, fetch, or
   push old branches, tags, reflogs, recovery refs, or other objects into it.
6. Keep the replacement repository private while its clean root commit passes
   the public-source check and an independent secret scan. Enable repository
   secret scanning and push protection before widening access.
7. Build deployment output from that reviewed source commit. Create deployment
   branches from the clean history only; never import the old `deployed` branch.

Keep the old repository private and access-restricted as an archive until its
credentials, integrations, deploy hooks, and recovery value have been reviewed.
Deleting or rewriting it is a separate destructive operation and is not part of
the clean export.

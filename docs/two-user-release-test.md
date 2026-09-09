# Isolated two-user release test

Run from this checkout with Docker, Bun, Node 22 LTS and installed dependencies available. Install the
matching browser once, then run:

```sh
node node_modules/playwright/cli.js install chromium
node scripts/release-test/run.mjs run
```

The runner generates new human A/B identities and a Tower service/app identity,
copies the current nonignored source into a private run directory, builds Tower,
Autopilot and Flight Deck, starts a uniquely named Docker stack, waits for health,
and exercises two independent Chromium profiles. Source revision and content hashes,
image IDs, build metadata, browser version and outcomes are recorded. It never
uses the existing Playwright config or its host credential loader. Missing
prerequisites fail the run; this suite has no credential-based skip.

The default repository layout is sibling `tower`, `autopilot`, and `flightdeck`
checkouts. Override source locations with `RELEASE_TEST_TOWER_REPO` and
`RELEASE_TEST_AUTOPILOT_REPO`. Every execution builds selected source anew; Docker
may reuse matching build layers. A private empty Docker client configuration
avoids host registry credentials. The classic Docker builder is the default
because the local BuildKit metadata request stalled; set
`RELEASE_TEST_BUILDKIT=1` where BuildKit works.

The stack contains run-owned Postgres, Tower, MinIO, a local profile-announcement
relay, and Autopilot. Only Tower and Autopilot publish loopback ports. Flight Deck
serves its own freshly built static snapshot on another loopback port. Shared
host services, production databases, host authentication and Docker sockets are
not mounted into containers.

## What is exercised

Login and PG workspace onboarding use the real browser UI. A grants B ordinary
membership and channel contribution using current signed PG administrative APIs.
That provisioning is an API step, not an invitation-link test. The wizard selects
one starter scope and channel; the test selects its real channel tab and opens
Chat through the sidebar. A uses the actual
composer and structured mention picker; B observes live materialization and
continues in the bound thread with another explicit mention. Shared-channel
policy requires a mention per turn; the existing runtime session must be reused. Both users must see the
same durable conversation and completed activity after reload. B then stays offline
while A publishes an unmentioned human marker in the thread. B must lack that
message while offline and receive it exactly once on reconnect before any
navigation or reload. The five-message history still produces exactly two agent dispatches.

The runtime creates its own dedicated infrastructure administrator and bot keys
inside a new Docker volume. Its ordinary Agent Connect API imports a PG workspace
locator, and Tower's normal member/channel APIs authorize the new bot. The bot
consumes real Tower events, dispatches through the real ProcessManager, and
publishes through the normal turn bridge and signing broker. Only the Pi ACP
executable is deterministic; it emits a repeatable response containing a prompt
hash and never possesses an agent signing key. The FIPS fault scenario additionally
launches the brokered client probe described below. This tests dispatch and
publication, not model quality.

The verifier checks all five durable kind-33358 signatures, authors, body hashes
and routing. Runtime dispatch outcomes must identify those two human triggers
and the same actual session. Activity records currently retain provisional
`pending:<turn>` session identifiers; actual binding is checked from replies
and runtime outcomes. It retries the original root idempotency key and requires the same
message ID, rejects a member workspace-admin mutation, and sends an intentionally
mismatched NIP-98 payload hash that Tower must reject before mutation. Browser
updates continue through TowerSyncService, Dexie and liveQuery; no test injects
Alpine or IndexedDB records.

## Evidence and lifecycle

Each command prints its ignored `test-results/release/fd-release-…` directory.
`manifest.json` records status, actual source/build identities and local URLs.
`browser/report.json` records assertions, public workspace/message/session/turn
IDs, screenshots, videos and failure phase. `browser/progress.json` identifies
the current phase. The browser report stays `finalizing` until both contexts close successfully and
both distinct A/B recordings resolve to files larger than 1000 bytes. Closure or
recording failures produce a failed report and nonzero result, preserving any
original assertion failure. Required Docker cleanup failure also marks the
manifest failed and retains `cleanupFailure`. The runner exits nonzero on any
failed assertion, prerequisite, finalization or required cleanup.

Secret entry is unrecorded. Each user closes the login browser and reopens only
their own run-created profile before video recording begins. Traces, console
capture and browser state export are disabled. `DEBUG` and `PWDEBUG` must be
unset. Screenshots are taken only when secret-entry controls are hidden.

The enclosing run directory is owner-only. **Do not upload the whole directory:**
identity files, Compose configuration and browser profiles are private runtime
state. Review only the manifest, browser report, screenshots and videos for
private evidence publication. These are recordings of the actual run; extracted
debug frames are identified by their filenames and are not separate test passes.

After the conversation the runner restarts only its own Autopilot, waits for
its subscription to recover, and verifies bot identity, dispatch count and
durable history remain unchanged.

Normal completion removes only this run's containers, network and volumes while
retaining local evidence. `--retain` keeps Docker resources for inspection. The
static frontend process ends when the test command exits. For an interactive
development stack, `up` stays running until Ctrl-C:

```sh
node scripts/release-test/run.mjs up
node scripts/release-test/run.mjs health test-results/release/fd-release-<run>
node scripts/release-test/run.mjs down test-results/release/fd-release-<run>
```

`down` validates run ownership and removes its volumes. Never run a broad Docker
prune. A fresh `run` creates new identities, ports, volumes and workspace; repeat
the command to verify isolation rather than reusing a previous browser profile.

Use Node 22 LTS for this runner. Set `RELEASE_TEST_NODE` to a Node 22 executable if `node` uses another major.
The runner can also reuse the private Node 22.21.1 macOS ARM64 installation under
its ignored evidence directory. Other runtimes are rejected because local Node 26 and Bun stalled during Playwright lifecycle operations.
The application source build still uses Bun.

Focused infrastructure and signature-helper checks:

```sh
node --test scripts/release-test/*-check.mjs
```

Unit checks and Docker health alone do not constitute a passing full-stack test.
Only a manifest marked `passed` after browser finalization, integrity assertions and required cleanup does.

## Repository validation at implementation

Build 1922 includes fixes for workspace activation before starter-space writes,
derived channel/thread context reset, and member-directory hydration after ACL
resets. Focused onboarding, roster and sync regressions pass, including the case
where the actor sidecar omits an agent with no authored records.

The full repository suite currently has two pre-existing failures:
`chat-file-drop.test.js` expects an obsolete attachment-input attribute sequence,
and `pg-materialization-responsiveness.test.js` exceeds its 10-second limit.
The public-source check also reports existing older documentation; this change
adds no findings. Build, release-note and distribution checks pass. These baseline
failures remain separate from the mandatory, non-skipped full-stack result.

## Tower FIPS acceptance

These scenarios use real isolated Linux FIPS 0.5 peers and the production
Autopilot transport. Prerequisites include Docker Linux TUN support, NET_ADMIN
inside owned containers, Bun, Node 22, Chromium, and network access for pinned
build dependencies and the independent public HTTPS outage canary. No host
FIPS installation or identity is used. Missing prerequisites fail the command.

```sh
# Real peer/TUN/full Tower ingress prerequisite; no browser acceptance claim
node scripts/release-test/run.mjs mesh
# Trusted TLS baseline, with the complete original A/B browser scenario
node scripts/release-test/run.mjs run --https
# Complete FIPS matrix, including two browser videos and fault/continuity phases
node scripts/release-test/run.mjs run --fips --faults
```

The FIPS scenario first verifies the trusted TLS connection, provisions a
workspace/profile-scoped signing policy for the exact generated mesh origin,
then selects FIPS with `httpsEndpoint: null`. Node and Tower service identities
are generated separately and verified separately. Persistent approved peer
configuration supports reconnect without a discovery service. Each application
shares its own daemon's namespace and TUN. Mesh requests enter Tower's full
PG/storage ingress; a transparent proxy on that encrypted peer path can close
streams or drop a response after a real committed write.

Before measuring FIPS traffic the runner retires prior TLS keep-alive sockets.
An nftables positive control must block observed packets; counters are then
reset. Autopilot's public Tower TCP destinations are blocked independently of
browser traffic. The measured phase requires zero blocked attempts, unchanged
source-filtered TLS ingress and zero HTTPS requests in transport diagnostics.
The peer outage blocks both UDP directions while `https://example.com` remains
reachable. It must produce a newly timestamped runtime failure, followed by
recovery of the waiting mention when the mesh is restored. No automatic HTTPS
fallback is permitted. This measurement describes this fixture's explicit
Tower destinations, not every unrelated Autopilot integration.

The original five signed messages and two same-session dispatches remain exact
assertions. Forced established-stream closure must precede successful mesh
recovery polling. One committed agent response is lost and retried with the
same idempotency key, same durable message ID and renewed valid signatures.
The isolated ACP driver invokes a real child CLI/client acceptance probe through
its inherited capability broker before returning deterministic model output.
It never reads a bot key or substitutes an event dispatcher. Probe operations
cover workspace reads, files, documents, task state/comments, precise broker
approval denials, Tower authentication/ACL denials, incomplete storage and
canonical document conflict preservation. Only disposable outsider identities
are generated for negative authentication/ACL checks.

Both recorded browsers reload the unchanged five-message history and download
the same mesh-uploaded attachment bytes under their own identities. Removing
its actual message attachment link must revoke B's authenticated metadata and
content access before the link is restored. Presigned URL expiry is not used as
a revocation oracle. Three additional roots in separate threads exercise fresh
work across owned Autopilot stop/start, explicit HTTPS rollback with queued work,
and return to FIPS while work is active. These remain in the A/B recordings,
retain connection/subscription IDs and nonregressing cursors, and require exactly
five total dispatches. The explicit rollback phase permits HTTPS deliberately;
its traffic is outside the saved FIPS-only measurement. Returning to FIPS starts
a new strictly blocked measurement with no HTTPS endpoint.

In addition to the ordinary manifest/browser report, inspect:

- `mesh.json`, `mesh-network.json`: public nodes, daemon versions, peer/TUN/routes.
- `fips-phase.json`, `fips-network-assertions.json`: final measurement boundary,
  positive control, independent counters/ingress and transport diagnostics.
- `fips-before-rollback-*.json`: preserved earlier FIPS-only phase and proof.
- `fips-fault-assertions.json`, `mesh-outage-*.json`: ordered stream/poll evidence,
  committed-response replay, precise child probe outcomes and outage canary.
- `fips-continuity.json`: separately counted restart/switch roots, replies,
  signatures, sessions and cursor/connection continuity.
- `tower-fips-settings.json` and `.png`: actual settings Test connection,
  draft refresh/reload persistence, apply and reenabled controls.
- `fips-terminal-network.json`: terminal rule/peer/subscription/fault metadata,
  also captured on failure before owned cleanup.

The normal command removes owned resources and exits nonzero on assertions,
evidence failures or cleanup failures. `--retain` is diagnostic only; a run with
retained resources is not final cleanup acceptance until `down` succeeds. Never
share identity files, TLS private keys, Compose configuration or browser profiles.
Review reports and both videos before any private publication. The live host
Autopilot is never restarted by these commands. Operator activation remains a
separate restart after implementation acceptance and manager review; explicit
HTTPS selection is rollback only where an approved HTTPS endpoint is configured.

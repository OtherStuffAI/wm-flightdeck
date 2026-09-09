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
same durable conversation and completed activity after reload.

The runtime creates its own dedicated infrastructure administrator and bot keys
inside a new Docker volume. Its ordinary Agent Connect API imports a PG workspace
locator, and Tower's normal member/channel APIs authorize the new bot. The bot
consumes real Tower events, dispatches through the real ProcessManager, and
publishes through the normal turn bridge and signing broker. Only the Pi ACP
executable is deterministic; it emits a repeatable response containing a prompt
hash and never contacts Tower or possesses an agent signing key. This tests
dispatch and publication, not model quality.

The verifier checks all four durable kind-33358 signatures, authors, body hashes
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
the current phase. The runner exits nonzero on a failed assertion or prerequisite.

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
node --test scripts/release-test/stack-check.mjs scripts/release-test/browser-api-check.mjs
```

Unit checks and Docker health alone do not constitute a passing full-stack test.
Only a manifest marked `passed` after browser and integrity assertions does.

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

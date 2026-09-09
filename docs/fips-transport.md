# Tower connection paths

Flight Deck can keep its existing HTTPS page, workspace and local database while
using a manually paired Tower FIPS endpoint. Public HTTPS remains the default
for browsers and iPhone. FIPS requires a WMapp build exposing native Tower bridge
version 2. Current WMapp supports its configured trusted Tower; preferences for
other Towers are retained but explicitly unavailable. Multiple workspaces on the
same configured Tower share this transport. A raw HTTP `.fips` URL is insufficient for an HTTPS page.

## Setup

1. Configure Tower's dedicated mesh ingress and host gateway using Tower's
   `docs/fips-ingress.md`. Use the active Tower checkout and the same database
   as HTTPS. Docker Desktop requires the native host gateway to the dedicated
   loopback-published Docker ingress, because the host FIPS interface is outside
   the container. Shared runtime activation belongs to the supervising manager.
2. Build/install WMapp's native Tower bridge following its
   `docs/fips-tower-bridge.md`. Keep Flight Deck open at its existing HTTPS origin.
3. In Flight Deck Setup → Connection, select **FIPS via WMapp**, enter the exact
   `http://<node-npub>.fips:<mesh-port>/` Tower endpoint and choose **Apply and
   reload**. Approve the narrowly scoped native pairing when requested.
4. Flight Deck checks the Tower service identity and performs a signed workspace
   descriptor read before saving. Reload restores the selection at the same page
   origin; it does not modify backend identity, workspace keys, Dexie rows, queued
   writes or durable SSE/workspace cursors.
5. To return, select **Public HTTPS** and apply. Unavailable/unsupported FIPS
   remains visibly selected until the user changes it. It never falls back to
   public Tower traffic automatically.

The paired endpoint is the Tower ingress, not the Autopilot control-plane or
managed app port. Obtain its exact node identity and port from the operator's
running gateway configuration; sample placeholders are not usable endpoints.

## Native transport contract

`window.wingmanTowerTransport.version` must be `2`. `connect({endpoint,
logicalTower})` returns `{version:2, endpoint, logicalTower, transport:'native'}`.
Its `fetch(actualMeshUrl, RequestInit)` returns a standard streaming Response.
The bridge must explicitly pair and pin the destination, preserve method,
Authorization and body bytes, reject redirects, omit cookies/forwarding headers,
and propagate cancellation. It does not sign or act as an authority.

WMapp injects this bridge on page completion. Flight Deck waits up to five seconds
for `wingman-tower-transport-ready` when restoring a FIPS preference. A missing
bridge is an explicit unsupported-client state. No global fetch replacement,
WebView mixed-content exception, TLS exception or page-origin change is used.
Native WKWebView testing rejected an earlier loopback HTTP fetch proposal from
HTTPS pages; v2 therefore transports bytes through the native message channel.

`detachWorker(worker)` cancels its native requests before worker replacement or
shutdown, so old streams cannot survive worker recovery. `attachWorker(worker)` transfers `{type:'wingman-tower-transport-port', port}`.
The Flight Deck worker sends `request` (`id`, exact `url`, `method`, header pairs,
`bodyBase64`), then one `pull` per response chunk, or `cancel`. Replies are
`headers` (`status`, header pairs), `chunk` (`bodyBase64`), `end` or `error`.
Transport metadata is delivered independently of optional key export. Native
request body serialization is capped at 16 MiB and buffered in the worker;
oversized requests fail explicitly before dispatch, preserving pending writes.
Page uploads use native streaming chunks; response/SSE bytes are pulled
incrementally. Existing finite API/signing timeouts apply.

`TowerSyncService` remains the only network-update lifecycle owner. The existing
worker requests a fresh NIP-98 token on every SSE reconnect. The token's URL is the
exact mesh endpoint with the existing cursor parameters; only the transport
`token` parameter is appended afterwards. Native SSE bytes feed the existing
worker event/batch/acknowledgement logic. Cursor keys and materialization remain
bound to the logical Tower/workspace, so switching transports creates no second
sync owner. HTTPS continues to use browser EventSource.

Connection responses may describe their incoming mesh URL. Only known locator
fields (`tower_base_url`, service `base_url`, workspace list/descriptor locators)
are mapped back to the configured logical Tower before persistence. User text
and metadata are never rewritten.

## Storage and assets

Tower metadata, signed reads, PG commands, checkout, sync and storage content use
the same selected route. FIPS uploads use Tower's signed `/api/v4/storage/:id`
byte-upload fallback instead of a public presigned upload URL. Content downloads
use signed `/api/v4/storage/:id/content` and local Blob URLs. The native bridge
preserves binary bytes and status/headers, streams responses, omits cookies and
rejects redirects. A Tower installation that redirects content to an external
bucket cannot serve that object over this route until it enables its authenticated
content streaming path; the failure must not be retried through public HTTPS.
Public HTTPS retains its existing presigned-upload behavior.

External user links, third-party avatars and unrelated WApps are not Tower
transport. This setting does not make the entire application an offline or
mesh-only browser. Tower links outside the paired endpoint are rejected in FIPS
PG requests rather than accepted as a public transport fallback.

## Validation

Run the focused transport/API/worker tests, then the repository's complete test,
public-source, release-note, build and dist checks. For cross-repository protocol
proof, generate WMapp's actual injected script and execute the paired consumer:

```sh
dart run ../wmapp/tools/export_tower_bridge.dart test-document-token https://flightdeck.example > /tmp/wmapp-tower-bridge.js
WMAPP_TOWER_BRIDGE_SCRIPT=/tmp/wmapp-tower-bridge.js bunx vitest run tests/wmapp-tower-bridge-contract.test.js
```

The optional cross-repository test uses the production JS producer and a real
MessageChannel. It supplements WMapp's native socket/WKWebView tests; it is not
proof that a particular running app/container has loaded new code. Final runtime
acceptance must exercise the same workspace read/write, live SSE and reconnect,
storage round trip, reload/HTTPS switch, unavailable FIPS and unauthorized
requests over both paths, using broker signing and the configured local Tower.
Do not restart Autopilot to activate this work.

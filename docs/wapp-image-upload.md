# WApp icon uploads

Add WApp and Edit WApp share the personal launcher editor. Choose a PNG, JPEG,
GIF, or WebP image of at most 5 MiB, inspect the local preview, then select Upload
image. The image is public on Primal Blossom; cancelling the editor does not
remove an uploaded blob. Manual Icon URL entry and the manifest/favicon/initials
fallback remain available.

The browser uses the existing `signNostrEvent` session signer (local session,
NIP-07 extension, or bunker). It signs a kind 24242 upload authorization with the
SHA-256 blob hash, expiration, and server scope, then PUTs the original binary
file to `https://blossom.primal.net/upload`. Hashing uses asynchronous Web Crypto.
The upload helper requires a matching blob descriptor and HTTPS URL before
updating the form. Saving uses the existing personal WApp command and Dexie
materialization path for `icon_url`; no schema or backend changes are needed.

Selections and AbortControllers are kept outside Alpine proxies. Replacing or
clearing a selection, editing the manual URL, or closing/reopening the form
invalidates prior results and revokes the local preview URL. Results are also
checked against workspace and actor context. Uploads time out after two minutes,
including while awaiting signer approval. Pending uploads block save; failed
uploads can be retried without losing the previous icon URL or other form fields.

Protocol evidence checked on 2026-09-07:

- [Primal server API](https://github.com/PrimalHQ/primal-blossom-server#api-endpoints)
  documents binary PUT uploads and Nostr authorization.
- [Blossom blob upload](https://github.com/hzrd149/blossom/blob/master/buds/02.md)
  documents response descriptors and status codes.
- [Blossom authorization](https://github.com/hzrd149/blossom/blob/master/buds/11.md)
  documents kind 24242 and scoped authorization tags. Primal's implemented
  BUD-02 API uses standard base64 JSON authorization.
- A read-only GET to `https://blossom.primal.net/` identified the live server as
  Primal Blossom. A read-only OPTIONS preflight to `/upload` returned HTTP 200,
  allowed GET/PUT/DELETE, wildcard origin, and Authorization headers.

Validation for build 1889:

- 32 upload, lifecycle, and actual Add/Edit store tests pass. These cover scoped
  signing, response validation, HTTP/network/signing errors, retry, cancellation,
  replacement, stale workspace results, save protection, and launcher rendering.
- Release-note tests: 8 pass. WApp Dexie tests: 7 pass.
- Full suite: 3511 pass, one existing 20,000-row Dexie responsiveness test timed
  out at 10 seconds. A focused rerun including that test passed all 48 tests;
  the responsiveness benchmark completed in 8467 ms.
- Build and `verify:dist` pass; `dist/version.json` reports build 1889.
- `git diff --check` passes. `check:public-source` fails on pre-existing tracked
  handoff documents and their operator-specific content. Those documents were
  preserved. Pre-existing untracked handoffs remain untracked because they are
  incompatible with that public-source policy.

Browser limits: upload transport and Tower responses are mocked in tests. A real
browser pass with the configured development runtime remains necessary for
signer approval/rejection, a real Primal upload, visual layout at desktop/mobile
sizes, and persistence/rendering after reload. No authenticated external backend
browser test, deployment, push, or service restart was performed.

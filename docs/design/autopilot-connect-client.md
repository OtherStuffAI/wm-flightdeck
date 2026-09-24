# Autopilot Connect client seam

Flight Deck accepts versioned `wingman_autopilot_connect` v1 and v2 envelopes with
two fields: `manifest` and `signature`. The signature is a valid Nostr event of
kind `27236`; its content is the manifest encoded with recursively sorted object
keys. The event signer must equal `manifest.installation.npub`, and the exact
FIPS origin must match the identity required by that version.

Version 1 retains its original invariant: signer, installation identity and
FIPS host identity are the same. Version 2 separates the stable installation
signer from `transport.fips.npub`; the event is still verified against
`installation.npub`, while the endpoint must be exactly
`http://<transport.fips.npub>.fips:<port>`. Native pairing pins that endpoint
while using `installation.npub` as the HTTP service identity. Generation time
is signature-bound and valid for five minutes, with a
15-second future clock allowance.

The signed manifest advertises `api.version` (currently `1`), `health_path`,
`agents_path`, and read capabilities. Its optional HTTPS endpoint is descriptive
metadata only. The client always connects and fetches through WMapp's approved
`window.wingmanTowerTransport` v2 service-identity bridge. It pairs with
`connect({ endpoint, serviceNpub: installationNpub })`, verifies the returned
native descriptor, signs and sends the same exact mesh URL and method with
NIP-98, rejects redirects, and never retries through HTTPS. Drive's GRASP-only
`window.fipsTransport` is not used for arbitrary control API requests.

Health must return `ok`, `installation_id`, `installation_npub`, and
`api_version`. Discovery must return the matching `installation_id` and an
`agents` array. Flight Deck exposes only normalized `agent_id`, `bot_npub`,
`name`, `description`, and `can_instruct` fields; it neither persists nor renders
the raw response. Discovery also retains only the four signed per-agent paths;
Agent Space never synthesizes paths or falls back to HTTPS.

Packages containing credential-like fields or secret URI/key prefixes are
rejected before verification. The client does not log packages, authorization
headers, response bodies, or native bridge capabilities.

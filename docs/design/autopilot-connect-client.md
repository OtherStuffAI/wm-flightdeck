# Autopilot Connect client seam

Flight Deck WP2 accepts a versioned `wingman_autopilot_connect` v1 envelope with
two fields: `manifest` and `signature`. The signature is a valid Nostr event of
kind `27236`; its content is the manifest encoded with recursively sorted object
keys. The event signer must equal `manifest.installation.npub`, and the exact
FIPS origin must be `http://<installation-npub>.fips:<port>`.

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
the raw response in WP2.

Packages containing credential-like fields or secret URI/key prefixes are
rejected before verification. The client does not log packages, authorization
headers, response bodies, or native bridge capabilities.

# Compact mobile Inbox

Inbox items keep context and relative time on their first line, title on their second, and activity reason or chat preview/message count on their third. Identical chat titles and previews are shown once. Long context labels ellipsize; their complete text remains in the DOM and title attribute. Source records, read state, and routing are unchanged.

Below 768px, cards use smaller icons, tighter spacing, and no separate Open pill. Existing whole-card click, Enter, and Space navigation remains available. Unread highlighting and separate read/done buttons remain; mobile action buttons have 44px minimum targets and visible labels. Desktop retains Open labels.

## Verification

Run `node scripts/verify-inbox-compact-browser.mjs`. This renders the actual source Inbox template and styles in Chromium using intercepted requests only, with no server or backend access. Synthetic task, attachment, duplicate/distinct chat preview, review task, and document rows cover 375, 390, 430, and 1440px widths. It checks overflow, card height, action targets, keyboard activation, read highlight clearing, and callback dispatch. Callback destinations are instrumented; this is not a live backend navigation test. Existing Inbox history and bulk-read unit tests cover the production behavior.

The initial comparison measured mobile cards at 76px versus 113–161px before, and desktop cards at approximately 78px. Local screenshots and JSON measurements are emitted under `/tmp/flightdeck-inbox-*`.

The full suite at implementation time passed 3666/3668 tests; failures were an unrelated chat file picker attribute-order assertion and a 10-second materialization responsiveness timeout. The responsiveness test passed in isolation. Focused Inbox history, bulk-read, and release-note tests passed (48 tests). Build 1911 and asset verification passed. The public-source check reports pre-existing private handoff documents. A live iPhone/Safari smoke check remains: WebKit was not installed in the available browser cache.

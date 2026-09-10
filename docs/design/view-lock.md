# Lock into a view

With Scopes > Channels expanded in the left sidebar, the selected Chat, Tasks,
Docs or Files tab offers a grey padlock button. Press it to keep that view while
selecting another scope or channel. Workspace Home (including its avatar) keeps
the locked view and clears the scope/channel context to show all workspace
content. Unlocked Home opens Deck. The existing board context controls the
content filter and subscriptions; no records or backend contracts change.

The closed padlock and pressed button state indicate a lock. Pressing it again
unlocks. Selecting another view clears it; Deck and Setup cannot be locked.
Explicit Deck links still open Deck. Route-driven section changes also clear
the lock. The lock lives in shell memory and is not restored on reload.
Changing sidebar mode clears it. Mobile uses the same controls when the scope
and channel sidebar is open.

The independent native button supports Tab, Enter and Space, has a stable
accessible name and aria-pressed state, and shows an action tooltip. Scope and
channel selection highlighting continues to reflect the active filter.

Navigation coverage lives in tests/view-lock-navigation.test.js. Browser review
should exercise keyboard locking/unlocking, scope and channel changes, opening
another view, and switching sidebar mode on desktop and mobile.

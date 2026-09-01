# Scope Inbox bulk-read shortcuts to the visible scope

## Goal

Fix Flight Deck's Inbox bulk-read shortcuts so they act on the currently visible scope, while preserving workspace-wide behavior from the All scopes / channels view.

Flight Deck task: `f3c530e7-e3a0-407b-abaf-9a551412f173` (`Scope Inbox bulk read shortcuts to the current scope`).

Originating Flight Deck surface:

- workspace: `2e5caefd-dd65-45d2-b747-ee874e8e5fc9`
- scope: `76d518f7-c477-4374-bf74-5d36fda570ed`
- channel: `0617d526-88dc-4dc2-9876-08349ab60eca`
- thread: `5f10b2f1-464b-4198-b98a-86bb02f5a69e`
- message: `611ef86b-56f0-4077-8b34-5c7b6e503019`
- screenshot storage object: `8884269f-c1d9-4cbe-8ae4-0527d2d00c5b`

## User requirement

Pete reports that the Inbox menu shortcuts shown in the screenshot currently mark items read across all scopes. When any of these shortcuts is used from a concrete scope, it must apply only to the current scope:

- Mark all tasks as read
- Mark all docs as read
- Mark all chats as read
- Mark everything as read

If Pete wants to mark across the whole workspace, he will invoke the same action from the All scopes / channels view.

## Confirmed current path

- `index.html` calls `runInboxReadAction(...)` without explicit scope context.
- `src/unread-store.js::markInboxResourcesRead()` obtains all resource-view states and passes them to `collectUnreadViewResources(states, types)`.
- That collector filters by unread state and type, but not by the active scope, so the current implementation is workspace-wide regardless of the visible scope.
- `tests/inbox-bulk-read.test.js` covers type filtering/global batching and menu wiring, but has no selected-scope regression.

## Required behavior

1. In a concrete scope, each shortcut must select only unread resources in that scope's visible context.
2. Sibling/non-visible scopes must remain unread, including their per-resource and aggregated channel indicators.
3. In All scopes / channels, preserve the existing workspace-wide behavior.
4. Do not accidentally make the operation channel-specific. A selected channel is not the bulk-read boundary; the selected/visible scope is.
5. Resolve membership from current PG identities and hydrated resource/channel/scope relations. View-state rows may lack `scope_id`, so use the authoritative resource/channel mapping available in the store.
6. Reuse the existing scope-hierarchy/overview semantics for descendant scopes. Do not invent a second interpretation of what belongs to a selected scope.
7. Preserve batching, optimistic writes, server refresh, notices, busy state, and per-type filtering.
8. Keep individual-card Mark read, channel-settings bulk thread read, and Inbox Mark done behavior unchanged unless a narrowly shared helper must be corrected.
9. Preserve the legacy non-PG path if it cannot safely express a scoped operation; document that boundary rather than claiming unsupported scoping.

## Acceptance tests

- A concrete scope marks matching thread, task, and document resources and leaves sibling-scope resources unread.
- Each type-specific menu action is covered, plus the combined action.
- All scopes continues to mark matching resources workspace-wide.
- A resource whose view-state row lacks `scope_id` is correctly scoped through its authoritative channel/resource mapping.
- A selected channel does not narrow a concrete-scope bulk action to only that channel.
- Existing batching and partial/failure behavior remains covered.

## Repo and validation

Work in `/Users/mini/code/wm/flightdeck` on `main`. This is a shared dirty worktree; inspect the entire state first and preserve concurrent changes. The current manager inspection found tracked modifications in `src/app.js`, `src/connect-settings-manager.js`, `src/nostr-onboarding-announcements.js`, `src/nostr-workspace-self-index.js`, `src/onboarding-announcements-manager.js`, `src/workspace-manager.js`, and `src/workspace-self-index-manager.js`, plus several untracked handoff documents. Do not discard, reset, or overwrite them. Follow Pete's state semantics: commit all compatible nonignored tested worktree state, not only files touched by this feature.

Run:

```bash
bun test tests/inbox-bulk-read.test.js
bun run check:public-source
bun run test
bun run build
bun run verify:dist
git diff --check
```

Add required user-visible release/build metadata, regenerate/include `dist/`, and use a Conventional Commit. Do not push, deploy, start a preview server, or restart the managed Flight Deck process.

## Reporting

Read the live task and latest comments before acting. Post a diagnosis/progress comment after confirming the implementation path, then a completion comment with files changed, validation evidence, commit/build identifiers, and remaining manual checks. Move the task to `review` only when the work is genuinely ready. Rick will post concise milestone and completion updates into the originating chat thread.

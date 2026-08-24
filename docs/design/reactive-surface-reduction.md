# Reduce the Flight Deck reactive surface

Status: Proposed  
Date: 2026-08-04

## Decision

Reduce the amount of application data and derived work owned by the single
`$store.chat` Alpine store. Keep Dexie as the durable UI source, but expose
section-sized, windowed projections to Alpine and keep inactive sections cold.

This is a larger architectural change than request deduplication, pagination,
or memoizing markdown. It should be delivered incrementally, with compatibility
adapters for the existing `$store.chat.*` template contract, rather than as a
single store rewrite.

## Problem

The current root store contains shell state, every major record collection,
editor buffers, modal state, sync state, and many derived getters. The root
`index.html` template also contains every application surface. An update to one
reactive field can therefore cause Alpine to revisit expressions across large
lists and inactive UI branches.

The expensive pattern is:

```text
worker or local write
  -> Dexie table changes
  -> several liveQuery subscriptions invalidate
  -> large arrays are replaced on the root Alpine store
  -> getters rescan arrays
  -> x-for/x-html expressions rerun across visible and retained DOM
```

Existing windowing and section-scoped live queries reduce the cost, but they do
not change the ownership shape: large domain collections still share one
reactive object and one monolithic template.

## Target boundaries

### Shell store

Own only authentication, workspace selection, routing, navigation, update
state, global errors, and compact sync status.

### Section stores

- Chat: channel projection, selected-channel message window, active thread,
  composers, reactions/activity indexes.
- Tasks: selected board projection, filters, selected-task detail and comments.
- Docs: browser projection, selected document, editor session and comments.
- Files, Status, Reports, Workrooms, and Settings: only their active list/detail
  projections and local controls.

### Component-local state

Menus, transient queries, drag targets, confirmation state, draft UI, and
popover coordinates should live with the component that renders them rather
than on the application store.

### Dexie query adapters

Each section should subscribe through a small query adapter that returns an
already-windowed render model. Alpine should not receive a complete table and
then repeatedly filter, group, and sort it.

## Invariants

- Dexie remains the rendering source; Tower payloads are never rendered
  directly.
- Optimistic writes remain local-first and durable before remote delivery.
- The worker remains responsible for sync and materialization.
- Only the active workspace and active section own live subscriptions.
- Scroll anchoring and explicit load-more behavior remain intact.
- Workspace switches dispose every section subscription and transient cache.
- Existing route URLs and Tower payload contracts do not change.

## Migration plan

### Phase 1: Measure and enforce budgets

Add development counters for active subscriptions, root-store collection
sizes, Alpine render passes, long tasks, and selected-section activation time.
Set initial budgets: no inactive detail subscription, no unwindowed large list,
and no getter that repeatedly scans a full domain collection per rendered row.

### Phase 2: Extract Chat behind a compatibility facade

Chat is the best first slice because its messages, reactions, identities, and
thread summaries generate the most repeated work. Create a dedicated chat
store backed by windowed Dexie queries. Initially forward existing
`$store.chat` methods/getters to it so templates can migrate incrementally.

Exit criteria:

- changing an unrelated shell field does not recompute message rows;
- only the selected channel and active thread are subscribed;
- message, reaction, and activity lookup maps are built once per snapshot;
- closing Chat disposes its subscriptions and large arrays.

### Phase 3: Extract Tasks and Docs

Move board/list projections and selected-record details into separate stores.
Load the rich editor only when an edit surface is mounted. Keep editor buffers
component-local so typing does not invalidate task boards, document browsers,
or global navigation.

### Phase 4: Split templates and modules by route

Move section markup from the root HTML into lazily activated components or
template modules. Pair each template boundary with a JavaScript dynamic import
so inactive sections do not contribute initialization and parse work.

### Phase 5: Remove the compatibility facade

After all template consumers move to section stores, remove duplicated root
fields and forwarding getters. Do this only after route, workspace-switch,
offline, unread, and scroll tests cover the new ownership boundaries.

## Validation

Use deterministic large fixtures plus a real browser profile. Compare:

- initial JavaScript transferred, parsed, and evaluated;
- time from channel click to cached messages painted;
- long tasks during 1,000-message Dexie materialization;
- Alpine expression evaluations after an unrelated state update;
- heap retained after leaving Chat or switching workspaces;
- active Dexie subscription count per section;
- network requests and transferred bytes during five idle minutes.

The migration is successful when inactive sections retain no large reactive
collections or subscriptions, cached navigation paints within one frame, and
an unrelated update does not cause work proportional to total workspace data.

## Risks

- Two stores temporarily representing the same state can drift. Use one-way
  compatibility forwarding, not duplicated mutable arrays.
- Subscription disposal bugs can retain whole workspaces. Centralize section
  activation/disposal and test repeated workspace switching.
- Moving derived state into Dexie projections can make write ordering subtle.
  Update base rows and projections in the same transaction where required.
- Aggressive lazy loading can delay first use of an editor. Prefetch the section
  chunk on intent (hover/focus/navigation) while keeping it out of startup.

## Recommended first work package

Extract the selected-channel chat projection and its template into a dedicated
store/component while retaining a read-only compatibility facade on
`$store.chat`. This has the clearest performance signal and establishes the
activation/disposal pattern for every later section.

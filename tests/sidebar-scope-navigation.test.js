import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSidebarScopeChannelGroups } from '../src/sidebar-navigation.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('expanded sidebar scope/channel navigation', () => {
  it('groups workspace-visible records in scope order and channel position order', () => {
    const scopes = [
      { record_id: 'scope-child', title: 'Child', level: 'l2' },
      { record_id: 'scope-a', title: 'Alpha', level: 'l1' },
      { record_id: 'scope-deleted', title: 'Deleted', level: 'l1', record_state: 'deleted' },
      { record_id: 'scope-b', title: 'Beta', level: 'l1' },
      { record_id: 'scope-a', title: 'Duplicate', level: 'l1' },
    ];
    const channels = [
      { record_id: 'channel-a-2', title: 'Second', scope_id: 'scope-a', position: 2 },
      { record_id: 'channel-a-1', title: 'First', scope_id: 'scope-a', position: 1 },
      { record_id: 'channel-b', title: 'Beta', scope_id: 'scope-b', position: 1 },
      { record_id: 'channel-a-1', title: 'Duplicate', scope_id: 'scope-b', position: 2 },
      { record_id: 'channel-deleted', scope_id: 'scope-a', record_state: 'deleted' },
      { record_id: 'channel-hidden', scope_id: 'scope-a', can_read: false },
      { record_id: 'channel-orphan', scope_id: 'scope-missing' },
    ];

    const groups = buildSidebarScopeChannelGroups(scopes, channels);

    expect(groups.map(({ scope }) => scope.record_id)).toEqual(['scope-a', 'scope-b', 'scope-child']);
    expect(groups[0].channels.map((channel) => channel.record_id)).toEqual(['channel-a-1', 'channel-a-2']);
    expect(groups[1].channels.map((channel) => channel.record_id)).toEqual(['channel-b']);
    expect(groups[2].channels).toEqual([]);
  });

  it('binds Deck selection styling and routes clicks through the shared work-context controller', () => {
    expect(html).toContain('class="sidebar-scope-navigation"');
    expect(html).toContain('active: $store.chat.pgContextSelectedChannelId === channel.record_id && !$store.chat.pgContextSelectedThreadId');
    expect(html).toContain('@click="$store.chat.selectWorkContextChannel(channel.record_id, $event)"');
    expect(html).not.toContain('openSidebarChannel');
  });

  it('renders scope headings as native controls that open the exact scope Home in Deck', () => {
    expect(html).toMatch(/<h2\s+class="sidebar-scope-heading"[^>]*>\s*<span class="sidebar-scope-heading-row">\s*<button/s);
    expect(html).toContain('class="sidebar-scope-heading-control"');
    expect(html).toContain('@click="$store.chat.selectWorkContextScope(group.scope.record_id, $event)"');
    expect(html).toContain("active: $store.chat.navSection === 'status' && $store.chat.pgContextScopeId === group.scope.record_id && $store.chat.pgContextHomeSelected");
    expect(html).toContain("$store.chat.pgContextHomeSelected ? 'page' : null");
    expect(html).toContain("'Open ' + ($store.chat.getScopeBreadcrumb(group.scope.record_id) || group.scope.title || group.scope.record_id) + ' home'");
  });

  it('opens the all-scopes Deck from a workspace avatar control with current-page semantics', () => {
    expect(html).toMatch(/<button\s+type="button"\s+class="sidebar-workspace-overview"/s);
    expect(html).toContain('@click="$store.chat.openAllScopesOverview()"');
    expect(html).toContain("active: $store.chat.navSection === 'status' && $store.chat.pgContextAllScopesSelected");
    expect(html).toContain("$store.chat.pgContextAllScopesSelected ? 'page' : null");
    expect(html).toContain('aria-label="All workspace activity"');
    expect(html).toContain('title="All workspace activity"');
    expect(html).toContain('class="sidebar-workspace-overview-label">Home</span>');
  });

  it('uses the existing workspace avatar image and initials fallback state', () => {
    expect(html).toContain('class="sidebar-workspace-overview-avatar" :src="$store.chat.currentWorkspaceAvatarUrl"');
    expect(html).toContain('class="sidebar-workspace-overview-avatar sidebar-workspace-overview-avatar-fallback avatar-fallback" x-text="$store.chat.currentWorkspaceInitials"');
    expect(html).toContain('<template x-if="!$store.chat.currentWorkspaceAvatarUrl">');
  });

  it('keeps the overview visible for an active workspace when loaded groups are empty', () => {
    const visibility = "x-show=\"(!$store.chat.navCollapsed || $store.chat.mobileNavOpen) && (!$store.chat.scopesLoaded || $store.chat.currentWorkspaceKey || $store.chat.activeWorkspaceOwnerNpub || $store.chat.sidebarScopeChannelGroups.length > 0)\"";

    expect(html).toContain(visibility);
    expect(html).toContain('x-show="$store.chat.currentWorkspaceKey || $store.chat.activeWorkspaceOwnerNpub"');
  });

  it('uses the shared resolved channel label for sidebar text and accessible metadata', () => {
    const resolvedLabel = "$store.chat.getChannelLabel(channel) || channel.name || 'Channel'";

    expect(html).toContain(`:aria-label="${resolvedLabel}"`);
    expect(html).toContain(`:title="${resolvedLabel}"`);
    expect(html).toContain(`x-text="${resolvedLabel}"`);
    expect(html).not.toContain('x-text="channel.title || channel.name || channel.record_id"');
  });

  it('keeps unread and selected channel state reactive on the same sidebar control', () => {
    expect(html).toContain("'sidebar-scope-channel-unread': $store.chat.isChannelUnread(channel.record_id)");
    expect(html).toContain('active: $store.chat.pgContextSelectedChannelId === channel.record_id && !$store.chat.pgContextSelectedThreadId');
    expect(html).toMatch(/class="sidebar-scope-channel-row"[\s\S]*?:class="\{[\s\S]*?active:[\s\S]*?'sidebar-scope-channel-unread':[\s\S]*?\}"/s);
    expect(html).toContain('class="unread-dot unread-dot-channel" x-show="$store.chat.isChannelUnread(channel.record_id)" x-cloak aria-hidden="true"');
    expect(styles).toMatch(/\.sidebar-scope-channel-label\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;/s);
    expect(styles).toMatch(/\.sidebar-scope-channel-unread \.sidebar-scope-channel-label\s*\{[^}]*font-weight:\s*800;/s);
    expect(styles).toMatch(/\.sidebar-scope-channel-row\.active\.sidebar-scope-channel-unread \.sidebar-scope-channel-label\s*\{[^}]*color:\s*#1d4ed8;/s);
  });

  it('adds a permission-aware scoped channel creation control without navigating Home', () => {
    expect(html).toContain('class="sidebar-scope-add-channel"');
    expect(html).toContain('x-show="$store.chat.canCreateChannelInScope(group.scope)"');
    expect(html).toContain(":aria-label=\"'Create channel in ' + ($store.chat.getScopeBreadcrumb(group.scope.record_id) || group.scope.title || group.scope.record_id)\"");
    expect(html).toContain('@click.stop.prevent="$store.chat.openNewChannelModal({ scopeId: group.scope.record_id })"');
    expect(styles).toMatch(/\.sidebar-scope-add-channel\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
    expect(styles).toMatch(/\.sidebar-scope-add-channel:focus-visible\s*\{[^}]*outline:\s*2px solid #2563eb;/s);
  });

  it('renders a visible sibling settings control on every channel row', () => {
    expect(html).toMatch(/class="sidebar-scope-channel-row"[\s\S]*?<button[\s\S]*?class="sidebar-scope-channel"[\s\S]*?<\/button>[\s\S]*?<button[\s\S]*?class="chat-channel-menu-button sidebar-scope-channel-menu"/s);
    expect(html).toContain('@click.stop.prevent="$store.chat.openChannelSettings(channel.record_id)"');
    expect(html).toContain(":aria-label=\"'Channel settings for ' + ($store.chat.getChannelLabel(channel) || channel.name || 'Channel')\"");
    expect(styles).toMatch(/\.sidebar-scope-channel-row\s*\{[^}]*min-height:\s*40px;/s);
    expect(styles).toMatch(/\.sidebar-scope-channel-menu\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
  });

  it('keeps only the middle hierarchy scrollable and hides it in collapsed/mobile rails', () => {
    expect(styles).toMatch(/\.sidebar-nav\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).toMatch(/\.sidebar-scope-navigation\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior-y:\s*contain;/s);
    expect(styles).toMatch(/\.sidebar-scope-heading-control:focus-visible\s*\{[^}]*outline:\s*2px solid #2563eb;/s);
    expect(styles).toMatch(/\.sidebar-workspace-overview:focus-visible\s*\{[^}]*outline:\s*2px solid #2563eb;/s);
    expect(styles).toMatch(/\.sidebar-workspace-overview:active\s*\{[^}]*background:\s*#dbeafe;/s);
    expect(styles).toMatch(/\.sidebar-workspace-footer\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).toMatch(/\.sidebar-collapsed \.sidebar-scope-navigation[\s\S]*display:\s*none;/);
    const mobile = styles.slice(styles.indexOf('@media (max-width: 768px)'));
    expect(mobile).toMatch(/\.sidebar\.sidebar-mobile-open \.sidebar-scope-navigation\s*\{[^}]*display:\s*block;/s);
    expect(mobile).toMatch(/\.sidebar\.sidebar-mobile-open \.sidebar-workspace-navigation-divider\s*\{[^}]*display:\s*block;/s);
  });

  it('hides the horizontal work-context bar only for expanded desktop rails', () => {
    expect(html).toContain("'global-pg-channel-bar-sidebar-expanded': !$store.chat.navCollapsed");
    expect(styles).toMatch(/@media \(min-width: 769px\)\s*\{[\s\S]*?\.global-pg-channel-bar\.global-pg-channel-bar-sidebar-expanded\s*\{[^}]*display:\s*none;/s);
    const mobile = styles.slice(styles.indexOf('@media (max-width: 768px)'));
    expect(mobile).toMatch(/\.global-pg-channel-bar\.global-pg-channel-bar-sidebar-expanded\s*\{[^}]*display:\s*flex;/s);
  });

  it('separates Setup from workspace navigation with an expanded-desktop-only divider', () => {
    expect(html).toMatch(/<span class="sidebar-label">Setup<\/span>[\s\S]*<\/ul>\s*<hr\s+class="sidebar-workspace-navigation-divider"[\s\S]*<section\s+class="sidebar-scope-navigation"/s);
    expect(styles).toMatch(/\.sidebar-workspace-navigation-divider\s*\{[^}]*border-top:\s*1px solid #cbd5e1;/s);
    expect(styles).toMatch(/\.sidebar-collapsed \.sidebar-workspace-navigation-divider,[\s\S]*display:\s*none;/s);
  });
});

import {
  createTowerPgPersonalWapp,
  createTowerPgScopeChannel,
  deleteTowerPgWappActivityMute,
  disableTowerPgWappPublishingGrant,
  patchTowerPgWappActivityUserState,
  putTowerPgWappActivityMute,
  putTowerPgWappPublishingGrant,
  revokeTowerPgWappPublishingGrant,
  rotateTowerPgWappPublishingGrant,
  updateTowerPgPersonalWapp,
} from './tower-command-intents.js';
import {
  mapPgChannelToLocal,
  mapPgPersonalWappToLocal,
  mapPgWappActivityItemToLocal,
  mapPgWappActivityMuteToLocal,
  mapPgWappPublishingGrantToLocal,
  resolveTowerPgWorkspaceContext,
} from './wapp-command-support.js';
import {
  upsertChannel,
  upsertWapp,
  upsertWappActivityItem,
  upsertWappActivityMute,
  deleteWappActivityMute,
  upsertWappPublishingGrant,
} from './db.js';
import { isTowerPgBackendMode } from './backend-mode.js';
import { buildChannelAccessGrantPayloads } from './channels-manager.js';
import { isDmScope } from './dm-scope.js';

function text(value) {
  return String(value ?? '').trim();
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

export function normalizePersonalWappLaunchUrl(value) {
  try {
    const parsed = new URL(text(value));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function personalWappInstallationId(wapp) {
  const metadata = objectValue(wapp?.metadata);
  const autopilot = objectValue(metadata.autopilot_wapp);
  return text(wapp?.wapp_installation_id || metadata.wapp_installation_id || autopilot.wapp_installation_id);
}

export function findPublishingPersonalWapp(wapps = [], installation = {}, ownerActorId = '') {
  const activeRows = (Array.isArray(wapps) ? wapps : []).filter((wapp) => {
    const rowOwnerActorId = text(wapp?.owner_actor_id || wapp?.pg_owner_actor_id);
    return wapp?.record_state !== 'deleted'
      && wapp?.record_state !== 'archived'
      && wapp?.status !== 'archived'
      && (!ownerActorId || !rowOwnerActorId || rowOwnerActorId === ownerActorId);
  });
  const installationId = text(installation?.wapp_installation_id);
  const appId = text(installation?.app_id);
  return activeRows.find((wapp) => installationId && personalWappInstallationId(wapp) === installationId)
    || activeRows.find((wapp) => appId && text(wapp?.app_id) === appId)
    || null;
}

export function extractWappPublishingMetadata(wapp) {
  const metadata = objectValue(wapp?.metadata);
  const autopilot = objectValue(metadata.autopilot_wapp);
  return {
    app_id: text(wapp?.app_id || metadata.app_id || autopilot.app_id),
    wapp_id: text(wapp?.wapp_id || metadata.wapp_id || autopilot.wapp_id),
    source_wingman_url: text(wapp?.source_wingman_url || metadata.source_wingman_url || autopilot.source_wingman_url),
    wapp_installation_id: text(
      wapp?.wapp_installation_id
      || metadata.wapp_installation_id
      || autopilot.wapp_installation_id,
    ),
    publisher_npub: text(wapp?.publisher_npub || metadata.publisher_npub || autopilot.publisher_npub),
    owner_npub: text(wapp?.owner_npub || metadata.owner_npub || autopilot.owner_npub),
    metadata,
    registered_open_origins: uniqueStrings(
      wapp?.registered_open_origins
      || metadata.registered_open_origins
      || autopilot.registered_open_origins,
    ),
  };
}

export function normalizeHttpsOrigins(value) {
  const candidates = Array.isArray(value) ? value : String(value || '').split(/[\n,]+/);
  const origins = [];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(text(candidate));
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) continue;
      origins.push(parsed.origin);
    } catch {
      // Invalid origins are reported by comparing the normalized count in the editor.
    }
  }
  return uniqueStrings(origins);
}

export function approvedWappOpenTarget(item, grants = []) {
  const rawUrl = text(item?.open_url);
  if (!rawUrl || item?.open_links_disabled === true || ['withdrawn', 'resolved'].includes(text(item?.state))) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const itemOrigins = uniqueStrings(item?.registered_open_origins);
  const grant = (Array.isArray(grants) ? grants : [])
    .find((entry) => text(entry?.wapp_installation_id) === text(item?.wapp_installation_id));
  const itemGrantStatus = text(item?.grant_status);
  const grantStatus = text(grant?.status);
  if (
    ['revoked', 'disabled'].includes(itemGrantStatus)
    || ['revoked', 'disabled'].includes(grantStatus)
    || grant?.disable_open_links === true
  ) return null;
  if (item?.open_url_allowed === true) {
    return { url: rawUrl, hostname: parsed.hostname, origin: parsed.origin };
  }
  const authoritativeItemOrigins = itemOrigins.length > 0 && Boolean(itemGrantStatus || item?.open_url_allowed === true);
  const authoritativeGrantOrigins = grant?.grant_authoritative === true
    ? (Array.isArray(grant.registered_open_origins) ? grant.registered_open_origins : [])
    : [];
  const approvedOrigins = new Set(normalizeHttpsOrigins([
    ...(authoritativeItemOrigins ? itemOrigins : []),
    ...authoritativeGrantOrigins,
  ]));
  if (!approvedOrigins.has(parsed.origin)) return null;
  return { url: rawUrl, hostname: parsed.hostname, origin: parsed.origin };
}

export function resolveWappActivityOpenTarget(item, grants = [], visibleWapps = []) {
  const approvedTarget = approvedWappOpenTarget(item, grants);
  if (approvedTarget) return { ...approvedTarget, target_type: 'activity' };

  const grant = (Array.isArray(grants) ? grants : [])
    .find((entry) => text(entry?.wapp_installation_id) === text(item?.wapp_installation_id));
  const status = text(item?.grant_status || grant?.status);
  if (
    item?.open_links_disabled === true
    || ['withdrawn', 'resolved'].includes(text(item?.state))
    || ['revoked', 'disabled'].includes(status)
    || grant?.disable_open_links === true
  ) return null;

  const installationId = text(item?.wapp_installation_id);
  const appId = text(item?.app_id);
  const wappId = text(item?.wapp_id);
  const launcher = (Array.isArray(visibleWapps) ? visibleWapps : []).find((wapp) => {
    const metadata = extractWappPublishingMetadata(wapp);
    return (installationId && metadata.wapp_installation_id === installationId)
      || (appId && metadata.app_id === appId)
      || (wappId && metadata.wapp_id === wappId);
  });
  const url = normalizePersonalWappLaunchUrl(launcher?.launch_url);
  if (!url) return null;
  const parsed = new URL(url);
  return { url, hostname: parsed.hostname, origin: parsed.origin, target_type: 'launcher' };
}

export function filterWappActivityItems(items = [], filters = {}) {
  const source = text(filters.source);
  const category = text(filters.category);
  const channel = text(filters.channel);
  const unreadOnly = filters.unread === true;
  return (Array.isArray(items) ? items : [])
    .filter((item) => !item?.dismissed_at && item?.muted !== true)
    .filter((item) => !unreadOnly || item?.unread === true)
    .filter((item) => !source || text(item?.wapp_installation_id) === source)
    .filter((item) => !category || text(item?.category) === category)
    .filter((item) => !channel || text(item?.channel_id) === channel)
    .sort((left, right) => {
      const timeDelta = Date.parse(right?.occurred_at || right?.updated_at || 0) - Date.parse(left?.occurred_at || left?.updated_at || 0);
      if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta;
      return text(left?.record_id).localeCompare(text(right?.record_id));
    });
}

function unwrapGrant(result) {
  return result?.grant || result?.publishing_grant || result;
}

function unwrapItem(result) {
  return result?.item || result?.activity_item || result;
}

const wappActivityReconciledAt = new WeakMap();

export const wappPublishingManagerMixin = {
  wappPublishingGrants: [],
  wappActivityItems: [],
  wappActivityCounts: {},
  wappActivityMutes: [],
  wappActivityLoading: false,
  wappActivityBootstrapping: true,
  wappActivityError: '',
  wappActivityFilterUnread: false,
  wappActivityFilterSource: '',
  wappActivityFilterCategory: '',
  wappActivityFilterChannel: '',
  wappActivityDismissAllBusy: false,
  wappActivityDismissNotice: '',
  wappPublishingLoading: false,
  wappPublishingEditorOpen: false,
  wappPublishingEditorSaving: false,
  wappPublishingEditorError: '',
  wappPublishingSelectedInstallationId: '',
  wappPublishingCanPost: false,
  wappPublishingDestinationIds: [],
  wappPublishingOriginsText: '',
  wappPublishingRotateOpen: false,
  wappPublishingRotateNpub: '',
  wappPublishingRotateError: '',
  wappPublishingDraftInstallation: null,
  wappPublishingNewChannelOpen: false,
  wappPublishingNewChannelScopeId: '',
  wappPublishingNewChannelName: '',
  wappPublishingNewChannelSaving: false,
  wappPublishingNewChannelError: '',
  wappPublishingAddToMyWapps: false,
  wappPublishingLauncherLaunchUrl: '',
  wappPublishingLauncherDescription: '',
  wappPublishingLauncherIconUrl: '',
  wappPublishingLauncherError: '',
  wappPublishingGrantSaved: false,

  applyWappPublishingGrants(grants = []) {
    this.wappPublishingGrants = Array.isArray(grants) ? grants : [];
  },

  applyWappActivityItems(items = []) {
    this.wappActivityItems = Array.isArray(items) ? items : [];
  },

  applyWappActivityCounts(counts = {}) {
    this.wappActivityCounts = objectValue(counts);
  },

  applyWappActivityMutes(mutes = []) {
    this.wappActivityMutes = Array.isArray(mutes) ? mutes : [];
  },

  applyWappActivityProjection(projection = {}) {
    this.applyWappActivityItems(projection.items);
    this.applyWappActivityCounts(projection.counts);
    this.applyWappActivityMutes(projection.mutes);
    this.wappActivityBootstrapping = false;
    this.wappActivityLoading = false;
  },

  resetWappActivityProjection() {
    this.wappActivityItems = [];
    this.wappActivityCounts = {};
    this.wappActivityMutes = [];
    this.wappActivityError = '';
    this.wappActivityLoading = false;
    this.wappActivityBootstrapping = true;
    this.wappActivityReconciledWorkspaceKey = '';
    this.wappActivityDismissAllBusy = false;
    this.wappActivityDismissNotice = '';
  },

  get wappPublishingInstallations() {
    const byId = new Map();
    for (const grant of (this.wappPublishingGrants || [])) {
      const id = text(grant?.wapp_installation_id);
      if (id) byId.set(id, { ...grant, grant_authoritative: true });
    }
    for (const wapp of (this.wapps || [])) {
      const metadata = extractWappPublishingMetadata(wapp);
      if (!metadata.wapp_installation_id) continue;
      const current = byId.get(metadata.wapp_installation_id) || {};
      byId.set(metadata.wapp_installation_id, {
        ...metadata,
        ...current,
        grant_authoritative: current.grant_authoritative === true,
        wapp_installation_id: metadata.wapp_installation_id,
        app_id: current.app_id || metadata.app_id,
        publisher_npub: current.publisher_npub || metadata.publisher_npub,
        owner_npub: current.owner_npub || metadata.owner_npub,
        display_name: current.display_name || wapp.title || metadata.app_id || 'WApp installation',
        launcher: wapp,
        registered_open_origins: current.registered_open_origins?.length
          ? current.registered_open_origins
          : metadata.registered_open_origins,
      });
    }
    return [...byId.values()].sort((left, right) => text(left.display_name).localeCompare(text(right.display_name)));
  },

  get selectedWappPublishingInstallation() {
    const id = text(this.wappPublishingSelectedInstallationId);
    if (id === 'new') return this.wappPublishingDraftInstallation;
    return this.wappPublishingInstallations.find((entry) => entry.wapp_installation_id === id) || null;
  },

  get isNewWappPublishingInstallation() {
    return this.wappPublishingSelectedInstallationId === 'new';
  },

  get wappPublishingDestinationGroups() {
    const scopesById = new Map((this.scopes || []).map((scope) => [text(scope?.record_id), scope]));
    const groups = new Map();
    for (const channel of (this.channels || [])) {
      if (!channel?.record_id || channel.record_state === 'deleted' || channel.status === 'archived' || channel.archived_at) continue;
      const scopeId = text(channel.scope_id || channel.scope_l1_id);
      if (!scopeId) continue;
      const scope = scopesById.get(scopeId);
      if (!groups.has(scopeId)) groups.set(scopeId, {
        scope_id: scopeId,
        label: this.getScopeBreadcrumb?.(scopeId) || scope?.title || 'Scope',
        channels: [],
      });
      groups.get(scopeId).channels.push({
        channel_id: text(channel.record_id),
        scope_id: scopeId,
        label: this.getChannelLabel?.(channel) || channel.title || channel.name || 'Channel',
      });
    }
    return [...groups.values()]
      .map((group) => ({ ...group, channels: group.channels.sort((a, b) => a.label.localeCompare(b.label)) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },

  get wappPublishingChannelScopeOptions() {
    return (this.scopes || [])
      .filter((scope) => scope?.record_id && scope.record_state !== 'deleted' && !isDmScope(scope))
      .map((scope) => ({
        id: text(scope.record_id),
        label: this.getScopeBreadcrumb?.(scope.record_id) || scope.title || scope.record_id,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  },

  get filteredWappActivityItems() {
    return filterWappActivityItems(this.wappActivityItems, {
      unread: this.wappActivityFilterUnread,
      source: this.wappActivityFilterSource,
      category: this.wappActivityFilterCategory,
      channel: this.wappActivityFilterChannel,
    });
  },

  get hasActiveWappActivityFilters() {
    return this.wappActivityFilterUnread === true
      || Boolean(text(this.wappActivityFilterSource))
      || Boolean(text(this.wappActivityFilterCategory))
      || Boolean(text(this.wappActivityFilterChannel));
  },

  clearWappActivityFilters() {
    this.wappActivityFilterUnread = false;
    this.wappActivityFilterSource = '';
    this.wappActivityFilterCategory = '';
    this.wappActivityFilterChannel = '';
  },

  get wappActivitySources() {
    const byId = new Map();
    for (const item of (this.wappActivityItems || [])) {
      const id = text(item?.wapp_installation_id);
      if (id) byId.set(id, text(item?.source_name) || id);
    }
    return [...byId.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  },

  get wappActivityCategories() {
    return uniqueStrings((this.wappActivityItems || []).map((item) => item?.category)).sort();
  },

  get wappActivityUnreadCount() {
    return (this.wappActivityItems || [])
      .filter((item) => item?.unread && !item?.dismissed_at && !item?.muted)
      .length;
  },

  async refreshWappPublishingGrants() {
    if (!isTowerPgBackendMode() || !this.canAdminWorkspace) return [];
    this.wappPublishingLoading = true;
    try {
      return await this.requestTowerSyncFamily?.('wapp-publishing-grants', '', { force: true }) ?? [];
    } finally {
      this.wappPublishingLoading = false;
    }
  },

  async reconcileWappActivity(options = {}) {
    if (!isTowerPgBackendMode()) return { items: [], counts: {}, mutes: [] };
    const context = resolveTowerPgWorkspaceContext(this);
    if (!context.workspaceId || !context.baseUrl) {
      return { items: [], counts: {}, mutes: [], deferred: true };
    }
    const workspaceKey = text(this.currentWorkspaceKey);
    const refresh = (async () => {
      try {
        const [result] = await Promise.all([
          this.requestTowerSyncFamily?.('wapp-activity', '', options),
          this.requestTowerSyncFamily?.('personal-wapps', '', options).catch(() => this.wapps || []),
        ]);
        const currentContext = resolveTowerPgWorkspaceContext(this);
        if (currentContext.workspaceId === context.workspaceId && currentContext.baseUrl === context.baseUrl) {
          wappActivityReconciledAt.set(this, { at: Date.now(), workspaceKey });
          this.wappActivityReconciledWorkspaceKey = workspaceKey;
        }
        return result;
      } catch (error) {
        this.wappActivityError = error?.message || 'Could not refresh Feed.';
        return { items: [], counts: {}, mutes: [] };
      } finally {
      }
    })();
    return refresh;
  },

  async openWappPublishingEditor(installation) {
    if (!installation) return;
    this.wappPublishingSelectedInstallationId = text(installation.wapp_installation_id);
    this.wappPublishingDraftInstallation = null;
    this.wappPublishingEditorError = '';
    this.wappPublishingCanPost = installation.status === 'active'
      && (installation.capabilities || []).includes('activity.publish');
    this.wappPublishingDestinationIds = (installation.destinations || []).map((destination) => text(destination.channel_id)).filter(Boolean);
    this.wappPublishingOriginsText = (installation.registered_open_origins || []).join('\n');
    this.wappPublishingRotateOpen = false;
    this.wappPublishingRotateNpub = '';
    this.wappPublishingNewChannelOpen = false;
    this.wappPublishingLauncherError = '';
    this.wappPublishingGrantSaved = false;
    this.wappPublishingAddToMyWapps = false;
    this.wappPublishingEditorOpen = true;
  },

  openNewWappPublishingEditor() {
    this.wappPublishingSelectedInstallationId = 'new';
    this.wappPublishingDraftInstallation = {
      wapp_installation_id: '',
      app_id: '',
      wapp_id: '',
      source_wingman_url: '',
      publisher_npub: '',
      owner_npub: text(this.currentViewerNpub || this.session?.npub),
      display_name: '',
      capabilities: [],
      destinations: [],
      registered_open_origins: [],
      status: 'unconfigured',
      grant_version: 0,
      metadata: {},
    };
    this.wappPublishingCanPost = true;
    this.wappPublishingDestinationIds = [];
    this.wappPublishingOriginsText = '';
    this.wappPublishingEditorError = '';
    this.wappPublishingRotateOpen = false;
    this.wappPublishingNewChannelOpen = false;
    this.wappPublishingNewChannelScopeId = '';
    this.wappPublishingNewChannelName = '';
    this.wappPublishingNewChannelError = '';
    this.wappPublishingAddToMyWapps = true;
    this.wappPublishingLauncherLaunchUrl = '';
    this.wappPublishingLauncherDescription = '';
    this.wappPublishingLauncherIconUrl = '';
    this.wappPublishingLauncherError = '';
    this.wappPublishingGrantSaved = false;
    this.wappPublishingEditorOpen = true;
  },

  closeWappPublishingEditor(force = false) {
    if (this.wappPublishingEditorSaving && !force) return;
    this.wappPublishingEditorOpen = false;
    this.wappPublishingEditorError = '';
    this.wappPublishingRotateOpen = false;
    this.wappPublishingDraftInstallation = null;
    this.wappPublishingNewChannelOpen = false;
    this.wappPublishingNewChannelError = '';
    this.wappPublishingLauncherError = '';
    this.wappPublishingGrantSaved = false;
  },

  toggleWappPublishingDestination(channelId, checked) {
    const id = text(channelId);
    const next = new Set(this.wappPublishingDestinationIds || []);
    if (checked) next.add(id);
    else next.delete(id);
    this.wappPublishingDestinationIds = [...next];
  },

  async openWappPublishingNewChannel() {
    this.wappPublishingNewChannelOpen = true;
    this.wappPublishingNewChannelError = '';
    this.wappPublishingNewChannelName = '';
    const options = this.wappPublishingChannelScopeOptions;
    const currentScopeId = text(this.currentConcretePgScopeId);
    this.wappPublishingNewChannelScopeId = options.some((option) => option.id === currentScopeId)
      ? currentScopeId
      : (options.length === 1 ? options[0].id : '');
    try {
      await Promise.all([
        this.refreshTowerPgWorkspaceMembers?.({ force: true, limit: 200 }) ?? Promise.resolve([]),
        this.refreshGroups?.({ force: true, minIntervalMs: 0 }) ?? Promise.resolve([]),
      ]);
      this.resetNewChannelAccessRows?.();
    } catch (error) {
      this.wappPublishingNewChannelError = error?.message || 'Could not load channel access defaults.';
    }
  },

  closeWappPublishingNewChannel() {
    if (this.wappPublishingNewChannelSaving) return;
    this.wappPublishingNewChannelOpen = false;
    this.wappPublishingNewChannelError = '';
  },

  async createWappPublishingChannel() {
    const scopeId = text(this.wappPublishingNewChannelScopeId);
    const name = text(this.wappPublishingNewChannelName);
    if (!scopeId || !name) {
      this.wappPublishingNewChannelError = 'Choose a scope and enter a channel name.';
      return;
    }
    if (!this.wappPublishingChannelScopeOptions.some((option) => option.id === scopeId)) {
      this.wappPublishingNewChannelError = 'Choose an available non-DM scope.';
      return;
    }
    const context = resolveTowerPgWorkspaceContext(this);
    if (!context.workspaceId || !context.baseUrl) {
      this.wappPublishingNewChannelError = 'Configure setup first.';
      return;
    }
    const grants = buildChannelAccessGrantPayloads(this.newChannelAccessRows);
    if (grants.length === 0) {
      this.wappPublishingNewChannelError = 'Channel access could not be initialized. Reopen New channel and try again.';
      return;
    }
    this.wappPublishingNewChannelSaving = true;
    this.wappPublishingNewChannelError = '';
    try {
      const result = await createTowerPgScopeChannel(this, context.workspaceId, scopeId, {
        name,
        kind: 'channel',
        grants,
      }, { baseUrl: context.baseUrl, appNpub: context.appNpub });
      const channel = mapPgChannelToLocal(result?.channel, { workspaceOwnerNpub: context.workspaceOwnerNpub });
      if (!channel.record_id) throw new Error('Tower did not return the new channel.');
      await upsertChannel(channel);
      if (typeof this.applyChannels === 'function') {
        await this.applyChannels([
          ...(this.channels || []).filter((entry) => entry.record_id !== channel.record_id),
          channel,
        ]);
      } else {
        this.channels = [...(this.channels || []).filter((entry) => entry.record_id !== channel.record_id), channel];
      }
      this.toggleWappPublishingDestination(channel.record_id, true);
      await this.requestTowerSyncFamily?.('channels', '', { force: true }).catch(() => this.channels);
      this.wappPublishingNewChannelOpen = false;
      this.wappPublishingNewChannelName = '';
    } catch (error) {
      this.wappPublishingNewChannelError = error?.reason || error?.message || 'Could not create the channel.';
    } finally {
      this.wappPublishingNewChannelSaving = false;
    }
  },

  async saveWappPublishingLauncher(installation) {
    const context = resolveTowerPgWorkspaceContext(this);
    const launchUrl = normalizePersonalWappLaunchUrl(this.wappPublishingLauncherLaunchUrl);
    if (!context.workspaceId || !context.baseUrl) throw new Error('Configure setup first.');
    if (!launchUrl) throw new Error('Launch URL must be a valid HTTP(S) URL.');
    const ownerActorId = text(this.currentPgActorId);
    const existing = findPublishingPersonalWapp(this.wapps, installation, ownerActorId);
    const sourceMetadata = objectValue(installation?.metadata);
    const autopilotMetadata = objectValue(sourceMetadata.autopilot_wapp);
    const wappId = text(installation?.wapp_id || autopilotMetadata.wapp_id || existing?.wapp_id);
    const sourceWingmanUrl = text(installation?.source_wingman_url || autopilotMetadata.source_wingman_url || existing?.source_wingman_url);
    const body = {
      title: text(installation?.display_name),
      description: text(this.wappPublishingLauncherDescription) || null,
      launch_url: launchUrl,
      icon_url: text(this.wappPublishingLauncherIconUrl) || null,
      app_id: text(installation?.app_id),
      wapp_id: wappId || null,
      source_wingman_url: sourceWingmanUrl || null,
      metadata: {
        ...objectValue(existing?.metadata),
        ...sourceMetadata,
        wapp_installation_id: text(installation?.wapp_installation_id),
        autopilot_wapp: {
          ...objectValue(existing?.metadata?.autopilot_wapp),
          ...autopilotMetadata,
          app_id: text(installation?.app_id),
          ...(wappId ? { wapp_id: wappId } : {}),
          wapp_installation_id: text(installation?.wapp_installation_id),
          ...(sourceWingmanUrl ? { source_wingman_url: sourceWingmanUrl } : {}),
        },
      },
    };
    const response = existing?.record_id
      ? await updateTowerPgPersonalWapp(this, context.workspaceId, existing.record_id, body, {
          baseUrl: context.baseUrl,
          appNpub: context.appNpub,
        })
      : await createTowerPgPersonalWapp(this, context.workspaceId, body, {
          baseUrl: context.baseUrl,
          appNpub: context.appNpub,
        });
    const personalWapp = response?.personal_wapp;
    if (!personalWapp) throw new Error('Tower saved the launcher but did not return it.');
    const row = mapPgPersonalWappToLocal(personalWapp, { workspaceOwnerNpub: context.workspaceOwnerNpub });
    await upsertWapp(row);
    this.wapps = [...(this.wapps || []).filter((entry) => entry.record_id !== row.record_id), row];
      await this.requestTowerSyncFamily?.('personal-wapps', '', { force: true }).catch(() => this.wapps);
    return row;
  },

  async retryWappPublishingLauncher() {
    const installation = this.selectedWappPublishingInstallation;
    if (!installation || !this.wappPublishingGrantSaved) return;
    this.wappPublishingEditorSaving = true;
    this.wappPublishingLauncherError = '';
    try {
      await this.saveWappPublishingLauncher(installation);
      this.closeWappPublishingEditor(true);
    } catch (error) {
      this.wappPublishingLauncherError = error?.reason || error?.message || 'The publishing grant is saved, but My WApps could not be updated.';
    } finally {
      this.wappPublishingEditorSaving = false;
    }
  },

  async saveWappPublishingGrant() {
    const installation = this.selectedWappPublishingInstallation;
    if (!installation) return;
    const context = resolveTowerPgWorkspaceContext(this);
    if (!context.workspaceId || !context.baseUrl) {
      this.wappPublishingEditorError = 'Configure setup first.';
      return;
    }
    const destinations = [];
    for (const group of this.wappPublishingDestinationGroups) {
      for (const channel of group.channels) {
        if ((this.wappPublishingDestinationIds || []).includes(channel.channel_id)) {
          destinations.push({ scope_id: group.scope_id, channel_id: channel.channel_id });
        }
      }
    }
    const rawOrigins = String(this.wappPublishingOriginsText || '').split(/[\n,]+/).map(text).filter(Boolean);
    const origins = normalizeHttpsOrigins(rawOrigins);
    const isNewInstallation = this.isNewWappPublishingInstallation;
    if (!text(installation.wapp_installation_id) || !text(installation.app_id) || !text(installation.publisher_npub) || !text(installation.owner_npub) || !text(installation.display_name)) {
      this.wappPublishingEditorError = 'Installation ID, app ID, publisher npub, owner npub, and display name are required.';
      return;
    }
    if (this.wappPublishingCanPost && destinations.length === 0) {
      this.wappPublishingEditorError = 'Select at least one channel. Flight Deck never chooses a default publishing destination.';
      return;
    }
    if (rawOrigins.length !== origins.length) {
      this.wappPublishingEditorError = 'Every open origin must be an HTTPS origin such as https://app.example.com, without a path.';
      return;
    }
    if (isNewInstallation && this.wappPublishingAddToMyWapps && !normalizePersonalWappLaunchUrl(this.wappPublishingLauncherLaunchUrl)) {
      this.wappPublishingEditorError = 'Add to My WApps requires a valid HTTP(S) launch URL.';
      return;
    }
    if (this.wappPublishingGrantSaved) {
      await this.retryWappPublishingLauncher();
      return;
    }
    this.wappPublishingEditorSaving = true;
    this.wappPublishingEditorError = '';
    try {
      let result;
      if (!this.wappPublishingCanPost && installation.grant_id) {
        result = await disableTowerPgWappPublishingGrant(this, context.workspaceId, installation.wapp_installation_id, {
          disabled: true,
          reason: 'Disabled in Flight Deck',
        }, { baseUrl: context.baseUrl, appNpub: context.appNpub });
      } else if (this.wappPublishingCanPost) {
        result = await putTowerPgWappPublishingGrant(this, context.workspaceId, installation.wapp_installation_id, {
          app_id: installation.app_id,
          publisher_npub: installation.publisher_npub,
          owner_npub: installation.owner_npub,
          display_name: installation.display_name,
          capabilities: ['activity.publish'],
          destinations,
          registered_open_origins: origins,
        }, { baseUrl: context.baseUrl, appNpub: context.appNpub });
      } else {
        this.closeWappPublishingEditor(true);
        return;
      }
      const grant = mapPgWappPublishingGrantToLocal(unwrapGrant(result));
      if (grant.wapp_installation_id) {
        await upsertWappPublishingGrant(grant);
        this.applyWappPublishingGrants([
          ...(this.wappPublishingGrants || []).filter((entry) => entry.wapp_installation_id !== grant.wapp_installation_id),
          grant,
        ]);
      }
      if (isNewInstallation && this.wappPublishingAddToMyWapps) {
        this.wappPublishingGrantSaved = true;
        this.wappPublishingDraftInstallation = { ...installation, ...grant };
        try {
          await this.saveWappPublishingLauncher(this.wappPublishingDraftInstallation);
        } catch (error) {
          this.wappPublishingLauncherError = `Publishing grant saved. My WApps was not updated: ${error?.reason || error?.message || 'unknown error'}`;
          return;
        }
      }
      this.closeWappPublishingEditor(true);
    } catch (error) {
      this.wappPublishingEditorError = error?.reason || error?.message || 'Could not save the publishing grant.';
    } finally {
      this.wappPublishingEditorSaving = false;
    }
  },

  async revokeSelectedWappPublishingGrant() {
    const installation = this.selectedWappPublishingInstallation;
    const context = resolveTowerPgWorkspaceContext(this);
    if (!installation?.wapp_installation_id || !context.workspaceId) return;
    if (typeof window !== 'undefined' && !window.confirm('Revoke this WApp publishing grant? Retained updates will show a revoked-source treatment.')) return;
    this.wappPublishingEditorSaving = true;
    try {
      const result = await revokeTowerPgWappPublishingGrant(this, context.workspaceId, installation.wapp_installation_id, {
        reason: 'Revoked in Flight Deck',
        disable_open_links: true,
      }, { baseUrl: context.baseUrl, appNpub: context.appNpub });
      const grant = mapPgWappPublishingGrantToLocal(unwrapGrant(result));
      if (grant.wapp_installation_id) await upsertWappPublishingGrant(grant);
      this.closeWappPublishingEditor(true);
    } catch (error) {
      this.wappPublishingEditorError = error?.reason || error?.message || 'Could not revoke the publishing grant.';
    } finally {
      this.wappPublishingEditorSaving = false;
    }
  },

  async rotateSelectedWappPublisherKey() {
    const installation = this.selectedWappPublishingInstallation;
    const context = resolveTowerPgWorkspaceContext(this);
    const newPublisherNpub = text(this.wappPublishingRotateNpub);
    if (!installation?.publisher_npub || !newPublisherNpub || !context.workspaceId) {
      this.wappPublishingRotateError = 'Enter the replacement publisher npub.';
      return;
    }
    this.wappPublishingEditorSaving = true;
    this.wappPublishingRotateError = '';
    try {
      const nonce = globalThis.crypto?.randomUUID?.() || `rotation-${Date.now()}`;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const result = await rotateTowerPgWappPublishingGrant(this, context.workspaceId, installation.wapp_installation_id, {
        current_publisher_npub: installation.publisher_npub,
        new_publisher_npub: newPublisherNpub,
        nonce,
        expires_at: expiresAt,
      }, { baseUrl: context.baseUrl, appNpub: context.appNpub });
      const grant = mapPgWappPublishingGrantToLocal(unwrapGrant(result));
      if (grant.wapp_installation_id) await upsertWappPublishingGrant(grant);
      this.wappPublishingRotateOpen = false;
      this.wappPublishingRotateNpub = '';
    } catch (error) {
      this.wappPublishingRotateError = error?.reason || error?.message || 'Could not rotate the publisher key.';
    } finally {
      this.wappPublishingEditorSaving = false;
    }
  },

  async updateWappActivityUserState(item, patch) {
    const itemId = text(item?.record_id);
    const context = resolveTowerPgWorkspaceContext(this);
    if (!itemId || !context.workspaceId) {
      this.wappActivityError = 'Could not update this Feed item because the workspace is not ready.';
      return false;
    }
    this.wappActivityError = '';
    try {
      const result = await patchTowerPgWappActivityUserState(this, context.workspaceId, itemId, patch, {
        baseUrl: context.baseUrl,
        appNpub: context.appNpub,
      });
      const returnedState = objectValue(result?.state || result?.user_state);
      const next = mapPgWappActivityItemToLocal({ ...item, ...returnedState });
      if (next.record_id) {
        await upsertWappActivityItem(next);
      }
      return true;
    } catch (error) {
      this.wappActivityError = error?.reason || error?.message || 'Could not update this WApp item.';
      return false;
    }
  },

  markWappActivityRead(item) {
    return this.updateWappActivityUserState(item, { read: true });
  },

  markWappActivityUnread(item) {
    return this.updateWappActivityUserState(item, { read: false });
  },

  async dismissWappActivity(item) {
    const itemId = text(item?.record_id);
    if (!itemId) {
      this.wappActivityError = 'Could not dismiss this Feed item.';
      return false;
    }

    const previousItems = this.wappActivityItems;
    const dismissedAt = new Date().toISOString();
    this.wappActivityItems = (this.wappActivityItems || []).map((entry) => (
      text(entry?.record_id) === itemId ? { ...entry, dismissed_at: dismissedAt } : entry
    ));

    const persisted = await this.updateWappActivityUserState(item, { dismissed: true });
    if (persisted) return true;

    const current = (this.wappActivityItems || []).find((entry) => text(entry?.record_id) === itemId);
    if (!current || current.dismissed_at === dismissedAt) this.wappActivityItems = previousItems;
    this.wappActivityDismissNotice = 'Dismissal failed. The Feed item has been restored.';
    return false;
  },

  async dismissAllWappActivity() {
    if (this.wappActivityDismissAllBusy) return { ok: false, count: 0 };
    const items = [...this.filteredWappActivityItems];
    this.wappActivityDismissNotice = '';
    if (items.length === 0) {
      this.wappActivityDismissNotice = 'Feed is already clear.';
      return { ok: true, count: 0 };
    }

    this.wappActivityDismissAllBusy = true;
    try {
      const results = await Promise.all(items.map((item) => this.dismissWappActivity(item)));
      const count = results.filter(Boolean).length;
      if (count === items.length) {
        this.wappActivityDismissNotice = `${count} ${count === 1 ? 'item' : 'items'} dismissed.`;
        return { ok: true, count };
      }
      this.wappActivityDismissNotice = count > 0
        ? `${count} of ${items.length} items dismissed.`
        : 'Could not dismiss Feed items.';
      return { ok: false, count };
    } finally {
      this.wappActivityDismissAllBusy = false;
    }
  },

  async setWappActivityMute(targetType, targetValue, muted = true) {
    const context = resolveTowerPgWorkspaceContext(this);
    if (!context.workspaceId || !text(targetValue)) return;
    try {
      if (muted) {
        const result = await putTowerPgWappActivityMute(this, context.workspaceId, targetType, targetValue, {}, {
          baseUrl: context.baseUrl,
          appNpub: context.appNpub,
        });
        const mute = mapPgWappActivityMuteToLocal(result?.mute || result);
        if (mute.record_id) await upsertWappActivityMute(mute);
      } else {
        await deleteTowerPgWappActivityMute(this, context.workspaceId, targetType, targetValue, {
          baseUrl: context.baseUrl,
          appNpub: context.appNpub,
        });
        await deleteWappActivityMute(`${text(targetType)}:${text(targetValue)}`);
      }
    } catch (error) {
      this.wappActivityError = error?.reason || error?.message || 'Could not update WApp mute settings.';
    }
  },

  getWappActivityOpenTarget(item) {
    return resolveWappActivityOpenTarget(item, this.wappPublishingInstallations, this.visiblePersonalWapps);
  },

  wappActivityChannelLabel(item) {
    const channel = (this.channels || []).find((entry) => text(entry?.record_id) === text(item?.channel_id));
    return text(item?.channel_title) || (channel ? text(this.getChannelLabel?.(channel) || channel.title || channel.name) : '');
  },

  wappActivityMuteLabel(mute) {
    if (mute?.target_type === 'category') return `Category: ${text(mute.target_value)}`;
    const installation = this.wappPublishingInstallations.find((entry) => entry.wapp_installation_id === text(mute?.target_value));
    return `Source: ${text(installation?.display_name || mute?.target_value)}`;
  },

  openWappActivityLink(item) {
    const target = this.getWappActivityOpenTarget(item);
    if (!target || typeof window === 'undefined') return false;
    window.open(target.url, '_blank', 'noopener,noreferrer');
    if (item?.unread) void this.markWappActivityRead(item);
    return true;
  },

  async openWappActivityChannel(item) {
    const channelId = text(item?.channel_id);
    const visible = (this.channels || []).some((channel) => text(channel?.record_id) === channelId && channel.record_state !== 'deleted');
    if (!channelId || !visible) return false;
    this.navigateTo('chat', { syncRoute: false, skipChatChannelSelection: true });
    await this.selectChannel(channelId, { syncRoute: false, scrollToLatest: false, backgroundRemoteRefresh: true });
    if (text(this.selectedChannelId) !== channelId) return false;
    this.syncRoute?.();
    if (item?.unread) void this.markWappActivityRead(item);
    return true;
  },

  wappActivitySourceTreatment(item) {
    const grant = this.wappPublishingInstallations.find((entry) => entry.wapp_installation_id === text(item?.wapp_installation_id));
    const status = text(item?.grant_status || grant?.status);
    if (status === 'revoked') return 'Source revoked';
    if (status === 'disabled') return 'Publishing disabled';
    if (item?.state === 'withdrawn') return 'Withdrawn';
    if (item?.state === 'resolved') return 'Resolved';
    return 'Verified WApp';
  },
};

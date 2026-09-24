import { createAutopilotDiscoveryClient, verifyAutopilotConnectPackage } from './autopilot-connect-client.js';
import { createTowerPgAutopilotConnection, createTowerPgWorkspaceAgent } from './tower-command-intents.js';

const text = (value) => String(value ?? '').trim();
const VIEWS = new Set(['overview', 'pipelines', 'schedules', 'triggers']);

export function normalizeAgentPipelineView(payload = {}) {
  const definitions = new Map((Array.isArray(payload.available_definitions) ? payload.available_definitions : [])
    .map((row) => [text(row?.pipeline_definition_id), {
      id: text(row?.pipeline_definition_id), name: text(row?.name) || text(row?.pipeline_definition_id),
      description: text(row?.description), scope: text(row?.scope), version: row?.version ?? null,
      tags: Array.isArray(row?.tags) ? row.tags.map(text).filter(Boolean) : [],
    }]).filter(([id]) => id));
  const ids = (rows) => new Set((Array.isArray(rows) ? rows : []).map((row) => text(row?.pipeline_definition_id)).filter(Boolean));
  const assigned = ids(payload.assignments);
  const defaults = ids(payload.defaults);
  const overrides = (Array.isArray(payload.overrides) ? payload.overrides : []).map((row) => ({
    kind: text(row?.kind), contextId: text(row?.context_id), pipelineDefinitionId: text(row?.pipeline_definition_id),
  })).filter((row) => row.kind && row.contextId && row.pipelineDefinitionId);
  const missing = new Set((Array.isArray(payload.missing_definition_ids) ? payload.missing_definition_ids : []).map(text).filter(Boolean));
  const referenced = new Set([...assigned, ...defaults, ...overrides.map((row) => row.pipelineDefinitionId), ...missing]);
  return {
    availabilityMode: payload.availability_mode === 'implicit_all' ? 'implicit_all' : 'explicit',
    defaultMode: payload.default_mode === 'implicit_library' ? 'implicit_library' : 'explicit',
    definitions: [...definitions.values()].map((definition) => ({
      ...definition, assigned: assigned.has(definition.id), default: defaults.has(definition.id),
      overrides: overrides.filter((row) => row.pipelineDefinitionId === definition.id), missing: false,
    })),
    missing: [...referenced].filter((id) => !definitions.has(id)).map((id) => ({
      id, name: id, assigned: assigned.has(id), default: defaults.has(id),
      overrides: overrides.filter((row) => row.pipelineDefinitionId === id), missing: true,
    })),
  };
}

export function normalizeAgentBoundRows(payload, key, agent) {
  return (Array.isArray(payload?.[key]) ? payload[key] : []).filter((row) => (
    text(row?.agent_id) === text(agent?.agentId) && text(row?.bot_npub) === text(agent?.botNpub)
  ));
}

function storedPackage(connection) {
  const endpoint = new URL(text(connection?.fips_endpoint));
  const transportNpub = text(connection?.fips_transport_npub || connection?.metadata?.installation_npub);
  if (endpoint.protocol !== 'http:' || !endpoint.port || endpoint.origin !== `http://${transportNpub}.fips:${endpoint.port}`) {
    throw new Error('Stored Autopilot transport identity does not match its signed FIPS origin.');
  }
  const metadata = connection?.metadata || {};
  return Object.freeze({
    version: Number(metadata.connect_package_version || 1), installationId: text(connection.installation_id),
    installationNpub: text(connection.metadata?.installation_npub), transportNpub, fipsEndpoint: endpoint.origin,
    httpsEndpoint: text(connection.https_endpoint) || null, apiVersion: Number(connection.api_version || 1),
    capabilities: Object.freeze([...(connection.capabilities || [])]), healthPath: text(metadata.health_path), agentsPath: text(metadata.agents_path),
  });
}

function managerError(error, fallback) {
  return text(error?.message || error?.reason) || fallback;
}

export const agentSpaceManagerMixin = {
  agentConnections: [], workspaceAgents: [], agentConnectInput: '', agentConnectError: '', agentConnectBusy: false,
  agentConnectStep: 'package', agentDiscoveredAgents: [], agentSelectedDiscoveryIds: [], _verifiedAgentConnectPackage: null,
  selectedWorkspaceAgentId: '', agentSpaceView: 'overview', agentSpaceLoading: false, agentSpaceError: '', agentSpaceData: null,

  openAgentConnectModal() {
    this.showAgentConnectModal = true; this.agentConnectStep = 'package'; this.agentConnectError = '';
    this.agentConnectInput = ''; this.agentDiscoveredAgents = []; this.agentSelectedDiscoveryIds = []; this._verifiedAgentConnectPackage = null;
  },
  closeAgentConnectModal() { if (!this.agentConnectBusy) this.showAgentConnectModal = false; },
  toggleDiscoveredAgent(agentId) {
    const id = text(agentId); const selected = new Set(this.agentSelectedDiscoveryIds || []);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    this.agentSelectedDiscoveryIds = [...selected];
  },
  async verifyAndDiscoverAutopilotAgents() {
    this.agentConnectBusy = true; this.agentConnectError = '';
    try {
      const verified = verifyAutopilotConnectPackage(this.agentConnectInput);
      const client = createAutopilotDiscoveryClient(verified);
      const health = await client.health();
      if (!health.ok) throw new Error('Autopilot reported that this installation is not healthy.');
      const agents = await client.discoverAgents();
      this._verifiedAgentConnectPackage = verified;
      this.agentDiscoveredAgents = agents;
      this.agentSelectedDiscoveryIds = agents.map((agent) => agent.agentId);
      this.agentConnectStep = 'agents';
      await client.disconnect();
    } catch (error) { this.agentConnectError = managerError(error, 'Could not verify this Autopilot connection package.'); }
    finally { this.agentConnectBusy = false; }
  },
  async installSelectedAutopilotAgents() {
    const verified = this._verifiedAgentConnectPackage;
    const selected = new Set(this.agentSelectedDiscoveryIds || []);
    const agents = (this.agentDiscoveredAgents || []).filter((agent) => selected.has(agent.agentId));
    const workspaceId = text(this.currentWorkspace?.workspaceId);
    if (!verified || !workspaceId || agents.length === 0) { this.agentConnectError = 'Select at least one agent to add.'; return; }
    this.agentConnectBusy = true; this.agentConnectError = '';
    try {
      const response = await createTowerPgAutopilotConnection(this, workspaceId, {
        installation_id: verified.installationId, fips_transport_npub: verified.transportNpub,
        display_name: `Autopilot ${verified.installationId}`,
        fips_endpoint: verified.fipsEndpoint, https_endpoint: verified.httpsEndpoint, api_version: String(verified.apiVersion),
        capabilities: [...verified.capabilities], metadata: { connect_package_version: verified.version, installation_npub: verified.installationNpub, health_path: verified.healthPath, agents_path: verified.agentsPath },
      }, { baseUrl: this.backendUrl });
      const connection = response?.autopilot_connection;
      if (!connection?.id) throw new Error('Tower did not return the Autopilot connection.');
      let firstInstalledId = (this.workspaceAgents || []).find((row) => row.connection_id === connection.id && selected.has(row.agent_id))?.id || '';
      for (const [sortOrder, agent] of agents.entries()) {
        const existing = (this.workspaceAgents || []).find((row) => row.connection_id === connection.id && row.agent_id === agent.agentId);
        if (existing) { firstInstalledId ||= existing.id; continue; }
        const created = await createTowerPgWorkspaceAgent(this, workspaceId, {
          connection_id: connection.id, agent_id: agent.agentId, agent_npub: agent.botNpub,
          display_name: agent.name, capabilities: [], sort_order: sortOrder, is_visible: true,
          metadata: { description: agent.description, can_instruct: agent.canInstruct, paths: agent.paths },
        }, { baseUrl: this.backendUrl });
        firstInstalledId ||= created?.workspace_agent?.id || '';
      }
      await this.requestTowerSyncFamily?.('workspace-bootstrap', '', { force: true });
      this.showAgentConnectModal = false;
      if (firstInstalledId) this.openAgentSpace(firstInstalledId);
    } catch (error) { this.agentConnectError = managerError(error, 'Could not save the selected agents.'); }
    finally { this.agentConnectBusy = false; }
  },
  async openAgentSpace(workspaceAgentId, view = 'overview') {
    this.selectedWorkspaceAgentId = text(workspaceAgentId); this.navSection = 'agents'; this.mobileNavOpen = false;
    await this.selectAgentSpaceView(view, { syncRoute: true });
  },
  async selectAgentSpaceView(view, { syncRoute = false } = {}) {
    const nextView = VIEWS.has(view) ? view : 'overview'; this.agentSpaceView = nextView;
    if (syncRoute) this.syncRoute?.();
    await this.loadSelectedAgentSpaceView();
  },
  async loadSelectedAgentSpaceView() {
    const row = (this.workspaceAgents || []).find((agent) => agent.id === this.selectedWorkspaceAgentId);
    const connection = (this.agentConnections || []).find((item) => item.id === row?.connection_id);
    if (!row || !connection) { this.agentSpaceData = null; this.agentSpaceError = row ? 'Installation connection is unavailable offline.' : ''; return; }
    this.agentSpaceLoading = true; this.agentSpaceError = '';
    try {
      const agent = { agentId: row.agent_id, botNpub: row.agent_npub, paths: row.metadata?.paths || {} };
      const payload = await createAutopilotDiscoveryClient(storedPackage(connection)).readAgent(agent, this.agentSpaceView);
      this.agentSpaceData = this.agentSpaceView === 'pipelines' ? normalizeAgentPipelineView(payload)
        : this.agentSpaceView === 'schedules' ? normalizeAgentBoundRows(payload, 'schedules', agent)
          : this.agentSpaceView === 'triggers' ? normalizeAgentBoundRows(payload, 'triggers', agent) : payload.agent;
    } catch (error) {
      this.agentSpaceError = globalThis.navigator?.onLine === false
        ? 'Agent Space is offline. The installed agent remains available after reconnecting.'
        : managerError(error, 'Could not load this Agent Space view.');
    } finally { this.agentSpaceLoading = false; }
  },
  get selectedWorkspaceAgent() { return (this.workspaceAgents || []).find((row) => row.id === this.selectedWorkspaceAgentId) || null; },
  get selectedAgentConnection() { return (this.agentConnections || []).find((row) => row.id === this.selectedWorkspaceAgent?.connection_id) || null; },
  get selectedAgentAutopilotUrl() { return text(this.selectedWorkspaceAgent?.metadata?.launch_url || this.selectedAgentConnection?.https_endpoint); },
  get selectedAgentCanInstructLabel() { return this.selectedWorkspaceAgent?.metadata?.can_instruct === true ? 'Can receive instructions' : 'Read-only'; },
};

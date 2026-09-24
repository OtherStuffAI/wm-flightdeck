const SECRET_KEY = /(token|secret|private|nsec|bunker|nwc|connect_package|nip_?98|discovery_response|raw_discovery)/i;
const SECRET_VALUE = /^(?:nsec1|bunker:|nostr\+walletconnect:)/i;

function string(value, field, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  const normalized = String(value ?? '').trim();
  if (!normalized && !nullable) throw new Error(`${field} is required`);
  return normalized || null;
}

function integer(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) throw new Error(`${field} must be a non-negative integer`);
  return normalized;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`);
  return value;
}

function stringList(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return [...new Set(value.map(item => item.trim()))];
}

function publicUrl(value, field, schemes, { nullable = false } = {}) {
  const normalized = string(value, field, { nullable });
  if (normalized == null) return null;
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new Error(`${field} must be a valid public URL`); }
  if (!schemes.includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${field} must use an accepted public scheme without credentials`);
  }
  return normalized;
}

function publicMetadata(value, path = 'metadata') {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
  const visit = (input, currentPath) => {
    if (input == null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') {
      if (SECRET_VALUE.test(input.trim())) throw new Error(`${currentPath} contains private connection material`);
      return input;
    }
    if (Array.isArray(input)) return input.map((item, index) => visit(item, `${currentPath}[${index}]`));
    if (!input || typeof input !== 'object') throw new Error(`${currentPath} contains an unsupported value`);
    return Object.fromEntries(Object.entries(input).map(([key, item]) => {
      if (SECRET_KEY.test(key)) throw new Error(`${currentPath}.${key} is not public capability metadata`);
      return [key, visit(item, `${currentPath}.${key}`)];
    }));
  };
  return visit(value, path);
}

function auditFields(row) {
  return {
    row_version: integer(row.row_version, 'row_version'),
    created_by_actor_id: string(row.created_by_actor_id, 'created_by_actor_id'),
    updated_by_actor_id: string(row.updated_by_actor_id, 'updated_by_actor_id'),
    archived_by_actor_id: string(row.archived_by_actor_id, 'archived_by_actor_id', { nullable: true }),
    created_at: string(row.created_at, 'created_at'),
    updated_at: string(row.updated_at, 'updated_at'),
    archived_at: string(row.archived_at, 'archived_at', { nullable: true }),
  };
}

export function inboundAutopilotConnection(row = {}) {
  return {
    id: string(row.id, 'id'),
    record_id: string(row.id, 'id'),
    workspace_id: string(row.workspace_id, 'workspace_id'),
    installation_id: string(row.installation_id, 'installation_id').toLowerCase(),
    display_name: string(row.display_name, 'display_name'),
    fips_endpoint: publicUrl(row.fips_endpoint, 'fips_endpoint', ['fips:', 'https:']),
    https_endpoint: publicUrl(row.https_endpoint, 'https_endpoint', ['https:'], { nullable: true }),
    api_version: string(row.api_version, 'api_version'),
    capabilities: stringList(row.capabilities ?? [], 'capabilities'),
    metadata: publicMetadata(row.metadata),
    ...auditFields(row),
    sync_status: 'synced',
    pg_backend: true,
  };
}

export function inboundWorkspaceAgent(row = {}) {
  return {
    id: string(row.id, 'id'),
    record_id: string(row.id, 'id'),
    workspace_id: string(row.workspace_id, 'workspace_id'),
    connection_id: string(row.connection_id, 'connection_id'),
    agent_id: string(row.agent_id, 'agent_id'),
    agent_npub: string(row.agent_npub, 'agent_npub'),
    display_name: string(row.display_name, 'display_name'),
    avatar_url: publicUrl(row.avatar_url, 'avatar_url', ['https:'], { nullable: true }),
    capabilities: stringList(row.capabilities ?? [], 'capabilities'),
    sort_order: integer(row.sort_order, 'sort_order'),
    is_visible: boolean(row.is_visible, 'is_visible'),
    metadata: publicMetadata(row.metadata),
    ...auditFields(row),
    sync_status: 'synced',
    pg_backend: true,
  };
}

export function outboundAutopilotConnection(row = {}) {
  return {
    installation_id: string(row.installation_id, 'installation_id').toLowerCase(),
    display_name: string(row.display_name, 'display_name'),
    fips_endpoint: publicUrl(row.fips_endpoint, 'fips_endpoint', ['fips:', 'https:']),
    https_endpoint: publicUrl(row.https_endpoint, 'https_endpoint', ['https:'], { nullable: true }),
    api_version: string(row.api_version ?? '1', 'api_version'),
    capabilities: stringList(row.capabilities ?? [], 'capabilities'),
    metadata: publicMetadata(row.metadata),
  };
}

export function outboundWorkspaceAgent(row = {}) {
  return {
    connection_id: string(row.connection_id, 'connection_id'),
    agent_id: string(row.agent_id, 'agent_id'),
    agent_npub: string(row.agent_npub, 'agent_npub'),
    display_name: string(row.display_name, 'display_name'),
    avatar_url: publicUrl(row.avatar_url, 'avatar_url', ['https:'], { nullable: true }),
    capabilities: stringList(row.capabilities ?? [], 'capabilities'),
    sort_order: integer(row.sort_order ?? 0, 'sort_order'),
    is_visible: boolean(row.is_visible ?? true, 'is_visible'),
    metadata: publicMetadata(row.metadata),
  };
}

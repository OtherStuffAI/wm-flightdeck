export const AGENT_CHAT_ACTIVATION = 'mention_then_continue';

function metadataObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function readAgentChatConfig(metadata = {}) {
  const source = metadataObject(metadata);
  const canonical = metadataObject(source.agent_chat);
  const compatibilityPrompt = source.basePrompt ?? source.contextPrompt ?? '';
  return {
    // Agent Direct Chat is a universal channel policy. Legacy persisted false
    // values are retained only as input compatibility and no longer opt out.
    enabled: true,
    context_prompt: String(canonical.context_prompt ?? compatibilityPrompt ?? ''),
    activation: AGENT_CHAT_ACTIVATION,
  };
}

export function writeAgentChatConfig(metadata = {}, config = {}) {
  const next = { ...metadataObject(metadata) };
  delete next.basePrompt;
  delete next.contextPrompt;
  next.agent_chat = {
    ...metadataObject(next.agent_chat),
    enabled: true,
    context_prompt: String(config.context_prompt ?? ''),
    activation: AGENT_CHAT_ACTIVATION,
  };
  return next;
}

export function canonicalAgentMentionsFromSelection(body = '', selectedMentions = []) {
  const text = String(body || '');
  const mentions = [];
  const seen = new Set();
  for (const selected of Array.isArray(selectedMentions) ? selectedMentions : []) {
    const type = selected?.type === 'agent' ? 'agent' : selected?.type === 'person' ? 'person' : '';
    if (!type) continue;
    const npub = String(selected.npub || '').trim();
    const label = String(selected.label || '').trim() || npub;
    if (!npub || seen.has(npub)) continue;
    const token = `@[${label}](mention:${type}:${npub})`;
    if (!text.includes(token)) continue;
    seen.add(npub);
    mentions.push({ type, npub, label });
  }
  return mentions;
}

export function filterMentionsToCurrentWorkspaceActors(mentions = [], workspaceMembers = [], fallbackNpubs = []) {
  const roster = Array.isArray(workspaceMembers) ? workspaceMembers : [];
  if (roster.length === 0) return Array.isArray(mentions) ? mentions : [];
  const allowedNpubs = new Set([
    ...roster.map((member) => (
      String(member?.npub || member?.actor?.npub || '').trim()
    )),
    ...(Array.isArray(fallbackNpubs) ? fallbackNpubs : []).map((npub) => String(npub || '').trim()),
  ].filter(Boolean));
  return (Array.isArray(mentions) ? mentions : []).filter((mention) => (
    allowedNpubs.has(String(mention?.npub || '').trim())
  ));
}

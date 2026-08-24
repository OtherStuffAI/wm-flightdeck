import { normalizeHarnessUrl } from './translators/settings.js';

export function normalizeAutopilotAgentEntry(entry = {}) {
  return {
    agent_npub: String(entry?.agent_npub || entry?.npub || '').trim(),
    url: String(entry?.url || entry?.launch_url || '').trim(),
  };
}

export function normalizeOrderedAutopilotAgents(entries, legacy = {}) {
  const source = Array.isArray(entries) && entries.length > 0
    ? entries
    : ((legacy?.agent_npub || legacy?.url) ? [legacy] : []);
  const seen = new Set();
  const normalized = [];

  for (const entry of source) {
    const next = normalizeAutopilotAgentEntry(entry);
    const key = next.agent_npub || next.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

export function normalizedAutopilotLaunchUrl(value) {
  const normalized = normalizeHarnessUrl(value);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (parsed.username || parsed.password) return '';
    return normalized;
  } catch {
    return '';
  }
}

export function projectPrimaryAutopilotAgent(entries = []) {
  const [primary] = normalizeOrderedAutopilotAgents(entries);
  return {
    wingman_harness_agent_npub: primary?.agent_npub || '',
    wingman_harness_url: primary?.url || '',
  };
}

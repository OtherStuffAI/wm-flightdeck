import { canonicalActorMentions } from './mention-composer.js';

export function canonicalDocumentAgentMentions(value = '') {
  const seen = new Set();
  return canonicalActorMentions(value).flatMap((mention) => {
    const npub = String(mention?.npub || '').trim();
    if (!npub || seen.has(npub)) return [];
    seen.add(npub);
    return [{ type: 'agent', npub, label: String(mention?.label || npub).trim() }];
  });
}

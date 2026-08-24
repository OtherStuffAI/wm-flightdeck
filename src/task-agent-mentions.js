import { canonicalActorMentions } from './mention-composer.js';

export function canonicalTaskAgentMentions(value = '') {
  const seen = new Set();
  return canonicalActorMentions(value).flatMap((mention) => {
    const npub = String(mention?.npub || '').trim();
    if (!npub || seen.has(npub)) return [];
    seen.add(npub);
    return [{
      type: 'agent',
      npub,
      label: String(mention?.label || npub).trim(),
    }];
  });
}

export function sameNpubSet(left = [], right = []) {
  const normalize = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

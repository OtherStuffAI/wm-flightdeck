import { serializeMentionComposerState } from './mention-composer.js';

const editors = new WeakMap();
const states = new WeakMap();

export function registerChatComposer(store, el, context, activate = true) {
  if (!['message', 'thread'].includes(context)) return;
  let registered = editors.get(store);
  if (!registered) editors.set(store, registered = new Map());
  if (activate || !registered.has(context)) registered.set(context, el);
  let state = states.get(el);
  if (!state) {
    state = { composing: false, pending: [] };
    states.set(el, state);
    el.addEventListener('compositionstart', () => { state.composing = true; });
    el.addEventListener('compositionend', () => {
      state.composing = false;
      // The final input event must land before reading the live draft.
      queueMicrotask(() => state.pending.splice(0).forEach((apply) => apply()));
    });
  }
  state.key = store.getChatComposerDraftKey(context);
}

export function rebindChatComposer(store, context) {
  const el = editors.get(store)?.get(context);
  if (!el?.isConnected) return null;
  registerChatComposer(store, el, context);
  return el;
}

export function liveChatComposer(store, context, key = store.getChatComposerDraftKey(context)) {
  const el = editors.get(store)?.get(context);
  return el?.isConnected && states.get(el)?.key === key ? el : null;
}

export function readLiveChatDraft(store, context, key) {
  const el = liveChatComposer(store, context, key);
  if (!el) return null;
  const state = states.get(el);
  // Navigation can unmount an IME editor without delivering compositionend.
  // The saved snapshot then owns pending upload results.
  if (state.pending.length) queueMicrotask(() => {
    if (key !== store.getChatComposerDraftKey(context)) state.pending.splice(0).forEach((apply) => apply());
  });
  return serializeMentionComposerState(el);
}

// Canonical offsets count mention tokens atomically and browser line breaks just
// like serialization. Keep the actual nodes: replacing a token must not rehydrate
// the editor or disturb mention pills, other uploads, or the active selection.
function positions(root) {
  const boundaries = [];
  let offset = 0;
  function visit(node) {
    if (node.nodeType === 3) {
      for (let i = 0; i <= node.length; i++) boundaries.push({ node, at: i, offset: offset + i });
      offset += node.length;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.dataset.mentionToken || node.tagName === 'BR') {
      offset += node.dataset.mentionToken?.length || 1;
      return;
    }
    boundaries.push({ node, at: 0, offset });
    [...node.childNodes].forEach((child, i) => {
      visit(child);
      boundaries.push({ node, at: i + 1, offset });
    });
    if (node !== root && node.tagName === 'DIV') offset++;
  }
  visit(root);
  return boundaries;
}

export function replaceLiveComposerToken(root, token, replacement) {
  const value = serializeMentionComposerState(root).value;
  const start = value.indexOf(token);
  if (start < 0) return false;
  const end = start + token.length;
  const before = positions(root);
  const selection = root.ownerDocument.getSelection();
  const anchor = before.find((p) => p.node === selection?.anchorNode && p.at === selection.anchorOffset);
  const focus = before.find((p) => p.node === selection?.focusNode && p.at === selection.focusOffset);
  const boundary = (list, offset) => list.find((p) => p.offset === offset && p.node.nodeType === 3)
    || list.find((p) => p.offset === offset) || list.at(-1);
  const a = boundary(before, start), b = boundary(before, end);
  const range = root.ownerDocument.createRange();
  range.setStart(a.node, a.at);
  range.setEnd(b.node, b.at);
  range.deleteContents();
  range.insertNode(root.ownerDocument.createTextNode(replacement));
  if (anchor && focus) {
    const remap = (offset) => offset <= start ? offset : offset < end ? start + replacement.length : offset + replacement.length - token.length;
    const after = positions(root);
    const a = boundary(after, remap(anchor.offset)), b = boundary(after, remap(focus.offset));
    selection.setBaseAndExtent(a.node, a.at, b.node, b.at);
  }
  return true;
}

export function resolveChatUploadToken(store, draft, context, replacement) {
  const token = String(draft?.inline_upload_token || '');
  const key = draft?.composer_draft_key;
  if (!token || !key) return false;
  const apply = () => resolveChatUploadToken(store, draft, context, replacement);
  const el = liveChatComposer(store, context, key);
  if (el && key === store.getChatComposerDraftKey(context) && states.get(el).composing) {
    states.get(el).pending.push(apply);
    return true;
  }
  if (el && key === store.getChatComposerDraftKey(context)) {
    if (!replaceLiveComposerToken(el, token, replacement)) return false;
    // Cache the patched DOM before publishing the model, so Alpine's watcher
    // sees an already-current editor and cannot replace its children.
    store.syncMentionComposerModel(el);
    return true;
  }
  const active = key === store.getChatComposerDraftKey(context);
  const inputKey = context === 'thread' ? 'threadInput' : 'messageInput';
  const saved = store.chatComposerDrafts?.[key];
  const value = String((active ? store[inputKey] : saved?.value) || '');
  if (!value.includes(token)) return false;
  const next = value.replace(token, () => replacement);
  store.chatComposerDrafts = { ...(store.chatComposerDrafts || {}), [key]: { ...saved, value: next, mentions: saved?.mentions || [] } };
  if (active) store[inputKey] = next;
  return true;
}

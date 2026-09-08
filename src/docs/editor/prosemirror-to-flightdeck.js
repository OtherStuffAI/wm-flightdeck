import {
  FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT,
  PROSEMIRROR_JSON_FORMAT,
  PROSEMIRROR_JSON_VERSION,
  createFlightDeckBlockId,
} from './prosemirror-constants.js';

function escapeText(value = '') {
  return String(value || '').replace(/([\\`*_{}\[\]()#+\-.!|>&])/g, '\\$1');
}

function markText(text, marks = [], { atStart = false, atEnd = false, encodeFirst = false, encodeLast = false } = {}) {
  // Markdown emphasis cannot open/close beside literal whitespace, and block
  // parsers trim boundary spaces. Character references preserve the exact text
  // (including its marks) without relaxing the independent integrity check.
  let escaped = escapeText(text);
  // An encoded marked space ends in ';'. Encode an adjacent word character
  // too, so Markdown's delimiter flanking rules still recognize the mark.
  if (encodeFirst) escaped = escaped.replace(/^[\p{L}\p{N}]/u, (char) => `&#${char.codePointAt(0)};`);
  if (encodeLast) escaped = escaped.replace(/[\p{L}\p{N}]$/u, (char) => `&#${char.codePointAt(0)};`);
  if (marks.length || atStart) escaped = escaped.replace(/^ +/, (spaces) => '&#32;'.repeat(spaces.length));
  if (marks.length || atEnd) escaped = escaped.replace(/ +$/, (spaces) => '&#32;'.repeat(spaces.length));
  return (marks || []).reduce((out, mark) => {
    if (mark.type === 'bold') return `**${out}**`;
    if (mark.type === 'italic') return `_${out}_`;
    if (mark.type === 'strike') return `~~${out}~~`;
    if (mark.type === 'code') return `\`${String(text || '').replace(/`/g, '\\`')}\``;
    if (mark.type === 'link') return `[${out}](${mark.attrs?.href || ''})`;
    if (mark.type === 'fdMention') {
      const label = mark.attrs?.label || text;
      return `@[${label}](mention:${mark.attrs?.mentionType || 'record'}:${mark.attrs?.mentionId || ''})`;
    }
    return out;
  }, escaped);
}

function inlineMarkdown(nodes = []) {
  // Escaped punctuation reparses into separate text nodes with identical
  // marks. Serialize each contiguous run once so bold/italic delimiters do
  // not collide on reopen (for example **word****\-****word**).
  const runs = [];
  for (const node of nodes || []) {
    const previous = runs[runs.length - 1];
    if (node.type === 'text' && previous?.type === 'text'
      && JSON.stringify(previous.marks || []) === JSON.stringify(node.marks || [])) {
      previous.text += node.text || '';
    } else {
      runs.push({ ...node });
    }
  }
  return runs.map((node, index) => {
    if (node.type === 'text') return markText(node.text || '', node.marks || [], {
      atStart: index === 0,
      atEnd: index === runs.length - 1,
      encodeFirst: runs[index - 1]?.marks?.length > 0 && / $/.test(runs[index - 1]?.text || ''),
      encodeLast: runs[index + 1]?.marks?.length > 0 && /^ /.test(runs[index + 1]?.text || ''),
    });
    if (node.type === 'hardBreak') return '  \n';
    if (node.type === 'fdStorageImage' || node.type === 'image') {
      const src = node.type === 'fdStorageImage' && node.attrs?.objectId
        ? `storage://${node.attrs.objectId}`
        : node.attrs?.src || (node.attrs?.objectId ? `storage://${node.attrs.objectId}` : '');
      return `![${escapeText(node.attrs?.alt || '')}](${src})`;
    }
    if (node.type === 'fdStorageFile') {
      const src = node.attrs?.src || '';
      const label = node.attrs?.label || node.attrs?.title || src || 'File';
      return `[${escapeText(label)}](${src})`;
    }
    return inlineMarkdown(node.content || []);
  }).join('');
}

function indent(value = '', spaces = 2) {
  const prefix = ' '.repeat(spaces);
  return String(value || '').split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function listMarkdown(node = {}, ordered = false, depth = 0) {
  return (node.content || []).map((item, index) => {
    const paragraph = item.content?.find((child) => child.type === 'paragraph');
    const nested = (item.content || []).filter((child) => child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList');
    const marker = node.type === 'taskList'
      ? `- [${item.attrs?.checked ? 'x' : ' '}]`
      : ordered ? `${index + (node.attrs?.start || 1)}.` : '-';
    const line = `${'  '.repeat(depth)}${marker} ${inlineMarkdown(paragraph?.content || [])}`.trimEnd();
    const nestedLines = nested.map((child) => listMarkdown(child, child.type === 'orderedList', depth + 1)).filter(Boolean);
    return [line, ...nestedLines].join('\n');
  }).join('\n');
}

function tableMarkdown(node = {}) {
  const rows = node.content || [];
  if (rows.length === 0) return '';
  const cells = rows.map((row) => (row.content || []).map((cell) => inlineMarkdown(cell.content?.[0]?.content || [])));
  const width = Math.max(...cells.map((row) => row.length), 1);
  const normalize = (row) => Array.from({ length: width }, (_, index) => row[index] || '');
  const lines = [];
  const header = normalize(cells[0] || []);
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of cells.slice(1)) lines.push(`| ${normalize(row).join(' | ')} |`);
  return lines.join('\n');
}

function blockMarkdown(node = {}) {
  if (node.type === 'heading') return `${'#'.repeat(node.attrs?.level || 1)} ${inlineMarkdown(node.content || [])}`.trimEnd();
  if (node.type === 'paragraph') return inlineMarkdown(node.content || []);
  if (node.type === 'codeBlock') {
    const language = node.attrs?.language || '';
    const text = (node.content || []).map((child) => child.text || '').join('');
    return `\`\`\`${language}\n${text}\n\`\`\``;
  }
  if (node.type === 'blockquote') {
    return blockNodesMarkdown(node.content || []).split('\n').map((line) => `> ${line}`.trimEnd()).join('\n');
  }
  if (node.type === 'horizontalRule') return '---';
  if (node.type === 'bulletList' || node.type === 'taskList') return listMarkdown(node, false);
  if (node.type === 'orderedList') return listMarkdown(node, true);
  if (node.type === 'table') return tableMarkdown(node);
  if (node.type === 'fdStorageImage' || node.type === 'image') return inlineMarkdown([node]);
  if (node.type === 'fdStorageFile') return inlineMarkdown([node]);
  if (node.type === 'fdUploadPlaceholder') return '';
  return inlineMarkdown(node.content || []);
}

function blockNodesMarkdown(nodes = []) {
  return (nodes || []).map(blockMarkdown).filter((value) => String(value || '').trim()).join('\n\n');
}

function compatibilityBlockType(node = {}) {
  if (node.type === 'heading') return 'heading';
  if (node.type === 'paragraph') return 'paragraph';
  if (node.type === 'codeBlock') return 'code';
  if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') return 'list';
  return node.type || 'markdown';
}

function blockIdForNode(node = {}) {
  return String(node.attrs?.fdBlockId || node.attrs?.id || '').trim() || createFlightDeckBlockId();
}

export function prosemirrorToFlightDeckContentModel(editorState = {}) {
  const state = editorState?.type === 'doc' ? editorState : { type: 'doc', content: [] };
  const content = blockNodesMarkdown(state.content || []);
  const contentBlocks = (state.content || []).map((node) => {
    const id = blockIdForNode(node);
    const raw = blockMarkdown(node);
    return {
      id,
      type: compatibilityBlockType(node),
      text: raw,
      attrs: {
        ...(node.attrs && typeof node.attrs === 'object' ? node.attrs : {}),
        pmNodeId: id,
      },
    };
  }).filter((block) => String(block.text || '').trim());

  return {
    content,
    content_format: FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT,
    content_blocks: contentBlocks,
    editor_state: state,
    editor_state_format: PROSEMIRROR_JSON_FORMAT,
    editor_state_version: PROSEMIRROR_JSON_VERSION,
  };
}

// Locale-independent, accent-insensitive natural title keys make indexed and
// rendered task order identical on every browser. Numeric runs sort by value.
export const TASK_INDEX_SORT_MODES = ['manual','created_asc','created_desc','modified_asc','modified_desc','alpha_asc','alpha_desc'];
export function taskTitleKey(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\d+/g, digits => { const n=digits.replace(/^0+(?=\d)/,''); return `\u0001${String(n.length).padStart(8,'0')}:${n}\u0001`; });
}
const inverse = value => Array.from(String(value), c => String.fromCodePoint(0x10ffff-c.codePointAt(0))).join('')+'\u{10ffff}';
export function taskSortTuple(row, mode='manual') {
  const title=taskTitleKey(row.title), id=String(row.record_id || '');
  const time=key=>Number.isFinite(Date.parse(row[key])) ? Date.parse(row[key]) : 0;
  if(mode==='manual') return [Number.isFinite(Number(row.board_order)) ? Number(row.board_order) : Number.MAX_VALUE,'',id];
  if(mode==='alpha_asc') return [title,'',id];
  if(mode==='alpha_desc') return [inverse(title),'',inverse(id)];
  return [(mode.startsWith('created') ? time('created_at') : time('updated_at'))*(mode.endsWith('desc')?-1:1),title,id];
}
export function compareIndexedTasks(a,b,mode='manual') {
  const left=taskSortTuple(a,mode),right=taskSortTuple(b,mode);
  for(let i=0;i<left.length;i++) {if(left[i]<right[i])return -1;if(left[i]>right[i])return 1}
  return 0;
}
export function taskSearchTokens(row) {
  const text=[row.title,row.description,row.tags].map(v=>String(v||'').toLowerCase()).join('\n');
  const tokens=new Set();
  for(let i=0;i<text.length;i++) for(let length=1;length<=3 && i+length<=text.length;length++) tokens.add(text.slice(i,i+length));
  return [...tokens];
}
export function taskIndexFields(row) {
  const states=['new','ready','in_progress','blocked','review','done','archive'];
  const active=row.record_state==='deleted'?0:1;
  const state=states.includes(row.state)?row.state:'new';
  const scope=String(row.scope_id || row.scope_l1_id || '');
  const boards=[`owner:${row.owner_npub || ''}`,`scope:${scope}`,
    ...(row.pg_channel_id?[`channel:${row.pg_channel_id}`]:[]),...(row.pg_thread_id?[`thread:${row.pg_thread_id}`]:[])];
  return {cache_active:active,cache_state:state,cache_scope:scope,
    cache_board_keys:boards.flatMap(board=>TASK_INDEX_SORT_MODES.map(mode=>[board,active,state,mode,...taskSortTuple(row,mode)])),
    cache_search_tokens:taskSearchTokens(row),
    cache_tags:String(row.tags||'').split(',').map(t=>t.trim().toLowerCase()).filter(Boolean),
    cache_assignees:[...new Set([...(row.assigned_to_npubs||[]),row.assigned_to_npub].filter(Boolean))]};
}

// Isolated fake-indexeddb measurements, never connects to a Tower/runtime.
import 'fake-indexeddb/auto';
import { performance } from 'node:perf_hooks';
import { instrumentIndexedDb } from '../tests/helpers/indexeddb-metrics.js';
globalThis.__FLIGHT_DECK_PG_APP_NPUB__ = 'npub1benchmark';
const { openWorkspaceDb, replacePgMessagesForChannel, replacePgTasksForChannel, getMessagePresentationWindowByChannel, getCommentsByTarget, getTaskBoardWindow } = await import('../src/db.js');
const {applyPgRecordChanges,PG_RECORD_DELTA_FAMILIES}=await import('../src/pg-record-delta.js');
const metrics=instrumentIndexedDb();
const results=[];
for (const size of [1000,10000,100000]) {
  const db=openWorkspaceDb(`isolated-performance-${size}`);
  await db.open();
  await Promise.all(db.tables.map(t=>t.clear()));
  for(let offset=0;offset<size;offset+=1000) {
    const rows=Array.from({length:Math.min(1000,size-offset)},(_,j)=>({record_id:`r${String(offset+j).padStart(6,'0')}`,channel_id:'channel',pg_channel_id:'channel',target_record_id:'task',owner_npub:'owner',updated_at:'2026-09-05T00:00:00.000Z',record_state:'active',sync_status:'synced',version:1,pg_backend:true}));
    await db.chat_messages.bulkPut(rows.map(r=>({...r})));await db.tasks.bulkPut(rows.map(r=>({...r})));await db.comments.bulkPut(rows.map(r=>({...r})));
  }
  let reads=0,writes=0;
  for(const table of [db.chat_messages,db.tasks,db.comments]) {
    table.hook('reading',row=>{if(row)reads++;return row});
    table.hook('creating',()=>{writes++});table.hook('updating',()=>{writes++});
  }
  const measure=async(name,fn)=>{
    const times=[],counts=[],physical=[];
    for(let i=0;i<15;i++) {reads=0;writes=0;metrics.reset();const start=performance.now();await fn(i);times.push(performance.now()-start);counts.push({reads,writes});physical.push(metrics.snapshot())}
    times.sort((a,b)=>a-b);results.push({size,name,medianMs:+times[7].toFixed(3),p95Ms:+times[14].toFixed(3),maxRowsRead:Math.max(...counts.map(c=>c.reads)),maxRowsWritten:Math.max(...counts.map(c=>c.writes)),idbValueRowsRead:Math.max(...physical.map(c=>c.valueRowsRead)),idbKeyRowsRead:Math.max(...physical.map(c=>c.keyRowsRead)),idbWriteRequests:Math.max(...physical.map(c=>c.writeRequests)),lastByStore:physical.at(-1).byStore});
  };
  await measure('chat-window-21',()=>getMessagePresentationWindowByChannel('channel',{rootLimit:21,replyLimit:6}));
  await measure('task-board-window-50',()=>getTaskBoardWindow({ownerNpub:'owner',limit:50}));
  await measure('baseline-channel-history-read',()=>db.chat_messages.where('channel_id').equals('channel').toArray());
  await measure('baseline-task-history-read',()=>db.tasks.toArray());
  await measure('comment-window-21',()=>getCommentsByTarget('task',{limit:21}));
  const record={record_id:'r000000',channel_id:'channel',pg_channel_id:'channel',target_record_id:'task',owner_npub:'owner',updated_at:'2026-09-05T00:00:00.000Z',record_state:'active',sync_status:'synced',pg_backend:true};
  await measure('message-one-row',i=>replacePgMessagesForChannel('channel',[{...record,version:i+2}]));
  await measure('task-one-row',i=>replacePgTasksForChannel('channel',[{...record,version:i+2}]));
  await measure('canonical-message-delta',i=>applyPgRecordChanges({workspaceId:'benchmark',workspaceOwnerNpub:'owner',currentWorkspace:{workspaceId:'benchmark'}},
    {protocol_version:1,families:PG_RECORD_DELTA_FAMILIES,mode:'delta',changes:[{family:'message',id:record.record_id,operation:'upsert',version:String(i+100),workspace_id:'benchmark',channel_id:'channel',scope_id:null,row:{id:record.record_id,workspace_id:'benchmark',channel_id:'channel',body:'delta',row_version:i+100,updated_at:record.updated_at,created_at:record.updated_at}}],next_cursor:`delta-${i}`,has_more:false}));
  await db.delete();
}
metrics.restore();
console.log(JSON.stringify({environment:'Node + fake-indexeddb; 15 repetitions; IndexedDB-delivered value/key rows and write requests (not internal B-tree visits); excludes payload/network/DOM/device costs',results},null,2));

import { openWorkspaceDb, getMessagePresentationWindowByChannel, getCommentsByTarget, getTaskBoardWindow, replacePgMessagesForChannel, replacePgTasksForChannel, replacePgCommentsForTarget } from '../src/db.js';
import { applyPgRecordChanges, PG_RECORD_DELTA_FAMILIES } from '../src/pg-record-delta.js';
import { instrumentIndexedDb } from '../tests/helpers/indexeddb-metrics.js';
const metrics=instrumentIndexedDb();
window.runIncrementalBenchmark=async()=>{
  const results=[];
  for(const size of [1000,10000,100000]) {
    const db=openWorkspaceDb(`browser-incremental-${size}`);await db.open();
    let sampleStorageBytes=0;const seedStarted=performance.now();
    for(let offset=0;offset<size;offset+=1000) {
      const rows=Array.from({length:Math.min(1000,size-offset)},(_,j)=>({record_id:`r${String(offset+j).padStart(6,'0')}`,channel_id:'channel',pg_channel_id:'channel',owner_npub:'owner',target_record_id:'target',state:'ready',title:`Task ${offset+j}`,body:'A small representative message',updated_at:'2026-09-05T00:00:00.000Z',created_at:'2026-09-05T00:00:00.000Z',version:1,sync_status:'synced',pg_backend:true}));
      await db.chat_messages.bulkPut(rows.map(r=>({...r})));await db.tasks.bulkPut(rows.map(r=>({...r})));await db.comments.bulkPut(rows.map(r=>({...r})));
      if(!sampleStorageBytes)sampleStorageBytes=new TextEncoder().encode(JSON.stringify(await db.tasks.get(rows[0].record_id))).length;
    }
    results.push({size,name:'seed-and-storage',seedMs:+(performance.now()-seedStarted).toFixed(3),sampleTaskValueBytes:sampleStorageBytes,storage:await navigator.storage?.estimate?.()});
    const measure=async(name,fn)=>{
      const times=[],counts=[];
      for(let i=0;i<15;i++){metrics.reset();const start=performance.now();await fn(i);times.push(performance.now()-start);counts.push(metrics.snapshot())}
      times.sort((a,b)=>a-b);
      results.push({size,name,medianMs:+times[7].toFixed(3),p95Ms:+times[14].toFixed(3),valueRowsRead:Math.max(...counts.map(c=>c.valueRowsRead)),keyRowsRead:Math.max(...counts.map(c=>c.keyRowsRead)),writeRequests:Math.max(...counts.map(c=>c.writeRequests)),lastByStore:counts.at(-1).byStore,sampleTaskValueBytes:sampleStorageBytes});
    };
    await measure('baseline-channel-history-read',()=>db.chat_messages.where('channel_id').equals('channel').toArray());
    await measure('baseline-task-history-read',()=>db.tasks.toArray());
    await measure('chat-window-21',()=>getMessagePresentationWindowByChannel('channel',{rootLimit:21,replyLimit:6}));
    await measure('comment-window-21',()=>getCommentsByTarget('target',{limit:21}));
    await measure('task-board-window-50',()=>getTaskBoardWindow({ownerNpub:'owner',limit:50}));
    await measure('message-one-row',i=>replacePgMessagesForChannel('channel',[{record_id:'r000000',channel_id:'channel',version:i+2,body:'edited',updated_at:'2026-09-05T00:00:00.000Z',sync_status:'synced'}]));
    await measure('task-one-row',i=>replacePgTasksForChannel('channel',[{record_id:'r000000',pg_channel_id:'channel',owner_npub:'owner',state:'ready',title:'Task 0',version:i+2,updated_at:'2026-09-05T00:00:00.000Z',sync_status:'synced'}]));
    await measure('comment-one-row',i=>replacePgCommentsForTarget('target',[{record_id:'r000000',target_record_id:'target',version:i+2,body:'edited',updated_at:'2026-09-05T00:00:00.000Z',sync_status:'synced'}]));
    const change={family:'message',id:'r000000',operation:'upsert',workspace_id:'benchmark',channel_id:'channel',scope_id:null,row:{id:'r000000',workspace_id:'benchmark',channel_id:'channel',body:'Canonical edit',row_version:100,updated_at:'2026-09-05T00:00:00+00:00',created_at:'2026-09-05T00:00:00+00:00'}};
    await measure('canonical-message-delta',i=>applyPgRecordChanges({workspaceId:'benchmark',workspaceOwnerNpub:'owner',currentWorkspace:{workspaceId:'benchmark'}},{protocol_version:1,families:PG_RECORD_DELTA_FAMILIES,mode:'delta',actors:[],changes:[{...change,version:String(i+100),row:{...change.row,row_version:i+100}}],next_cursor:`c${i}`,has_more:false}));
    const rows=await getMessagePresentationWindowByChannel('channel',{rootLimit:21,replyLimit:6});
    await measure('query-and-simple-dom-21',async()=>{
      const page=await getMessagePresentationWindowByChannel('channel',{rootLimit:21,replyLimit:6});
      const target=document.getElementById('feed');target.replaceChildren(...page.slice(-21).map(row=>{const div=document.createElement('div');div.textContent=row.body || row.record_id;return div}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    });
    results.push({size,name:'canonical-payload',bytes:new TextEncoder().encode(JSON.stringify(change)).length,renderedRows:Math.min(21,rows.length)});
    console.log(`BENCHMARK_SIZE_COMPLETE ${size}`);await db.delete();
  }
  metrics.restore();return results;
};

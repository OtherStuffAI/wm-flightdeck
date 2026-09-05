// Exercise production module-worker chunks with in-memory HTTP routing only.
// Does not start a server or connect to Tower/the configured runtime.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const html=await readFile(path.join(root,'index.html'),'utf8');
const entry=html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
if(!entry)throw new Error('Missing built entry');
const source=await readFile(path.join(root,entry),'utf8');
const worker=source.match(/tower-pg-materialization-worker-[\w-]+\.js/)?.[0];
if(!worker)throw new Error('Missing built materialization worker');
const fixture=JSON.parse(await readFile('tests/fixtures/flightdeck-record-delta-v1.json','utf8'));
const browser=await chromium.launch({headless:true,channel:process.env.FLIGHTDECK_BENCH_BROWSER_CHANNEL || 'chrome'});
try {
  const context=await browser.newContext();
  await context.route('**/*',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated worker verification</title>'});
    const file=path.resolve(root,`.${pathname}`);
    if(!file.startsWith(root+path.sep))return route.fulfill({status:404,body:''});
    try {await route.fulfill({contentType:'text/javascript',body:await readFile(file)})}
    catch {await route.fulfill({status:404,body:''})}
  });
  const page=await context.newPage();await page.goto('http://flightdeck-worker.test/');
  const result=await page.evaluate(async({worker,fixture})=>{
    const instance=new Worker(`/assets/${worker}`,{type:'module'});
    const workspaceId=fixture.one_message_delta.changes[0].workspace_id;
    const request=bundle=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Built worker timeout')),10000);
      instance.onerror=error=>{clearTimeout(timer);reject(new Error(error.message))};
      instance.onmessage=event=>{clearTimeout(timer);resolve(event.data)};
      instance.postMessage({type:'tower-pg-materializer:request',id:'verify',workspaceKey:'isolated',workspaceDbKey:'isolated',
        store:{workspaceId,workspaceOwnerNpub:'npub1owner',currentWorkspace:{workspaceId},session:{npub:'npub1viewer'}},bundle});
    });
    const applied=await request(fixture.canonical_upserts);
    if(!applied.ok)throw new Error(applied.error.message);
    const rejected=await request({...fixture.one_message_delta,next_cursor:'unexpected-next',local_apply_options:{expectedCursor:'wrong'}});
    if(rejected.ok || !rejected.error.message.includes('cursor changed'))throw new Error('Missing production cursor guard: '+JSON.stringify(rejected));
    const legacy={mode:'delta',next_cursor:'legacy-next',has_more:false,
      local_record_fallback:{expectedCursor:fixture.canonical_upserts.next_cursor,expectedGeneration:0}};
    const fallback=await request(legacy);
    if(!fallback.ok)throw new Error('Production legacy fallback failed: '+JSON.stringify(fallback));
    const staleFallback=await request({...legacy,local_record_fallback:{...legacy.local_record_fallback,expectedGeneration:1}});
    if(staleFallback.ok || !staleFallback.error.message.includes('authority changed'))throw new Error('Missing production fallback guard: '+JSON.stringify(staleFallback));
    instance.terminate();return {worker,applied:applied.value,cursorGuard:rejected.error.message,
      legacyFallback:fallback.value,fallbackGuard:staleFallback.error.message};
  },{worker,fixture});
  console.log(JSON.stringify({browser:browser.version(),result}));
} finally {await browser.close()}

// Offline synthetic proof using the production Alpine mixin, templates and CSS.
// Run with FLIGHTDECK_BROWSER_EXECUTABLE when Chromium is not installed by Playwright.
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const { build } = require('esbuild');
const root = process.cwd();
const phase = process.argv[2] || 'after';
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after');
const baseline = process.env.FLIGHTDECK_ACTIVITY_BASELINE || '7dfd7b5d1903c2999ba2fe7b4601455c9af0de25';
const output = process.env.FLIGHTDECK_ACTIVITY_SCREENSHOTS || '/tmp';
mkdirSync(output, { recursive: true });
const html = phase === 'before' ? execFileSync('git',['show',baseline + ':index.html'],{encoding:'utf8'}) : readFileSync('index.html','utf8');
function template(marker) {
 const start = html.indexOf('<template x-for="activity in $store.chat.' + marker);
 let end = start, depth = 0;
 const tags = /<template\b[^>]*>|<\/template>/g; tags.lastIndex = start;
 for (let m; (m = tags.exec(html));) { depth += m[0].startsWith('</') ? -1 : 1; if (!depth) { end = tags.lastIndex; break; } }
 return html.slice(start,end);
}
const entry = `import Alpine from 'alpinejs'; import { chatMessageManagerMixin } from './src/chat-message-manager.js';
const rows = [0,1,2].map((n) => ({record_id:'row-'+n, activity_id:'run-'+n, turn_id:'turn-'+n, workspace_id:'workspace',backend_url:'http://localhost',channel_id:'channel',thread_id:'thread',trigger_message_id:'message',agent_npub:'agent',visibility:'user_visible',state:'working',sequence:1,label:'Agent started',created_at:'2026-09-08T0'+n+':00:00Z',expires_at:n<2?'2020-01-01T00:00:00Z':'2999-01-01T00:00:00Z',summary:n<2?'Older run commentary '+(n+1):'',body:'Retained update '+(n+1),commentary_history:[]}));
const store=Object.create(chatMessageManagerMixin); Object.assign(store,{agentActivities:rows,currentWorkspace:{workspaceId:'workspace'},backendUrl:'http://localhost',activeChannelId:'channel',activeThreadId:'thread',sseStatus:'connected',expandedAgentActivityIds:{},getThreadParentMessage:()=>null,getSenderName:()=> 'Agent',getSenderAvatar:()=>null,getInitials:()=> 'A',requestTowerSyncFamily:async()=>Object.assign([],{next_cursor:null})});
Alpine.store('chat',store); window.Alpine=Alpine; Alpine.start();`;
const result = await build({stdin:{contents:entry,resolveDir:root,sourcefile:'visual-entry.js'},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}','__FLIGHT_DECK_PG_APP_NPUB__':'"npub1synthetic"'},plugins:phase==='before'?[{name:'baseline',setup(b){b.onLoad({filter:/src\/(agent-activity|chat-message-manager)\.js$/},args=>({contents:execFileSync('git',['show',baseline+':'+args.path.slice(root.length+1)],{encoding:'utf8'}),loader:'js'}));}}]:[]});
const browser=await chromium.launch({headless:true,executablePath:process.env.FLIGHTDECK_BROWSER_EXECUTABLE || undefined});
for(const surface of ['chat','inbox','channel']) for(const width of [1120,390]) {
 const page=await browser.newPage({viewport:{width,height:820}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.abort());
 await page.setContent(`<html><head><style>${readFileSync('src/styles.css','utf8')} body{margin:0;padding:16px;background:#eef1f5} main{max-width:1080px;margin:auto;background:white;border:1px solid #ccd2db;border-radius:8px;overflow:hidden} header,article,footer{padding:20px;border-bottom:1px solid #ddd} .proof-activities{padding:0} [x-cloak]{display:none!important}</style></head><body><main x-data="{msg:{record_id:'message'}}"><header>${surface === 'inbox'?'Inbox':'Chat'} · Thread</header><article><b>Agent</b><p>Updated the app. Validation passed and the task is ready for review.</p></article><article><b>User</b><p>Please show the stages as a chain, with an arrow from one to the next.</p></article><div class="proof-activities">${template(surface==='channel'?'getAgentActivitiesForMessage(msg)':'activeThreadAgentActivities')}</div><footer>Reply to thread…</footer></main></body></html>`);
 await page.addScriptTag({content:result.outputFiles[0].text});
 await page.waitForTimeout(300);
 if(errors.length) throw new Error(errors.join('\n'));
 if(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow');
 await page.screenshot({path:`${output}/activity-${phase}-${surface}-${width}.png`,fullPage:true});
 if(phase==='after') {
  if(await page.locator('.agent-activity-toggle:visible').count()!==1) throw new Error('Expected one current panel');
  if(await page.getByText('Connection lost—status unknown',{exact:false}).count()) throw new Error('Unexpected connection warning');
  await page.locator('.agent-activity-earlier > summary').click();
  await page.getByText('Earlier activity · status unconfirmed').first().click();
  if(!await page.getByText('Retained update 2',{exact:true}).isVisible()) throw new Error('History not accessible');
  await page.screenshot({path:`${output}/activity-${phase}-${surface}-${width}-expanded.png`,fullPage:true});
 }
 if (phase === 'after') {
  await page.evaluate(() => {
   const store = Alpine.store('chat');
   store.agentActivities[0] = {...store.agentActivities[0], sequence:999, updated_at:'2999-01-01'};
   store.agentActivities[2].expires_at = '2000-01-01';
  });
  await page.getByText('Agent · No recent update', {exact:true}).waitFor();
  await page.evaluate(() => { const s=Alpine.store('chat'); s.sseStatus='reconnecting'; s.agentActivityRecoveryStartedAt=Date.now()-59000; });
  await page.getByText('Agent · Reconnecting', {exact:true}).waitFor();
  await page.evaluate(() => { Alpine.store('chat').agentActivityRecoveryStartedAt-=2000; });
  await page.getByText('Agent · Connection lost—status unknown', {exact:true}).waitFor();
  if(await page.locator('.agent-activity-error').count()!==1) throw new Error('Stacked warnings');
  await page.evaluate(() => {
   const s=Alpine.store('chat'); s.agentActivities[2].state='completed';
   s.agentActivities.push({...s.agentActivities[2],record_id:'other-agent',activity_id:'other-agent',agent_npub:'other-agent',state:'working'});
  });
  await page.getByText('Agent completed', {exact:true}).waitFor();
  if(await page.locator('.agent-activity-toggle:visible').count()!==2) throw new Error('Distinct agent missing');
  if(errors.length) throw new Error(errors.join('\n'));
 }
 await page.close();
}
await browser.close();
console.log('Visual proof passed: '+phase);

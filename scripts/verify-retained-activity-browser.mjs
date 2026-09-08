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
const output = process.env.FLIGHTDECK_ACTIVITY_SCREENSHOTS || '/tmp/activity-menu';
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
const rows = [0,1,2].map((n) => ({record_id:'row-'+n, activity_id:'run-'+n, turn_id:'turn-'+n, workspace_id:'workspace',backend_url:'http://localhost',channel_id:'channel',thread_id:'thread',trigger_message_id:'message',agent_npub:'agent',visibility:'user_visible',state:'working',sequence:1,label:'Agent started',created_at:'2026-09-08T0'+n+':00:00Z',expires_at:n<2?'2020-01-01T00:00:00Z':'2999-01-01T00:00:00Z',summary:n<2?'Older run commentary '+(n+1):'Updating the stage layout',body:n<2?'Retained update '+(n+1):'Updating the stage layout',commentary_history:[]}));
const store=Object.create(chatMessageManagerMixin); Object.assign(store,{agentActivityDetailsContext:null,channelHangCallSending:false,threadHangCallSending:false,workroomsEnabled:false,deckThreadComposerOpen:false,agentActivities:rows,currentWorkspace:{workspaceId:'workspace'},backendUrl:'http://localhost',activeChannelId:'channel',activeThreadId:'thread',sseStatus:'connected',expandedAgentActivityIds:{},getThreadParentMessage:()=>null,getSenderName:()=> 'Agent',getSenderAvatar:()=>null,getInitials:()=> 'A',requestTowerSyncFamily:async()=>Object.assign([],{next_cursor:null})});
Object.defineProperties(store,{canComposeInChatDestination:{value:false},canComposeInThreadDestination:{value:false}});
Alpine.store('chat',store); window.Alpine=Alpine; Alpine.start();`;
const result = await build({stdin:{contents:entry,resolveDir:root,sourcefile:'visual-entry.js'},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}','__FLIGHT_DECK_PG_APP_NPUB__':'"npub1synthetic"'},plugins:phase==='before'?[{name:'baseline',setup(b){b.onLoad({filter:/src\/(agent-activity|chat-message-manager)\.js$/},args=>({contents:execFileSync('git',['show',baseline+':'+args.path.slice(root.length+1)],{encoding:'utf8'}),loader:'js'}));}}]:[]});
function elementAt(start, tag) {
 const tags = new RegExp('<' + tag + '\\b[^>]*>|</' + tag + '>', 'g'); tags.lastIndex = start;
 let depth = 0;
 for (let m; (m = tags.exec(html));) { depth += m[0].startsWith('</') ? -1 : 1; if (!depth) return html.slice(start,tags.lastIndex); }
 throw new Error('Missing production element');
}
function menu(surface) {
 const start=html.indexOf('<div class="chat-composer-menu"',html.indexOf(surface === 'channel' ? 'class="chat-input-actions"' : 'class="thread-input-actions"'));
 return elementAt(start, 'div');
}
const dialog=phase === 'after' ? elementAt(html.indexOf('<dialog class="agent-activity-dialog"'), 'dialog') : '';
const browser=await chromium.launch({headless:true,executablePath:process.env.FLIGHTDECK_BROWSER_EXECUTABLE || undefined});
for(const surface of ['chat','inbox','channel']) for(const width of [1120,390]) {
 const page=await browser.newPage({viewport:{width,height:820}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.abort());
 await page.setContent(`<html><head><style>${readFileSync('src/styles.css','utf8')} body{margin:0;padding:16px;background:#eef1f5} main{max-width:1080px;margin:auto;background:white;border:1px solid #ccd2db;border-radius:8px;overflow:hidden} header,article,footer{padding:20px;border-bottom:1px solid #ddd} .proof-activities{padding:0} [x-cloak]{display:none!important}</style></head><body><main x-data="{msg:{record_id:'message'}}"><header>${surface === 'inbox'?'Inbox':'Chat'} · Thread</header><article><b>Agent</b><p>Updated the app. Validation passed and the task is ready for review.</p></article><article><b>User</b><p>Please show the stages as a chain, with an arrow from one to the next.</p></article><div class="proof-activities">${template(surface==='channel'?'getAgentActivitiesForMessage(msg)':'activeThreadAgentActivities')}</div><footer>Reply to thread…${phase === 'after' ? menu(surface) : ''}</footer></main>${dialog}</body></html>`);
 await page.addScriptTag({content:result.outputFiles[0].text});
 await page.waitForTimeout(300);
 if(errors.length) throw new Error(errors.join('\n'));
 if(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow');
 await page.screenshot({path:`${output}/activity-${phase}-${surface}-${width}.png`,fullPage:true});
 if(phase==='after') {
  const visibleText=()=>page.locator('body').innerText();
  async function clean() {
   if (/Earlier activity|Connection lost|status unconfirmed|No recent update|Reconnecting|Load earlier|completed/.test(await visibleText())) throw new Error('Timeline contains activity detail');
   if(await page.locator('.agent-activity-error:visible, .agent-activity-history-toggle:visible').count()) throw new Error('Inline diagnostic/history control');
  }
  await clean();
  if(await page.locator('.agent-activity-current:visible').count()!==1) throw new Error('Expected current commentary only');
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Working history & diagnostics'}).waitFor();
  await page.screenshot({path:`${output}/activity-${phase}-${surface}-${width}-menu.png`,fullPage:true});
  await page.getByRole('menuitem',{name:'Working history & diagnostics'}).click();
  await page.getByRole('dialog').waitFor();
  await page.locator('.agent-activity-retained > summary').nth(1).click();
  if(!await page.getByText('Retained update 2',{exact:true}).isVisible()) throw new Error('History not accessible');
  await page.screenshot({path:`${output}/activity-${phase}-${surface}-${width}-history.png`,fullPage:true});
  await page.getByRole('button',{name:'Close working history'}).click();
  await page.evaluate(() => {
   const s = Alpine.store('chat');
   s.agentActivities[0] = {...s.agentActivities[0], sequence:999, updated_at:'2999-01-01'};
   s.sseStatus='reconnecting'; s.agentActivityRecoveryStartedAt=Date.now()-61000;
  });
  await clean();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Working history & diagnostics'}).click();
  await page.locator('.agent-activity-retained > summary').first().click();
  await page.getByText('Connection lost—status unknown',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Close working history'}).click();
  await page.evaluate(() => { const s=Alpine.store('chat'); s.agentActivities[2].state='completed'; });
  await page.locator('.agent-activity-current:visible').waitFor({state:'hidden'});
  await clean();
  if(await page.locator('.agent-activity-current:visible').count()) throw new Error('Finished strip visible');
  await page.screenshot({path:`${output}/activity-${phase}-${surface}-${width}-finished.png`,fullPage:true});
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Working history & diagnostics'}).click();
  if(await page.locator('.agent-activity-retained:visible').count()!==3) throw new Error('Finished history unavailable');
  await page.getByRole('button',{name:'Load earlier agent runs'}).click();
  await page.getByRole('button',{name:'Close working history'}).click();
  await page.evaluate(() => { const s=Alpine.store('chat'); s.agentActivities.push({...s.agentActivities[2],record_id:'other-agent',activity_id:'other-agent',agent_npub:'other-agent',state:'working'}); });
  await page.locator('.agent-activity-current:visible').waitFor();
  if(await page.locator('.agent-activity-current:visible').count()!==1) throw new Error('Distinct agent missing');
  if(errors.length) throw new Error(errors.join('\n'));
 }
 await page.close();
}
await browser.close();
console.log('Visual proof passed: '+phase);

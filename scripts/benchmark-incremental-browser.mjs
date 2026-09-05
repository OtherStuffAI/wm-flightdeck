// An isolated browser harness. All HTTP URLs are fulfilled in-memory; it never
// contacts Tower, starts a server, changes the development runtime or uses keys.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const temporary=await mkdtemp(path.join(tmpdir(),'flightdeck-browser-benchmark-'));
const bundle=path.join(temporary,'benchmark.js');
execFileSync('bun',['build','scripts/browser-incremental-benchmark-entry.js','--target=browser',`--outfile=${bundle}`,'--define','__FLIGHT_DECK_PG_APP_NPUB__="npub1benchmark"'],{stdio:'pipe'});
const source=await readFile(bundle,'utf8');
const browser=await chromium.launch({headless:true,channel:process.env.FLIGHTDECK_BENCH_BROWSER_CHANNEL || 'chrome'});
const runs=[];
try {
  for(const target of [{name:'desktop',viewport:{width:1440,height:900},cpuRate:1},{name:'mobile-emulation',viewport:{width:390,height:844},cpuRate:4}]) {
    const context=await browser.newContext({viewport:target.viewport,isMobile:target.cpuRate>1,hasTouch:target.cpuRate>1});
    await context.route('**/*',route=>route.fulfill({contentType:route.request().url().endsWith('benchmark.js')?'text/javascript':'text/html',body:route.request().url().endsWith('benchmark.js')?source:'<!doctype html><main id="feed"></main><script type="module" src="/benchmark.js"></script>'}));
    const page=await context.newPage();page.on('pageerror',error=>process.stderr.write(`${error.stack}\n`));page.on('console',message=>process.stderr.write(`${target.name}: ${message.text()}\n`));
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:target.cpuRate});
    await page.goto('http://flightdeck-benchmark.test/');await page.waitForFunction(()=>typeof window.runIncrementalBenchmark==='function');
    runs.push({target,results:await page.evaluate(()=>window.runIncrementalBenchmark())});await context.close();
  }
  const report={browser:browser.version(),environment:'Headless Chromium on this host; mobile is 4x CPU emulation, not a physical device. In-memory HTTP routing; no backend/network. Simple DOM harness is not the authenticated application.',runs};
  const output=process.argv[2] || '/tmp/flightdeck-browser-benchmark.json';await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
} finally {await browser.close();await rm(temporary,{recursive:true,force:true})}

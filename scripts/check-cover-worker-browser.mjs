import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
import {chromium} from 'playwright';
import {startFixture} from './windows-fixture.mjs';

const root='artifacts/benchmark/cover-worker-dist',entry='artifacts/benchmark/cover-worker.html';
let browser,fixture;const report={at:new Date().toISOString(),failures:[]};
try {
  await fs.mkdir(path.dirname(entry),{recursive:true});
  await fs.writeFile(entry,'<!doctype html><script type="module" src="/scripts/cover-worker-check.mjs"></script>');
  await build({configFile:false,publicDir:false,logLevel:'error',build:{outDir:root,emptyOutDir:false,rollupOptions:{input:path.resolve(entry)}}});
  fixture=await startFixture(root,0);
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,timeout:10000});
  const page=await browser.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.failures.push(e.message));
  await page.goto(fixture.url+'artifacts/benchmark/cover-worker.html');
  await page.waitForFunction(()=>typeof window.runCoverWorkerCheck==='function');
  report.result=await page.evaluate(()=>window.runCoverWorkerCheck());assert.deepEqual(report.failures,[]);assert.equal(report.result.passed,true);
  console.log(JSON.stringify(report.result));
} catch(error){report.failures.push(String(error));process.exitCode=1;console.error(error);}
finally{await browser?.close().catch(()=>{});await fixture?.close().catch(()=>{});await fs.writeFile('artifacts/benchmark/cover-worker-results.json',JSON.stringify(report,null,2)+'\n');}

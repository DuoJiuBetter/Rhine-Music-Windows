// Actual Tauri window/IPC and production chrome, with a blank synthetic page.
// No music app, accounts, audio or WebGL. Requires other player instances closed.
import fs from 'node:fs/promises';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';
const root=process.cwd(),directory=path.resolve('artifacts/native-window-probe',String(Date.now()));
const existing=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process -Name 'Rhine Music','rhine-music-windows' -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true}).trim();
assert.equal(existing,'0','Preserve existing players; close them before the isolated native probe.');
await fs.mkdir(path.join(directory,'runtime'),{recursive:true});
for(const name of ['config','local','data'])await fs.mkdir(path.join(directory,name));
await fs.copyFile('src-tauri/target/release/rhine-music-windows.exe',path.join(directory,'Rhine Music.exe'));
await fs.copyFile(process.execPath,path.join(directory,'runtime/node.exe'));
await fs.mkdir(path.join(directory,'runtime/assets'));
const assets=await fs.readdir('dist/assets'),desktop=assets.find(f=>/^desktop-.*\.js$/.test(f));assert.ok(desktop);
for(const file of assets.filter(f=>/\.(js|css)$/.test(f)))await fs.copyFile(path.join('dist/assets',file),path.join(directory,'runtime/assets',file));
const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#e8e5e1;color:#20221d;font:16px sans-serif}main{padding:70px}#music-toast{margin:30px}select{font:inherit}</style></head><body><main id="stage" data-presentation="archive"><h1>窗口控制检查 · 空白页面</h1><div id="settings"></div><div id="music-toast"></div></main><script>window.probe={contexts:0};const context=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(/webgl/i.test(type)){probe.contexts++;throw Error('GPU forbidden in window probe')}return context.call(this,type,...args)};</script><script type="module">import{mountDesktop,windowDisplayMarkup,setWindowDisplayMode}from'/assets/${desktop}';mountDesktop();document.querySelector('#settings').innerHTML=windowDisplayMarkup();document.addEventListener('change',e=>{if(e.target.id==='window-display-mode')setWindowDisplayMode(e.target.value)});window.probe.ready=true;</script></body></html>`;
await fs.mkdir(path.join(directory,'runtime/scripts'));
await fs.writeFile(path.join(directory,'runtime/scripts/desktop-server.mjs'),`import http from'node:http';import fs from'node:fs/promises';import path from'node:path';const html=${JSON.stringify(html)};const server=http.createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(p==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({pid:process.pid}));return}if(p==='/stop'){res.end('stopping');setTimeout(()=>process.exit(0),20);return}if(p.startsWith('/assets/')&&/^[a-zA-Z0-9_.-]+$/.test(p.slice(8))){try{res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(process.cwd(),p.slice(1))));return}catch{res.writeHead(404);res.end();return}}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)});process.stdin.on('data',v=>{if(String(v).includes('shutdown'))process.exit(0)});process.stdin.on('end',()=>process.exit(0));server.listen(0,'127.0.0.1',()=>console.log('RHINE_READY http://127.0.0.1:'+server.address().port+'/'));`);
const serverFile=path.join(directory,'runtime/scripts/desktop-server.mjs');
execFileSync(process.execPath,['--check',serverFile],{windowsHide:true,timeout:5000});
const portServer=net.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const environment={...process.env,APPDATA:path.join(directory,'config'),LOCALAPPDATA:path.join(directory,'local'),RHINE_DESKTOP_DATA_DIR:path.join(directory,'data'),WEBVIEW2_USER_DATA_FOLDER:path.join(directory,'webview-profile'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--disable-gpu --mute-audio --remote-debugging-port=${port}`};
const child=spawn(path.join(directory,'Rhine Music.exe'),[],{cwd:directory,env:environment,windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket,target,next=0;const pending=new Map();const report={pid:child.pid,webgl:false,checks:[],geometry:[]};
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},8000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function waitFor(expression){for(let i=0;i<50;i++){if(await evaluate(expression))return;await sleep(100)}throw Error('Native condition timed out: '+expression);}
const state=()=>evaluate(`window.__TAURI__.core.invoke('desktop_window_state')`);
const action=value=>evaluate(`window.__TAURI__.core.invoke('desktop_window_action',{action:${JSON.stringify(value)}})`);
const geometry=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/read-player-window-area.ps1'),'-PlayerProcessId',String(child.pid)],{encoding:'utf8',windowsHide:true,timeout:8000}));
try{
  for(let i=0;i<60;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');}catch{}if(target)break;if(child.exitCode!==null)throw Error('Native process exited '+child.exitCode);await sleep(250)}assert.ok(target,'Blank native page appears');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
  socket.addEventListener('message',event=>{const data=JSON.parse(event.data),entry=pending.get(data.id);if(entry){pending.delete(data.id);clearTimeout(entry.timer);data.error?entry.reject(data.error):entry.resolve(data.result);}});
  await waitFor('window.probe?.ready&&!!window.__TAURI__');await action('restore');await sleep(200);
  await evaluate(`document.querySelector('[data-window="maximize"]').click()`);await waitFor(`document.documentElement.classList.contains('desktop-maximized')`);
  const maximum=geometry();assert.equal(maximum.maximized,true);assert.ok(Math.abs(maximum.client.Bottom-(maximum.workArea.Bottom-maximum.workArea.Top))<=2);report.geometry.push({mode:'maximized',...maximum});
  // F11's native toggle exercises the formerly failing maximized -> fullscreen path.
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F11',bubbles:true}))`);await waitFor(`document.documentElement.classList.contains('desktop-fullscreen')`);await sleep(200);
  const full=geometry();assert.equal(full.maximized,false);assert.equal(full.client.Bottom,full.monitor.Bottom-full.monitor.Top);assert.equal(full.client.Right,full.monitor.Right-full.monitor.Left);report.geometry.push({mode:'fullscreen-from-maximized',...full});
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.desktop-chrome')).visibility`),'visible');
  await evaluate(`document.querySelector('[data-window="maximize"]').click()`);await waitFor(`!document.documentElement.classList.contains('desktop-fullscreen')&&!document.documentElement.classList.contains('desktop-maximized')`);
  await evaluate(`const select=document.querySelector('#window-display-mode');select.value='fullscreen';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-window="maximize"]').click()`);await waitFor(`document.documentElement.classList.contains('desktop-fullscreen')`);
  await evaluate(`document.querySelector('[data-window="maximize"]').click()`);await waitFor(`!document.documentElement.classList.contains('desktop-fullscreen')`);
  await action('minimize');await sleep(200);await action('restore');await sleep(200);assert.equal((await state()).fullscreen,false);
  report.checks.push('native window remains responsive through focus/resize/maximize/fullscreen/restore/minimize','actual fullscreen client covers monitor, maximum uses work area','production mode preference and three window controls work');
  const secondary=spawn(path.join(directory,'Rhine Music.exe'),[],{cwd:directory,env:environment,windowsHide:true,stdio:'ignore'});
  const exit=await Promise.race([new Promise(r=>secondary.once('exit',code=>r(code))),sleep(4000).then(()=>{secondary.kill();throw Error('Second launch blocked')})]);assert.equal(exit,0);await state();report.checks.push('second launch hands off and exits within four seconds; first instance still responds');
  assert.equal(await evaluate('window.probe.contexts'),0);
  // The closing window cannot reliably send an IPC reply after destroying itself.
  socket.send(JSON.stringify({id:++next,method:'Runtime.evaluate',params:{expression:"void window.__TAURI__.core.invoke('desktop_window_action',{action:'close'})"}}));
  for(let i=0;i<40&&child.exitCode===null;i++)await sleep(100);
  assert.equal(child.exitCode,0,'native close exits normally');
  report.checks.push('native close exits without leaving an unresponsive window');report.passed=true;
}finally{
  socket?.close();for(const entry of pending.values())clearTimeout(entry.timer);
  for(let i=0;i<20&&child.exitCode===null;i++)await sleep(100);
  if(child.exitCode===null)child.kill();
  if(target){try{await fetch(new URL('/stop',target.url),{signal:AbortSignal.timeout(1000)});}catch{}}
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({directory,...report},null,2));

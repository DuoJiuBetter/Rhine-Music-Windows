import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';

export function isolatedProfileArgument(args,profile) {
  const base=path.resolve(profile).toLowerCase();
  return args.some(arg=>{
    if(!arg.startsWith('--user-data-dir='))return false;
    const raw=arg.slice('--user-data-dir='.length).replace(/^"|"$/g,'');
    const actual=path.resolve(raw).toLowerCase();
    // WebView2 uses EBWebView beneath its user-data folder.
    return actual===base || actual.startsWith(base+path.sep);
  });
}

/** Own native host + synthetic server + independent WebView profile.
 * Never attaches to a user's player; no native compilation, account or library. */
export async function launchNativeBenchmark(dist) {
  const check=await promisify(execFile)('powershell.exe',['-NoProfile','-Command',
    "if(Get-Process -Name 'Rhine Music','rhine-music-windows','RhineMusicTest' -ErrorAction SilentlyContinue){exit 3}"],{windowsHide:true});
  const base=path.resolve('artifacts/benchmark'),root=path.join(base,'native-rapid-'+Date.now());
  assert.equal(path.dirname(root),base);await fs.mkdir(path.join(root,'runtime/scripts'),{recursive:true});
  await fs.copyFile('src-tauri/target-public/release/rhine-music-windows.exe',path.join(root,'RhineMusicTest.exe'));
  await fs.copyFile('desktop-runtime/node.exe',path.join(root,'runtime/node.exe'));
  await fs.copyFile('scripts/windows-fixture.mjs',path.join(root,'runtime/scripts/windows-fixture.mjs'));
  await fs.cp(dist,path.join(root,'runtime/dist'),{recursive:true});
  await fs.writeFile(path.join(root,'runtime/scripts/desktop-server.mjs'),`
import fs from 'node:fs/promises';
import {startFixture} from './windows-fixture.mjs';
const fixture=await startFixture('dist',24);
await fs.writeFile(process.env.RHINE_NATIVE_READY,JSON.stringify({url:fixture.url}));
console.log('RHINE_READY '+fixture.url);
let stopping=false;async function stop(){if(stopping)return;stopping=true;await fixture.close();process.exit(0);}
process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{if(s.includes('shutdown'))void stop();});
process.stdin.once('end',()=>void stop());process.once('SIGTERM',()=>void stop());
`);
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const ready=path.join(root,'ready.json'),profile=path.join(root,'webview-profile');
  const child=spawn(path.join(root,'RhineMusicTest.exe'),[],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,RHINE_DESKTOP_DATA_DIR:path.join(root,'music-data'),RHINE_NATIVE_READY:ready,
      WEBVIEW2_USER_DATA_FOLDER:profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --enable-automation`}});
  let error;child.on('error',e=>error=e);let exited=false;child.once('exit',()=>exited=true);
  const close=async()=>{if(!exited){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2500))]);}
    await fs.writeFile(path.join(root,'closed.json'),JSON.stringify({exited,pid:child.pid}));};
  const debugUrl=`http://127.0.0.1:${port}`;
  try {
    const start=Date.now();let url;
    while(Date.now()-start<25000){
      if(error)throw error;if(exited)throw Error('Isolated native host exited before CDP connection; no retry');
      try{url=JSON.parse(await fs.readFile(ready,'utf8')).url;
        const response=await fetch(debugUrl+'/json/version',{signal:AbortSignal.timeout(500)});
        if(response.ok){assert.ok(new URL(url).hostname==='127.0.0.1');return{url,debugUrl,profile,root,close,native:true};}
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw Error('Native CDP startup timed out; no automatic retry');
  }catch(error){await close();throw error;}
}

import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {collectNativeLicenses} from './collect-native-licenses.mjs';
const root=path.resolve(import.meta.dirname,'..');
const options=new Map();
for(let i=2;i<process.argv.length;i+=2){if(!['--source','--native'].includes(process.argv[i])||!process.argv[i+1])throw Error('Usage: --source PORTABLE --native PUBLIC_EXE');options.set(process.argv[i],path.resolve(process.argv[i+1]));}
const source=options.get('--source'),native=options.get('--native');
if(!source||!native)throw Error('Both packaging inputs are required');
const version='0.2.0-public-preview',output=path.join(root,'release','Rhine-Music-Windows-0.2.0-Public-x64');
if(await fs.stat(output).catch(()=>null))throw Error('Preserve existing release directory');
for(const file of [native,path.join(source,'runtime/node.exe'),path.join(root,'dist/index.html')])await fs.access(file);
const host=await fs.readFile(native);
for(const pattern of [/Users[\\/]+fantas/i,/[CD]:[\\/]+only test/i])if(pattern.test(host.toString('latin1'))||pattern.test(host.toString('utf16le')))throw Error('Private native build path detected');
await fs.mkdir(path.join(output,'runtime'),{recursive:true});
await fs.copyFile(native,path.join(output,'Rhine Music.exe'));
await fs.copyFile(path.join(source,'runtime/node.exe'),path.join(output,'runtime/node.exe'));
for(const dir of ['scripts','native'])await fs.cp(path.join(root,dir),path.join(output,'runtime',dir),{recursive:true});
await fs.cp(path.join(root,'dist'),path.join(output,'runtime/dist'),{recursive:true});
for(const dir of ['third-party','docs'])await fs.cp(path.join(root,dir),path.join(output,dir),{recursive:true});
const licenses=await collectNativeLicenses(path.join(output,'third-party/native'),root);
for(const file of ['README.md','README.windows.md','README.original.md','README.upstream.md','LICENSE','NOTICE.md','PRIVACY.md','PLATFORM-NOTICE.md']){
 await fs.copyFile(path.join(root,file),path.join(output,file));await fs.copyFile(path.join(root,file),path.join(output,'runtime',file));
}
await fs.cp(path.join(output,'third-party'),path.join(output,'runtime/third-party'),{recursive:true});
for(const file of ['package.json','package-lock.json'])await fs.copyFile(path.join(root,file),path.join(output,'runtime',file));
execFileSync(process.env.ComSpec||'cmd.exe',['/d','/c','npm ci --omit=dev --ignore-scripts --offline --no-audit --no-fund'],{cwd:path.join(output,'runtime'),stdio:'inherit',windowsHide:true,timeout:120000});
if(await fs.stat(path.join(output,'runtime/node_modules/node-nim')).catch(()=>null))throw Error('Restricted SDK must not enter the public payload');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const publicInfo={version,sourceCommit,edition:'public',features:{listenTogether:false},bundledFfmpeg:false,bundledNim:false};
await fs.writeFile(path.join(output,'runtime/PUBLIC-PACKAGE.json'),JSON.stringify(publicInfo,null,2)+'\n');
await fs.writeFile(path.join(output,'BUILD-INFO.json'),JSON.stringify({...publicInfo,publicRedistributionReady:true,frontendVersion:'0.4.1-preview-model-loop-1-public',nativeBuild:'single-job-offline-incremental-with-path-remapping',nativeLicenseEntries:licenses,runtimeChecked:false,gpuTested:false,realAccountTested:false,installerRuntimeChecked:false},null,2)+'\n');
await fs.writeFile(path.join(output,'PUBLIC-PACKAGE.txt'),'Rhine Music Windows 0.2.0 Public Preview\r\nSource: https://github.com/DuoJiuBetter/Rhine-Music-Windows\r\nNo FFmpeg/ffprobe or node-nim/native cloud chat SDK is bundled. Together is unavailable in this public edition.\r\nSource commit: '+sourceCommit+'\r\n');
async function hash(file){const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');}
const manifest=[];
async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Unexpected symlink in payload');if(entry.isDirectory())await walk(file);else manifest.push(`${await hash(file)}  ${path.relative(output,file).replaceAll('\\','/')}`);}}
await walk(output);await fs.writeFile(path.join(output,'SHA256SUMS.txt'),manifest.join('\n')+'\n');
console.log(JSON.stringify({output,sourceCommit,files:manifest.length,nativeLicenseEntries:licenses}));

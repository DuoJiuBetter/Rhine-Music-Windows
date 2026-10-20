import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const options = new Map();
for (let i=2;i<process.argv.length;i+=2) { if(!['--source','--compiler','--webview2'].includes(process.argv[i])||!process.argv[i+1])throw Error('Usage: --source PORTABLE --compiler makensis.exe --webview2 MicrosoftEdgeWebview2Setup.exe'); options.set(process.argv[i],path.resolve(process.argv[i+1])); }
const source=options.get('--source'), compiler=options.get('--compiler'), bootstrapper=options.get('--webview2');
if(!source||!compiler||!bootstrapper)throw Error('All three arguments are required.');
const info=JSON.parse(await fs.readFile(path.join(source,'BUILD-INFO.json'),'utf8'));
const version=info.version;
if(!/^\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/.test(version))throw Error('Invalid build version.');
const output=path.join(root,'release','Installers',`Rhine-Music-Windows-${version}-x64-Setup.exe`);
if(await fs.stat(output).catch(()=>null))throw Error('Installer already exists; preserve the previous output.');
const build=path.join(root,'artifacts','installer-build',version); await fs.mkdir(build,{recursive:true});await fs.mkdir(path.dirname(output),{recursive:true});
const hash=async file=>{const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');};
// Authenticode is checked before packaging Microsoft's executable.
const escapedBootstrapper=bootstrapper.replaceAll("'","''");
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$s=Get-AuthenticodeSignature -LiteralPath '${escapedBootstrapper}'; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'Invalid Microsoft bootstrapper signature'}`],{stdio:'pipe',windowsHide:true,timeout:20000,env:{...process.env,PSModulePath:path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')}});
const rows=(await fs.readFile(path.join(source,'SHA256SUMS.txt'),'utf8')).trim().split(/\r?\n/).map(row=>{const match=/^([a-f0-9]{64})  (.+)$/.exec(row);if(!match)throw Error('Invalid portable manifest');return{hash:match[1],relative:match[2]};});
const inventory=[];
async function walk(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isSymbolicLink())throw Error('Symlinks cannot enter an installer');if(item.isDirectory())await walk(file);else if(item.isFile())inventory.push(path.relative(source,file).replaceAll('\\','/'));}}
await walk(source);
const expected=new Set([...rows.map(row=>row.relative),'SHA256SUMS.txt']);
if(expected.size!==inventory.length||inventory.some(file=>!expected.has(file)))throw Error('Payload has files outside its manifest');
for(const row of rows){const file=path.resolve(source,row.relative);if(!file.startsWith(source+path.sep)||await hash(file)!==row.hash)throw Error(`Portable integrity mismatch: ${row.relative}`);}
const quote=value=>'"'+value.replaceAll('$','$$').replaceAll('"','$\\"')+'"';
const files=inventory.sort(), dirs=[...new Set(files.map(file=>path.posix.dirname(file)))].sort();
const install=[];let bytes=0;
for(const dir of dirs){install.push(`SetOutPath "$INSTDIR${dir==='.'?'':'\\'+dir.replaceAll('/','\\').replaceAll('$','$$')}"`);for(const file of files.filter(file=>path.posix.dirname(file)===dir)){install.push('File '+quote(path.join(source,file)));bytes+=(await fs.stat(path.join(source,file))).size;}}
const allDirs=new Set();for(const file of files){let dir=path.posix.dirname(file);while(dir!=='.'){allDirs.add(dir);dir=path.posix.dirname(dir);}}
const uninstall=files.map(file=>'Delete "$INSTDIR\\'+file.replaceAll('/','\\').replaceAll('$','$$')+'"');
uninstall.push(...[...allDirs].sort((a,b)=>b.split('/').length-a.split('/').length).map(dir=>'RMDir "$INSTDIR\\'+dir.replaceAll('/','\\').replaceAll('$','$$')+'"'));
const installFile=path.join(build,'install.nsh'),uninstallFile=path.join(build,'uninstall.nsh'),notes=path.join(build,'INSTALL-NOTES.txt');
// Both generated scripts and LicenseData must be independent of Windows ACP.
const writeUtf8Bom=(file,text)=>fs.writeFile(file,'\uFEFF'+text.replace(/\r?\n/g,'\r\n'),'utf8');
await writeUtf8Bom(installFile,install.join('\n'));await writeUtf8Bom(uninstallFile,uninstall.join('\n'));
const editionNotice = info.publicRedistributionReady === true ? '当前为公开预览版，不捆绑 FFmpeg／ffprobe 或云信原生聊天 SDK，暂不提供一起听。第三方平台适配不代表官方合作，曲库权限由平台和账号决定。' : '当前为本地开发体验版。第三方音乐平台适配不代表官方合作，曲库权限由平台和账号决定。新增云信原生 SDK 的公开再分发许可仍待核实，请勿将此体验安装包直接作为公开 Release。';
await writeUtf8Bom(notes,`Rhine Music Windows ${version}\r\n\r\n${editionNotice}\r\n\r\n默认安装到当前用户目录，不要求管理员权限。缺少 WebView2 时可通过 Microsoft 官方引导程序联网安装；已有运行时会跳过。\r\n\r\n卸载保留音乐文件、账号会话、曲库索引与设置。程序只删除安装清单列出的文件，不递归清空安装目录。\r\n\r\n项目代码许可：\r\n${await fs.readFile(path.join(source,'LICENSE'),'utf8')}\r\n\r\n隐私说明：\r\n${await fs.readFile(path.join(source,'PRIVACY.md'),'utf8')}`);
const args=['/INPUTCHARSET','UTF8','/OUTPUTCHARSET','UTF8','/V4',`/DSETUP_OUTPUT=${output}`,`/DAPP_VERSION=${version}`,`/DAPP_ICON=${path.join(root,'src-tauri/icons/icon.ico')}`,`/DINSTALL_NOTES=${notes}`,`/DWEBVIEW_BOOTSTRAPPER=${bootstrapper}`,`/DCOMPILER_LICENSE=${path.join(path.dirname(compiler),'COPYING')}`,`/DPAYLOAD_INSTALL=${installFile}`,`/DPAYLOAD_UNINSTALL=${uninstallFile}`,`/DESTIMATED_KIB=${Math.ceil(bytes/1024)}`,path.join(root,'scripts/windows-installer.nsi')];
const log=execFileSync(compiler,args,{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:16*1024*1024});await fs.writeFile(path.join(build,'compiler.log'),log);
const digest=await hash(output),result={version,sourceCommit:info.sourceCommit,installerBytes:(await fs.stat(output)).size,payloadBytes:bytes,payloadFiles:files.length,sha256:digest,compilerVersion:execFileSync(compiler,['/VERSION'],{encoding:'utf8'}).trim(),compilerSha256:await hash(compiler),webviewBootstrapperSha256:await hash(bootstrapper),webviewBootstrapperSignatureVerified:true,publicRedistributionReady:info.publicRedistributionReady===true,installerRuntimeChecked:false};
Object.assign(result,{installerBuildCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:root}).trim(),unicodeInstaller:true,scriptInputCharset:'UTF8',generatedTextCharset:'UTF8-BOM',compilerLogCharset:'UTF8'});
await fs.writeFile(output+'.json',JSON.stringify(result,null,2)+'\n');await fs.writeFile(output+'.sha256',digest+'  '+path.basename(output)+'\n');
console.log(JSON.stringify({output,...result}));

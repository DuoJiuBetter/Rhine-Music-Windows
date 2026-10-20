import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';
import * as data from '../src/data.ts';
import {SceneInstanceBudget} from '../src/scene-instance-budget.ts';
import {archiveWave} from '../src/motion.ts';
const source=await fs.readFile('src/scene.ts','utf8'),tree=ts.createSourceFile('scene.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const klass=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='ArchiveScene');
const update=klass.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(tree)==='update');
const variables=new Map();function visit(node){if(ts.isVariableDeclaration(node))variables.set(node.name.getText(tree),node);ts.forEachChild(node,visit);}visit(update);
const expression=name=>variables.get(name).initializer.getText(tree);
const adaptive=new Function('cinematic','musicIntro',`return ${expression('adaptive')};`);
for(const arrayBudget of [0,1])assert.equal(adaptive.call({instanceBudget:{},quality:{arrayBudget}},{musicIntro:true},true),true,'all normal music quality settings retain the intro frame budget');
assert.equal(adaptive.call({instanceBudget:{},quality:{arrayBudget:1}},{time:23},false),false,'the original reference film retains its comparison path');
assert.equal(adaptive.call({quality:{arrayBudget:1}},{musicIntro:true},true),false,'no unavailable pool is fabricated');
// Execute the actual upload-planning statements, replacing only I/O.
let uploadIf;function findUpload(node){if(ts.isIfStatement(node)&&node.getText(tree).includes('if (!adaptive || uploadNow'))uploadIf=node;ts.forEachChild(node,findUpload);}findUpload(update);
assert.ok(uploadIf);
const upload=new Function('adaptive','performance',`return function(){const work=this.coverWork.plan(100,false),uploadNow=100;${uploadIf.getText(tree)}}`)(true,{now:()=>100});
const calls=[],context={lastCoverUploadAt:0,coverPriority:[2,4],dragging:false,renderer:{},coverWork:{plan:()=>({uploadIntervalMs:0,uploadTiles:1,uploadMs:1,maxTransfers:1,transfers:1,phase:'quiet'})},gpuTiming:{measure:(_name,fn)=>fn()},covers:{flushUploads:(_renderer,tiles,budget)=>calls.push({tiles,budget})}};
upload.call(context);assert.equal(calls[0].tiles,1);assert.equal(calls[0].budget.timeBudgetMs,1);assert.equal(calls[0].budget.maxTransfers,1);
const album={id:'loaded',title:'loaded',artist:'Test',genreId:'',rawGenres:[],folder:'',tracks:[],producers:[],offline:false,playlistCell:{playlistId:'p',playlistIndex:0,playlistName:'P',songIndex:0,total:943}};
data.setPlaylistAlbums([album],['P']);assert.equal(data.playlistFile(2,412),-1,'metadata for this real song has not loaded');
const shell=new Function('musicIntro','playlistRows','playlistShellExists','lane','row',`const i=0;return ${expression('shellExists')};`);
assert.equal(shell.call({actualCell:()=>false},true,data.playlistRows,data.playlistShellExists,2,412),true,'missing metadata never removes a real shell in the intro');
assert.equal(shell.call({cells:[{}],actualCell:()=>false},false,data.playlistRows,data.playlistShellExists,2,412),false,'browsing behavior is unchanged');
// Real conservative frustum math: current-frame wave transforms, no renderer.
const camera=new THREE.PerspectiveCamera(60,16/9,5,300);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld();
const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
const budget=new SceneInstanceBudget(1),object=new THREE.Object3D(),point=new THREE.Vector3();
let visibleSamples=0;
for(let frame=0;frame<=130;frame++){
 const time=21.92+frame/25;object.position.set(7*Math.sin(frame/20),-4.6+archiveWave(12,2,time),0);object.rotation.x=.12*Math.sin(frame/7);object.updateMatrix();object.matrix.toArray(budget.pool,0);
 budget.update(camera,frustum,10,0,0,1280,.04,true);
 for(const x of [-2.225,2.225])for(const y of [.175,3.525])for(const z of [-.07,.07]){
  point.set(x,y,z).applyMatrix4(object.matrix).project(camera);
  if(Math.abs(point.x)<=1&&Math.abs(point.y)<=1&&point.z>=-1&&point.z<=1){visibleSamples++;assert.deepEqual(budget.visibleSlots,[0],'a visible moving shell cannot be dropped by the frame frustum');}
 }
}
assert.ok(visibleSamples>0);
object.position.x=100;object.updateMatrix();object.matrix.toArray(budget.pool,0);budget.update(camera,frustum,10,0,0,1280,.04,true);assert.equal(budget.visibleSlots.length,0);
object.position.set(0,0,0);object.updateMatrix();object.matrix.toArray(budget.pool,0);budget.update(camera,frustum,10,0,0,1280,.04,true);assert.deepEqual(budget.visibleSlots,[0],'re-entering geometry is restored in the same frame');
// Execute production async guards: account data can arrive while the opening
// plays, but it must not replace the display pool or enqueue a scene rebuild.
const appSource=await fs.readFile('src/music-app.ts','utf8'),appTree=ts.createSourceFile('music-app.ts',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const rebuild=appTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='rebuildPlaylistGrid');
const code=ts.transpileModule(rebuild.getText(appTree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const guard=new Function(`let playlistRefreshDeferred=false;const accountActive=true,accountView=true,scene={},ready=true,frameDisposed=false,boot={active:true};${code};return{run:rebuildPlaylistGrid,deferred:()=>playlistRefreshDeferred};`)();
await guard.run();assert.equal(guard.deferred(),true,'startup account refresh waits for the film instead of touching the renderer');
const queuedGuard=new Function(`let playlistRefreshDeferred=false,playbackVisualGeneration=0,playbackVisualTask=Promise.resolve();const accountActive=true,accountView=true,scene={},ready=true,frameDisposed=false,boot={active:false},playlistRenderTimer=0,clearTimeout=()=>{};${code};return{run:rebuildPlaylistGrid,startFilm:()=>boot.active=true,deferred:()=>playlistRefreshDeferred};`)();
const pending=queuedGuard.run();queuedGuard.startFilm();await pending;assert.equal(queuedGuard.deferred(),true,'a rebuild queued before replay also respects the opening lock');
console.log(JSON.stringify({passed:true,visibleCornerSamples:visibleSamples,uploadsBounded:true,unloadedPlaylistShellsRetained:true,accountRefreshDeferred:true,webgl:false}));

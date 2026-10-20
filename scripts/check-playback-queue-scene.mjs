import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=await fs.readFile('src/scene.ts','utf8'),tree=ts.createSourceFile('scene.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const scene=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='ArchiveScene');
const method=scene.members.find(node=>ts.isMethodDeclaration(node)&&node.name.getText(tree)==='refreshLibrary');
const javascript=ts.transpileModule(method.getText(tree).replace(/^async refreshLibrary/,'async function refreshLibrary'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
test('production queue refresh preserves camera/placement/springs and cover residency while updating selected slot',async()=>{
  const calls=[],record={album:{tracks:[{id:'test'}]}},cell={lane:2,row:14,slot:78};
  const run=new Function('archiveColumns','columnFiles','fileLocation','playlistRows','records','fileAtCell','selectionCell',javascript+';return refreshLibrary;')(['','','queue'],()=>[0],()=>cell,[],[record],()=>-1,()=>({lane:cell.lane,row:cell.row}));
  const context={loaded:true,playlistGrid:false,covers:{selected:{visible:false},select:async value=>calls.push(['cover',value]),reset:()=>{throw Error('No atlas reset')}},
    musicRealColumns:{reset:(counts,selected)=>calls.push(['counts',counts,selected])},instanceBudget:{reset:()=>calls.push('instances')},shadowBudget:{invalidate:()=>calls.push('shadows')},fieldCache:{invalidate:()=>calls.push('field')},
    musicCamera:{token:'camera'},musicPlacement:{token:'placement'},lift:{value:.9},detail:1,rotation:1,
    musicPresentation:{request:()=>{throw Error('No camera reset')}}};
  const camera=context.musicCamera,placement=context.musicPlacement,lift=context.lift;
  await run.call(context,0,true,true);
  assert.equal(context.musicCamera,camera);assert.equal(context.musicPlacement,placement);assert.equal(context.lift,lift);assert.equal(context.detail,1);assert.equal(context.rotation,1);
  assert.equal(context.selectedSlot,78);assert.deepEqual(context.selectedCell,{lane:2,row:14});assert.equal(context.covers.selected.visible,true);assert.deepEqual(calls.at(-1),['cover',record]);
});
test('unloaded production scene refresh remains a no-op',async()=>{
  const run=new Function('archiveColumns','columnFiles','fileLocation','playlistRows','records',javascript+';return refreshLibrary;')([],()=>[],()=>({}),[],[]);
  const context={loaded:false};await run.call(context,0,true,true);assert.deepEqual(context,{loaded:false});
});

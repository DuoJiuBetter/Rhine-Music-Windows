import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../src/data.ts';
import {fileAtCell,selectionCell} from '../src/archive-loop.ts';
import {queueShelfAlbums} from '../src/playback-albums.ts';
const track=id=>({id,albumId:'source',title:id,artist:'Test',format:'WAV',duration:1,relativePath:id,audioUrl:'/api/audio/'+id,browserPlayable:true});
const album=(id,extra={})=>({id,title:id,artist:'Test',genreId:'test',folder:'',rawGenres:[],tracks:[track(id)],producers:[],offline:false,...extra});
test('one finite queue row preserves base records and handles add, replace, remove and hide without placeholders',()=>{
  data.setMusicAlbums([album('a'),album('b')],[{id:'test',name:'Source'}]);
  const original=data.records.map(r=>r.id),baseCell=data.fileLocation(0);
  data.setQueueShelfAlbums(queueShelfAlbums(['a','x','b'].map(track),[]));
  assert.deepEqual(data.records.slice(0,2).map(r=>r.id),original);assert.deepEqual(data.fileLocation(0),baseCell);
  const lane=data.queueShelfLane;assert.equal(data.columnFiles(lane).length,3);
  for(let row=0;row<3;row++)assert.equal(data.records[fileAtCell({lane,row:12+row})].album.tracks[0].id,['a','x','b'][row]);
  for(const row of [11,15,60])assert.equal(fileAtCell({lane,row}),-1);
  assert.equal(fileAtCell({lane:lane+data.shelfColumnPeriod(),row:12}),-1,'no repeated queue row');
  data.setQueueShelfAlbums(queueShelfAlbums(['a','y'].map(track),[]));assert.equal(data.columnFiles(lane).length,2);assert.equal(data.records.length,4);
  assert.deepEqual(selectionCell(3,{lane:lane+20,row:50}),{lane,row:13});
  data.setQueueShelfAlbums([]);assert.equal(data.queueShelfLane,-1);assert.deepEqual(data.records.map(r=>r.id),original);
});
test('playlist looping stays separate from a finite queue row and queue models never inherit playlist cells',()=>{
  const albums=[album('a',{playlistCell:{playlistId:'p',playlistIndex:0,playlistName:'Source',songIndex:0,total:2}}),album('b',{playlistCell:{playlistId:'p',playlistIndex:0,playlistName:'Source',songIndex:1,total:2}})];
  data.setPlaylistAlbums(albums,['Source']);data.setQueueShelfAlbums(queueShelfAlbums(['x','y'].map(track),[]));
  assert.equal(data.records[fileAtCell({lane:2,row:14})].id,'a');
  assert.equal(data.records[fileAtCell({lane:3,row:12})].album.tracks[0].id,'x');assert.equal(fileAtCell({lane:3,row:14}),-1);
  assert.ok(!data.records[fileAtCell({lane:3,row:12})].album.playlistCell);
  data.setQueueShelfAlbums([]);assert.deepEqual(data.playlistRows,['Source']);assert.equal(data.records.length,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {GAMES,gamesByMode,settlementForGame} from './game-catalog.mjs';
import {rankedSummary} from './progression.mjs';
import {newConnect4,dropDisc,connectWinner,legalColumns,chooseConnectMove,newMemory,flipMemory,closeMemory,newSlide,moveSlide,SLIDE_GOAL,slideNeighbours,newLights,lightNeighbours,toggleLights} from './extra-games.mjs';
const rng=(seed=7)=>()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);

test('Ten unique games split into five ranked and five unranked tables',()=>{
  assert.equal(GAMES.length,10);assert.equal(new Set(GAMES.map(g=>g.id)).size,10);
  assert.deepEqual(gamesByMode('ranked').map(g=>g.id),['blackjack','baccarat','poker','mines','connect4']);
  assert.deepEqual(gamesByMode('unranked').map(g=>g.id),['roulette','memory','slide','lights','codebreaker']);
  assert.equal(GAMES[3].id,'poker');
});
test('Every unranked outcome keeps MMR and ranked statistics unchanged',()=>{
  for(const game of gamesByMode('unranked'))for(const result of ['win','draw','loss','exhibition']){
    const award=settlementForGame(game.id,result,1432);assert.equal(award.ranked,false);assert.equal(award.delta,0);assert.ok(award.points>0);
  }
  for(const game of gamesByMode('ranked'))assert.ok(settlementForGame(game.id,'win',1200).delta>0);
  const stats=rankedSummary([{result:'win',ranked:false,mmrDelta:0},{result:'loss',ranked:true,mmrDelta:-8}],1200);
  assert.equal(stats.matches,1);assert.equal(stats.wins,0);assert.equal(stats.form.length,1);
});
test('Connect Four detects all four line directions without wrapping edges',()=>{
  for(const [start,step] of [[35,1],[0,7],[0,8],[6,6]]){const cells=Array(42).fill(0);for(let i=0;i<4;i++)cells[start+i*step]=2;assert.equal(connectWinner(cells),2);}
  const cells=Array(42).fill(0);for(const i of [5,6,7,8])cells[i]=1;assert.equal(connectWinner(cells),0);
});
test('Connect Four uses gravity, rejects full columns and ends on a win',()=>{
  const b=newConnect4();for(let i=0;i<6;i++)assert.equal(dropDisc(b,0,i%2+1),true);
  assert.equal(dropDisc(b,0,1),false);assert.equal(b.moves,6);assert.ok(!legalColumns(b.cells).includes(0));
  assert.equal(dropDisc(b,-1,1),false);assert.equal(dropDisc(b,7,1),false);
  const win=newConnect4();for(const c of [0,1,2,3])dropDisc(win,c,1);assert.equal(win.status,'win');assert.equal(win.winner,1);assert.equal(dropDisc(win,4,2),false);
});
test('Connect Four AI takes a win, blocks a loss and preserves the input board',()=>{
  const win=newConnect4();for(const c of [0,1,2])dropDisc(win,c,2);assert.equal(chooseConnectMove(win.cells),3);
  const block=newConnect4();for(const c of [0,1,2])dropDisc(block,c,1);const before=[...block.cells];assert.equal(chooseConnectMove(block.cells),3);assert.deepEqual(block.cells,before);
  const empty=newConnect4();assert.ok(legalColumns(empty.cells).includes(chooseConnectMove(empty.cells)));
  assert.equal(chooseConnectMove(Array(42).fill(1)),null);
});
test('Memory hides exactly eight pairs and locks mismatches until reset',()=>{
  const b=newMemory(rng());const counts=Object.values(b.symbols.reduce((a,s)=>(a[s]=(a[s]??0)+1,a),{}));assert.deepEqual(counts,Array(8).fill(2));
  const other=b.symbols.findIndex(s=>s!==b.symbols[0]);assert.ok(flipMemory(b,0));assert.equal(flipMemory(b,0),false);flipMemory(b,other);assert.equal(b.waiting,true);assert.equal(b.turns,1);assert.equal(flipMemory(b,15),false);closeMemory(b);assert.deepEqual(b.flipped,[]);assert.equal(b.waiting,false);
});
test('Memory completes all pairs and ignores further input',()=>{
  const b=newMemory(rng(19));for(const symbol of new Set(b.symbols)){const indices=b.symbols.flatMap((s,i)=>s===symbol?[i]:[]);for(const i of indices)flipMemory(b,i);}
  assert.equal(b.status,'win');assert.equal(b.turns,8);assert.ok(b.matched.every(Boolean));assert.equal(flipMemory(b,0),false);
});
test('Slide Eight shuffles are legal solvable permutations and never start solved',()=>{
  for(let seed=1;seed<=100;seed++){const b=newSlide(rng(seed));assert.deepEqual([...b.tiles].sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8]);assert.notDeepEqual(b.tiles,SLIDE_GOAL);const values=b.tiles.filter(Boolean);let inversions=0;for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)if(values[i]>values[j])inversions++;assert.equal(inversions%2,0);}
  assert.deepEqual(slideNeighbours(0),[3,1]);assert.deepEqual(slideNeighbours(8),[5,7]);
});
test('Slide Eight accepts only neighbouring numbered tiles and recognises completion',()=>{
  const b={tiles:[1,2,3,4,5,6,7,0,8],moves:0,status:'playing'};assert.equal(moveSlide(b,1),false);assert.equal(moveSlide(b,0),false);assert.equal(moveSlide(b,99),false);assert.equal(moveSlide(b,8),true);assert.equal(b.status,'win');assert.equal(b.moves,1);assert.equal(moveSlide(b,7),false);
});
test('Lights Out toggles the correct cross and recognises a dark board',()=>{
  assert.deepEqual(lightNeighbours(0),[0,4,1]);assert.deepEqual(lightNeighbours(5),[5,1,9,4,6]);
  const b={cells:Array(16).fill(false),moves:0,status:'playing'};toggleLights(b,5);assert.equal(b.cells.filter(Boolean).length,5);toggleLights(b,5);assert.equal(b.status,'win');assert.equal(b.moves,2);assert.equal(toggleLights(b,5),false);
});
test('Generated Lights Out boards are nonempty and can be reversed by their generating toggles',()=>{
  for(let seed=1;seed<=30;seed++){const random=rng(seed),record=[];const b=newLights(()=>{const n=random();record.push(Math.floor(n*16));return n;});assert.ok(b.cells.some(Boolean));const cells=[...b.cells];for(const index of record)for(const i of lightNeighbours(index))cells[i]=!cells[i];if(cells.some(Boolean))for(const i of lightNeighbours(0))cells[i]=!cells[i];assert.ok(cells.every(v=>!v));}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {CODE_SYMBOLS,CODE_ATTEMPTS,codeFeedback,newCodebreaker,editCode,submitCode} from './codebreaker.mjs';
import {renderCodebreaker} from './codebreaker-ui.mjs';

test('Codebreaker creates a hidden four-symbol code with six repeatable symbols',()=>{
  assert.equal(CODE_SYMBOLS.length,6);assert.equal(CODE_ATTEMPTS,8);
  const b=newCodebreaker(()=>0);assert.deepEqual(b.secret,[0,0,0,0]);assert.deepEqual(b.draft,[null,null,null,null]);assert.deepEqual(b.guesses,[]);
  assert.deepEqual(newCodebreaker(()=>.999).secret,[5,5,5,5]);
  const html=renderCodebreaker({extra:b,phase:'playing'});assert.ok(html.includes('Hidden four-symbol code'));assert.ok(!html.includes('Secret code:'));assert.equal((html.match(/class="code-secret ">\?/g)||[]).length,4);assert.ok(html.includes('data-action="code-submit" disabled'));
});
test('Codebreaker feedback scores exact and misplaced symbols without double counting repeats',()=>{
  assert.deepEqual(codeFeedback([0,1,2,3],[0,1,2,3]),{exact:4,misplaced:0});
  assert.deepEqual(codeFeedback([0,1,2,3],[3,2,1,0]),{exact:0,misplaced:4});
  assert.deepEqual(codeFeedback([0,0,1,1],[0,1,0,0]),{exact:1,misplaced:2});
  assert.deepEqual(codeFeedback([0,0,1,2],[0,0,0,0]),{exact:2,misplaced:0});
  assert.deepEqual(codeFeedback([0,0,0,0],[1,1,1,1]),{exact:0,misplaced:0});
  for(const a of [[0,0,1,2],[1,2,3,4],[5,5,5,5]])for(const b of [[0,1,0,0],[1,2,4,3],[5,5,5,1]]){const score=codeFeedback(a,b);assert.deepEqual(score,codeFeedback(b,a));assert.ok(score.exact+score.misplaced<=4);}
  assert.throws(()=>codeFeedback([0,1,2],Array(4)),RangeError);
});
test('Codebreaker rejects partial and invalid guesses without spending an attempt',()=>{
  const b=newCodebreaker(()=>.5);assert.equal(submitCode(b),false);assert.equal(editCode(b,4,1),false);assert.equal(editCode(b,0,6),false);assert.equal(editCode(b,0,-1),false);
  for(let i=0;i<3;i++)editCode(b,i,i);assert.equal(submitCode(b),false);assert.equal(b.guesses.length,0);assert.equal(b.active,3);editCode(b,1,null);assert.equal(b.draft[1],null);assert.equal(b.active,1);
});
test('Codebreaker keeps independent guess history, resets drafts, and wins on the eighth attempt',()=>{
  const b=newCodebreaker(()=>0);for(let attempt=0;attempt<7;attempt++){for(let i=0;i<4;i++)editCode(b,i,1);assert.ok(submitCode(b));assert.equal(b.status,'playing');assert.deepEqual(b.draft,[null,null,null,null]);}
  for(let i=0;i<4;i++)editCode(b,i,0);submitCode(b);assert.equal(b.status,'win');assert.equal(b.guesses.length,8);assert.deepEqual(b.guesses[0].guess,[1,1,1,1]);assert.equal(editCode(b,0,1),false);assert.equal(submitCode(b),false);
  assert.ok(renderCodebreaker({extra:b,phase:'done'}).includes('Secret code: Spade, Spade, Spade, Spade'));
});
test('Codebreaker ends after eight misses and reveals the secret only at completion',()=>{
  const b=newCodebreaker(()=>.5);for(let attempt=0;attempt<8;attempt++){for(let i=0;i<4;i++)editCode(b,i,0);submitCode(b);}
  assert.equal(b.status,'loss');assert.equal(b.guesses.length,8);assert.equal(submitCode(b),false);const html=renderCodebreaker({extra:b,phase:'done'});assert.ok(html.includes('The code revealed.'));assert.ok(html.includes('Secret code: Club, Club, Club, Club'));assert.ok(!html.includes('code-composer'));
});

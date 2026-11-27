import {deck,total,blackjackResult,baccaratDeal,baccaratTotal,comparePoker,aiDraw,pokerRank,secureRandom} from '../engine.mjs';
import {newMinefield,revealCell,toggleFlag,mineProgress} from '../mines.mjs';
import {newConnect4,dropDisc,chooseConnectMove,newMemory,flipMemory,closeMemory,newSlide,moveSlide,newLights,toggleLights} from '../extra-games.mjs';
import {newCodebreaker,editCode,submitCode} from '../codebreaker.mjs';
import {GAMES} from '../game-catalog.mjs';
import {WHEEL_ORDER,wheelColour,spinDestination} from '../progression.mjs';
import {demand} from './store.mjs';

export function gameService(store,{now=()=>Date.now()}={}){
  function load(id,userId){const row=store.get('SELECT * FROM games WHERE id=? AND user_id=?',id,userId);demand(row,404,'Round not found.');return JSON.parse(row.state);}
  function write(r,userId){store.run('UPDATE games SET state=?,phase=?,version=? WHERE id=? AND user_id=?',JSON.stringify(r),r.phase,r.version,r.id,userId);}
  function finish(r,userId,outcome,message,title){
    demand(r.phase==='playing',409,'This round is already complete.');r.phase='done';r.spinning=false;r.outcome=outcome;r.message=message;r.title=title??(outcome==='win'?'You win.':outcome==='draw'?'Draw.':'Round lost.');r.resultLabel=title??r.title;
    Object.assign(r,store.record(userId,r.game,outcome,{resultId:r.id,opponent:r.opponentMMR}));
  }
  function view(r){const copy=structuredClone(r);delete copy.d;delete copy.answer;copy.server=true;copy.elapsed=Math.max(0,now()-r.started);copy.flipRemainingif(r.game==='baccarat'&&r.phase==='playing')copy.remainingMs=Math.max(0,(r.deadline??now())-now());=Math.max(0,(r.flipUntil??0)-now());
    if(r.phase!=='done'){
      if(r.game==='blackjack')copy.dealer=r.dealer.slice(0,1).concat({r:0,s:''});
      if(r.game==='poker')copy.dealer=[];
      if(r.game==='codebreaker')copy.extra.secret=Array(4).fill(null);
      if(r.game==='memory')copy.extra.symbols=r.extra.symbols.map((s,i)=>r.extra.matched[i]||r.extra.flipped.includes(i)?s:'?');
      if(r.game==='mines')copy.board.cells=r.board.cells.map(c=>({...c,mine:false,nearby:c.revealed?c.nearby:0}));
      if(r.game==='roulette')delete copy.number;
    }
    return copy;
  }
  function packet(r,id){return {round:view(r),profile:store.profile(id)};}
  function active(id){const row=store.get("SELECT state FROM games WHERE user_id=? AND phase='playing'",id);return row?view(JSON.parse(row.state)):null;}
  function start(id,gameId,requestId){return store.tx(()=>{
    demand(typeof requestId==='string'&&/^[a-f0-9-]{36}$/i.test(requestId),400,'A round request ID is required.');
    const previous=store.get('SELECT user_id,state FROM games WHERE id=?',requestId);if(previous){demand(previous.user_id===id,404,'Round not found.');return packet(JSON.parse(previous.state),id);}
    const g=GAMES.find(g=>g.id===gameId);demand(g,400,'Unknown game.');
    const pending=store.get("SELECT state FROM games WHERE user_id=? AND phase='playing'",id);
    if(pending){const old=JSON.parse(pending.state);if(old.ranked)finish(old,id,'loss','An unfinished ranked match was left.','Match forfeited.');else{old.phase='abandoned';old.spinning=false;}write(old,id);}
    const r={id:requestId,game:gameId,version:0,started:now(),phase:'playing',ranked:g.mode==='ranked',opponentMMR:g.benchmark,message:g.sub,d:deck()};
    if(gameId==='blackjack'){r.player=[r.d.pop(),r.d.pop()];r.dealer=[r.d.pop(),r.d.pop()];r.message=`You have ${total(r.player)}. Hit or stand?`;if(total(r.player)===21||total(r.dealer)===21)finish(r,id,blackjackResult(r.player,r.dealer),'A natural 21 ends the round.');}
    if(gameId==='baccarat'){
  const b=baccaratDeal(r.d);
  r.player=b.player;
  r.banker=b.banker;
  r.dealer=b.banker;
  r.answer=b.answer;
  r.handNumber=1;
  r.correct=0;
  r.deadline=now()+10000;
  r.message='Hand 1 of 5 · Calculate both totals and choose within 10 seconds.';
}
    if(gameId==='poker'){r.player=Array.from({length:5},()=>r.d.pop());r.dealer=Array.from({length:5},()=>r.d.pop());r.held=[];r.message='Choose cards to hold, then draw once.';}
    if(gameId==='mines'){r.board=newMinefield();r.puzzle=true;r.message='Clear 20 safe cells. The first opening is safe.';}
    if(gameId==='roulette'){const index=Math.floor(secureRandom()*37);r.number=WHEEL_ORDER[index];r.destination=spinDestination(index);r.spinning=true;r.angle=0;r.message='The wheel stops automatically after five seconds. +10 club points, 0 MMR.';}
    const extra={connect4:newConnect4,memory:newMemory,slide:newSlide,lights:newLights,codebreaker:newCodebreaker}[gameId];if(extra)r.extra=extra();
    store.run('INSERT INTO games VALUES(?,?,?,?,?,?,?)',r.id,id,gameId,r.phase,r.version,JSON.stringify(r),now());return packet(r,id);
  });}
  function action(id,gameId,input){return store.tx(()=>{
    const r=load(gameId,id);demand(typeof input.requestId==='string'&&/^[a-f0-9-]{36}$/i.test(input.requestId),400,'An action request ID is required.');
    if(store.get('SELECT 1 FROM game_actions WHERE game_id=? AND request_id=?',gameId,input.requestId))return packet(r,id);
    demand(r.phase==='playing',409,'This round has ended.');demand(input.version===r.version,409,'The round changed. Refresh and try again.');
    const t=input.type,b=r.extra;let valid=false;
    if(t==='abandon'){valid=true;if(r.ranked)finish(r,id,'loss','You left an unfinished ranked match.','Match forfeited.');else{r.phase='abandoned';r.spinning=false;}}
    else if(r.game==='blackjack'&&['hit','stand'].includes(t)){
      valid=true;if(t==='hit'){r.player.push(r.d.pop());if(total(r.player)>21)finish(r,id,'loss',`Your ${total(r.player)} is over 21.`);else if(total(r.player)===21)input={...input,type:'stand'};else r.message=`You have ${total(r.player)}. Hit or stand?`;}
      if(input.type==='stand'&&r.phase==='playing'){while(total(r.dealer)<17)r.dealer.push(r.d.pop());finish(r,id,blackjackResult(r.player,r.dealer),`You: ${total(r.player)} · Dealer: ${total(r.dealer)}.`);}
    }else if(r.game==='baccarat'&&t==='answer'){
      demand(['player','banker','tie'].includes(input.answer),400,'Choose Player, Banker or Tie.');valid=true;const win=input.answer===r.answer;finish(r,id,win?'win':'loss',`Player ${baccaratTotal(r.player)} · Banker ${baccaratTotal(r.banker)}. ${r.answer==='tie'?'The hands tie.':r.answer+' is higher.'}`,win?'Correct comparison.':'Comparison missed.');
    }else if(r.game==='poker'&&t==='draw'){
      demand(Array.isArray(input.held)&&input.held.length<=5&&new Set(input.held).size===input.held.length&&input.held.every(i=>Number.isInteger(i)&&i>=0&&i<5),400,'Invalid held cards.');valid=true;r.held=input.held;r.player=r.player.map((c,i)=>r.held.includes(i)?c:r.d.pop());r.dealer=aiDraw(r.dealer,r.d);const result=comparePoker(r.player,r.dealer);finish(r,id,result>0?'win':result<0?'loss':'draw',`Your hand: ${pokerRank(r.player).name}. AI hand: ${pokerRank(r.dealer).name}.`);
    }else if(r.game==='mines'&&['reveal','flag'].includes(t)){
      demand(Number.isInteger(input.index)&&input.index>=0&&input.index<25,400,'Invalid cell.');valid=t==='flag'?toggleFlag(r.board,input.index):revealCell(r.board,input.index);const progress=mineProgress(r.board);r.message=`${progress.revealed} of 20 safe cells cleared.`;if(r.board.status==='win')finish(r,id,'win','All 20 safe cells cleared.','Field cleared.');if(r.board.status==='loss')finish(r,id,'loss','A mine was revealed.','Mine revealed.');
    }else if(r.game==='connect4'&&t==='drop'){
      valid=dropDisc(b,input.column,1);if(valid&&b.status==='playing')dropDisc(b,chooseConnectMove(b.cells),2);
      if(b.winner)finish(r,id,b.winner===1?'win':'loss',b.winner===1?'Your gold discs connect four.':'Iris connected four burgundy discs.',b.winner===1?'Four in a row.':'Iris connects four.');else if(b.status==='draw')finish(r,id,'draw','The board is full.','Full-board draw.');else r.message='Iris has played. Choose your next column.';
    }else if(r.game==='roulette'&&t==='complete'){
      demand(now()-r.started>=5000,409,'The wheel is still spinning.');valid=true;r.angle=r.destination;finish(r,id,'exhibition',`The wheel stopped on ${r.number} · ${wheelColour(r.number)}.`,`${r.number} · ${wheelColour(r.number)}`);
    }else if(r.game==='memory'&&['flip','memory-close'].includes(t)){
      if(b.waiting&&now()>=r.flipUntil)closeMemory(b);
      if(t==='memory-close'){demand(!b.waiting,409,'Wait for these tiles to turn over.');valid=true;}else valid=flipMemory(b,input.index);
      if(b.waiting)r.flipUntil=now()+650;
      if(b.status==='win')finish(r,id,'win',`All eight pairs found in ${b.turns} turns.`,'Every pair found.');else r.message=b.waiting?'Different symbols. Remember them for the next turn.':`${b.matched.filter(Boolean).length/2} of 8 pairs found.`;
    }else if(r.game==='slide'&&t==='slide'){valid=moveSlide(b,input.tile);if(b.status==='win')finish(r,id,'win',`Solved in ${b.moves} moves.`,'Puzzle solved.');else r.message=`${b.moves} moves. Put the tiles in order.`;
    }else if(r.game==='lights'&&t==='toggle'){valid=toggleLights(b,input.index);if(b.status==='win')finish(r,id,'win',`All lights off after ${b.moves} moves.`,'All lights out.');else r.message=`${b.cells.filter(Boolean).length} lights remain on.`;
    }else if(r.game==='codebreaker'&&t==='guess'){
      demand(Array.isArray(input.guess)&&input.guess.length===4&&input.guess.every(n=>Number.isInteger(n)&&n>=0&&n<6),400,'Choose four valid symbols.');input.guess.forEach((n,i)=>editCode(b,i,n));valid=submitCode(b);const clue=b.guesses.at(-1);if(b.status==='win')finish(r,id,'win',`You cracked the code in ${b.guesses.length} guesses.`,'Code cracked.');else if(b.status==='loss')finish(r,id,'loss','Eight guesses used. The secret code is revealed.','The lock held.');else r.message=`${clue.exact} exact · ${clue.misplaced} correct symbol, wrong position.`;
    }
    demand(valid,400,'That move is not available.');r.version++;write(r,id);store.run('INSERT INTO game_actions VALUES(?,?)',gameId,input.requestId);return packet(r,id);
  });}
  return {start,action,active,load,view};
}

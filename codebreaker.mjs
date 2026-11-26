import {secureRandom} from './engine.mjs';

export const CODE_SYMBOLS=[
  {mark:'♠',name:'Spade'},{mark:'♥',name:'Heart'},{mark:'♦',name:'Diamond'},
  {mark:'♣',name:'Club'},{mark:'☾',name:'Moon'},{mark:'✦',name:'Star'}
];
export const CODE_ATTEMPTS=8;
const validSymbol=n=>Number.isInteger(n)&&n>=0&&n<CODE_SYMBOLS.length;
const validCode=code=>Array.isArray(code)&&code.length===4&&Array.from(code).every(validSymbol);

export function codeFeedback(secret,guess){
  if(!validCode(secret)||!validCode(guess))throw new RangeError('Codes need four symbols from 0 to 5.');
  let exact=0;const remainingSecret=Array(6).fill(0),remainingGuess=Array(6).fill(0);
  for(let i=0;i<4;i++)if(secret[i]===guess[i])exact++;else{remainingSecret[secret[i]]++;remainingGuess[guess[i]]++;}
  const misplaced=remainingSecret.reduce((total,n,i)=>total+Math.min(n,remainingGuess[i]),0);
  return {exact,misplaced};
}
export function newCodebreaker(random=secureRandom){
  return {secret:Array.from({length:4},()=>Math.floor(random()*6)),draft:Array(4).fill(null),active:0,guesses:[],status:'playing'};
}
export function editCode(board,slot,symbol){
  if(board.status!=='playing'||!Number.isInteger(slot)||slot<0||slot>3||symbol!==null&&!validSymbol(symbol))return false;
  board.draft[slot]=symbol;board.active=symbol===null?slot:(slot+1)%4;return true;
}
export function submitCode(board){
  if(board.status!=='playing'||!validCode(board.draft))return false;
  const guess=[...board.draft],feedback=codeFeedback(board.secret,guess);
  board.guesses.push({guess,...feedback});
  if(feedback.exact===4)board.status='win';else if(board.guesses.length===CODE_ATTEMPTS)board.status='loss';
  if(board.status==='playing'){board.draft=Array(4).fill(null);board.active=0;}
  return true;
}

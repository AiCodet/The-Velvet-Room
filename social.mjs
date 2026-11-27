import {deck,aiDraw,comparePoker} from './engine.mjs';
export const PLAYER_ID='player:alex';
export const playerProfile=mmr=>({id:PLAYER_ID,name:'Alex Morgan',type:'player',mmr});
export function friendProfile(friend){return {id:'friend:'+friend.name.toLocaleLowerCase('en-GB'),name:friend.name,type:'friend',mmr:friend.mmr??({Oliver:1328,Scarlett:1384,Theo:1184}[friend.name]??1200)};}
export function weekKey(now=Date.now()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const day=new Date(Date.UTC(+parts.year,+parts.month-1,+parts.day));
  day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);
  return day.toISOString().slice(0,10);
}
export function nextWeek(key){const d=new Date(key+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10);}
export const emptySocial=()=>({series:{},tournaments:{},active:null,rivalries:{},weeks:{},recorded:[],awards:[],equippedTitle:'Club member'});
export function normaliseSocial(value){const s={...emptySocial(),...(value??{})};for(const t of Object.values(s.tournaments))for(const series of tournamentSeries(t))s.series[series.id]=series;return s;}
export function pairKey(a,b){return JSON.stringify([a,b].sort());}
export function rivalry(social,a,b){const r=social.rivalries[pairKey(a,b)];return r??{matches:0,wins:{[a]:0,[b]:0},draws:0,streakWinner:null,streak:0};}
export function makeSeries(a,b,bestOf=3,extra={}){
  if(![1,3,5].includes(bestOf)||a.id===b.id)throw Error('Choose distinct players and best-of-1, 3 or 5.');
  return {id:crypto.randomUUID(),players:[{...a},{...b}],bestOf,target:Math.floor(bestOf/2)+1,score:{[a.id]:0,[b.id]:0},hands:[],status:'playing',winnerId:null,created:Date.now(),...extra};
}
export function applyHand(series,outcome,handId){
  if(!['win','draw','loss'].includes(outcome))throw Error('Invalid hand outcome');
  if(series.status==='complete'||series.hands.some(h=>h.id===handId))return false;
  const winner=outcome==='draw'?null:series.players[outcome==='win'?0:1].id;
  series.hands.push({id:handId,winner});
  if(winner)series.score[winner]++;
  if(winner&&series.score[winner]>=series.target){series.status='complete';series.winnerId=winner;}
  return true;
}
export function simulateSeries(series,random){
  for(let count=0;series.status!=='complete'&&count<200;count++){
    const d=deck(random),a=aiDraw(d.splice(0,5),d),b=aiDraw(d.splice(0,5),d),result=comparePoker(a,b);
    applyHand(series,result>0?'win':result<0?'loss':'draw',crypto.randomUUID());
  }
  if(series.status!=='complete')throw Error('The simulated match tied too often. Please start again.');
  return series;
}
export function weeklyRows(social,profiles,key=weekKey()){
  const scores=social.weeks[key]?.scores??{};
  return profiles.map(p=>({...p,matches:0,wins:0,draws:0,points:0,...scores[p.id]})).sort((a,b)=>b.points-a.points||b.wins-a.wins||a.name.localeCompare(b.name));
}
export function recordSeries(social,series,now=Date.now()){
  if(series.status!=='complete'||social.recorded.includes(series.id))return false;
  social.recorded.push(series.id);
  const [a,b]=series.players;
  if(a.type!=='ai'&&b.type!=='ai'){
    const key=pairKey(a.id,b.id),r=rivalry(social,a.id,b.id);
    r.matches++;r.wins[series.winnerId]=(r.wins[series.winnerId]??0)+1;
    if(r.streakWinner===series.winnerId)r.streak++;else{r.streakWinner=series.winnerId;r.streak=1;}
    social.rivalries[key]=r;
  }
  const key=weekKey(now),week=social.weeks[key]??={scores:{},settled:false};
  for(const p of series.players){
    if(p.type==='ai')continue;
    const score=week.scores[p.id]??={id:p.id,name:p.name,matches:0,wins:0,draws:0,points:0};
    score.matches++;
    if(p.id===series.winnerId){score.wins++;score.points+=3;}
  }
  return true;
}
export function settleWeeks(social,now=Date.now()){
  const current=weekKey(now),awards=[];
  for(const [key,week] of Object.entries(social.weeks)){
    if(key>=current||week.settled)continue;
    const rows=Object.values(week.scores).sort((a,b)=>b.points-a.points||b.wins-a.wins),me=week.scores[PLAYER_ID];
    if(me?.matches){
      const place=1+rows.filter(p=>p.points>me.points||(p.points===me.points&&p.wins>me.wins)).length;
      const title=place===1?'Weekly Champion':place<=3?'Club Contender':'Good Company';
      const award={id:'week:'+key,week:key,title,badge:place===1?'♛':place<=3?'✧':'✦',place};
      if(!social.awards.some(a=>a.id===award.id)){social.awards.push(award);awards.push(award);}
    }
    week.settled=true;
  }
  return awards;
}
export function makeTournament(players,bestOf=3,roomCode=''){
  if(players.length!==4||players[0].id!==PLAYER_ID||![3,5].includes(bestOf)||new Set(players.map(p=>p.id)).size!==4)throw Error('A tournament needs four distinct seats, including you, and best-of-3 or 5.');
  const id=crypto.randomUUID();
  return {id,roomCode,bestOf,players:players.map(p=>({...p})),status:'playing',championId:null,
    semiA:makeSeries(players[0],players[1],bestOf,{tournamentId:id,stage:'Semifinal 1'}),
    semiB:makeSeries(players[2],players[3],bestOf,{tournamentId:id,stage:'Semifinal 2'}),final:null};
}
export function advanceTournament(tournament,simulate=simulateSeries){
  if(tournament.status==='complete')return null;
  if(tournament.semiB.status!=='complete')simulate(tournament.semiB);
  if(tournament.semiA.status!=='complete')return tournament.semiA;
  if(!tournament.final){
    const a=tournament.players.find(p=>p.id===tournament.semiA.winnerId),b=tournament.players.find(p=>p.id===tournament.semiB.winnerId);
    tournament.final=makeSeries(a,b,tournament.bestOf,{tournamentId:tournament.id,stage:'Final'});
  }
  if(!tournament.final.players.some(p=>p.id===PLAYER_ID)&&tournament.final.status!=='complete')simulate(tournament.final);
  if(tournament.final.status==='complete'){tournament.status='complete';tournament.championId=tournament.final.winnerId;return null;}
  return tournament.final;
}
export function tournamentSeries(t){return [t.semiA,t.semiB,t.final].filter(Boolean);}

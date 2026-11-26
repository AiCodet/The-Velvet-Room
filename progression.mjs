export const SPIN_DURATION = 5000;
export const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const wheelColour = n => n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
export function spinDestination(index) { return 360 * 5 + (360 - index * 360 / WHEEL_ORDER.length) % 360; }
export function spinState(elapsed, destination) {
  const progress = Math.max(0, Math.min(1, elapsed / SPIN_DURATION));
  return {rotation: destination * (1 - (1 - progress) ** 3), done: progress === 1, remaining: Math.max(0, (SPIN_DURATION - elapsed) / 1000)};
}
export const MMR_TIERS = [
  {min:800,name:'Silver I'}, {min:1200,name:'Silver II'}, {min:1400,name:'Gold I'},
  {min:1600,name:'Gold II'}, {min:1800,name:'Platinum I'}, {min:2000,name:'Platinum II'},
  {min:2200,name:'Diamond'}, {min:2400,name:'Velvet Master'}
];
export function rankForMMR(mmr) {
  const index = MMR_TIERS.findLastIndex(t => mmr >= t.min);
  const tier = MMR_TIERS[Math.max(0,index)], next = MMR_TIERS[index + 1] ?? null;
  return {...tier,next,progress:next ? Math.max(0,Math.min(100,(mmr-tier.min)/(next.min-tier.min)*100)) : 100};
}
export function mmrChange(mmr, opponentMMR, outcome, ranked = true) {
  if (!ranked) return 0;
  const score = {win:1,draw:.5,loss:0}[outcome];
  if (score === undefined) throw new Error('Unknown match outcome');
  const expected = 1 / (1 + 10 ** ((opponentMMR - mmr) / 400));
  return Math.max(800, mmr + Math.round(16 * (score - expected))) - mmr;
}
export function migrateProgress(saved) {
  const mmr = saved.mmr ?? saved.rating;
  if (!Number.isFinite(mmr) || mmr < 800) throw new Error('Invalid saved MMR');
  const {rating, ...rest} = saved;
  const history = saved.history.slice(0,100).map(h => {
    const {rating, ...entry} = h;
    return {...entry, mmrDelta:h.mmrDelta ?? rating ?? 0};
  });
  let previous = mmr, peakMMR = Math.max(1200, mmr, saved.peakMMR ?? 0);
  for (const match of history) { previous -= match.mmrDelta; peakMMR = Math.max(peakMMR, previous); }
  return {...rest, mmr, peakMMR, history};
}

// These summaries describe retained local matches, not fabricated online stats.
export function rankedSummary(history, currentMMR, peakMMR = currentMMR, now = Date.now()) {
  const ranked = history.filter(h => h.ranked!==false && ['win','draw','loss'].includes(h.result));
  const wins = ranked.filter(h => h.result === 'win').length;
  const recent = ranked.slice(0,20);
  let value = currentMMR - recent.reduce((sum,h) => sum + h.mmrDelta, 0);
  const trend = [value];
  for (const h of recent.toReversed()) { value += h.mmrDelta; trend.push(value); }
  const weekly = ranked.filter(h => { const age=now-new Date(h.date).getTime(); return age>=0 && age<7*864e5; });
  return {matches:ranked.length,wins,draws:ranked.filter(h=>h.result==='draw').length,
    winRate:ranked.length?Math.round(wins/ranked.length*100):0,
    weeklyChange:weekly.reduce((sum,h)=>sum+h.mmrDelta,0),
    peakMMR:Math.max(currentMMR,peakMMR,...trend),form:ranked.slice(0,10).toReversed(),trend};
}

export function matchTimeline(history, currentMMR) {
  let mmr = currentMMR;
  return history.map(h => {
    const after=mmr, before=after-h.mmrDelta;
    mmr=before;
    return {...h,mmrBefore:before,mmrAfter:after};
  });
}

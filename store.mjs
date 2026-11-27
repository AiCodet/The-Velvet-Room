import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {rankForMMR,mmrChange} from '../progression.mjs';
import {weekKey} from '../social.mjs';
import {GAMES,settlementForGame} from '../game-catalog.mjs';

export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
export const demand=(condition,status,message)=>{if(!condition)throw new ApiError(status,message);};
export const uid=()=>randomUUID();
export const token=()=>randomBytes(32).toString('base64url');
export const digest=value=>createHash('sha256').update(value).digest('hex');
const derive=promisify(scrypt);
export async function passwordHash(password,salt=randomBytes(16).toString('hex')){const key=await derive(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return salt+':'+key.toString('hex');}
export async function passwordMatches(password,hash){const [salt,key]=hash.split(':');const actual=(await passwordHash(password,salt)).split(':')[1];return timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(key,'hex'));}
export const publicUser=u=>({id:u.id,username:u.username,name:u.name,guest:!u.username,mmr:u.mmr,rank:rankForMMR(u.mmr).name,wins:u.wins});
export function createStore(filename){
  if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename);db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY); INSERT OR IGNORE INTO schema_version VALUES(1);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,name TEXT NOT NULL,password TEXT,mmr INTEGER NOT NULL DEFAULT 1200,peak INTEGER NOT NULL DEFAULT 1200,points INTEGER NOT NULL DEFAULT 2500,wins INTEGER NOT NULL DEFAULT 0,played INTEGER NOT NULL DEFAULT 0,last_claim TEXT,prefs TEXT NOT NULL DEFAULT '{}',created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),game TEXT NOT NULL,phase TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_game ON games(user_id) WHERE phase='playing';
    CREATE TABLE IF NOT EXISTS game_actions(game_id TEXT NOT NULL REFERENCES games(id),request_id TEXT NOT NULL,PRIMARY KEY(game_id,request_id));
    CREATE TABLE IF NOT EXISTS results(id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),game TEXT NOT NULL,result TEXT NOT NULL,ranked INTEGER NOT NULL,points INTEGER NOT NULL,delta INTEGER NOT NULL,before_mmr INTEGER NOT NULL,after_mmr INTEGER NOT NULL,opponent INTEGER NOT NULL,created INTEGER NOT NULL,kind TEXT NOT NULL,label TEXT,PRIMARY KEY(id,user_id));
    CREATE INDEX IF NOT EXISTS result_history ON results(user_id,created DESC);
    CREATE TABLE IF NOT EXISTS friends(id TEXT PRIMARY KEY,sender TEXT NOT NULL REFERENCES users(id),recipient TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(sender,recipient));
    CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),state TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS room_members(code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(code,user_id));
    CREATE TABLE IF NOT EXISTS room_actions(code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,user_id TEXT NOT NULL,request_id TEXT NOT NULL,PRIMARY KEY(code,user_id,request_id));
    CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,sender TEXT NOT NULL REFERENCES users(id),recipient TEXT NOT NULL REFERENCES users(id),created INTEGER NOT NULL,UNIQUE(code,recipient));
    CREATE TABLE IF NOT EXISTS rivalries(pair TEXT PRIMARY KEY,state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS weekly(week TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),wins INTEGER NOT NULL DEFAULT 0,played INTEGER NOT NULL DEFAULT 0,points INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(week,user_id));
    CREATE TABLE IF NOT EXISTS cosmetics(user_id TEXT NOT NULL REFERENCES users(id),week TEXT NOT NULL,title TEXT NOT NULL,PRIMARY KEY(user_id,week));`);
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  function tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  const user=id=>get('SELECT * FROM users WHERE id=?',id);
  function guest(){const id=uid();run('INSERT INTO users(id,name,created) VALUES(?,?,?)',id,'Guest-'+randomBytes(3).toString('hex').toUpperCase(),Date.now());return user(id);}
  function session(userId,now=Date.now()){const raw=token(),csrf=token();run('DELETE FROM sessions WHERE expires<?',now);run('INSERT INTO sessions VALUES(?,?,?,?)',digest(raw),userId,csrf,now+7*864e5);return {raw,csrf};}
  function profile(id){const u=user(id);demand(u,401,'Sign in to continue.');const history=all('SELECT * FROM results WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 100',id).map(r=>({id:r.id,game:r.game,result:r.result,ranked:!!r.ranked,points:r.points,mmrDelta:r.delta,mmrBefore:r.before_mmr,mmrAfter:r.after_mmr,opponentMMR:r.opponent,date:new Date(r.created).toISOString(),seriesLabel:r.label}));
    const awards=all('SELECT week,title FROM cosmetics WHERE user_id=? ORDER BY week DESC',id);
    return {...publicUser(u),peakMMR:u.peak,points:u.points,played:u.played,lastClaim:u.last_claim,history,preferences:JSON.parse(u.prefs),awards};}
  function record(id,gameId,outcome,{resultId=uid(),opponent,kind='solo',pointsAlreadyEarned=false,points=0,label=null,now=Date.now()}={}){
    if(get('SELECT 1 FROM results WHERE id=? AND user_id=?',resultId,id))return null;
    const u=user(id),g=GAMES.find(g=>g.id===gameId);demand(g,400,'Unknown game.');const award=kind==='series'?{ranked:true,points,delta:mmrChange(u.mmr,opponent,outcome)}:settlementForGame(gameId,outcome,u.mmr,opponent);
    const delta=award.delta,earned=award.points,after=u.mmr+delta;
    run('UPDATE users SET mmr=?,peak=MAX(peak,?),points=points+?,wins=wins+?,played=played+? WHERE id=?',after,after,pointsAlreadyEarned?0:earned,award.ranked&&outcome==='win'?1:0,pointsAlreadyEarned?0:1,id);
    run('INSERT INTO results VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',resultId,id,g.name,outcome,award.ranked?1:0,earned,delta,u.mmr,after,opponent??g.benchmark,now,kind,label);
    if(kind==='series')run('INSERT INTO weekly(week,user_id,wins,played,points) VALUES(?,?,?,?,?) ON CONFLICT(week,user_id) DO UPDATE SET wins=wins+excluded.wins,played=played+1,points=points+excluded.points',weekKey(now),id,outcome==='win'?1:0,1,outcome==='win'?3:0);
    return {earned,mmrDelta:delta,mmrBefore:u.mmr,mmrAfter:after,rankBefore:rankForMMR(u.mmr).name,rankAfter:rankForMMR(after).name,pointsBefore:u.points,pointsAfter:user(id).points,ranked:award.ranked};
  }
  function settleCosmetics(id){for(const row of all('SELECT week FROM weekly WHERE user_id=? AND week<?',id,weekKey())){const ranked=all('SELECT user_id,points FROM weekly WHERE week=? ORDER BY points DESC,wins DESC,user_id',row.week);const mine=ranked.find(r=>r.user_id===id);const place=1+ranked.filter(r=>r.points>mine.points).length;const title=place===1?'Weekly Champion':place<=3?'Club Contender':'Good Company';run('INSERT OR IGNORE INTO cosmetics VALUES(?,?,?)',id,row.week,title);}}
  function claim(id){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date());return tx(()=>{demand(user(id).last_claim!==day,409,'Today’s welcome has already been claimed.');run('UPDATE users SET points=points+250,last_claim=? WHERE id=?',day,id);return profile(id);});}
  function leaderboard(id,period='all',friendsOnly=false){const ids=friendsOnly?new Set([id,...all("SELECT sender,recipient FROM friends WHERE status='accepted' AND (sender=? OR recipient=?)",id,id).map(r=>r.sender===id?r.recipient:r.sender)]):null;const since=Date.now()-7*864e5;
    return all('SELECT * FROM users WHERE username IS NOT NULL').filter(u=>!ids||ids.has(u.id)).map(u=>{const sums=get('SELECT COALESCE(SUM(delta),0) delta,COALESCE(SUM(CASE WHEN result=\'win\' AND ranked=1 THEN 1 ELSE 0 END),0) wins FROM results WHERE user_id=? AND created>=?',u.id,since);return {...publicUser(u),mmr:period==='weekly'?1200+sums.delta:u.mmr,wins:period==='weekly'?sums.wins:u.wins,self:u.id===id};}).sort((a,b)=>b.mmr-a.mmr||b.wins-a.wins||a.name.localeCompare(b.name)).slice(0,100).map(u=>({...u,rank:rankForMMR(u.mmr).name}));}
  return {db,get,all,run,tx,user,guest,session,profile,record,claim,leaderboard,settleCosmetics,close:()=>db.close()};
}

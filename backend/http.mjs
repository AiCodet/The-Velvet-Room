import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore,ApiError,demand,uid,digest,passwordHash,passwordMatches} from './store.mjs';
import {gameService} from './games.mjs';
import {socialService} from './social.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicFiles=new Set(['index.html','style.css','app.mjs','api-client.mjs','online-ui.mjs','engine.mjs','progression.mjs','ranked-ui.mjs','social.mjs','social-ui.mjs','mines.mjs','roulette-layout.mjs','arcade-ui.mjs','game-catalog.mjs','extra-games.mjs','extra-ui.mjs','codebreaker.mjs','codebreaker-ui.mjs','favicon.svg']);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const usernameValid=u=>typeof u==='string'&&/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(u);
function cookies(req){return Object.fromEntries((req.headers.cookie??'').split(';').map(s=>s.trim().split('=')));}
export async function createApp({dbPath=path.join(root,'.data','velvet-room.sqlite'),origin=process.env.PUBLIC_ORIGIN,production=process.env.NODE_ENV==='production',now,rateLimits=true}={}){
  if(production)demand(origin&&new URL(origin).protocol==='https:',500,'Production requires an HTTPS PUBLIC_ORIGIN.');if(origin)origin=new URL(origin).origin;
  const store=createStore(dbPath),games=gameService(store,now?{now}:{}),social=socialService(store),dummyHash=await passwordHash('unused authentication check '+uid()),buckets=new Map();
  function throttle(key,max,window){if(!rateLimits)return;const time=Date.now();let b=buckets.get(key);if(!b||time>b.until){b={count:0,until:time+window};buckets.set(key,b);}demand(++b.count<=max,429,'Too many requests. Please try again later.');if(buckets.size>10000)for(const [k,v] of buckets)if(v.until<time)buckets.delete(k);demand(buckets.size<=20000,503,'The server is busy. Please try again later.');}
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
  function cookie(res,raw,clear=false){res.setHeader('Set-Cookie',`velvet_session=${clear?'':raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:7*86400}${production?'; Secure':''}`);}
  function session(req){const raw=cookies(req).velvet_session;if(!raw)return null;return store.get('SELECT * FROM sessions WHERE hash=? AND expires>?',digest(raw),Date.now())??null;}
  function auth(req){const s=session(req);demand(s,401,'Your session ended. Please sign in again.');return s;}
  async function body(req){demand(req.headers['content-type']?.split(';')[0]==='application/json',415,'Send JSON data.');let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;demand(bytes<=16384,413,'Request is too large.');chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');demand(value&&typeof value==='object'&&!Array.isArray(value),400,'Send a JSON object.');return value;}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,'Invalid JSON.');}}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try{
      const host=new URL('http://'+(req.headers.host??'localhost'));if(!origin)demand(['127.0.0.1','localhost','[::1]'].includes(host.hostname),403,'Unrecognised host.');const expected=origin??host.origin;
      const url=new URL(req.url,expected),p=url.pathname,method=req.method,ip=req.socket.remoteAddress??'unknown';
      if(p==='/api/health'&&method==='GET'){store.get('SELECT 1');return json(res,200,{status:'ok',database:'ready',version:'2.0.0'});}
      if(!p.startsWith('/api/')){demand(['GET','HEAD'].includes(method),405,'Method not allowed.');const name=p==='/'?'index.html':p.slice(1);demand(publicFiles.has(name),404,'Not found.');const file=await readFile(path.join(root,name));res.writeHead(200,{'Content-Type':mime[path.extname(name)],'Cache-Control':'no-cache'});return res.end(method==='HEAD'?undefined:file);}
      const mutation=!['GET','HEAD'].includes(method);let input={};if(mutation){demand(req.headers.origin===expected&&req.headers['sec-fetch-site']!=='cross-site',403,'This request must come from the Velvet Room website.');demand(req.headers['x-velvet-client']==='web',403,'Missing client header.');throttle('write:'+ip,600,60000);input=await body(req);}
      if(p==='/api/session'&&method==='GET'){const s=session(req);if(!s)return json(res,200,{user:null});store.settleCosmetics(s.user_id);return json(res,200,{user:store.profile(s.user_id),csrf:s.csrf,round:games.active(s.user_id)});}
      if(['/api/auth/guest','/api/auth/register','/api/auth/login'].includes(p)&&method==='POST'){
        throttle('auth:'+ip,30,15*60000);let u;
        if(p.endsWith('/guest')){const old=session(req);u=old?store.user(old.user_id):store.guest();}
        else{
          demand(usernameValid(input.username),400,'Use 3–20 letters, numbers or underscores, starting with a letter.');demand(typeof input.password==='string'&&input.password.length>=12&&input.password.length<=128,400,'Use a password with 12–128 characters.');
          if(p.endsWith('/register')){throttle('register:'+ip,10,3600000);const old=session(req);if(old){demand(req.headers['x-csrf-token']===old.csrf,403,'Session check failed. Refresh the page.');demand(!store.user(old.user_id).username,409,'You already have an account.');}const hash=await passwordHash(input.password);u=store.tx(()=>{demand(!store.get('SELECT id FROM users WHERE username=? COLLATE NOCASE',input.username),409,'That username is already taken.');const existing=old?store.user(old.user_id):store.guest();demand(!existing.username,409,'This guest account was already registered.');store.run('UPDATE users SET username=?,name=?,password=? WHERE id=?',input.username,input.username,hash,existing.id);return store.user(existing.id);});}
          else{u=store.get('SELECT * FROM users WHERE username=? COLLATE NOCASE',input.username);const good=await passwordMatches(input.password,u?.password??dummyHash);demand(u&&good,401,'Username or password is incorrect.');}
        }
        const old=session(req);if(old)store.run('DELETE FROM sessions WHERE hash=?',old.hash);const s=store.session(u.id);cookie(res,s.raw);return json(res,200,{user:store.profile(u.id),csrf:s.csrf,round:games.active(u.id)});
      }
      const s=auth(req),id=s.user_id;if(mutation)demand(req.headers['x-csrf-token']===s.csrf,403,'Session check failed. Refresh the page.');
      if(p==='/api/auth/logout'&&method==='POST'){store.run('DELETE FROM sessions WHERE hash=?',s.hash);cookie(res,'',true);return json(res,200,{signedOut:true});}
      if(p==='/api/me'&&method==='GET')return json(res,200,{profile:store.profile(id)});
      if(p==='/api/me/preferences'&&method==='PATCH'){
        demand(Object.keys(input).every(k=>['muted','rouletteHighlights','rouletteGroup','title'].includes(k)),400,'Only interface preferences can be changed here.');const prefs=JSON.parse(store.user(id).prefs);
        if('muted' in input){demand(typeof input.muted==='boolean',400,'Invalid sound preference.');prefs.muted=input.muted;}
        if('rouletteHighlights' in input){demand(Array.isArray(input.rouletteHighlights)&&input.rouletteHighlights.length<=37&&input.rouletteHighlights.every(n=>Number.isInteger(n)&&n>=0&&n<=36),400,'Invalid roulette highlights.');prefs.rouletteHighlights=[...new Set(input.rouletteHighlights)];}
        if('rouletteGroup' in input){demand(input.rouletteGroup===null||typeof input.rouletteGroup==='string'&&input.rouletteGroup.length<=20,400,'Invalid group.');prefs.rouletteGroup=input.rouletteGroup;}
        if('title' in input){demand(input.title==='Club member'||store.get('SELECT 1 FROM cosmetics WHERE user_id=? AND title=?',id,input.title),400,'Choose an earned title.');prefs.title=input.title;}
        store.run('UPDATE users SET prefs=? WHERE id=?',JSON.stringify(prefs),id);return json(res,200,{preferences:prefs});
      }
      if(p==='/api/claim'&&method==='POST')return json(res,200,{profile:store.claim(id)});
      if(p==='/api/leaderboard'&&method==='GET')return json(res,200,{players:store.leaderboard(id,url.searchParams.get('period'),url.searchParams.get('friends')==='1')});
      if(p==='/api/games/active'&&method==='GET')return json(res,200,{round:games.active(id)});
      if(p==='/api/games'&&method==='POST'){throttle('rounds:'+id,60,60000);return json(res,200,games.start(id,input.game,input.requestId));}
      const game=p.match(/^\/api\/games\/([a-f0-9-]{36})(\/actions)?$/i);if(game){if(method==='GET'&&!game[2])return json(res,200,{round:games.view(games.load(game[1],id)),profile:store.profile(id)});if(method==='POST'&&game[2])return json(res,200,games.action(id,game[1],input));}
      if(p==='/api/club'&&method==='GET')return json(res,200,social.hub(id));
      if(p==='/api/friends'&&method==='POST')return json(res,200,{friends:social.requestFriend(id,input.username)});
      const friend=p.match(/^\/api\/friends\/([a-f0-9-]{36})$/i);if(friend&&method==='POST'){demand(typeof input.accept==='boolean',400,'Choose accept or decline.');return json(res,200,{friends:social.answerFriend(id,friend[1],input.accept)});}
      if(p==='/api/rooms'&&method==='POST')return json(res,201,{room:social.create(id,input)});
      if(p==='/api/rooms/join'&&method==='POST'){throttle('join:'+id,30,60000);return json(res,200,{room:social.join(id,String(input.code??'').trim().toUpperCase())});}
      const room=p.match(/^\/api\/rooms\/([A-F0-9]{8})(?:\/(actions|leave|invite))?$/);if(room){const code=room[1];if(method==='GET'&&!room[2])return json(res,200,{room:social.view(social.load(code,id),id),profile:store.profile(id)});if(method==='POST'&&room[2]==='actions')return json(res,200,{room:social.act(id,code,input),profile:store.profile(id)});if(method==='POST'&&room[2]==='leave')return json(res,200,social.leave(id,code));if(method==='POST'&&room[2]==='invite')return json(res,200,social.invite(id,code,input.userId));}
      throw new ApiError(404,'Endpoint not found.');
    }catch(e){if(res.headersSent){res.end();return;}const status=e instanceof ApiError?e.status:500;if(status===500)console.error('Request failed:',e.message);if(status===429)res.setHeader('Retry-After','60');json(res,status,{error:status===500?'The server could not complete this request.':e.message});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxRequestsPerSocket=1000;
  return {server,store,games,social,close:()=>new Promise(resolve=>server.close(()=>{store.close();resolve();}))};
}

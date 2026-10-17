'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
function modules(){for(const f of ['../lib/store.cjs','../lib/game-service.cjs','../api/room.js'])assert.ok(fs.existsSync(path.join(__dirname,f)),f+' must exist');return {store:require('../lib/store.cjs'),service:require('../lib/game-service.cjs'),handler:require('../api/room.js')};}
let seq=0;
function rid(){return 'request-'+(++seq);}
function fixture(options={}){const {store,service}=modules();let clock=1700000000000;const backend=new store.MemoryStore();const svc=service.createService({store:backend,now:()=>clock,sessionSecret:'test-session-secret',gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}},...options});return {backend,svc,advance(ms){clock+=ms;},async call(body,ip='127.0.0.1'){return svc.handle(body,{ip});}};}
const TEST_PASSWORD='StrongPass42!';
async function login(f,name){return (await f.call({op:'register',name,password:TEST_PASSWORD,requestId:rid()})).token;}
async function create(f,token,capacity=6){return (await f.call({op:'create',token,capacity,requestId:rid()})).room;}
async function poll(f,token){return (await f.call({op:'poll',token})).room;}
async function mutate(f,token,op,extra={}){const room=await poll(f,token);return f.call({op,token,revision:room?.revision,requestId:rid(),...extra});}
async function lobby(f,n=6){const tokens=[];for(let i=0;i<n;i++)tokens.push(await login(f,'Player '+i));let room=await create(f,tokens[0],n);for(const token of tokens.slice(1))room=(await f.call({op:'join',token,code:room.code,requestId:rid()})).room;return {tokens,room};}
async function started(f,n=6){const {tokens}=await lobby(f,n);for(const token of tokens)await mutate(f,token,'ready',{ready:true});await mutate(f,tokens[0],'start');return {tokens,room:await poll(f,tokens[0])};}
async function engineAction(f,tokens,event){const room=await poll(f,tokens[0]),owner=room.game.turnOwnerId,index=room.members.findIndex(m=>m.gameId===owner);assert.ok(index>=0);return mutate(f,tokens[index],'action',{event});}
async function finishPrivate(f,tokens){let room=await poll(f,tokens[0]);while(['reveal','secret'].includes(room.game.phase)){await engineAction(f,tokens,{type:room.game.phase==='reveal'?'ROLE_SEEN':'SECRET_ACTION',kind:'pass'});room=await poll(f,tokens[0]);}return room;}

test('memory store create and compare-and-swap are atomic and return detached values',async()=>{
 const {store}=modules(),s=new store.MemoryStore();assert.equal(await s.get('x'),null);assert.equal(await s.create('x',{n:1}),true);assert.equal(await s.create('x',{n:9}),false);assert.deepEqual(await s.get('x'),{rev:0,value:{n:1}});
 const result=await Promise.all([s.CAS('x',0,{n:2}),s.CAS('x',0,{n:3})]);assert.equal(result.filter(Boolean).length,1);const value=await s.get('x');value.value.n=88;assert.notEqual((await s.get('x')).value.n,88);
});
test('login tokens are private and refresh reconnects the same member without impersonation',async()=>{
 const f=fixture(),token=await login(f,'  Alice  '),room=await create(f,token,2);assert.match(token,/^[A-Za-z0-9_-]{40,}$/);assert.equal(room.members[0].name,'Alice');assert.equal((await poll(f,token)).meId,room.meId);
 const serialized=JSON.stringify(room);assert.ok(!serialized.includes(token));for(const m of room.members){assert.equal(m.tokenHash,undefined);assert.equal(m.role,undefined);}
 const documents=JSON.stringify(await f.backend.get('witness:world'));assert.ok(!documents.includes(token));await assert.rejects(()=>f.call({op:'poll',token:'invalid-token'}),e=>e.status===401);
});
test('public nickname and request ID cannot recover a password-protected account',async()=>{
 const f=fixture(),body={op:'register',name:'Public nickname',password:TEST_PASSWORD,requestId:'known-public-id'};
 const original=await f.call(body,'192.0.2.1');const room=await create(f,original.token,2);
 await assert.rejects(()=>f.call({op:'login',name:body.name,requestId:body.requestId},'192.0.2.2'),e=>e.status===401);
 assert.equal((await poll(f,original.token)).meId,room.meId);
});
test('room creation, readiness and host start enforce lobby authority without needing a full room',async()=>{
 const f=fixture(),a=await login(f,'A'),b=await login(f,'B');let room=await create(f,a,6);assert.match(room.code,/^[A-HJ-NP-Z2-9]{6}$/);
 await f.call({op:'join',token:b,code:room.code.toLowerCase(),requestId:rid()});await assert.rejects(()=>mutate(f,a,'start'),e=>e.status===409);await mutate(f,a,'ready',{ready:true});await mutate(f,b,'ready',{ready:true});
 await assert.rejects(()=>mutate(f,b,'start'),e=>e.status===403);room=(await mutate(f,a,'start')).room;assert.equal(room.status,'playing');assert.equal(room.members.length,2);assert.equal(room.game.players.length,2);assert.equal(room.game.phase,'reveal');
});
test('concurrent joins cannot exceed capacity and one session cannot join two rooms',async()=>{
 const f=fixture(),host=await login(f,'Host'),tokens=[];for(let i=0;i<8;i++)tokens.push(await login(f,'Guest '+i));const room=await create(f,host,6);
 const results=await Promise.allSettled(tokens.map(token=>f.call({op:'join',token,code:room.code,requestId:rid()})));assert.equal(results.filter(x=>x.status==='fulfilled').length,5);assert.equal((await poll(f,host)).members.length,6);
 const outsider=await login(f,'Other host'),other=await create(f,outsider,2),solo=await login(f,'Solo');const raced=await Promise.allSettled([room.code,other.code].map(code=>f.call({op:'join',token:solo,code,requestId:rid()})));assert.equal(raced.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(()=>create(f,host),e=>e.status===409);
});
test('all room mutations check revisions and duplicate request IDs cannot apply twice',async()=>{
 const f=fixture(),{tokens}=await lobby(f,2),room=await poll(f,tokens[0]),requestId=rid(),body={op:'ready',token:tokens[0],ready:true,revision:room.revision,requestId};
 const first=await f.call(body),second=await f.call(body);assert.equal(first.room.revision,second.room.revision);assert.equal(second.room.members.find(x=>x.id===room.meId).ready,true);
 await assert.rejects(()=>f.call({...body,requestId:rid(),ready:false}),e=>e.status===409&&e.code==='REVISION_CONFLICT');await assert.rejects(()=>f.call({...body,ready:false}),e=>e.status===409);
 await assert.rejects(()=>f.call({op:'ready',token:tokens[0],ready:false,revision:second.room.revision}),e=>e.status===400);
});
test('reserved object keys cannot be used as mutation receipt IDs',async()=>{
 const f=fixture(),token=await login(f,'A');for(const requestId of ['__proto__','constructor','prototype'])await assert.rejects(()=>f.call({op:'create',token,capacity:2,requestId}),e=>e.status===400);
 assert.equal(await poll(f,token),null);
});
test('one token racing two available rooms is admitted once, and six NAT clients can poll during mutations',async()=>{
 const f=fixture(),a=await login(f,'Host A'),b=await login(f,'Host B'),c=await login(f,'Joiner'),ra=await create(f,a,3),rb=await create(f,b,3);
 const result=await Promise.allSettled([ra.code,rb.code].map(code=>f.call({op:'join',token:c,code,requestId:rid()})));assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 const g=fixture(),{tokens}=await lobby(g,6);
 for(let i=0;i<35;i++){
  const room=await poll(g,tokens[0]);const batch=tokens.map(t=>poll(g,t));batch.push(g.call({op:'ready',token:tokens[0],ready:!!(i%2),revision:room.revision,requestId:rid()}));
  const responses=await Promise.all(batch);assert.equal(responses.at(-1).room.members.length,6);
 }
});
test('all six private projections reveal only the caller card, with criminal extras restricted',async()=>{
 const f=fixture(),{tokens}=await started(f);const views=await Promise.all(tokens.map(token=>poll(f,token)));let clues=0;
 for(const room of views){const g=room.game;assert.ok(g.self.id);assert.equal(g.secretNPC,undefined);assert.equal(g.liesUsed,undefined);assert.equal(g.guard,undefined);assert.equal(g.players.filter(x=>x.isDetective).length,1);assert.ok(room.members.every(m=>m.gameId));for(const p of g.players)assert.deepEqual(Object.keys(p).sort(),['id','isDetective','name']);clues+=g.self.clues.length;
  if(['culprit','accomplice'].includes(g.self.role)){assert.deepEqual(g.caseSecret,{suspectId:'s0',placeId:'p0'});assert.equal(g.remainingLies,2);assert.equal(g.partnerIds.length,1);}else{for(const key of ['caseSecret','remainingLies','partnerIds','sabotage'])assert.equal(g[key],undefined);}
 }
 assert.equal(clues,4);assert.equal(views.find(r=>r.game.self.role==='detective').game.self.clues.length,2);assert.notEqual(views[0].meId,views[0].game.self.id);
});
test('server overwrites both actor and speaker IDs and rejects out-of-turn actions',async()=>{
 const f=fixture(),{tokens}=await started(f,6);let views=await Promise.all(tokens.map(t=>poll(f,t))),owner=views[0].game.turnOwnerId,wrong=views.findIndex(v=>v.game.self.id!==owner);
 await assert.rejects(()=>mutate(f,tokens[wrong],'action',{event:{type:'ROLE_SEEN',actorId:owner}}),e=>e.status===403);
 await engineAction(f,tokens,{type:'ROLE_SEEN',actorId:'u999'});await finishPrivate(f,tokens);
 await engineAction(f,tokens,{type:'INVESTIGATE',kind:'pass',actorId:'u999'});
 const room=await poll(f,tokens[wrong]);await mutate(f,tokens[wrong],'action',{event:{type:'ADD_NOTE',speakerId:owner,text:'I speak for myself'}});const after=await poll(f,tokens[wrong]);assert.equal(after.game.notes.at(-1).speakerId,room.game.self.id);
});
test('gameplay cannot be joined, kicked, left, restarted or automatically transferred while playing',async()=>{
 const f=fixture(),{tokens,room}=await started(f,2),newcomer=await login(f,'Late');
 await assert.rejects(()=>f.call({op:'join',token:newcomer,code:room.code,requestId:rid()}),e=>e.status===409);
 for(const [token,op,extra] of [[tokens[0],'kick',{targetId:room.members[1].id}],[tokens[0],'restart',{}],[tokens[1],'leave',{}]])await assert.rejects(()=>mutate(f,token,op,extra),e=>e.status===409);
 f.advance(45000);const refreshed=await poll(f,tokens[0]);assert.equal(refreshed.members.length,2);assert.equal(refreshed.game.turnOwnerId,room.game.turnOwnerId);assert.equal(refreshed.members[1].online,false);
});
test('lobby leave transfers host and kick removes the room association without exposing tokens',async()=>{
 const f=fixture(),{tokens}=await lobby(f,3);await mutate(f,tokens[0],'leave');let room=await poll(f,tokens[1]);assert.equal(room.hostId,room.meId);assert.equal(room.members.length,2);assert.equal(await poll(f,tokens[0]),null);
 const target=room.members.find(x=>x.id!==room.meId);await mutate(f,tokens[1],'kick',{targetId:target.id});assert.equal(await poll(f,tokens[2]),null);room=await poll(f,tokens[1]);assert.equal(room.members.length,1);
});
test('a full six-player game completes five rounds, safely reveals results, and restarts to unready lobby',async()=>{
 const f=fixture(),{tokens,room:initial}=await started(f);let room;assert.match(initial.caseId,/^[0-9a-f-]{36}$/);
 for(let r=1;r<=5;r++){
  room=await finishPrivate(f,tokens);assert.equal(room.game.round,r);
  if(r===5)await assert.rejects(()=>engineAction(f,tokens,{type:'ACCUSE',suspectId:'s0',placeId:'p0'}),e=>e.code==='FINAL_INVESTIGATION_REQUIRED');
  await engineAction(f,tokens,{type:'INVESTIGATE',kind:'pass'});
  if(r<5)await engineAction(f,tokens,{type:'END_ROUND'});
 }
 await engineAction(f,tokens,{type:'REVIEW_RESULT',kind:'confirm'});room=(await engineAction(f,tokens,{type:'ACCUSE',suspectId:'s0',placeId:'p0'})).room;assert.equal(room.status,'finished');assert.equal(room.game.winner,'investigators');assert.deepEqual(room.game.reveal.secret,{suspectId:'s0',placeId:'p0'});
 await assert.rejects(()=>mutate(f,tokens[1],'restart'),e=>e.status===403);room=(await mutate(f,tokens[0],'restart')).room;assert.equal(room.status,'lobby');assert.equal(room.game,null);assert.equal(room.caseId,undefined);assert.ok(room.members.every(m=>!m.ready));
 for(const token of tokens)await mutate(f,token,'ready',{ready:true});room=(await mutate(f,tokens[0],'start')).room;assert.notEqual(room.caseId,initial.caseId);
});
test('review audit/confirm races are authenticated, idempotent, and cannot spend the kit or advance twice',async()=>{
 const f=fixture(),{tokens}=await started(f),views=await Promise.all(tokens.map(t=>poll(f,t)));let room=views[0];const c=views.findIndex(v=>v.game.self.role==='culprit'),d=views.findIndex(v=>v.game.self.role==='detective'),other=views.findIndex((v,i)=>i!==d);
 await mutate(f,tokens[other],'action',{event:{type:'ADD_NOTE',speakerId:views[d].game.self.id,text:'비공개 확인 중에도 내 이름으로 토론'}});room=await finishPrivate(f,tokens);
 room=(await mutate(f,tokens[d],'action',{event:{type:'INVESTIGATE',kind:'question',targetId:views[c].game.self.id,category:'coat',proposedValue:1}})).room;assert.equal(room.game.pending.proposedValue,1);
 await mutate(f,tokens[d],'action',{event:{type:'ADD_NOTE',speakerId:views[c].game.self.id,text:'답변을 기다리며 토론'}});room=await poll(f,tokens[d]);assert.equal(room.game.phase,'answer');assert.equal(room.game.notes.at(-1).speakerId,views[d].game.self.id);
 room=(await mutate(f,tokens[c],'action',{event:{type:'ANSWER',value:1}})).room;assert.equal(room.game.review.actualValue,undefined);
 await assert.rejects(()=>mutate(f,tokens[c],'action',{event:{type:'REVIEW_RESULT',kind:'audit'}}),e=>e.status===403);
 const audit={op:'action',token:tokens[d],revision:room.revision,requestId:rid(),event:{type:'REVIEW_RESULT',kind:'audit'}};const duplicated=await Promise.all([f.call(audit),f.call(audit)]);assert.ok(duplicated.every(r=>r.room.game.kits===0));room=await poll(f,tokens[d]);assert.equal(room.game.facts.length,1);assert.equal(room.game.review.actualValue,0);assert.equal(room.game.review.verified,true);
 const revision=room.revision;const confirmed=await Promise.allSettled([1,2].map(()=>f.call({op:'action',token:tokens[d],revision,requestId:rid(),event:{type:'REVIEW_RESULT',kind:'confirm'}})));assert.equal(confirmed.filter(r=>r.status==='fulfilled').length,1);assert.equal(confirmed.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);room=await poll(f,tokens[d]);assert.equal(room.game.round,2);assert.equal(room.game.review,null);
});
test('sessions expire after 24 hours while account rooms retain thirty days of inactivity',async()=>{
 const f=fixture(),token=await login(f,'A');await create(f,token,2);f.advance(23*3600000);assert.ok(await poll(f,token));f.advance(3600001);await assert.rejects(()=>poll(f,token),e=>e.status===401);
 const fresh=await login(f,'B');assert.equal(await poll(f,fresh),null);let doc=await f.backend.get('witness:world');assert.equal(Object.keys(doc.value.rooms).length,1);
 const recovered=await f.call({op:'login',name:'A',password:TEST_PASSWORD});assert.ok(recovered.room);f.advance(30*24*3600000);await f.call({op:'login',name:'A',password:TEST_PASSWORD});doc=await f.backend.get('witness:world');assert.equal(Object.keys(doc.value.rooms).length,0);
});
test('rate limits persist across service instances and never store raw IP addresses',async()=>{
 const f=fixture({rateLimit:3}),token=await login(f,'A');await poll(f,token);await poll(f,token);await assert.rejects(()=>poll(f,token),e=>e.status===429);
 const {service}=modules(),other=service.createService({store:f.backend,now:()=>1700000000000,sessionSecret:'test-session-secret',rateLimit:3});await assert.rejects(()=>other.handle({op:'poll',token},{ip:'127.0.0.1'}),e=>e.status===429);assert.ok(!JSON.stringify(await f.backend.get('witness:world')).includes('127.0.0.1'));
});
test('Supabase RPC store sends the guarded contract and never silently falls back in production',async()=>{
 const {store}=modules(),calls=[],remote=new store.SupabaseStore({url:'https://example.supabase.co',anonKey:'anon-test',secret:'server-only',fetchImpl:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>JSON.parse(init.body).p_op==='get'?{rev:4,value:{x:1}}:true};}});
 assert.deepEqual(await remote.get('test'),{rev:4,value:{x:1}});assert.equal(await remote.CAS('test',4,{x:2}),true);assert.equal(await remote.create('new',{x:3}),true);assert.ok(calls.every(x=>x.url.endsWith('/rest/v1/rpc/witness_store')));assert.equal(JSON.parse(calls[1].init.body).p_expected,4);assert.equal(calls[0].init.headers.apikey,'anon-test');
 assert.throws(()=>store.createStore({NODE_ENV:'production'}));
});
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(text){this.body=JSON.parse(text);}};}
test('API enforces POST, JSON body limit, same-origin and no-cache, without leaking storage errors',async()=>{
 const {handler}=modules(),f=fixture(),h=handler.createHandler(f.svc,{production:false});
 const call=async(req)=>{const res=response();await h({headers:{host:'localhost:3000','content-type':'application/json',origin:'http://localhost:3000'},socket:{remoteAddress:'test-ip'},body:{op:'register',name:'A',password:TEST_PASSWORD,requestId:rid()},method:'POST',...req},res);return res;};
 assert.equal((await call({method:'GET'})).statusCode,405);assert.equal((await call({headers:{host:'localhost:3000','content-type':'application/json',origin:'https://evil.example'}})).statusCode,403);assert.equal((await call({body:'x'.repeat(16385)})).statusCode,413);
 const success=await call({});assert.equal(success.statusCode,200);assert.match(success.headers['cache-control'],/no-store/);assert.ok(success.body.token);
 const broken=handler.createHandler({handle:async()=>{throw new Error('secret raw database password');}},{production:false}),res=response();await broken({method:'POST',headers:{host:'localhost','content-type':'application/json'},body:{op:'poll'},socket:{remoteAddress:'x'}},res);assert.equal(res.statusCode,503);assert.ok(!JSON.stringify(res.body).includes('database password'));
});
test('real HTTP requests receive JSON validation and body-limit responses without disconnecting',async()=>{
 const http=require('node:http'),{handler}=modules(),f=fixture(),server=http.createServer(handler.createHandler(f.svc,{production:false}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const valid=await fetch(origin+'/api/room',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({op:'register',name:'HTTP guest',password:TEST_PASSWORD})});assert.equal(valid.status,200);assert.ok((await valid.json()).token);
  const invalid=await fetch(origin+'/api/room',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{broken'});assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'INVALID_JSON');
  const large=await fetch(origin+'/api/room',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({text:'x'.repeat(20000)})});assert.equal(large.status,413);assert.ok((await large.json()).error);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

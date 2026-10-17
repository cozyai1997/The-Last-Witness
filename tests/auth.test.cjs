'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {MemoryStore}=require('../lib/store.cjs');
const {createService,WORLD_KEY}=require('../lib/game-service.cjs');
const Party=require('../lib/party-engine.cjs');
const DAY=86400000,PASS='Correct horse battery 42!';
let sequence=0;
const requestId=()=> 'auth-request-'+(++sequence);
function fixture(){let time=1700000000000;const store=new MemoryStore(),service=createService({store,now:()=>time,sessionSecret:'auth-test-secret',gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}}});return {store,service,advance(ms){time+=ms;},call(body,ip='192.0.2.10'){return service.handle(body,{ip});}};}
const register=(f,name,extra={})=>f.call({op:'register',name,password:PASS,...extra});
const login=(f,name,password=PASS)=>f.call({op:'login',name,password});
const poll=(f,token)=>f.call({op:'poll',token});
async function mutate(f,token,op,extra={}){const {room}=await poll(f,token);return f.call({op,token,revision:room?.revision,requestId:requestId(),...extra});}
async function legacyWorld(f,n=2){
 const sessions={},members=[],tokens=[];
 for(let i=0;i<n;i++){const token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex'),id='m_legacy'+i;tokens.push(token);sessions[hash]={id,name:'Guest '+i,roomCode:'ABC234',lastSeen:1700000000000,expiresAt:1700000000000+DAY,requests:{}};members.push({id,name:'Guest '+i,tokenHash:hash,ready:true,gameId:'u'+i});}
 let game=Party.makeGame(members.map(m=>m.name),{seed:17,secret:{suspectId:'s0',placeId:'p0'}});
 while(game.phase==='reveal')game=Party.act(game,{type:'ROLE_SEEN',actorId:Party.turnOwner(game)});
 while(game.phase==='secret')game=Party.act(game,{type:'SECRET_ACTION',actorId:Party.turnOwner(game),kind:'pass'});
 const world={version:1,sessions,rooms:{ABC234:{code:'ABC234',capacity:n,hostId:members[0].id,revision:3,status:'playing',members,game,expiresAt:1700000000000+DAY}},rates:{}};
 await f.store.create(WORLD_KEY,world);return {tokens,world};
}

test('password storage uses salted OWASP scrypt, never trims, and rejects invalid lengths',async()=>{
 assert.ok(fs.existsSync(path.join(__dirname,'../lib/passwords.cjs')),'password hashing module must exist');const P=require('../lib/passwords.cjs');
 const a=await P.hashPassword(PASS),b=await P.hashPassword(PASS);assert.equal(a.N,131072);assert.equal(a.r,8);assert.equal(a.p,1);assert.notEqual(a.salt,b.salt);assert.notEqual(a.hash,b.hash);assert.equal(await P.verifyPassword(PASS,a),true);assert.equal(await P.verifyPassword(PASS+' ',a),false);assert.equal(await P.verifyPassword('bad-password',a),false);assert.ok(!JSON.stringify(a).includes(PASS));
 for(const value of ['', 'short', 'x'.repeat(129), '😀'.repeat(129)])assert.throws(()=>P.validatePassword(value));
 assert.doesNotThrow(()=>P.validatePassword('😀'.repeat(128)));
 const spaced='  secret12  ';const hash=await P.hashPassword(spaced);assert.equal(await P.verifyPassword(spaced,hash),true);assert.equal(await P.verifyPassword(spaced.trim(),hash),false);
});
test('registration normalizes nicknames and atomically rejects normalization races',async()=>{
 const f=fixture(),results=await Promise.allSettled([register(f,' Ａlice '),register(f,'alice')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'NAME_TAKEN');
 const winner=results.find(x=>x.status==='fulfilled').value;assert.ok(winner.account.id.startsWith('m_'));assert.equal((await login(f,' ALICE ')).account.id,winner.account.id);
 const world=(await f.store.get(WORLD_KEY)).value;assert.equal(Object.keys(world.accounts).length,1);assert.match(Object.keys(world.accounts)[0],/^a_[0-9a-f]{64}$/);assert.ok(!JSON.stringify(world).includes(PASS));
});
test('scrypt admits two active jobs and twelve queued jobs, rejecting further work safely',async()=>{
 const P=require('../lib/passwords.cjs');assert.equal(P.MAX_JOBS,2);assert.equal(P.MAX_QUEUE,12);
 const results=await Promise.allSettled(Array.from({length:15},()=>P.hashPassword(PASS)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,14);const refused=results.filter(r=>r.status==='rejected');assert.equal(refused.length,1);assert.equal(refused[0].reason.code,'AUTH_BUSY');
});
test('login requires a password, emits generic invalid-credential errors and revokes the old token',async()=>{
 const f=fixture(),first=await register(f,'Alice');await assert.rejects(()=>f.call({op:'login',name:'Alice'}),e=>e.status===401&&e.code==='INVALID_CREDENTIALS');
 const errors=[];for(const [name,password] of [['Alice','Wrong password!'],['Missing','Wrong password!']])try{await login(f,name,password);}catch(e){errors.push({status:e.status,code:e.code,message:e.message});}
 assert.deepEqual(errors[0],errors[1]);const next=await login(f,'alice');assert.notEqual(next.token,first.token);assert.equal(next.account.id,first.account.id);await assert.rejects(()=>poll(f,first.token),e=>e.status===401);
 assert.equal((await poll(f,next.token)).account.name,'Alice');assert.ok(!JSON.stringify(next).includes('salt'));assert.ok(!JSON.stringify(next).includes('scrypt'));
});
test('legacy guest upgrade preserves exact playing identity and case; nickname alone cannot claim it',async()=>{
 const f=fixture(),{tokens}=await legacyWorld(f);const before=await poll(f,tokens[0]);assert.equal(before.account,null);
 const unrelated=await register(f,'Guest 0');assert.equal(unrelated.room,null);assert.notEqual(unrelated.account.id,before.room.meId);
 const upgraded=await register(f,'Saved Player',{token:tokens[0]});assert.equal(upgraded.account.id,before.room.meId);assert.equal(upgraded.room.meId,before.room.meId);assert.equal(upgraded.room.hostId,before.room.hostId);assert.equal(upgraded.room.game.self.id,before.room.game.self.id);assert.equal(upgraded.room.game.self.name,'Saved Player');
 const normalize=g=>{const value=structuredClone(g);value.players.forEach(p=>{p.name='';});value.self.name='';return value;};assert.deepEqual(normalize(upgraded.room.game),normalize(before.room.game));
 await assert.rejects(()=>poll(f,tokens[0]),e=>e.status===401);assert.equal((await poll(f,tokens[1])).account,null);
 const doc=(await f.store.get(WORLD_KEY)).value;assert.ok(doc.rooms.ABC234.expiresAt>=1700000000000+30*DAY);assert.equal(doc.accounts[Object.keys(doc.accounts).find(k=>doc.accounts[k].id===upgraded.account.id)].roomCode,'ABC234');
});
test('logout and session expiry preserve account seats, host and all game resources',async()=>{
 const f=fixture(),{tokens}=await legacyWorld(f);const upgraded=await register(f,'Host Account',{token:tokens[0]}),snapshot=upgraded.room;
 assert.deepEqual(await f.call({op:'logout',token:upgraded.token}),{room:null,account:null});await assert.rejects(()=>poll(f,upgraded.token),e=>e.status===401);
 let restored=await login(f,'host account');assert.deepEqual(restored.room.game,snapshot.game);assert.equal(restored.room.meId,snapshot.meId);assert.equal(restored.room.hostId,snapshot.hostId);
 f.advance(DAY+1);await assert.rejects(()=>poll(f,restored.token),e=>e.status===401);restored=await login(f,'Host Account');assert.deepEqual(restored.room.game,snapshot.game);assert.equal(restored.room.members.length,2);
 const doc=(await f.store.get(WORLD_KEY)).value;assert.equal(Object.keys(doc.accounts).length,1);assert.equal(doc.rooms.ABC234.members.length,2);
});
test('poll and login do not extend thirty-day retention; meaningful room mutations do',async()=>{
 const f=fixture(),a=await register(f,'A'),b=await register(f,'B');let room=(await mutate(f,a.token,'create',{capacity:2})).room;await f.call({op:'join',token:b.token,code:room.code,requestId:requestId()});
 const expiry=()=>f.store.get(WORLD_KEY).then(doc=>doc.value.rooms[room.code].expiresAt);const initial=await expiry();assert.equal(initial,1700000000000+30*DAY);
 f.advance(12*3600000);await poll(f,a.token);let recovered=await login(f,'A');assert.equal(await expiry(),initial);await mutate(f,recovered.token,'ready',{ready:true});const extended=await expiry();assert.equal(extended,initial+12*3600000);
 f.advance(31*DAY);recovered=await login(f,'A');assert.equal(recovered.room,null);assert.equal(Object.keys((await f.store.get(WORLD_KEY)).value.accounts).length,2);
});
test('per-account failed login reservations prevent races and reset only after the lock window',async()=>{
 const f=fixture();await register(f,'Target');const results=await Promise.allSettled(Array.from({length:8},(_,i)=>f.call({op:'login',name:'TARGET',password:'Wrong password!'},'198.51.100.'+i)));
 assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===401).length,5);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===429).length,3);
 await assert.rejects(()=>login(f,'Target'),e=>e.status===429);f.advance(15*60000+1);assert.ok((await login(f,'Target')).token);
});
test('one legacy token cannot register two accounts or leave a partial account after a rejected upgrade',async()=>{
 const f=fixture(),{tokens}=await legacyWorld(f),results=await Promise.allSettled(['First saved','Second saved'].map(name=>register(f,name,{token:tokens[0]})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const winner=results.find(r=>r.status==='fulfilled').value;assert.equal(winner.account.id,'m_legacy0');assert.equal(Object.keys((await f.store.get(WORLD_KEY)).value.accounts).length,1);
 await assert.rejects(()=>register(f,'Third saved',{token:winner.token}),e=>e.code==='ALREADY_REGISTERED');await assert.rejects(()=>register(f,'Invalid saved',{token:'x'.repeat(43)}),e=>e.status===401);
 assert.equal(Object.keys((await f.store.get(WORLD_KEY)).value.accounts).length,1);assert.equal((await poll(f,winner.token)).room.meId,'m_legacy0');
});
test('kick and voluntary leave clear persistent account room associations even after logout',async()=>{
 const f=fixture(),a=await register(f,'Host'),b=await register(f,'Member');const room=(await mutate(f,a.token,'create',{capacity:2})).room;
 await f.call({op:'join',token:b.token,code:room.code,requestId:requestId()});await f.call({op:'logout',token:b.token});
 await mutate(f,a.token,'kick',{targetId:b.account.id});let recovered=await login(f,'Member');assert.equal(recovered.room,null);assert.equal(recovered.account.id,b.account.id);
 await f.call({op:'join',token:recovered.token,code:room.code,requestId:requestId()});await mutate(f,a.token,'leave');assert.equal((await login(f,'Host')).room,null);
 recovered=await login(f,'Member');assert.equal(recovered.room.hostId,b.account.id);assert.equal(recovered.room.meId,b.account.id);
 const accounts=Object.values((await f.store.get(WORLD_KEY)).value.accounts);assert.equal(accounts.find(x=>x.id===a.account.id).roomCode,null);assert.equal(accounts.find(x=>x.id===b.account.id).roomCode,room.code);
});
test('six players can reauthenticate between rounds without changing role, secret, notes, seals or supplies',async()=>{
 const f=fixture(),{tokens}=await legacyWorld(f,6),names=[];
 for(let i=0;i<6;i++){names[i]='Saved '+i;tokens[i]=(await register(f,names[i],{token:tokens[i]})).token;}
 const roles=(await Promise.all(tokens.map(t=>poll(f,t)))).map(view=>view.room.game.self.role),criminal=roles.indexOf('culprit');
 for(let round=1;round<=5;round++){
  f.advance(60001);
  let views=await Promise.all(tokens.map(t=>poll(f,t)));let room=views[0].room;
  const owner=views.findIndex(v=>v.room.game.self.id===room.game.turnOwnerId);
  const investigation=round===2?{type:'INVESTIGATE',kind:'search',category:'coat'}:round===3||round===4?{type:'INVESTIGATE',kind:'question',targetId:views[criminal].room.game.self.id,category:round===3?'hand':'zone'}:{type:'INVESTIGATE',kind:'pass'};
  const investigated=await mutate(f,tokens[owner],'action',{event:investigation});
  if(investigated.room.game.phase==='answer')await mutate(f,tokens[criminal],'action',{event:{type:'ANSWER',value:1}});
  await mutate(f,tokens[(owner+1)%6],'action',{event:{type:'ADD_NOTE',text:'Round '+round}});
  views=await Promise.all(tokens.map(t=>poll(f,t)));
  for(let i=0;i<6;i++){const old=tokens[i],next=await login(f,names[i]);tokens[i]=next.token;assert.deepEqual(next.room.game,views[i].room.game);assert.equal(next.room.meId,views[i].room.meId);await assert.rejects(()=>poll(f,old),e=>e.status===401);}
  if(round===5)await mutate(f,tokens[owner],'action',{event:{type:'ACCUSE',suspectId:'s0',placeId:'p0'}});
  else{
   await mutate(f,tokens[owner],'action',{event:{type:'END_ROUND'}});room=(await poll(f,tokens[0])).room;
   while(room.game.phase==='secret'){const index=room.members.findIndex(m=>m.gameId===room.game.turnOwnerId),nextRound=round+1;
    const event=nextRound===2&&roles[index]==='culprit'?{type:'SECRET_ACTION',kind:'seal',category:'coat'}:nextRound===2&&roles[index]==='suspect'?{type:'SECRET_ACTION',kind:'guard',category:'coat'}:nextRound===3&&roles[index]==='accomplice'?{type:'SECRET_ACTION',kind:'seal',category:'hand'}:{type:'SECRET_ACTION',kind:'pass'};
    await mutate(f,tokens[index],'action',{event});room=(await poll(f,tokens[0])).room;}
  }
 }
 assert.equal((await poll(f,tokens[0])).room.game.winner,'investigators');
});

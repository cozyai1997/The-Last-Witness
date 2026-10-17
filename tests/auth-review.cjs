'use strict';
// Independent, controlled-race review. Runtime sources are never written.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs');
const repo=path.resolve(__dirname,'..');
const {createService,WORLD_KEY}=require(path.join(repo,'lib/game-service.cjs'));
const {MemoryStore}=require(path.join(repo,'lib/store.cjs'));
const Party=require(path.join(repo,'lib/party-engine.cjs'));
const Passwords=require(path.join(repo,'lib/passwords.cjs'));
const PASS='Independent Review!8723',DAY=86400000;
let sequence=0;const id=()=> 'review-request-'+(++sequence);
const delay=()=>new Promise(resolve=>setImmediate(resolve));
function latch(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
async function until(predicate){const deadline=Date.now()+10000;while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),'controlled race reached expected boundary');}
async function fixture(store=new MemoryStore(),n=2){
 let time=Date.now();const tokens=[],sessions={},members=[];
 for(let i=0;i<n;i++){const token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex'),memberId='m_auth_review_'+i;tokens.push(token);sessions[hash]={id:memberId,name:'Review '+i,roomCode:'ABC234',lastSeen:time,expiresAt:time+DAY,requests:{}};members.push({id:memberId,name:'Review '+i,tokenHash:hash,ready:true,gameId:'u'+i});}
 let game=Party.makeGame(members.map(m=>m.name),{seed:17,secret:{suspectId:'s0',placeId:'p0'}});
 while(game.phase==='reveal')game=Party.act(game,{type:'ROLE_SEEN',actorId:Party.turnOwner(game)});
 while(game.phase==='secret')game=Party.act(game,{type:'SECRET_ACTION',actorId:Party.turnOwner(game),kind:'pass'});
 await store.create(WORLD_KEY,{version:1,sessions,rooms:{ABC234:{code:'ABC234',capacity:n,hostId:members[0].id,revision:3,status:'playing',members,game,expiresAt:time+DAY}},rates:{}});
 const service=createService({store,now:()=>time,sessionSecret:'independent-review',rateLimit:10000});
 return{tokens,store,call:body=>service.handle(body,{ip:'192.0.2.7'}),advance:ms=>{time+=ms;}};
}
async function poll(f,token){return f.call({op:'poll',token});}
async function action(f,token,event){const {room}=await poll(f,token);return f.call({op:'action',token,event,revision:room.revision,requestId:id()});}
async function upgrade(f,index,name){return f.call({op:'register',token:f.tokens[index],name,password:PASS});}
function stateCore(g){return{phase:g.phase,round:g.round,turnOwnerId:g.turnOwnerId,kits:g.kits,statements:g.statements,facts:g.facts,log:g.log,notes:g.notes,pending:g.pending,secret:g.caseSecret,self:{id:g.self.id,role:g.self.role,clues:g.self.clues,shared:g.self.shared,sabotageLeft:g.self.sabotageLeft,guardLeft:g.self.guardLeft}};}
const reports=[];
(async()=>{
 // Hashing is intentionally held outside the CAS transaction. A legal game
 // action must survive and be included in the later guest-account conversion.
 {
  const f=await fixture(),originalHash=Passwords.hashPassword,gate=latch();let entered=0;
  Passwords.hashPassword=async password=>{entered++;await gate.promise;return originalHash(password);};
  try{
   const pending=upgrade(f,0,'Saved During Play');await until(()=>entered===1);
   const view=(await poll(f,f.tokens[0])).room,ownerIndex=view.members.findIndex(m=>m.gameId===view.game.turnOwnerId);
   await action(f,f.tokens[ownerIndex],{type:'INVESTIGATE',kind:'pass'});const afterAction=(await poll(f,f.tokens[0])).room;
   gate.resolve();const saved=await pending;assert.equal(saved.room.meId,afterAction.meId);assert.deepEqual(stateCore(saved.room.game),stateCore(afterAction.game));
   reports.push({check:'guest upgrade uses latest game state after hashing',passed:true});
  }finally{gate.resolve();Passwords.hashPassword=originalHash;}
 }
 // Two distinct names cannot both claim one legacy bearer seat.
 {
  const f=await fixture(),originalHash=Passwords.hashPassword,gate=latch();let entered=0;
  Passwords.hashPassword=async password=>{entered++;await gate.promise;return originalHash(password);};
  try{
   const first=upgrade(f,0,'First Race Name'),second=upgrade(f,0,'Second Race Name');const settled=Promise.allSettled([first,second]);await until(()=>entered===2);gate.resolve();const results=await settled;
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
   const winner=results.find(r=>r.status==='fulfilled').value,doc=(await f.store.get(WORLD_KEY)).value;
   assert.equal(Object.keys(doc.accounts).length,1);assert.equal(winner.account.id,'m_auth_review_0');assert.equal(doc.rooms.ABC234.members.length,2);assert.equal(doc.rooms.ABC234.members[0].id,winner.account.id);assert.ok(!JSON.stringify(doc).includes(PASS));
   await assert.rejects(()=>poll(f,f.tokens[0]),e=>e.status===401);
   reports.push({check:'dueling guest upgrades create exactly one account and one seat',passed:true});
  }finally{gate.resolve();Passwords.hashPassword=originalHash;}
 }
 // A token revoked while its password hash is being computed cannot finish
 // upgrading later, and failed conversion does not leave a partial account.
 {
  const f=await fixture(),before=(await poll(f,f.tokens[0])).room,originalHash=Passwords.hashPassword,gate=latch();let entered=0;
  Passwords.hashPassword=async password=>{entered++;await gate.promise;return originalHash(password);};
  try{
   const pending=upgrade(f,0,'Revoked Upgrade');const caught=pending.then(()=>null,e=>e);await until(()=>entered===1);await f.call({op:'logout',token:f.tokens[0]});gate.resolve();const error=await caught;assert.equal(error.status,401);
   const doc=(await f.store.get(WORLD_KEY)).value;assert.equal(Object.keys(doc.accounts).length,0);assert.equal(doc.rooms.ABC234.members[0].id,before.meId);assert.equal(doc.rooms.ABC234.game.phase,before.game.phase);
   reports.push({check:'logout during guest hashing rolls back account creation',passed:true});
  }finally{gate.resolve();Passwords.hashPassword=originalHash;}
 }
 // Force an old-token action to reach CAS, then commit a new login first.
 // Its stale CAS must retry authentication and fail, without spending a turn.
 {
  class HeldActionStore extends MemoryStore{
   constructor(){super();this.hold=false;this.entered=false;this.gate=latch();}
   async CAS(key,revision,value){if(this.hold&&value.rooms.ABC234?.game.phase==='discussion'){this.entered=true;await this.gate.promise;}return super.CAS(key,revision,value);}
  }
  const store=new HeldActionStore(),f=await fixture(store);let room=(await poll(f,f.tokens[0])).room;const ownerIndex=room.members.findIndex(m=>m.gameId===room.game.turnOwnerId),saved=await upgrade(f,ownerIndex,'Race Owner');
  const originalVerify=Passwords.verifyPassword,verifyGate=latch();let verifyEntered=false;
  Passwords.verifyPassword=async(password,record)=>{const value=await originalVerify(password,record);verifyEntered=true;await verifyGate.promise;return value;};
  try{
   const login=f.call({op:'login',name:'Race Owner',password:PASS});await until(()=>verifyEntered);
   room=(await poll(f,saved.token)).room;store.hold=true;
   const oldAction=f.call({op:'action',token:saved.token,event:{type:'INVESTIGATE',kind:'pass'},revision:room.revision,requestId:id()});const caught=oldAction.then(()=>null,e=>e);await until(()=>store.entered);
   verifyGate.resolve();const loggedIn=await login;assert.equal(loggedIn.room.game.phase,'investigate');store.gate.resolve();const error=await caught;assert.equal(error.status,401);
   const current=(await poll(f,loggedIn.token)).room;assert.equal(current.revision,room.revision);assert.equal(current.game.phase,'investigate');assert.deepEqual(current.game.facts,room.game.facts);
   reports.push({check:'stale old-token action cannot commit after new login',passed:true});
  }finally{verifyGate.resolve();store.gate.resolve();Passwords.verifyPassword=originalVerify;}
 }
 // Persisted account membership is independent of the 24-hour token lease.
 {
  const f=await fixture(undefined,6),saved=[];
  for(let i=0;i<6;i++)saved.push(await upgrade(f,i,'Private Account '+i));
  const before=saved.map(r=>r.room);f.advance(DAY+1);
  for(let i=0;i<6;i++){await assert.rejects(()=>poll(f,saved[i].token),e=>e.status===401);const recovered=await f.call({op:'login',name:'Private Account '+i,password:PASS});assert.equal(recovered.room.meId,before[i].meId);assert.equal(recovered.room.hostId,before[i].hostId);assert.deepEqual(recovered.room.game.self,before[i].game.self);
   const g=recovered.room.game,criminal=['culprit','accomplice'].includes(g.self.role);assert.equal(Object.hasOwn(g,'caseSecret'),criminal);assert.equal(Object.hasOwn(g,'partnerIds'),criminal);assert.equal(Object.hasOwn(g,'remainingLies'),criminal);assert.ok(g.players.every(p=>Object.keys(p).every(k=>['id','name','isDetective'].includes(k))));assert.ok(!JSON.stringify(recovered).includes('scrypt'));assert.ok(!JSON.stringify(recovered).includes('tokenHash'));assert.ok(!JSON.stringify(recovered).includes(PASS));}
  reports.push({check:'six expired sessions recover exact roles without other-role or hash leakage',passed:true});
 }
 const report={schemaVersion:1,recordedAt:new Date().toISOString(),scope:'Independent controlled-race and projection review, not a penetration test',storage:'Isolated in-memory test store; synthetic cases only',productionRequests:0,runtimeFilesModified:false,sourceSHA256:Object.fromEntries(['lib/passwords.cjs','lib/game-service.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')])),passed:true,checkCount:reports.length,reports};
 fs.mkdirSync(path.join(repo,'docs'),{recursive:true});fs.writeFileSync(path.join(repo,'docs/AUTH-SECURITY-REVIEW.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

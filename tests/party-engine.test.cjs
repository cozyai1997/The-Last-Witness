'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const enginePath=path.join(__dirname,'../lib/party-engine.cjs');
function api(){assert.ok(fs.existsSync(enginePath),'multiplayer engine must exist');return require(enginePath);}
const names=n=>Array.from({length:n},(_,i)=>'참가자 '+(i+1));
function make(n=6,seed=17,secret={suspectId:'s0',placeId:'p0'}){return api().makeGame(names(n),{seed,secret});}
function player(s,role){return s.players.find(p=>p.role===role);}
function reveal(s){const P=api();while(s.phase==='reveal')s=P.act(s,{type:'ROLE_SEEN',actorId:P.turnOwner(s)});return s;}
function prepare(s,choose=()=>({kind:'pass'})){const P=api();while(s.phase==='secret'){const actorId=P.turnOwner(s);s=P.act(s,{type:'SECRET_ACTION',actorId,...choose(s.players.find(p=>p.id===actorId),s)});}return s;}
function investigate(s,event){return api().act(s,{type:'INVESTIGATE',actorId:s.detectiveId,...event});}
function categoryValue(s,category){const P=api(),i=P.CATEGORIES.findIndex(c=>c.id===category);return i<3?P.SUSPECTS.find(x=>x.id===s.secretNPC.suspectId).bits[i]:P.PLACES.find(x=>x.id===s.secretNPC.placeId).bits[i-3];}
function assertTruthSurvives(s){assert.ok(api().candidates(api().publicView(s)).some(x=>x.suspectId===s.secretNPC.suspectId&&x.placeId===s.secretNPC.placeId));}

test('exports the multiplayer API, five rounds, and original 32 NPC worlds',()=>{
 const P=api();for(const k of ['makeGame','act','publicView','privateView','turnOwner','candidates'])assert.equal(typeof P[k],'function');
 assert.equal(P.MAX_ROUNDS,5);assert.equal(P.CATEGORIES.length,5);assert.equal(P.SUSPECTS.length*P.PLACES.length,32);
 assert.equal(P.ROLES.suspect.team,'investigators');assert.equal(P.ROLES.accomplice.label,'공범');
});
test('all 2–6 player packs have exactly the requested roles and exactly two distinct starting bits',()=>{
 const P=api();
 const packs={2:['detective','culprit'],3:['detective','culprit','witness'],4:['detective','culprit','witness','suspect'],5:['detective','culprit','witness','witness','suspect'],6:['detective','culprit','witness','witness','suspect','accomplice']};
 for(let n=2;n<=6;n++)for(let seed=0;seed<20;seed++){
  const s=make(n,seed);assert.deepEqual(s.players.map(p=>p.role).sort(),packs[n].slice().sort());
  assert.deepEqual(P.ROLE_PACKS[n].slice().sort(),packs[n].slice().sort());
  const clues=s.players.flatMap(p=>p.clues);assert.equal(clues.length,2);assert.equal(new Set(clues.map(c=>c.category)).size,2);
  for(const p of s.players){assert.equal(p.clues.length,p.role==='detective'?(n===2?2:n<5?1:0):p.role==='witness'?1:0);for(const c of p.clues)assert.equal(c.value,categoryValue(s,c.category));}
  assert.equal(s.kits,1);assert.equal(s.liesUsed,0);assert.equal(s.round,1);assert.equal(s.phase,'reveal');
 }
 assert.deepEqual(make(6,9),make(6,9));assert.notDeepEqual(make(6,9).players.map(p=>p.role),make(6,10).players.map(p=>p.role));
 assert.throws(()=>P.makeGame(names(1)));assert.throws(()=>P.makeGame(names(7)));assert.throws(()=>P.makeGame(['A',' ']));
});
test('roles can occupy every seat, and only the current seat can view private information',()=>{
 const P=api(),seats=new Map();
 for(let seed=0;seed<120;seed++){
  let s=make(6,seed);
  while(s.phase==='reveal'){
   const id=P.turnOwner(s),p=s.players.find(x=>x.id===id),v=P.privateView(s,id);assert.equal(v.self.role,p.role);
   seats.set(p.role,(seats.get(p.role)||new Set()).add(s.turnIndex));
   const other=s.players.find(x=>x.id!==id);assert.throws(()=>P.privateView(s,other.id));assert.throws(()=>P.act(s,{type:'ROLE_SEEN',actorId:other.id}));
   if(['culprit','accomplice'].includes(p.role)){assert.deepEqual(v.caseSecret,s.secretNPC);assert.equal(v.remainingLies,2);assert.deepEqual(v.partnerIds,s.players.filter(x=>x.id!==id&&['culprit','accomplice'].includes(x.role)).map(x=>x.id));}
   else {assert.equal(v.caseSecret,undefined);assert.equal(v.remainingLies,undefined);assert.equal(v.partnerIds,undefined);assert.equal(v.sabotage,undefined);}
   s=P.act(s,{type:'ROLE_SEEN',actorId:id});
  }
  assert.equal(s.phase,'secret');assert.equal(s.turnIndex,0);
 }
 for(const role of Object.keys(P.ROLES))assert.equal(seats.get(role).size,6,role+' must be shuffled among all seats');
});
test('public information never exposes private roles, clues, charges, secret, seals or guard',()=>{
 const P=api();let s=make();
 for(const stage of ['reveal','secret','investigate']){
  const v=P.publicView(s);for(const key of ['secretNPC','secret','liesUsed','sabotage','guard'])assert.equal(v[key],undefined);
  for(const p of v.players)assert.deepEqual(Object.keys(p).sort(),['id','isDetective','name']);
  assert.equal(v.players.filter(x=>x.isDetective).length,1);assert.equal(v.detectiveId,s.detectiveId);
  if(stage==='reveal')s=reveal(s);else if(stage==='secret')s=prepare(s);
 }
 assert.throws(()=>P.privateView(s,s.detectiveId));
});
test('secret shares are true, immutable facts; suggestions and passing do not create facts',()=>{
 const P=api();let s=reveal(make());const original=s;
 s=prepare(s,p=>p.clues.length?{kind:'share',category:p.clues[0].category}:{kind:'suggest',category:'coat'});
 assert.equal(s.facts.length,2);assert.equal(s.phase,'investigate');assert.equal(P.turnOwner(s),s.detectiveId);
 for(const f of s.facts){assert.equal(f.value,categoryValue(s,f.category));assert.equal(f.source,'share');assert.ok(f.speakerId);}
 assert.equal(original.facts.length,0);assert.ok(Object.isFrozen(s));assert.ok(Object.isFrozen(s.players[0].clues));assert.ok(Object.isFrozen(s.facts[0]));
 assert.throws(()=>{s.facts[0].value=1-s.facts[0].value;});assertTruthSurvives(s);
});
test('illegal or unaffordable secret choices do not advance or spend resources',()=>{
 const P=api();let s=reveal(make());
 while(s.phase==='secret'){
  const id=P.turnOwner(s),p=s.players.find(x=>x.id===id),before=JSON.stringify(s);
  const bad=p.role==='culprit'||p.role==='accomplice'?{kind:'guard',category:'coat'}:{kind:'seal',category:'coat'};
  assert.throws(()=>P.act(s,{type:'SECRET_ACTION',actorId:id,...bad}));assert.equal(JSON.stringify(s),before);
  assert.throws(()=>P.act(s,{type:'SECRET_ACTION',actorId:id,kind:'share',category:'invalid'}));
  s=P.act(s,{type:'SECRET_ACTION',actorId:id,kind:'pass'});
 }
 assert.throws(()=>P.act(s,{type:'SECRET_ACTION',actorId:s.detectiveId,kind:'pass'}));
});
test('C and A share one seal slot, charges persist, and a blocked search preserves the only kit',()=>{
 const P=api();let s=reveal(make()),sealer;
 s=prepare(s,(p,state)=>{
  if(['culprit','accomplice'].includes(p.role)){
   if(!state.sabotage){sealer=p.id;return {kind:'seal',category:'coat'};}
   assert.throws(()=>P.act(state,{type:'SECRET_ACTION',actorId:p.id,kind:'seal',category:'hand'}));
  }
  return {kind:'pass'};
 });
 const who=s.players.find(p=>p.id===sealer),remaining=who.role==='culprit'?1:0;assert.equal(who.sabotageLeft,remaining);
 const view=P.publicView(s);assert.equal(view.sabotage,undefined);
 s=investigate(s,{kind:'search',category:'coat'});assert.equal(s.phase,'discussion');assert.equal(s.kits,1);assert.equal(s.facts.length,0);
 assert.throws(()=>investigate(s,{kind:'search',category:'hand'}));
 s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});assert.equal(s.sabotage,null);assert.equal(s.guard,null);assert.equal(s.round,2);assert.equal(s.players.find(p=>p.id===sealer).sabotageLeft,remaining);
});
test('a single guard protects the named category without mutating official evidence',()=>{
 const P=api();let s=reveal(make()),usedSeal=false;
 s=prepare(s,p=>{
  if(['culprit','accomplice'].includes(p.role)&&!usedSeal){usedSeal=true;return {kind:'seal',category:'coat'};}
  if(p.role==='suspect')return {kind:'guard',category:'coat'};
  if(p.clues.length)return {kind:'share',category:p.clues[0].category};
  return {kind:'pass'};
 });
 const prior=JSON.parse(JSON.stringify(s.facts));assert.equal(player(s,'suspect').guardLeft,0);
 s=investigate(s,{kind:'search',category:'coat'});assert.equal(s.kits,0);assert.equal(s.phase,'discussion');assert.equal(s.facts.at(-1).source,'search');assert.equal(s.facts.at(-1).value,0);assert.deepEqual(s.facts.slice(0,prior.length),prior);
 s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});
 while(s.phase==='secret'){
  const id=P.turnOwner(s),p=s.players.find(x=>x.id===id);if(p.role==='suspect')assert.throws(()=>P.act(s,{type:'SECRET_ACTION',actorId:id,kind:'guard',category:'hand'}));
  s=P.act(s,{type:'SECRET_ACTION',actorId:id,kind:'pass'});
 }
 assert.throws(()=>investigate(s,{kind:'search',category:'hand'}));
});
test('questions target another human, consume one investigation, and only the target can answer',()=>{
 const P=api();let s=prepare(reveal(make()));const c=player(s,'culprit');
 assert.throws(()=>investigate(s,{kind:'question',category:'coat',targetId:s.detectiveId}));assert.throws(()=>investigate(s,{kind:'question',category:'coat',targetId:'s0'}));
 assert.throws(()=>P.act(s,{type:'INVESTIGATE',actorId:c.id,kind:'pass'}));
 s=investigate(s,{kind:'question',targetId:c.id,category:'coat'});assert.equal(s.phase,'answer');assert.equal(P.turnOwner(s),c.id);
 assert.equal(P.privateView(s,c.id).self.id,c.id);assert.deepEqual(P.publicView(s).pending,{targetId:c.id,category:'coat',proposedValue:0});
 assert.throws(()=>P.act(s,{type:'ANSWER',actorId:s.detectiveId,value:0}));assert.throws(()=>investigate(s,{kind:'pass'}));assert.throws(()=>P.act(s,{type:'ACCUSE',actorId:s.detectiveId,suspectId:'s0',placeId:'p0'}));
 s=P.act(s,{type:'ANSWER',actorId:c.id,value:1});assert.equal(s.phase,'discussion');assert.equal(s.pending,null);assert.equal(s.liesUsed,1);assert.equal(s.statements.length,1);
 assert.throws(()=>investigate(s,{kind:'pass'}));
});
test('honest roles must say unknown unless they own the clue or the truth is already public',()=>{
 const P=api();let s=prepare(reveal(make()));const w=player(s,'witness'),cat=P.CATEGORIES.find(c=>!w.clues.some(x=>x.category===c.id)).id;
 s=investigate(s,{kind:'question',targetId:w.id,category:cat});assert.throws(()=>P.act(s,{type:'ANSWER',actorId:w.id,value:0}));
 s=P.act(s,{type:'ANSWER',actorId:w.id,value:null});assert.equal(s.statements.length,0);assert.equal(s.liesUsed,0);assert.ok(s.log.some(x=>x.text.includes('모름')));
 s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});s=prepare(s,p=>p.clues.length?{kind:'share',category:p.clues[0].category}:{kind:'pass'});
 const known=s.facts[0],honest=player(s,'suspect');s=investigate(s,{kind:'question',targetId:honest.id,category:known.category});
 assert.throws(()=>P.act(s,{type:'ANSWER',actorId:honest.id,value:1-known.value}));s=P.act(s,{type:'ANSWER',actorId:honest.id,value:known.value});assert.equal(s.statements.length,1);
});
test('C and A share exactly two lies; neither may answer unknown',()=>{
 const P=api();let s=prepare(reveal(make()));const c=player(s,'culprit'),a=player(s,'accomplice');
 for(const target of [c,a,c]){
  s=investigate(s,{kind:'question',targetId:target.id,category:'coat'});assert.throws(()=>P.act(s,{type:'ANSWER',actorId:target.id,value:null}));
  if(s.liesUsed===2){assert.throws(()=>P.act(s,{type:'ANSWER',actorId:target.id,value:1}));s=P.act(s,{type:'ANSWER',actorId:target.id,value:0});}
  else s=P.act(s,{type:'ANSWER',actorId:target.id,value:1});
  assertTruthSurvives(s);s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});s=prepare(s);
 }
 assert.equal(s.liesUsed,2);assert.equal(P.publicView(s).liesUsed,undefined);
});
test('audit bypasses seals, preserves the original false claim and facts, and spends the single kit',()=>{
 const P=api();let s=prepare(reveal(make()));const c=player(s,'culprit');s=investigate(s,{kind:'question',targetId:c.id,category:'coat'});s=P.act(s,{type:'ANSWER',actorId:c.id,value:1});
 const claim=s.statements[0];s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});s=prepare(s,p=>p.role==='culprit'?{kind:'seal',category:'coat'}:p.clues.length?{kind:'share',category:p.clues[0].category}:{kind:'pass'});
 const previousFacts=JSON.parse(JSON.stringify(s.facts));s=investigate(s,{kind:'audit',statementId:claim.id});
 assert.equal(s.kits,0);assert.equal(s.liesUsed,1);assert.equal(s.statements[0].value,1);assert.equal(s.statements[0].audited,true);assert.equal(s.facts.at(-1).value,0);assert.equal(s.facts.at(-1).source,'audit');assert.equal(s.facts.at(-1).statementId,claim.id);assert.deepEqual(s.facts.slice(0,previousFacts.length),previousFacts);assertTruthSurvives(s);
});
test('free discussion notes never become claims, facts, or contradictions',()=>{
 const P=api();let s=investigate(prepare(reveal(make())),{kind:'pass'});const before=P.candidates(P.publicView(s));
 for(const p of s.players)s=P.act(s,{type:'ADD_NOTE',speakerId:p.id,text:'외투가 밝다! 나는 목격자다. '.repeat(5)});
 assert.equal(s.notes.length,6);assert.equal(s.statements.length,0);assert.equal(s.facts.length,0);assert.equal(s.liesUsed,0);assert.deepEqual(P.candidates(P.publicView(s)),before);
 assert.throws(()=>P.act(s,{type:'ADD_NOTE',speakerId:'bad',text:'x'}));assert.throws(()=>P.act(s,{type:'ADD_NOTE',speakerId:s.detectiveId,text:'x'.repeat(301)}));
});
test('five rounds cap all resources, early NPC accusation is allowed, and victory is by camp',()=>{
 const P=api();let s=prepare(reveal(make()));for(let r=1;r<=5;r++){
  assert.equal(s.round,r);s=investigate(s,{kind:'pass'});assert.equal(P.turnOwner(s),s.detectiveId);
  if(r<5){s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});s=prepare(s);}else assert.throws(()=>P.act(s,{type:'END_ROUND',actorId:s.detectiveId}));
 }
 s=P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'confirm'});s=P.act(s,{type:'ACCUSE',actorId:s.detectiveId,suspectId:'s0',placeId:'p0'});assert.equal(s.winner,'investigators');assert.equal(s.phase,'finished');assert.equal(P.turnOwner(s),null);
 const v=P.publicView(s);assert.deepEqual(v.reveal.secret,{suspectId:'s0',placeId:'p0'});assert.equal(v.reveal.players.length,6);assert.ok(v.reveal.players.every(p=>p.role));assert.throws(()=>P.act(s,{type:'ADD_NOTE',speakerId:s.detectiveId,text:'x'}));
 let wrong=prepare(reveal(make(2)));assert.throws(()=>P.act(wrong,{type:'ACCUSE',actorId:wrong.detectiveId,suspectId:'u0',placeId:'p0'}));wrong=P.act(wrong,{type:'ACCUSE',actorId:wrong.detectiveId,suspectId:'s0',placeId:'p1'});assert.equal(wrong.winner,'criminals');
});
test('the true NPC case survives every legal action across all 32 cases and all player packs',()=>{
 const P=api();let actions=0;
 for(let n=2;n<=6;n++)for(const suspect of P.SUSPECTS)for(const place of P.PLACES){
  let s=P.makeGame(names(n),{seed:53,secret:{suspectId:suspect.id,placeId:place.id}});s=reveal(s);assertTruthSurvives(s);
  for(let r=1;r<=5;r++){
   s=prepare(s,p=>p.clues.some(c=>!p.shared.includes(c.category))?{kind:'share',category:p.clues.find(c=>!p.shared.includes(c.category)).category}:{kind:'pass'});assertTruthSurvives(s);
   const cat=P.CATEGORIES[(r-1)%5].id,target=player(s,'culprit');s=investigate(s,{kind:'question',targetId:target.id,category:cat});assertTruthSurvives(s);
   s=P.act(s,{type:'ANSWER',actorId:target.id,value:categoryValue(s,cat)^(r<3?1:0)});assertTruthSurvives(s);actions++;
   if(r<5)s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});
  }
 }
 assert.equal(actions,800);
});
test('a sealed question consumes the round without an answer, and the wrong guard cannot protect it',()=>{
 const P=api();let s=reveal(make()),sealed=false;
 s=prepare(s,p=>{
  if(['culprit','accomplice'].includes(p.role)&&!sealed){sealed=true;return {kind:'seal',category:'coat'};}
  if(p.role==='suspect')return {kind:'guard',category:'hand'};
  if(p.clues.length)return {kind:'share',category:p.clues[0].category};
  return {kind:'pass'};
 });
 const facts=JSON.parse(JSON.stringify(s.facts)),c=player(s,'culprit');s=investigate(s,{kind:'question',targetId:c.id,category:'coat'});
 assert.equal(s.phase,'discussion');assert.equal(s.pending,null);assert.equal(s.statements.length,0);assert.equal(s.kits,1);assert.deepEqual(s.facts,facts);
 assert.throws(()=>P.act(s,{type:'ANSWER',actorId:c.id,value:0}));assert.throws(()=>P.act(s,{type:'ALTER_EVIDENCE',actorId:c.id,category:'coat',value:1}));
});
test('all three criminal-camp sabotage charges exhaust permanently without refreshing',()=>{
 const P=api();let s=reveal(make());
 for(let round=1;round<=5;round++){
  const desired=round<=2?'culprit':'accomplice';
  s=prepare(s,(p,state)=>{
   if(p.role===desired&&round<=3)return {kind:'seal',category:'coat'};
   if(round>=4&&['culprit','accomplice'].includes(p.role))assert.throws(()=>P.act(state,{type:'SECRET_ACTION',actorId:p.id,kind:'seal',category:'coat'}));
   return {kind:'pass'};
  });
  if(round>=3){assert.equal(player(s,'culprit').sabotageLeft,0);assert.equal(player(s,'accomplice').sabotageLeft,0);}
  s=investigate(s,{kind:'pass'});if(round<5)s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});
 }
});
test('a shared clue cannot be shared twice, while a later matching official fact is valid history',()=>{
 const P=api();let s=JSON.parse(JSON.stringify(make(2)));delete s.rulesVersion;s.facts=[];s.log=[];s.players.forEach(p=>{p.shared=[];});s=reveal(s);const d=player(s,'detective'),cat=d.clues[0].category;
 s=prepare(s);s=investigate(s,{kind:'search',category:cat,value:1-categoryValue(s,cat)});assert.equal(s.facts[0].value,categoryValue(s,cat));
 s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});s=prepare(s,p=>p.role==='detective'?{kind:'share',category:cat}:{kind:'pass'});assert.equal(s.facts.length,2);assert.equal(s.facts[0].value,s.facts[1].value);
 s=investigate(s,{kind:'pass'});s=P.act(s,{type:'END_ROUND',actorId:s.detectiveId});
 s=prepare(s,(p,state)=>{if(p.role==='detective')assert.throws(()=>P.act(state,{type:'SECRET_ACTION',actorId:p.id,kind:'share',category:cat}));return {kind:'pass'};});
 assert.equal(s.facts.length,2);assert.equal(s.kits,0);
});
test('the browser UMD API works without require and invalid seeds or NPC options are rejected',()=>{
 const vm=require('node:vm'),context={};vm.createContext(context);vm.runInContext(fs.readFileSync(enginePath,'utf8'),context);
 assert.equal(typeof context.WitnessParty.makeGame,'function');assert.equal(context.WitnessParty.makeGame(['가','나'],{seed:0}).players.length,2);
 const P=api();for(const seed of [-1,1.5,4294967296,'1'])assert.throws(()=>P.makeGame(names(2),{seed}));
 assert.throws(()=>P.makeGame(names(2),{secret:{suspectId:'u0',placeId:'p0'}}));assert.throws(()=>P.makeGame(names(2),{secret:{suspectId:'s0',placeId:'u1'}}));
});
test('new two-player games publish both starting clues and skip only detective secret turns',()=>{
 const P=api();
 for(let seed=0;seed<12;seed++){
  let s=make(2,seed),d=player(s,'detective'),c=player(s,'culprit');assert.equal(s.rulesVersion,2);assert.equal(s.facts.length,2);assert.equal(P.candidates(P.publicView(s)).length,8);assert.deepEqual(d.shared.slice().sort(),d.clues.map(x=>x.category).sort());
  s=reveal(s);assert.equal(P.turnOwner(s),c.id);assert.throws(()=>P.act(s,{type:'SECRET_ACTION',actorId:c.id,kind:'suggest',category:'coat'}));assert.throws(()=>P.act(s,{type:'SECRET_ACTION',actorId:c.id,kind:'share',category:d.clues[0].category}));
  s=P.act(s,{type:'SECRET_ACTION',actorId:c.id,kind:'pass'});assert.equal(s.phase,'investigate');s=investigate(s,{kind:'pass'});s=P.act(s,{type:'REVIEW_RESULT',actorId:d.id,kind:'confirm'});assert.equal(s.phase,'secret');assert.equal(P.turnOwner(s),c.id);assert.equal(s.review,null);
 }
});
test('flagless ongoing two-player games retain detective share and both private turns',()=>{
 const P=api();let s=JSON.parse(JSON.stringify(make(2)));delete s.rulesVersion;delete s.review;s.facts=[];s.log=[];s.players.forEach(p=>{p.shared=[];});s=reveal(s);let turns=0;
 while(s.phase==='secret'){const id=P.turnOwner(s),p=s.players.find(x=>x.id===id);s=P.act(s,{type:'SECRET_ACTION',actorId:id,kind:p.role==='detective'?'share':'suggest',category:p.role==='detective'?p.clues[0].category:'coat'});turns++;}
 assert.equal(turns,2);assert.equal(s.facts.length,1);assert.equal(s.phase,'investigate');
});
test('the immediate answer review can spend the single kit once without leaking the truth beforehand',()=>{
 const P=api();let s=prepare(reveal(make()));const c=player(s,'culprit');s=investigate(s,{kind:'question',targetId:c.id,category:'coat',proposedValue:1});assert.equal(s.pending.proposedValue,1);
 s=P.act(s,{type:'ANSWER',actorId:c.id,value:1});assert.equal(s.phase,'discussion');assert.deepEqual(P.publicView(s).review,{kind:'answer',round:1,category:'coat',targetId:c.id,statementId:'statement-1',value:1,verified:false,proposedValue:1});
 assert.throws(()=>P.act(s,{type:'REVIEW_RESULT',actorId:c.id,kind:'audit'}));assert.throws(()=>P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'audit',statementId:'wrong'}));
 s=P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'audit'});assert.equal(s.phase,'discussion');assert.equal(s.kits,0);assert.equal(s.review.value,1);assert.equal(s.review.actualValue,0);assert.equal(s.review.verified,true);assert.equal(s.statements[0].value,1);assert.equal(s.statements[0].audited,true);assert.equal(s.liesUsed,1);assert.equal(s.facts[0].value,0);assertTruthSurvives(s);
 assert.throws(()=>P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'audit'}));const old=s;s=P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'confirm'});assert.equal(s.round,2);assert.equal(s.phase,'secret');assert.equal(s.review,null);assert.equal(old.facts.length,1);assert.throws(()=>P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'confirm'}));
});
test('all investigation outcomes have public review summaries and fifth confirmation enters final',()=>{
 const P=api();let searched=investigate(prepare(reveal(make())),{kind:'search',category:'coat'});assert.equal(searched.review.kind,'search');assert.equal(searched.review.value,0);assert.equal(searched.review.verified,true);
 let blocked=prepare(reveal(make()),p=>p.role==='culprit'?{kind:'seal',category:'coat'}:{kind:'pass'});blocked=investigate(blocked,{kind:'question',category:'coat',targetId:player(blocked,'culprit').id});assert.equal(blocked.review.kind,'blocked');assert.equal(blocked.review.value,undefined);assert.equal(blocked.review.actualValue,undefined);
 let unknown=prepare(reveal(make())),w=player(unknown,'witness'),cat=P.CATEGORIES.find(x=>!w.clues.some(c=>c.category===x.id)).id;unknown=investigate(unknown,{kind:'question',category:cat,targetId:w.id});unknown=P.act(unknown,{type:'ANSWER',actorId:w.id,value:null});assert.equal(unknown.review.kind,'unknown');assert.equal(unknown.review.value,null);assert.equal(unknown.review.statementId,undefined);
 let s=prepare(reveal(make()));for(let round=1;round<=5;round++){s=investigate(s,{kind:'pass'});assert.equal(s.review.kind,'pass');s=P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'confirm'});if(round<5)s=prepare(s);}
 assert.equal(s.phase,'final');assert.equal(P.turnOwner(s),s.detectiveId);assert.equal(s.review.kind,'pass');assert.throws(()=>investigate(s,{kind:'pass'}));assert.throws(()=>P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'confirm'}));s=P.act(s,{type:'ACCUSE',actorId:s.detectiveId,suspectId:'s0',placeId:'p0'});assert.equal(s.winner,'investigators');
});
test('authenticated free discussion is nonfactual in every active phase including pending answers and final',()=>{
 const P=api();let s=make();const seen=new Set();
 function note(){const before=P.candidates(P.publicView(s)),pending=s.pending;s=P.act(s,{type:'ADD_NOTE',speakerId:s.players[0].id,text:'동시에 토론합니다.'});assert.deepEqual(P.candidates(P.publicView(s)),before);assert.deepEqual(s.pending,pending);seen.add(s.phase);}
 note();s=reveal(s);note();s=prepare(s);note();s=investigate(s,{kind:'question',category:'coat',targetId:player(s,'culprit').id});note();s=P.act(s,{type:'ANSWER',actorId:P.turnOwner(s),value:0});note();s=P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'confirm'});
 for(let r=2;r<=5;r++){s=prepare(s);s=investigate(s,{kind:'pass'});s=P.act(s,{type:'REVIEW_RESULT',actorId:s.detectiveId,kind:'confirm'});}note();assert.deepEqual([...seen].sort(),['answer','discussion','final','investigate','reveal','secret']);
 const forged=JSON.parse(JSON.stringify(s));forged.review={kind:'answer',round:5,category:'coat',value:1,verified:false,actualValue:0,secretNPC:forged.secretNPC};assert.equal(P.publicView(forged).review.actualValue,undefined);assert.equal(P.publicView(forged).review.secretNPC,undefined);
});

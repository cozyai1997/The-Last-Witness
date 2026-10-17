'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const enginePath = require('node:path').join(__dirname, '../lib/seven-engine.cjs');
function api() { assert.ok(fs.existsSync(enginePath), 'Seven engine must exist'); return require(enginePath); }
const names = n => Array.from({length:n}, (_, i) => '참가자' + i);
function make(n=6, seed=17, extra={}) { return api().makeGame(names(n), {seed, flowVersion:1, ...extra}); }
function role(s, kind) { return s.players.find(p => p.role === kind); }
function reveal(s) { const E=api(); while(s.phase==='reveal')s=E.act(s,{type:'ROLE_SEEN',actorId:E.turnOwner(s)});return s; }
function prepare(s, choose=()=>({kind:'pass'})) { const E=api();while(s.phase==='secret'){const actorId=E.turnOwner(s);s=E.act(s,{type:'SECRET_ACTION',actorId,...choose(s.players.find(p=>p.id===actorId),s)});}return s; }
function call(s, type, fields={}) { return api().act(s,{type,actorId:s.detectiveId,...fields}); }
function day(s, choose) { s=prepare(s,choose);s=call(s,'INVESTIGATE',{kind:'pass'});return call(s,'ROUND_CONFIRM'); }
function final(s) { while(s.phase!=='final')s=day(s);return s; }
function truthPresent(s) { return api().candidates(api().publicView(s)).some(c=>Object.keys(s.secretNPC).every(k=>c[k]===s.secretNPC[k])); }

test('every role pack assigns unique random characters and C is the actual culprit',()=>{
 const E=api(), signatures=new Set(), identities=new Set();
 for(let n=2;n<=6;n++)for(let seed=0;seed<50;seed++){
  const s=make(n,seed);assert.equal(s.rulesVersion,4);assert.equal(s.maxRounds,7);
  assert.deepEqual(s.players.map(p=>p.role).sort(),E.ROLE_PACKS[n].slice().sort());
  assert.equal(new Set(s.players.map(p=>p.characterId)).size,n);
  assert.equal(role(s,'culprit').characterId,s.secretNPC.suspectId);
  assert.equal(s.caseWorld.crime.suspectId,s.secretNPC.suspectId);
  for(const k of ['placeId','toolId','timeId'])assert.equal(s.caseWorld.crime[k],s.secretNPC[k]);
  const d=role(s,'detective');assert.equal(d.clues.length,2);assert.equal(E.CATEGORIES.find(c=>c.id===d.clues[0].category).group,'person');assert.equal(E.CATEGORIES.find(c=>c.id===d.clues[1].category).group,'place');
  s.players.filter(p=>p.role==='witness').forEach(p=>assert.equal(p.clues.length,1));
  signatures.add(s.players.map(p=>p.role).join(','));identities.add(s.players.map(p=>p.characterId).join(','));
  assert.ok(Object.isFrozen(s.players[0]));assert.ok(truthPresent(s));
 }
 assert.ok(signatures.size>15);assert.ok(identities.size>100);assert.equal(E.ROLES.suspect.team,'neutral');
 assert.throws(()=>make(6,1,{roleOrder:['culprit','culprit']}));
});

test('S identity stays private through 3→2→1 personal memories and reconnect',()=>{
 const E=api();let s=reveal(make());const S=role(s,'suspect'), original=s;
 let v=E.privateView(s,S.id);assert.equal(v.self.identity.known,false);assert.equal(v.self.identity.characterId,undefined);assert.equal(v.self.identity.candidates.length,3);
 assert.ok(v.self.identity.candidates.includes(S.characterId));
 s=day(s,p=>p.id===S.id?{kind:'memory'}:{kind:'pass'});v=E.privateView(s,S.id);assert.equal(v.self.identity.candidates.length,2);assert.equal(v.self.identity.characterId,undefined);
 s=day(s,p=>p.id===S.id?{kind:'memory'}:{kind:'pass'});v=E.privateView(JSON.parse(JSON.stringify(s)),S.id);
 assert.equal(v.self.identity.candidates.length,1);assert.equal(v.self.identity.characterId,S.characterId);assert.equal(v.self.identity.memoryLeft,0);
 assert.equal(E.privateView(original,S.id).self.identity.candidates.length,3);
 const pub=E.publicView(s);assert.equal(pub.reveal,undefined);assert.equal(pub.caseWorld,undefined);assert.equal(pub.replay,undefined);assert.equal(pub.secretNPC,undefined);
 for(const p of pub.players)assert.deepEqual(Object.keys(p).sort(),['id','isDetective','name']);
 for(const p of s.players.filter(p=>p.id!==S.id))assert.equal(E.privateView(s,p.id).self.sealedReport,undefined);
 assert.ok(pub.log.filter(l=>l.type==='personal').every(l=>l.text==='개인 행동을 마쳤습니다.'));
});

test('seven days require every official investigation and confirmation before accusation',()=>{
 const E=api();let s=reveal(make(2));
 for(let round=1;round<=7;round++){
  assert.equal(s.round,round);assert.throws(()=>call(s,'ACCUSE',s.secretNPC));
  s=prepare(s);assert.equal(s.phase,'investigate');assert.throws(()=>call(s,'ACCUSE',s.secretNPC));
  s=call(s,'INVESTIGATE',{kind:'pass'});assert.equal(s.phase,'discussion');assert.throws(()=>call(s,'ACCUSE',s.secretNPC));
  s=call(s,'ROUND_CONFIRM');
 }
 assert.equal(s.phase,'final');s=call(s,'ACCUSE',s.secretNPC);assert.equal(s.phase,'finished');assert.equal(s.winner,'investigators');
 assert.equal(E.publicView(s).reveal.replay.events.filter(e=>e.type==='round-confirm').length,7);
});

test('sealed reports accept self/unassigned identically, lock once, close on DAY6 personal turn',()=>{
 const E=api();for(const choice of ['self','unused','correct']){
  let s=reveal(make());const S=role(s,'suspect'), chosen=choice==='self'?S.characterId:choice==='correct'?s.secretNPC.suspectId:E.SUSPECTS.find(c=>!s.players.some(p=>p.characterId===c.id)).id;
  s=day(s,p=>p.id===S.id?{kind:'report',suspectId:chosen,text:'동선과 기억을 대조했습니다.'}:{kind:'pass'});
  const v=E.privateView(s,S.id);assert.deepEqual(v.self.sealedReport,{suspectId:chosen,text:'동선과 기억을 대조했습니다.',round:1});assert.equal(v.self.sealedReport.correct,undefined);
  assert.equal(E.publicView(s).sealedReport,undefined);assert.equal(v.log.some(l=>/제보/.test(l.text)),false);
  assert.throws(()=>prepare(s,p=>p.id===S.id?{kind:'report',suspectId:'s0',text:'수정'}:{kind:'pass'}));
 }
 let s=reveal(make());while(s.round<6)s=day(s);const S=role(s,'suspect');s=day(s,p=>p.id===S.id?{kind:'report',suspectId:'s0',text:'마감 제보'}:{kind:'pass'});assert.equal(E.privateView(s,S.id).self.sealedReport.round,6);
 s=reveal(make());while(s.round<7)s=day(s);assert.throws(()=>prepare(s,p=>p.role==='suspect'?{kind:'report',suspectId:'s0',text:'늦은 제보'}:{kind:'pass'}));
});

test('S false accusation loss has priority; correct private report wins independently of C',()=>{
 const E=api();for(const report of ['correct','wrong','none'])for(const accuse of ['S','correct','other']){
  let s=reveal(make());const S=role(s,'suspect');
  if(report!=='none')s=day(s,p=>p.id===S.id?{kind:'report',suspectId:report==='correct'?s.secretNPC.suspectId:S.characterId,text:'비공개 추적'}:{kind:'pass'});
  s=final(s);const charge={suspectId:accuse==='S'?S.characterId:accuse==='other'?E.SUSPECTS.find(c=>c.id!==S.characterId&&c.id!==s.secretNPC.suspectId).id:s.secretNPC.suspectId};
  s=call(s,'ACCUSE',charge);const v=E.publicView(s),want=accuse==='S'?'loss':report==='correct'?'win':'survived';assert.equal(v.reveal.suspectResult.status,want,report+'/'+accuse);
  assert.equal(v.reveal.suspectResult.earlyTracking,want==='win');assert.equal(v.winner,accuse==='correct'?'investigators':'criminals');
  assert.deepEqual(v.reveal.secretNPC,s.secretNPC);assert.equal(v.reveal.players.find(p=>p.id===S.id).characterId,S.characterId);
 }
});

test('final accusation needs only a person, and scene/tool/time remain linked evidence',()=>{
 const E=api();let s=final(reveal(make()));s=call(s,'ACCUSE',{suspectId:s.secretNPC.suspectId});assert.equal(s.winner,'investigators');assert.deepEqual(s.accusation,{suspectId:s.secretNPC.suspectId});
 assert.deepEqual(E.CATEGORIES.find(c=>c.id==='zone').values,['본관','별관','옥외']);
 for(let seed=0;seed<30;seed++){
  const g=make(6,seed),v=E.publicView(g);assert.ok(v.fieldReference);assert.deepEqual(E.privateView(g,g.detectiveId).fieldReference,v.fieldReference);
  assert.equal(E.PLACES.length,12);assert.equal(E.TOOLS.length,12);assert.equal(E.TIMES.length,12);
  const feasible=E.candidates(v);assert.ok(feasible.length<20736);assert.ok(feasible.some(c=>Object.keys(g.secretNPC).every(k=>c[k]===g.secretNPC[k])));
  for(const event of g.caseWorld.events)assert.ok(feasible.some(c=>Object.keys(c).every(k=>event[k]===c[k])),'every actual event must obey public possible ranges');
  for(const person of v.fieldReference.people){assert.equal(person.placeIds.length,6);assert.equal(person.toolIds.length,6);assert.equal(person.timeIds.length,6);assert.equal(person.routes.length,6);assert.equal(new Set(person.routes.map(r=>[r.placeId,r.toolId,r.timeId].join('/'))).size,6);if(E.SUSPECTS.find(p=>p.id===person.suspectId).access===0)assert.ok(person.placeIds.every(id=>E.PLACES.find(p=>p.id===id).entry===0),'general access cannot permit staff entry');}
  const d=E.privateView(g,g.detectiveId);assert.ok(!E.candidates(d).some(c=>c.suspectId===d.self.identity.characterId));assert.ok(E.candidates(d).length<feasible.length);
 }
 assert.throws(()=>make(6,1,{secret:{suspectId:'s0',placeId:'p1'}}),'incompatible forced crime coordinates must be rejected');
});

test('C and A cannot stack two seals in one day even on different categories',()=>{
 const E=api();let s=reveal(make(6,4,{roleOrder:['detective','culprit','witness','witness','suspect','accomplice']}));
 s=E.act(s,{type:'SECRET_ACTION',actorId:'u0',kind:'pass'});s=E.act(s,{type:'SECRET_ACTION',actorId:'u1',kind:'seal',category:'tool'});
 for(const actorId of ['u2','u3','u4'])s=E.act(s,{type:'SECRET_ACTION',actorId,kind:'pass'});
 assert.throws(()=>E.act(s,{type:'SECRET_ACTION',actorId:'u5',kind:'seal',category:'time'}));assert.equal(E.privateView(s,'u5').self.sabotageLeft,1);
});

test('every permitted person/place pairing supports the twelfth tool and time without invalid worlds',()=>{
 const E=api();for(const person of E.SUSPECTS)for(const place of E.PLACES){
  if(person.access===0&&place.entry===1)continue;
  const s=make(6,531,{secret:{suspectId:person.id,placeId:place.id,toolId:'t11',timeId:'time11'}});
  assert.ok(truthPresent(s));assert.equal(E.caseValue(s.secretNPC,'tool'),11);assert.equal(E.caseValue(s.secretNPC,'time'),11);
  const all=s.caseWorld.records.map(r=>({...r,source:'record'})),pub={...E.publicView(s),facts:all},pri={...E.privateView(s,s.detectiveId),facts:all};
  assert.ok(new Set(E.candidates(pub).map(c=>c.suspectId)).size>=3);assert.ok(new Set(E.candidates(pri).map(c=>c.suspectId)).size>=2);assert.ok(E.candidates(pri).some(c=>c.suspectId===role(s,'suspect').characterId));
 }
});

test('partial original records stay truthful, preserve multiple people including C and S, and cannot be farmed',()=>{
 const E=api();for(let seed=0;seed<60;seed++){
  let s=reveal(make(6,seed));const S=role(s,'suspect');const oldFacts=[];
  for(const record of E.RECORDS){s=prepare(s);s=call(s,'SEARCH',{recordId:record.id});oldFacts.push(s.facts[s.facts.length-1]);assert.ok(truthPresent(s));s=call(s,'ROUND_CONFIRM');}
  const view=E.publicView(s),cs=E.candidates(view),people=new Set(cs.map(c=>c.suspectId));assert.ok(people.size>=3);assert.ok(people.has(S.characterId));
  const privatePeople=new Set(E.candidates(E.privateView(s,s.detectiveId)).map(c=>c.suspectId));assert.ok(privatePeople.size>=2,'five originals plus initial private hints must preserve an interview choice');assert.ok(privatePeople.has(S.characterId),'initial scene memory plus all originals must not automatically clear S');
  s=prepare(s);assert.throws(()=>call(s,'SEARCH',{recordId:E.RECORDS[0].id}),/이미 확보/);assert.deepEqual(s.facts.slice(0,5),oldFacts);assert.equal(s.facts.length,5);
  assert.ok(s.facts.every(f=>f.source==='record'&&f.allowedValues.includes(E.caseValue(s.secretNPC,f.category))));
 }
});

test('truth-only knowledge, shared lies/refusal, and audit verdicts never reveal direct corrected values',()=>{
 const E=api();let s=reveal(make());const C=role(s,'culprit'),A=role(s,'accomplice'),W=role(s,'witness');
 const category=W.clues[0].category, truth=W.clues[0].value;s=prepare(s);s=call(s,'QUESTION',{targetId:W.id,category,proposedValue:truth});
 assert.throws(()=>E.act(s,{type:'ANSWER',actorId:W.id,value:1-truth}));assert.throws(()=>E.act(s,{type:'ANSWER',actorId:W.id,value:null}));s=E.act(s,{type:'ANSWER',actorId:W.id,value:truth});s=call(s,'ROUND_CONFIRM');
 for(const target of [C,A]){s=prepare(s);s=call(s,'QUESTION',{targetId:target.id,category:'tool',proposedValue:0});const wrong=(E.caseValue(s.secretNPC,'tool')+1)%4;s=E.act(s,{type:'ANSWER',actorId:target.id,value:wrong});if(target===C){s=call(s,'REVIEW_AUDIT');const f=s.facts.at(-1);assert.equal(f.isTrue,false);assert.equal(f.value,undefined);assert.equal(s.review.actualValue,undefined);assert.equal(s.kits,0);}s=call(s,'ROUND_CONFIRM');}
 assert.equal(E.privateView(s,C.id).remainingLies,0);s=prepare(s);s=call(s,'QUESTION',{targetId:C.id,category:'tool'});assert.throws(()=>E.act(s,{type:'ANSWER',actorId:C.id,value:(E.caseValue(s.secretNPC,'tool')+1)%4}));s=E.act(s,{type:'ANSWER',actorId:C.id,value:null});assert.equal(E.privateView(s,A.id).remainingRefusals,0);s=call(s,'ROUND_CONFIRM');s=prepare(s);s=call(s,'QUESTION',{targetId:A.id,category:'tool'});assert.throws(()=>E.act(s,{type:'ANSWER',actorId:A.id,value:null}));
});

test('seals preserve raw records, expire, and guards bypass them while memory is unblocked',()=>{
 const E=api();let s=reveal(make());const C=role(s,'culprit'),S=role(s,'suspect'), rec=s.caseWorld.records[0];
 s=prepare(s,p=>p.id===C.id?{kind:'seal',category:rec.category}:p.id===S.id?{kind:'memory'}:{kind:'pass'});s=call(s,'SEARCH',{recordId:rec.recordId});assert.equal(s.review.kind,'blocked');assert.equal(s.facts.length,0);assert.equal(E.privateView(s,S.id).self.identity.candidates.length,2);
 s=call(s,'ROUND_CONFIRM');s=prepare(s,p=>p.id===C.id?{kind:'seal',category:rec.category}:p.id===S.id?{kind:'guard',category:rec.category}:{kind:'pass'});s=call(s,'SEARCH',{recordId:rec.recordId});assert.equal(s.review.kind,'search');assert.equal(s.facts.length,1);assert.equal(s.facts[0].value,rec.allowedValues[0]);assert.ok(truthPresent(s));
});

test('invalid actor/input cannot mutate states and finished replay is complete and identical per seat',()=>{
 const E=api();let s=reveal(make());const saved=JSON.stringify(s);assert.throws(()=>E.act(s,{type:'SECRET_ACTION',actorId:'forged',kind:'memory'}));assert.throws(()=>E.act(s,{type:'ADD_NOTE',actorId:E.turnOwner(s),text:' '}));assert.equal(JSON.stringify(s),saved);
 const S=role(s,'suspect');s=day(s,p=>p.id===S.id?{kind:'suggest',suspectId:'s11',text:'정체 메모'}:{kind:'pass'});assert.equal(E.privateView(s,S.id).self.identity.known,false);assert.equal(E.publicView(s).identityGuess,undefined);
 s=final(s);s=call(s,'ACCUSE',s.secretNPC);const replay=E.publicView(s).reveal.replay;assert.equal(replay.version,2);assert.equal(replay.source,'recorded');assert.equal(replay.complete,true);assert.ok(replay.events.some(e=>e.type==='identity-guess'));assert.ok(replay.events.some(e=>e.type==='accusation'));
 for(const p of s.players)assert.deepEqual(E.privateView(s,p.id).reveal.replay,replay);assert.throws(()=>call(s,'ROUND_CONFIRM'));
});

test('private policies cannot read S hidden identity through errors, report receipts, logs or saved projections',()=>{
 const E=api();let included=0,excluded=0;const pairs=new Set(), peersByC=new Map();
 for(let seed=0;seed<120;seed++){
  const s=make(6,seed),S=role(s,'suspect'),sv=E.privateView(s,S.id),serialized=JSON.stringify(sv);
  assert.equal(sv.self.identity.characterId,undefined);assert.equal(sv.self.characterId,undefined);assert.equal(sv.self.identity.eliminationOrder,undefined);assert.equal(sv.caseSecret,undefined);assert.equal(sv.remainingLies,undefined);assert.equal(sv.partnerIds,undefined);
  assert.equal(sv.caseWorld,undefined);assert.equal(sv.seals,undefined);assert.equal(sv.replayEvents,undefined);assert.equal(sv.reveal,undefined);
  const pub=E.publicView(JSON.parse(JSON.stringify(s)));assert.deepEqual(pub,E.publicView(s));assert.equal(serialized.includes('eliminationOrder'),false);
  sv.self.identity.candidates.includes(s.secretNPC.suspectId)?included++:excluded++;
  pairs.add(s.caseWorld.resemblance.categories.slice().sort().join(','));
  if(!peersByC.has(s.secretNPC.suspectId))peersByC.set(s.secretNPC.suspectId,new Set());peersByC.get(s.secretNPC.suspectId).add(S.characterId);
 }
 assert.ok(included>0);assert.ok(excluded>0);assert.ok(pairs.size>=4);assert.ok([...peersByC.values()].every(set=>set.size>=2));
});

test('unknown and blocked questions remain retryable, official facts survive rejected forged actions',()=>{
 const E=api();let s=reveal(make());const W=role(s,'witness'),unknown=E.CATEGORIES.find(c=>c.id!==W.clues[0].category&&c.id==='tool')||E.CATEGORIES.find(c=>c.id!==W.clues[0].category);
 s=prepare(s);s=call(s,'QUESTION',{targetId:W.id,category:unknown.id});s=E.act(s,{type:'ANSWER',actorId:W.id,value:null});assert.equal(s.review.kind,'unknown');s=call(s,'ROUND_CONFIRM');s=prepare(s);s=call(s,'QUESTION',{targetId:W.id,category:unknown.id});assert.equal(s.phase,'answer');s=E.act(s,{type:'ANSWER',actorId:W.id,value:null});s=call(s,'ROUND_CONFIRM');s=prepare(s);s=call(s,'SEARCH',{recordId:'portrait'});
 const facts=s.facts;for(const bad of [{type:'SEARCH',recordId:'__proto__'},{type:'AUDIT',statementId:'missing'},{type:'ANSWER',value:999},{type:'ROUND_CONFIRM',actorId:W.id},{type:'ADD_NOTE',text:{toString:()=>'<script>'}},{type:'ACCUSE',suspectId:'s0'}]){
  assert.throws(()=>E.act(s,{actorId:s.detectiveId,...bad}));assert.deepEqual(s.facts,facts);
 }
 s=call(s,'ROUND_CONFIRM');s=prepare(s);assert.throws(()=>call(s,'SEARCH',{recordId:'portrait',value:100,allowedValues:[100],source:'forged'}),/이미 확보/);assert.deepEqual(s.facts,facts);
});

function policyRandom(seed) { let x=(seed+1)>>>0;return()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296;}; }
function policyRank(E,view,rng) {
 const possible=E.candidates(view),groups=new Map();
 for(const c of possible){
  let score=0;
  for(const s of view.statements)score+=E.caseValue(c,s.category)===s.value?1:0;
  for(const n of view.notes){const match=/^관찰:([a-z]+):(\d+)$/.exec(n.text);if(match&&E.CATEGORIES.some(k=>k.id===match[1]))score+=E.caseValue(c,match[1])===Number(match[2])?.25:0;}
  groups.set(c.suspectId,Math.max(groups.get(c.suspectId)??-Infinity,score));
 }
 const best=Math.max(...groups.values()),ties=[...groups].filter(([,score])=>score===best).map(([id])=>id);
 return ties.length?ties[Math.floor(rng()*ties.length)]:E.SUSPECTS[Math.floor(rng()*E.SUSPECTS.length)].id;
}
function projectedPolicyAudit(E,seeds) {
 const summary={seedsPerPlayerCount:seeds,playerCounts:[2,3,4,5,6],runsPerPolicy:seeds*5,policies:{},invariants:{illegalActions:0,truthEliminated:0,activeProjectionLeaks:0},sourceSweep:{cases:0,minimumPublicPeople:12,maximumPublicPeople:0,uniquePublicPeople:0,SRetained:0,minimumDetectivePrivatePeople:12,uniqueDetectivePrivatePeople:0,detectivePrivateSRetained:0},sourceAblations:Object.fromEntries(['place','tool','time'].map(id=>[id,{cases:0,changedPersonSets:0,restoredPeople:0}])),recordAblations:Object.fromEntries(E.RECORDS.map(r=>[r.id,{cases:0,changedPersonSets:0,restoredPeople:0}])),SInitial:{cases:0,containsC:0,doesNotContainC:0},resemblancePairs:[]};
 const pairs=new Set();
 for(let seed=0;seed<seeds;seed++)for(let n=2;n<=6;n++){
  const start=make(n,seed),S=role(start,'suspect');pairs.add(start.caseWorld.resemblance.categories.slice().sort().join(','));
  const allRecords=start.caseWorld.records.map((r,i)=>({id:'probe'+i,category:r.category,allowedValues:r.allowedValues,source:'record',recordId:r.recordId}));
  const cs=E.candidates({...E.publicView(start),facts:allRecords}),ids=new Set(cs.map(c=>c.suspectId));summary.sourceSweep.cases++;summary.sourceSweep.minimumPublicPeople=Math.min(summary.sourceSweep.minimumPublicPeople,ids.size);summary.sourceSweep.maximumPublicPeople=Math.max(summary.sourceSweep.maximumPublicPeople,ids.size);if(ids.size===1)summary.sourceSweep.uniquePublicPeople++;
  const privateIds=new Set(E.candidates({...E.privateView(start,start.detectiveId),facts:allRecords}).map(c=>c.suspectId));summary.sourceSweep.minimumDetectivePrivatePeople=Math.min(summary.sourceSweep.minimumDetectivePrivatePeople,privateIds.size);if(privateIds.size===1)summary.sourceSweep.uniqueDetectivePrivatePeople++;
  const fullView={...E.privateView(start,start.detectiveId),facts:allRecords};
  function countAblation(view,metric){const withoutIds=new Set(E.candidates(view).map(c=>c.suspectId)),restored=[...withoutIds].filter(id=>!privateIds.has(id));metric.cases++;if(restored.length)metric.changedPersonSets++;metric.restoredPeople+=restored.length;}
  for(const group of ['place','tool','time']){const groupOf=f=>E.CATEGORIES.find(c=>c.id===f.category)?.group;countAblation({...fullView,facts:fullView.facts.filter(f=>groupOf(f)!==group),self:{...fullView.self,clues:fullView.self.clues.filter(c=>groupOf(c)!==group)}},summary.sourceAblations[group]);}
  for(const record of E.RECORDS)countAblation({...fullView,facts:fullView.facts.filter(f=>f.recordId!==record.id)},summary.recordAblations[record.id]);
  if(S){summary.SInitial.cases++;E.privateView(start,S.id).self.identity.candidates.includes(start.secretNPC.suspectId)?summary.SInitial.containsC++:summary.SInitial.doesNotContainC++;if(ids.has(S.characterId))summary.sourceSweep.SRetained++;if(privateIds.has(S.characterId))summary.sourceSweep.detectivePrivateSRetained++;}
  for(const policy of ['originals-first','verified-observations-first']){
   const rng=policyRandom(seed*7+n),metrics=summary.policies[policy]||(summary.policies[policy]={games:0,detectiveWins:0,criminalWins:0,SWin:0,SLoss:0,SSurvived:0,questions:0,audits:0,searches:0,blocked:0,finalPeopleTotal:0,uniqueFinalPeople:0});let s=start;
   while(s.phase!=='finished'){
    const owner=E.turnOwner(s),v=E.privateView(s,owner),self=v.self;let event;
    if(v.caseWorld||v.secretNPC||v.replayEvents||v.reveal&&v.phase!=='finished'||self.role==='suspect'&&!self.identity.known&&self.identity.characterId)summary.invariants.activeProjectionLeaks++;
    if(v.phase==='reveal')event={type:'ROLE_SEEN'};
    else if(v.phase==='secret'){
     // Bots only announce their own projected observation. C/A may claim one false person observation.
     if(!v.notes.some(note=>note.speakerId===self.id&&note.text.startsWith('관찰:'))){
      const clue=self.clues[0]||(['culprit','accomplice'].includes(self.role)?{category:'hand',value:1-E.caseValue(v.caseSecret,'hand')}:null);
      if(clue)s=E.act(s,{type:'ADD_NOTE',actorId:owner,text:'관찰:'+clue.category+':'+clue.value});
     }
     if(self.role==='suspect'&&self.identity.memoryLeft)event={type:'SECRET_ACTION',kind:'memory'};
     else if(self.role==='suspect'&&v.round===4&&!self.sealedReport)event={type:'SECRET_ACTION',kind:'report',suspectId:policyRank(E,v,rng),text:'공개 원본과 자발적 관찰 발언을 비교한 추정'};
     else if(['culprit','accomplice'].includes(self.role)&&self.sabotageLeft&&!v.seals.length&&v.round<=3)event={type:'SECRET_ACTION',kind:'seal',category:E.CATEGORIES.filter(c=>c.group==='person')[Math.floor(rng()*4)].id};
     else event={type:'SECRET_ACTION',kind:'pass'};
    }else if(v.phase==='investigate'){
     const records=E.RECORDS.filter(r=>!v.facts.some(f=>f.recordId===r.id));
     const claims=v.notes.map(note=>({note,match:/^관찰:([a-z]+):(\d+)$/.exec(note.text)})).filter(x=>x.match&&x.note.speakerId!==owner&&!v.questionHistory.some(q=>q.targetId===x.note.speakerId&&q.category===x.match[1]&&q.status==='answered'));
     claims.sort((a,b)=>(E.CATEGORIES.find(c=>c.id===b.match[1]).group==='person')-(E.CATEGORIES.find(c=>c.id===a.match[1]).group==='person'));
     const prioritize=policy==='verified-observations-first'&&v.kits>0&&claims.length;
     if(prioritize||!records.length&&claims.length){const x=claims[0];event={type:'QUESTION',targetId:x.note.speakerId,category:x.match[1],proposedValue:Number(x.match[2])};metrics.questions++;}
     else if(records.length){event={type:'SEARCH',recordId:records[0].id};metrics.searches++;}
     else event={type:'INVESTIGATE',kind:'pass'};
    }else if(v.phase==='answer'){
     const legal=self.answerOptions.legalValues,actual=v.caseSecret?E.caseValue(v.caseSecret,v.pending.category):undefined;
     // A live kit deters lies; afterward C/A spend only the legal shared budget.
     const wrong=legal.filter(value=>value!==null&&value!==actual);let value;
     if(v.caseSecret)value=v.kits===0&&wrong.length?wrong[Math.floor(rng()*wrong.length)]:actual;else value=legal[0];
     event={type:'ANSWER',value};
    }else if(v.phase==='discussion'){
     if(v.review.kind==='answer'&&v.kits>0){event={type:'REVIEW_AUDIT'};metrics.audits++;}else{if(v.review.kind==='blocked')metrics.blocked++;event={type:'ROUND_CONFIRM'};}
    }else if(v.phase==='final'){
     const people=new Set(E.candidates(v).map(c=>c.suspectId));metrics.finalPeopleTotal+=people.size;if(people.size===1)metrics.uniqueFinalPeople++;
     event={type:'ACCUSE',suspectId:policyRank(E,v,rng)};
    }
    try{s=E.act(s,{...event,actorId:owner});}catch(error){summary.invariants.illegalActions++;throw error;}
    if(!truthPresent(s))summary.invariants.truthEliminated++;
   }
   metrics.games++;s.winner==='investigators'?metrics.detectiveWins++:metrics.criminalWins++;
   const outcome=E.publicView(s).reveal.suspectResult;if(outcome)metrics[outcome.status==='win'?'SWin':outcome.status==='loss'?'SLoss':'SSurvived']++;
  }
 }
 summary.resemblancePairs=[...pairs].sort();for(const m of Object.values(summary.policies)){m.detectiveWinFraction=m.detectiveWins/m.games;m.meanFinalPeople=m.finalPeopleTotal/m.games;}
 return summary;
}

test('multi-seed projected-view policies preserve truth, legal resources and unresolved alternatives',()=>{
 const E=api(),audit=projectedPolicyAudit(E,Number(process.env.SEVEN_BALANCE_SEEDS||12));
 assert.deepEqual(audit.invariants,{illegalActions:0,truthEliminated:0,activeProjectionLeaks:0});assert.ok(audit.sourceSweep.minimumPublicPeople>=3);assert.equal(audit.sourceSweep.uniquePublicPeople,0);assert.equal(audit.sourceSweep.SRetained,audit.SInitial.cases);assert.ok(audit.sourceSweep.minimumDetectivePrivatePeople>=2);assert.equal(audit.sourceSweep.uniqueDetectivePrivatePeople,0);assert.equal(audit.sourceSweep.detectivePrivateSRetained,audit.SInitial.cases);assert.ok(audit.SInitial.containsC>0&&audit.SInitial.doesNotContainC>0);assert.ok(audit.resemblancePairs.length>=4);
 for(const [id,metric] of Object.entries(audit.sourceAblations))assert.ok(metric.changedPersonSets>0,id+' evidence must sometimes narrow actual person choices');
 for(const [id,metric] of Object.entries(audit.recordAblations))assert.ok(metric.changedPersonSets>0,id+' original must sometimes narrow actual person choices while all other evidence stays');
 if(process.env.SEVEN_WRITE_BALANCE==='1'){
  const hash=file=>require('node:crypto').createHash('sha256').update(fs.readFileSync(require('node:path').join(__dirname,file))).digest('hex');
  const report={version:2,ruleVersion:4,finalAccusation:'person-only',catalogCounts:{people:12,places:12,tools:12,times:12},generatedAt:new Date().toISOString(),codeHashes:{engine:hash('../lib/seven-engine.cjs'),data:hash('../public/seven-data.js')},reproduce:'PowerShell: $env:SEVEN_BALANCE_SEEDS="100"; $env:SEVEN_WRITE_BALANCE="1"; node --test tests/seven-engine.test.cjs',contract:{events:['ROLE_SEEN','SECRET_ACTION','QUESTION','SEARCH','AUDIT','INVESTIGATE','ANSWER','REVIEW_AUDIT','ROUND_CONFIRM','ACCUSE','ADD_NOTE'],accusation:{type:'ACCUSE',suspectId:'s0..s11'},privateAnswerOptions:'self.answerOptions.legalValues',fieldReference:'Version2 public possible ranges: people[{suspectId,placeIds[6],toolIds[6],timeIds[6],routes[6]:{placeId,toolId,timeId}}], places[{placeId,toolIds[6],timeIds[6]}]. Paired rows must be read together; none identifies an actual event.'},sourcePurposes:{portrait:'One observed person trait. It identifies neither a player nor a role.',access:'A different person trait. Its case-specific resemblance pair varies among six category combinations.',scene:'One structural feature limits the paired possible routes for people; it does not name the actual location.',tool:'Six compatible tools limit paired routes. Exact-tool testimony can further narrow the evidence.',time:'Six compatible 15-minute intervals limit paired routes. Exact-time testimony can further narrow the evidence.'},ablationMethod:{baseline:'All five actual original-record snapshots plus D initial private observations and known-own innocence, using the same public fieldReference.',sourceAblations:'Remove originals in the given dimension and D private clues in that dimension; count cases that restore at least one person, not just more coordinate combinations.',recordAblations:'Remove only that original record, preserving all other original records and every D private clue; count cases that restore at least one person.',comparison:'The previous Cartesian-marginal model restored people in 0/500 cases for each place/tool/time dimension. Paired-route constraints replace that shortcut.'},audit,limits:['These are deterministic bot-policy outcomes, not human win rates or a claim of optimal balance.','Both policies use only authenticated projected views. Evaluation reads actual truth only to count outcomes and invariant violations.','Originals-first reads all available original records before questioning; verified-observations-first questions a volunteered observation while a kit remains, audits it, then returns to originals.','The crime policy knows only its permitted caseSecret, deters lies while a public kit remains, then spends only legal shared lies. It guesses seal categories without raw record access.','S uses two memories, then makes one private DAY4 report based on projected candidates and unverified voluntary observations. No correct-answer feedback is available.','All-record sweep deliberately grants all five originals for information-pressure analysis. It leaves at least three public people including C/S; adding initial D observations and known-own innocence still leaves at least two and retains S.','Generation preserves a possible route for C, S and a third person under all originals and initial D observations. Other routes are sampled from coherent permissions/ranges. This is a constrained puzzle model, not physical forensic simulation.','A possible route means an exhaustive in-game compatibility option, not a confirmed visit, actual use, proved alibi or causal forensic finding. Public data never labels which possible event actually happened.','Each partial source narrows person possibilities in some cases. No source dimension is claimed necessary in every case; duplicate or already-sufficient observations can make an individual record redundant.','Restricting generation to four-person resemblance groups was rejected: it would reduce six resemblance category pairs to two and make S partners deterministic for eight of twelve culprit profiles.','Free-text chat can contain arbitrary deception; these policies model one volunteered observation per seat and are not conversational agents.','Search repetition never yields additional constraints. A kit certifies statement truth only, including twelve-valued tool/time claims.']};
  fs.writeFileSync(require('node:path').join(__dirname,'../docs/SEVEN-BALANCE.json'),JSON.stringify(report,null,2)+'\n');
 }
});

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const base=process.env.BASE_URL||'http://127.0.0.1:4174';
const measurements=[];
async function request(body,expected=200){
 const started=Date.now();
 const response=await fetch(base+'/api/room',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const result=await response.json();measurements.push(Date.now()-started);
 assert.equal(response.status,expected,body.op+' '+(result.error||''));assert.match(response.headers.get('cache-control'),/no-store/);
 const g=result.room?.game;
 if(g){
  for(const key of ['replay','replayEvents','replayVersion','replayComplete'])assert.equal(g[key],undefined,'raw replay never enters a room projection');
  if(g.phase!=='finished')assert.equal(g.reveal,undefined,'end-only replay and answers stay hidden in every active phase');
  else {assert.equal(g.reveal.replay.version,1);assert.equal(g.reveal.replay.complete,true);assert.equal(g.reveal.replay.source,'recorded');assert.ok(g.reveal.replay.events.every(e=>e.round>=1&&e.round<=g.round));}
 }
 return result;
}
const tokens=[],credentials=[];
async function poll(index){return (await request({op:'poll',token:tokens[index]})).room;}
async function mutate(index,op,extra={}) {const room=await poll(index);return (await request({op,token:tokens[index],revision:room?.revision,requestId:crypto.randomUUID(),...extra})).room;}
function actual(secret,cat){const order=['coat','hand','item','zone','light'].indexOf(cat);const s=Number(secret.suspectId.slice(1)),p=Number(secret.placeId.slice(1));return order<3?(s>>(2-order))&1:(p>>(4-order))&1;}
(async()=>{
 const suffix=crypto.randomBytes(2).toString('hex');
 for(let i=0;i<7;i++){const credential={name:'검증'+suffix+'-'+(i+1),password:crypto.randomBytes(8).toString('base64url')};credentials.push(credential);const login=await request({op:'register',...credential});assert.equal(login.room,null);tokens.push(login.token);}
 let room=await mutate(0,'create',{capacity:6});const code=room.code;
 await Promise.all(tokens.slice(1,6).map(token=>request({op:'join',token,code,requestId:crypto.randomUUID()})));
 room=await poll(0);assert.equal(room.members.length,6);
 await request({op:'join',token:tokens[6],code,requestId:crypto.randomUUID()},409);
 await request({op:'poll',token:'X'.repeat(43)},401);
 await request({op:'start',token:tokens[1],revision:room.revision,requestId:crypto.randomUUID()},403);
 for(let i=0;i<6;i++)await mutate(i,'ready',{ready:true});
 room=await mutate(0,'start');
 assert.equal(room.game.rulesVersion,3);assert.match(room.caseId,/^[0-9a-f-]{36}$/);const firstCaseId=room.caseId;
 const views=await Promise.all(tokens.slice(0,6).map((_,i)=>poll(i)));
 const engineIds=views.map(v=>v.game.self.id);
 const roles=views.map(v=>v.game.self.role);
 assert.deepEqual([...roles].sort(),['detective','culprit','witness','witness','suspect','accomplice'].sort());
 const criminal=roles.indexOf('culprit'),accomplice=roles.indexOf('accomplice'),suspect=roles.indexOf('suspect'),detective=roles.indexOf('detective');
 const detectiveClues=views[detective].game.self.clues;
 assert.equal(detectiveClues.length,2);assert.equal(detectiveClues.filter(c=>['coat','hand','item'].includes(c.category)).length,1);assert.equal(detectiveClues.filter(c=>['zone','light'].includes(c.category)).length,1);
 assert.equal(views.reduce((total,v)=>total+v.game.self.clues.length,0),4);assert.equal(new Set(views.flatMap(v=>v.game.self.clues.map(c=>c.category))).size,4);
 const secret=views[criminal].game.caseSecret;
 for(const v of views){const g=v.game;assert.equal(g.secretNPC,undefined);assert.equal(g.seed,undefined);assert.ok(g.players.every(p=>p.role===undefined&&p.clues===undefined&&p.sealOutcome===undefined&&p.sealOutcomes===undefined));assert.equal(!!g.caseSecret,['culprit','accomplice'].includes(g.self.role));assert.equal(g.self.sealOutcome,undefined);assert.equal(g.self.sealOutcomes,undefined);assert.deepEqual(g.questionHistory,[]);assert.ok(!JSON.stringify(v).includes(tokens[0]));}
 async function current(){return poll(0);}
 async function ownerAction(event){const r=await current();const index=engineIds.indexOf(r.game.turnOwnerId);assert.ok(index>=0);return mutate(index,'action',{event});}
 await mutate(suspect,'action',{event:{type:'ADD_NOTE',speakerId:engineIds[criminal],text:'역할 확인 중에도 자유 발언'}});
 assert.equal((await current()).game.notes.at(-1).speakerId,engineIds[suspect]);
 while((await current()).game.phase==='reveal')await ownerAction({type:'ROLE_SEEN'});
 for(let round=1;round<=5;round++){
  while((await current()).game.phase==='secret'){
   const r=await current(),index=engineIds.indexOf(r.game.turnOwnerId);
   let event={type:'SECRET_ACTION',kind:'pass'};
   if(round===1&&index===criminal)event={type:'SECRET_ACTION',kind:'seal',category:'coat'};
   if(round===1&&index===suspect)event={type:'SECRET_ACTION',kind:'guard',category:'coat'};
   if(round===2&&index===criminal)event={type:'SECRET_ACTION',kind:'seal',category:'hand'};
   if(round===3&&index===accomplice)event={type:'SECRET_ACTION',kind:'seal',category:'item'};
   await ownerAction(event);
  }
  room=await current();assert.equal(room.game.round,round);
  const wrong=roles.findIndex(r=>r!=='detective');
  await request({op:'action',token:tokens[wrong],revision:room.revision,requestId:crypto.randomUUID(),event:{type:'INVESTIGATE',actorId:room.game.detectiveId,kind:'pass'}},403);
  if(round===5){
   await request({op:'action',token:tokens[detective],revision:room.revision,requestId:crypto.randomUUID(),event:{type:'ACCUSE',...secret}},409);
   room=await mutate(detective,'action',{event:{type:'INVESTIGATE',kind:'pass'}});
   assert.equal(room.game.review.kind,'pass');
  } else {
   const cat=['coat','hand','light','zone'][round-1];const targetId=engineIds[criminal];
   room=await mutate(detective,'action',{event:{type:'INVESTIGATE',kind:'question',targetId,category:cat,proposedValue:round%2}});
   if(round===2){assert.equal(room.game.phase,'discussion');assert.equal(room.game.review.kind,'blocked');assert.equal(room.game.kits,1);}else{
    assert.equal(room.game.phase,'answer');assert.equal(room.game.pending.proposedValue,round%2);
    if(round===1)assert.equal((await poll(criminal)).game.self.sealOutcome,undefined);
    if(round===1){await mutate(suspect,'action',{event:{type:'ADD_NOTE',text:'답변을 기다리며 공개 대화'}});assert.equal((await current()).game.phase,'answer');}
    room=await mutate(criminal,'action',{event:{type:'ANSWER',value:actual(secret,cat)^(round>=3?1:0)}});
    assert.equal(room.game.review.kind,'answer');assert.equal(room.game.review.proposedValue,round%2);assert.equal(room.game.review.verified,false);assert.equal(room.game.review.actualValue,undefined);
    if(round===3){
     const claim=structuredClone(room.game.statements.at(-1));
     room=await mutate(detective,'action',{event:{type:'REVIEW_RESULT',kind:'audit',statementId:claim.id}});
     assert.equal(room.game.kits,0);assert.equal(room.game.review.verified,true);assert.equal(room.game.review.value,claim.value);assert.equal(room.game.review.actualValue,actual(secret,cat));
     assert.equal(room.game.statements.at(-1).value,claim.value);assert.ok(room.game.facts.some(f=>f.statementId===claim.id&&f.value===actual(secret,cat)));
    }
   }
  }
  assert.equal(room.game.phase,'discussion');
  const outcomeHistory=[{round:1,success:false,reason:'guarded'}];
  if(round>=2)outcomeHistory.push({round:2,success:true,reason:'blocked'});
  if(round>=3)outcomeHistory.push({round:3,success:false,reason:'missed'});
  for(let i=0;i<6;i++){
   const checked=(await poll(i)).game;
   assert.equal(checked.sealOutcome,undefined);assert.equal(checked.sealOutcomes,undefined);
   assert.equal(checked.questionHistory.length,Math.min(round,4));
   assert.ok(checked.questionHistory.every(entry=>Object.keys(entry).sort().join(',')==='category,round,status'));
   if(i===criminal){assert.deepEqual(checked.self.sealOutcome,outcomeHistory.at(-1));assert.deepEqual(checked.self.sealOutcomes,outcomeHistory);}
   else {assert.equal(checked.self.sealOutcome,undefined);assert.equal(checked.self.sealOutcomes,undefined);}
  }
  assert.deepEqual(room.game.questionHistory[round===1?0:1],round===1?{round:1,category:'coat',status:'answered'}:{round:2,category:'hand',status:'blocked'});
  if(round===3){for(let i=0;i<6;i++){const before=await poll(i),old=tokens[i];const restored=await request({op:'login',...credentials[i]});assert.notEqual(restored.token,old);assert.equal(restored.room.meId,before.meId);assert.deepEqual(restored.room.game,before.game);tokens[i]=restored.token;await request({op:'poll',token:old},401);}const old=tokens[2];await request({op:'logout',token:old,requestId:crypto.randomUUID()});await request({op:'poll',token:old},401);const back=await request({op:'login',...credentials[2]});tokens[2]=back.token;assert.equal(back.room.code,code);}
  const before=structuredClone(room.game.facts);
  const free=await mutate(suspect,'action',{event:{type:'ADD_NOTE',speakerId:engineIds[criminal],text:'자유 발언 <b>검증</b>'}});
  assert.equal(free.game.notes.at(-1).speakerId,engineIds[suspect]);assert.deepEqual(free.game.facts,before);
  room=await mutate(detective,'action',{event:{type:'REVIEW_RESULT',kind:'confirm'}});
  assert.equal(room.game.phase,round<5?'secret':'final');assert.equal(room.game.round,round<5?round+1:5);
  if(round<5)assert.equal(room.game.review,null);
 }
 await mutate(suspect,'action',{event:{type:'ADD_NOTE',text:'최종 지목 전 의견'}});
 room=await mutate(detective,'action',{event:{type:'ACCUSE',...secret}});
 assert.equal(room.game.winner,'investigators');assert.equal(room.status,'finished');assert.equal(room.game.reveal.players.length,6);
 const replay=room.game.reveal.replay,events=replay.events;
 assert.equal(events.filter(e=>['question','blocked-question'].includes(e.type)).length,4);
 assert.equal(events.filter(e=>e.type==='answer').length,3);
 assert.equal(events.filter(e=>e.type==='answer'&&e.isTrue===false).length,2);
 assert.equal(events.filter(e=>e.type==='audit').length,1);
 assert.equal(events.filter(e=>e.type==='seal-result').length,3);
 assert.equal(events.at(-1).type,'accusation');
 for(const e of events.filter(e=>e.type==='answer')){assert.equal(e.actualValue,actual(secret,e.category));assert.equal(e.isTrue,e.value===e.actualValue);}
 const final=await Promise.all(tokens.slice(0,6).map((_,i)=>poll(i)));assert.ok(final.every(v=>v.game.winner==='investigators'));
 assert.ok(final.every(v=>JSON.stringify(v.game.reveal.replay)===JSON.stringify(replay)),'all six players receive the same finished replay');
 const reconnect=await poll(criminal);assert.equal(reconnect.game.self.id,views[criminal].game.self.id);assert.deepEqual(reconnect.game.caseSecret,secret);
 room=await mutate(0,'restart');assert.equal(room.game,null);assert.equal(room.caseId,undefined);assert.ok(room.members.every(m=>!m.ready&&!m.gameId));
 for(let i=0;i<6;i++)await mutate(i,'leave');
 assert.equal(await poll(0),null);
 // Reuse two authenticated accounts to exercise the separate new-duo rules.
 room=await mutate(0,'create',{capacity:2});const duoCode=room.code;
 await mutate(1,'join',{code:duoCode});await mutate(0,'ready',{ready:true});await mutate(1,'ready',{ready:true});room=await mutate(0,'start');
 assert.notEqual(room.caseId,firstCaseId);assert.equal(room.game.facts.length,2);assert.equal(new Set(room.game.facts.map(f=>f.category)).size,2);
 const duoViews=await Promise.all([poll(0),poll(1)]),duoIds=duoViews.map(v=>v.game.self.id),duoD=duoViews.findIndex(v=>v.game.self.role==='detective'),duoC=1-duoD;
 const duoClues=duoViews[duoD].game.self.clues;assert.equal(duoViews[duoD].game.rulesVersion,3);assert.equal(duoClues.length,2);assert.equal(duoClues.filter(c=>['coat','hand','item'].includes(c.category)).length,1);assert.equal(duoClues.filter(c=>['zone','light'].includes(c.category)).length,1);
 while((room=await current()).game.phase==='reveal')await mutate(duoIds.indexOf(room.game.turnOwnerId),'action',{event:{type:'ROLE_SEEN'}});
 assert.equal(room.game.phase,'secret');assert.equal(room.game.turnOwnerId,duoIds[duoC]);
 await request({op:'action',token:tokens[duoD],revision:room.revision,requestId:crypto.randomUUID(),event:{type:'SECRET_ACTION',kind:'pass'}},403);
 await request({op:'action',token:tokens[duoC],revision:room.revision,requestId:crypto.randomUUID(),event:{type:'SECRET_ACTION',kind:'suggest',category:'coat'}},400);
 room=await mutate(duoC,'action',{event:{type:'SECRET_ACTION',kind:'pass'}});assert.equal(room.game.phase,'investigate');
 const duoSecret=duoViews[duoC].game.caseSecret;
 const duoCategory=['coat','hand','item','zone','light'].find(category=>!duoClues.some(clue=>clue.category===category));
 room=await mutate(duoD,'action',{event:{type:'INVESTIGATE',kind:'question',category:duoCategory,targetId:duoIds[duoC],proposedValue:1}});
 assert.equal(room.game.pending.proposedValue,1);room=await mutate(duoC,'action',{event:{type:'ANSWER',value:actual(duoSecret,duoCategory)}});assert.deepEqual(room.game.questionHistory,[{round:1,category:duoCategory,status:'answered'}]);
 room=await mutate(duoD,'action',{event:{type:'REVIEW_RESULT',kind:'confirm'}});assert.equal(room.game.round,2);assert.equal(room.game.turnOwnerId,duoIds[duoC]);
 await mutate(duoC,'action',{event:{type:'SECRET_ACTION',kind:'pass'}});await mutate(duoD,'action',{event:{type:'ACCUSE',...duoSecret}});await mutate(0,'restart');await mutate(0,'leave');await mutate(1,'leave');
 const result={base,passed:true,checkedAt:new Date().toISOString(),sessions:7,simultaneousPlayers:6,rounds:5,rulesVersion:3,serverRequests:measurements.length,maxRequestMs:Math.max(...measurements),averageRequestMs:Math.round(measurements.reduce((a,b)=>a+b,0)/measurements.length),privacy:true,capacityRace:true,protectedEvidence:true,sharedLieBudget:true,guardAndSeal:true,reconnect:true,passwordReLogin:true,logoutPreservesSeat:true,restart:true,reviewAuditAndConfirm:true,finalPhase:true,proposedQuestions:true,chatDuringPrivateAndAnswerAndFinal:true,duoSimplified:true,caseIdentity:true,detectivePersonAndSceneHints:true,distinctWitnessClues:true,completedQuestionHistory:true,culpritOnlySealOutcomes:true,deferredSealOutcomeUntilAnswer:true,accompliceOutcomeCulpritOnly:true,persistentSealOutcomeHistory:true};
 const output=process.env.TEST_REPORT||require('node:path').join(__dirname,'../work/online-http-result.json');fs.mkdirSync(require('node:path').dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(result);
})().catch(e=>{console.error(e.message);process.exit(1)});

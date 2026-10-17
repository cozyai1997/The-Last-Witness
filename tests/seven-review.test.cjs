'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../lib/seven-engine.cjs');
function start(){let s=E.makeGame(['가','나','다','라'],{seed:17});while(s.phase==='reveal')s=E.act(s,{type:'ROLE_SEEN',actorId:E.turnOwner(s)});return s;}
function prepare(s){while(s.phase==='secret')s=E.act(s,{type:'SECRET_ACTION',actorId:E.turnOwner(s),kind:'pass'});return s;}
test('published investigation suggestions expose only deliberate category requests, while S identity guesses stay private',()=>{
 let s=start();const owner=E.turnOwner(s);
 s=E.act(s,{type:'SECRET_ACTION',actorId:owner,kind:'suggest',category:'time',text:'시간 기록을 먼저 대조하자'});
 const v=E.publicView(s);assert.deepEqual(v.suggestions,[{round:1,speakerId:owner,category:'time',text:'시간 기록을 먼저 대조하자'}]);
 assert.equal(v.suggestions[0].role,undefined);assert.equal(v.suggestions[0].characterId,undefined);
 s=prepare(s);s=E.act(s,{type:'INVESTIGATE',kind:'pass',actorId:s.detectiveId});s=E.act(s,{type:'ROUND_CONFIRM',actorId:s.detectiveId});
 const S=s.players.find(p=>p.role==='suspect');while(E.turnOwner(s)!==S.id)s=E.act(s,{type:'SECRET_ACTION',actorId:E.turnOwner(s),kind:'pass'});
 const before=E.publicView(s).suggestions;s=E.act(s,{type:'SECRET_ACTION',kind:'suggest',actorId:S.id,suspectId:'s10',text:'내 정체 추정'});
 assert.deepEqual(E.publicView(s).suggestions,before);assert.equal(E.privateView(s,S.id).self.identityGuess.suspectId,'s10');
});
test('history retains the exact public assumption for answered and unknown questions without adding true answer fields',()=>{
 let s=prepare(start()),C=s.players.find(p=>p.role==='culprit');
 s=E.act(s,{type:'QUESTION',actorId:s.detectiveId,targetId:C.id,category:'tool',proposedValue:9});
 s=E.act(s,{type:'ANSWER',actorId:C.id,value:E.caseValue(s.secretNPC,'tool')});
 let h=E.publicView(s).questionHistory.at(-1);assert.equal(h.proposedValue,9);assert.equal(h.status,'answered');assert.equal(h.actualValue,undefined);
 s=E.act(s,{type:'ROUND_CONFIRM',actorId:s.detectiveId});s=prepare(s);
 s=E.act(s,{type:'QUESTION',actorId:s.detectiveId,targetId:C.id,category:'tool',proposedValue:11});s=E.act(s,{type:'ANSWER',actorId:C.id,value:null});
 h=E.publicView(s).questionHistory.at(-1);assert.equal(h.proposedValue,11);assert.equal(h.status,'unknown');assert.equal(h.actualValue,undefined);
});

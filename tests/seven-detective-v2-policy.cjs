'use strict';
// Manual projected-information simulation; these are not human win rates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../lib/seven-engine.cjs');
const A = require('../public/seven-actions.js');
const context = { WitnessSevenActions: A }; context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/seven-practice.js'),'utf8'), context);
const choose = context.WitnessSevenPractice.chooseComputerEvent;
function rng(seed) { let x = seed >>> 0; return () => { x = (Math.imul(x,1664525)+1013904223) >>> 0; return x/4294967296; }; }
const counts = [], coverage = new Set(), categories = new Set();
let totalSteps = 0, truthChecks = 0, uniqueAtStart = 0;
for (let count = 2; count <= 6; count++) {
  const result = { players:count, cases:100, detectiveWins:0, questions:0, unknownAnswers:0, blockedQuestions:0, verdicts:0, initialMinPeople:12, finalRemainingPeople:0 };
  for (let seed=1000; seed<1100; seed++) {
    let state = E.makeGame(Array.from({length:count},(_,i)=>'정책검사'+i),{ seed, detectiveVersion:2 });
    const memory = Object.fromEntries(state.players.map(p=>[p.id,{ records:[],questions:[] }])), random = rng(seed^count);
    const first = E.privateView(state,state.detectiveId), clues = first.self.clues;
    assert.equal(clues.length,2); assert.equal(new Set(clues.map(c=>c.category)).size,2);
    clues.forEach(c=>categories.add(c.category)); coverage.add(clues.map(c=>c.category).sort().join('/'));
    let initialPeople = new Set(E.candidates(first).map(c=>c.suspectId)).size;
    assert.ok(initialPeople>=2); if(initialPeople===1) uniqueAtStart++;
    result.initialMinPeople=Math.min(result.initialMinPeople,initialPeople);
    let steps=0;
    while(state.phase!=='finished' && steps++<220) {
      const actorId=E.turnOwner(state), view=E.privateView(state,actorId), event=choose(E,view,random,memory[actorId]);
      assert.notEqual(event.type,'SEARCH');
      if(event.type==='AUDIT') assert.equal(A.auditAllowed(view,event.statementId),true);
      if(event.type==='QUESTION') result.questions++;
      if(event.type==='ANSWER' && event.value===null) result.unknownAnswers++;
      state=E.act(state,{...event,actorId}); totalSteps++;
      if(state.phase!=='finished') {
        const detective=E.privateView(state,state.detectiveId), candidates=E.candidates(detective);
        assert.ok(candidates.some(c=>Object.keys(state.secretNPC).every(k=>c[k]===state.secretNPC[k])),'Truth must remain possible after every action'); truthChecks++;
      }
    }
    assert.equal(state.phase,'finished'); assert.equal(state.round,7);
    assert.ok(state.kits>=0 && state.kits<=2);
    result.detectiveWins+=Number(state.winner==='investigators'); result.verdicts+=2-state.kits;
    result.blockedQuestions+=state.questionHistory.filter(q=>q.status==='blocked').length;
    const finalView=E.privateView(state,state.detectiveId);
    result.finalRemainingPeople+=new Set(E.candidates(finalView).map(c=>c.suspectId)).size;
  }
  result.averageFinalPeople=Number((result.finalRemainingPeople/result.cases).toFixed(2));
  counts.push(result);
  console.log(JSON.stringify({progress:count+'/6',cases:result.cases,steps:totalSteps}));
}
assert.equal(categories.size,9); assert.equal(coverage.size,36);
const report={ passed:true, checkedAt:new Date().toISOString(), detectiveVersion:2, cases:500, counts, totalSteps, truthChecks, categoryCoverage:categories.size, pairCoverage:coverage.size, uniqueAtStart, illegalActions:0, deadlocks:0, informationBoundary:'Each computer receives only its own privateView. No hidden crime is passed to the decision policy.', limitation:'Reference computer policy simulations do not measure human win rates, strategic balance, fun or fairness.' };
fs.writeFileSync(path.join(__dirname,'../docs/DETECTIVE-POLICY.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

'use strict';
// Manual diagnostic: this is intentionally not a *.test.cjs default-suite test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../lib/seven-engine.cjs');

function measurePolicyPacing({ seedsPerCount = 100, onProgress } = {}) {
  assert.ok(Number.isInteger(seedsPerCount) && seedsPerCount >= 1 && seedsPerCount <= 1000);
  const context = { setTimeout() {}, clearTimeout() {} }; context.window = context;
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/seven-practice.js'), 'utf8'), context);
  const choose = context.WitnessSevenPractice.chooseComputerEvent;
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const groups = [];
  for (const flowVersion of [1, 2]) for (const count of [2, 3, 4, 5, 6]) {
    const group = { flowVersion, count, cases: seedsPerCount, detectiveWins: 0, personalPasses: 0, readyDecisions: 0, secretAbilities: 0, freeContributions: 0, unknownAnswers: 0, officialPasses: 0, blocked: 0, illegalActions: 0, maxActions: 0 };
    for (let seed = 0; seed < seedsPerCount; seed++) {
      let state = E.makeGame(Array.from({ length: count }, (_, i) => '좌석 ' + i), { seed, flowVersion }), steps = 0, randomState = seed + 1;
      const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
      const memory = Object.fromEntries(E.publicView(state).players.map(player => [player.id, { records: [], questions: [] }]));
      while (state.phase !== 'finished' && steps++ < 400) {
        const actorId = E.turnOwner(state), view = E.privateView(state, actorId);
        for (const key of ['secretNPC', 'caseWorld', 'seed', 'replayEvents']) assert.equal(view[key], undefined, 'Only one projected seat may be supplied to the policy');
        const event = choose(E, view, random, memory[actorId]);
        if (event.type === 'SECRET_ACTION') {
          if (event.kind === 'pass') group.personalPasses++;
          else if (event.kind === 'ready') group.readyDecisions++;
          else group.secretAbilities++;
        }
        if (['SUGGEST', 'OFFER_TESTIMONY', 'IDENTITY_MEMO'].includes(event.type)) group.freeContributions++;
        if (event.type === 'ANSWER' && event.value === null) group.unknownAnswers++;
        if (event.type === 'INVESTIGATE' && event.kind === 'pass') group.officialPasses++;
        try { state = E.act(state, { ...event, actorId }); }
        catch (error) { group.illegalActions++; throw new Error(JSON.stringify({ flowVersion, count, seed, phase: view.phase, event, error: error.message })); }
      }
      assert.equal(state.phase, 'finished', 'Every seeded case must finish without a deadlock'); assert.equal(state.round, 7);
      const reveal = E.publicView(state).reveal;
      assert.ok(E.candidates({ ...E.publicView(state), facts: [...state.facts] }).some(candidate => candidate.suspectId === reveal.secretNPC.suspectId), 'Public certified facts cannot eliminate the actual culprit');
      group.blocked += state.questionHistory.filter(entry => entry.status === 'blocked').length;
      group.detectiveWins += state.winner === 'investigators'; group.maxActions = Math.max(group.maxActions, steps);
    }
    groups.push(group); onProgress?.(group);
  }
  return { checkedAt: new Date().toISOString(), transport: 'projected-engine-policy', rulesVersion: 4, seedsPerCount, totalCases: seedsPerCount * 10,
    baseline: 'Same current evidence and practice policy with sequential flowVersion 1 versus simultaneous flowVersion 2; not a historical production win rate.',
    interpretation: 'Readiness decisions remain. Daily online preparation barriers change from 7 times player count to 7 shared stages. Added proposals are unverified and do not create certified facts. These simulated win rates are not human game balance estimates.',
    policyHash: hash(choose.toString()), engineHash: hash(fs.readFileSync(path.join(__dirname, '../lib/seven-engine.cjs'))), groups };
}

module.exports = { measurePolicyPacing };
if (require.main === module) {
  const seedsPerCount = process.env.PACING_SEEDS_PER_COUNT === undefined ? 100 : Number(process.env.PACING_SEEDS_PER_COUNT);
  try {
    const report = measurePolicyPacing({ seedsPerCount, onProgress: group => console.log(JSON.stringify({ progress: group })) });
    const output = process.env.PACING_POLICY_REPORT || path.join(__dirname, '../docs/PACING-POLICY.json');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error('Pacing policy check failed: ' + error.message); process.exitCode = 1; }
}

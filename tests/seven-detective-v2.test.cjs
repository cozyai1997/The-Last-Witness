'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../lib/seven-engine.cjs');
const names = n => Array.from({ length: n }, (_, i) => '참가자' + i);
const make = (seed = 17, n = 6, extra = {}) => E.makeGame(names(n), { seed, detectiveVersion: 2, ...extra });
const call = (s, type, fields = {}) => E.act(s, { type, actorId: s.detectiveId, ...fields });
const role = (s, kind) => s.players.find(p => p.role === kind);
function prepare(s, choose = () => ({ kind: 'ready' })) {
  while (s.phase === 'reveal') s = E.act(s, { type: 'ROLE_SEEN', actorId: E.turnOwner(s) });
  while (s.phase === 'secret') { const actorId = E.turnOwner(s); s = E.act(s, { type: 'SECRET_ACTION', actorId, ...choose(s.players.find(p => p.id === actorId), s) }); }
  return s;
}
function auditFixture(phase = 'investigate') {
  const s = structuredClone(make());
  s.phase = phase; s.round = 3; s.kits = 2; s.fieldReference = undefined;
  role(s, 'detective').clues = [];
  s.statements = [
    { id: 'statement-1', round: 1, speakerId: role(s, 'culprit').id, category: 'tool', value: E.caseValue(s.secretNPC, 'tool'), audited: false },
    { id: 'statement-2', round: 2, speakerId: role(s, 'accomplice').id, category: 'time', value: E.caseValue(s.secretNPC, 'time'), audited: false }
  ];
  s.pending = null;
  s.review = phase === 'discussion' ? { kind: 'answer', round: 3, statementId: 'statement-2', category: 'time', targetId: role(s, 'accomplice').id, value: E.caseValue(s.secretNPC, 'time'), verified: false } : null;
  return s;
}

test('v2 explicitly projects its contract, has two case verdicts and rejects invalid versions', () => {
  const s = make();
  assert.equal(s.rulesVersion, 4); assert.equal(s.flowVersion, 2); assert.equal(s.detectiveVersion, 2); assert.equal(s.kits, 2);
  assert.equal(E.publicView(s).detectiveVersion, 2); assert.equal(E.privateView(s, s.detectiveId).detectiveVersion, 2);
  for (const detectiveVersion of [null, 0, 3, '2', true]) assert.throws(() => make(17, 6, { detectiveVersion }));
});

test('new starting answers cover all 36 category pairs and preserve true, ambiguous routes', () => {
  const pairs = new Set();
  for (let seed = 0; seed < 500; seed++) {
    const s = make(seed, 2 + seed % 5), detective = role(s, 'detective'), clues = detective.clues;
    assert.equal(clues.length, 2); assert.notEqual(clues[0].category, clues[1].category);
    pairs.add(clues.map(c => c.category).sort().join('/'));
    for (const clue of clues) assert.equal(clue.value, E.caseValue(s.secretNPC, clue.category));
    for (const witness of s.players.filter(p => p.role === 'witness')) assert.ok(witness.clues.every(c => !clues.some(d => d.category === c.category)));
    const candidates = E.candidates(E.privateView(s, detective.id));
    assert.ok(candidates.some(c => Object.keys(s.secretNPC).every(k => c[k] === s.secretNPC[k])), 'true case survives seed ' + seed);
    assert.ok(new Set(candidates.map(c => c.suspectId)).size >= 2, 'at least two culprit characters survive seed ' + seed);
    const publicCandidates = E.candidates(E.publicView(s));
    for (const event of s.caseWorld.events) assert.ok(publicCandidates.some(c => Object.keys(c).every(k => c[k] === event[k])));
    for (const profile of s.fieldReference.people) {
      assert.equal(profile.routes.length, 6); assert.equal(new Set(profile.routes.map(r => JSON.stringify(r))).size, 6);
      for (const key of ['placeIds', 'toolIds', 'timeIds']) assert.equal(new Set(profile[key]).size, 6);
    }
  }
  assert.equal(pairs.size, 36);
});

test('v2 removes both SEARCH spellings without changing any resources or daily state', () => {
  const s = prepare(make()), saved = JSON.stringify(s);
  for (const event of [{ type: 'SEARCH', recordId: 'portrait' }, { type: 'INVESTIGATE', kind: 'search', recordId: 'portrait' }]) {
    assert.throws(() => call(s, event.type, event)); assert.equal(JSON.stringify(s), saved);
  }
  assert.equal(call(s, 'INVESTIGATE', { kind: 'pass' }).phase, 'discussion');
});

test('a verdict before the daily question preserves investigation, pending, review and seal timing', () => {
  const s = auditFixture(), C = role(s, 'culprit'); s.seals = [{ actorId: C.id, category: 'gender' }];
  const next = call(s, 'AUDIT', { statementId: 'statement-1' });
  assert.equal(next.phase, 'investigate'); assert.equal(next.pending, null); assert.equal(next.review, null); assert.equal(next.kits, 1);
  assert.equal(role(next, 'culprit').sealOutcomes, undefined); assert.equal(next.replayEvents.some(e => e.type === 'seal-result'), false);
  const proposedValue = E.actions.options(E.privateView(next, next.detectiveId)).questions.find(c => c.id !== 'gender').proposedValues[0];
  const category = E.actions.options(E.privateView(next, next.detectiveId)).questions.find(c => c.id !== 'gender').id;
  const asked = call(next, 'QUESTION', { targetId: C.id, category, proposedValue });
  assert.equal(asked.phase, 'answer'); assert.equal(asked.kits, 1);
  assert.throws(() => call(asked, 'AUDIT', { statementId: 'statement-2' }));
  const answered = E.act(asked, { type: 'ANSWER', actorId: C.id, value: E.caseValue(s.secretNPC, category) });
  assert.equal(role(answered, 'culprit').sealOutcomes.length, 1); assert.equal(role(answered, 'culprit').sealOutcome.reason, 'missed');
});

test('two distinct unresolved verdicts may be used in one day without using the daily question', () => {
  const s = auditFixture();
  const first = call(s, 'AUDIT', { statementId: 'statement-1' });
  const second = call(first, 'AUDIT', { statementId: 'statement-2' });
  assert.equal(second.kits, 0); assert.equal(second.phase, 'investigate'); assert.equal(second.questionHistory.length, 0);
  assert.equal(second.facts.filter(f => f.source === 'audit').length, 2);
  assert.equal(call(second, 'INVESTIGATE', { kind: 'pass' }).phase, 'discussion');
});

test('discussion verdicts preserve the daily review; REVIEW_AUDIT uses the same two kits', () => {
  const s = auditFixture('discussion'), originalReview = structuredClone(s.review);
  const first = call(s, 'AUDIT', { statementId: 'statement-1' });
  assert.equal(first.phase, 'discussion'); assert.deepEqual(first.review, originalReview);
  const second = call(first, 'REVIEW_AUDIT', { statementId: 'statement-2' });
  assert.equal(second.kits, 0); assert.equal(second.review.kind, 'audit'); assert.equal(second.review.statementId, 'statement-2');
  assert.throws(() => call(second, 'QUESTION', { targetId: role(second, 'culprit').id, category: 'zone', proposedValue: 0 }));
  assert.equal(call(second, 'ROUND_CONFIRM').round, 4);
});

test('duplicate, malformed and already determined verdicts spend no kit or daily question', () => {
  const s = auditFixture(), same = { ...s.statements[0], id: 'statement-3', speakerId: role(s, 'witness').id };
  s.statements.push(same);
  const first = call(s, 'AUDIT', { statementId: 'statement-1' }), saved = JSON.stringify(first);
  for (const statementId of ['statement-1', 'statement-3', undefined, {}, 'missing']) {
    assert.throws(() => call(first, 'AUDIT', { statementId })); assert.equal(JSON.stringify(first), saved);
  }
  const known = auditFixture(); role(known, 'detective').clues = [{ category: 'tool', value: E.caseValue(known.secretNPC, 'tool') }];
  assert.throws(() => call(known, 'AUDIT', { statementId: 'statement-1' })); assert.equal(known.kits, 2);
  const malformed = auditFixture(); malformed.statements[0].value = 99;
  assert.throws(() => call(malformed, 'AUDIT', { statementId: 'statement-1' })); assert.equal(malformed.kits, 2);
});

test('a false multi-value verdict excludes only that claim and permits another unresolved claim', () => {
  const s = auditFixture(), actual = E.caseValue(s.secretNPC, 'tool');
  s.statements[0].value = (actual + 1) % 12;
  s.statements[1] = { ...s.statements[1], category: 'tool', value: (actual + 2) % 12 };
  const first = call(s, 'AUDIT', { statementId: 'statement-1' });
  assert.equal(first.facts.at(-1).isTrue, false); assert.equal(first.facts.at(-1).value, undefined);
  const second = call(first, 'AUDIT', { statementId: 'statement-2' });
  assert.equal(second.kits, 0); assert.equal(second.facts.at(-1).isTrue, false);
});

test('S always answers memory unknown even with a known clue and exhausted criminal refusals', () => {
  let s = structuredClone(prepare(make())); const S = role(s, 'suspect'), clue = S.clues[0];
  role(s, 'detective').clues = []; s.fieldReference = undefined; s.refusalsUsed = 1;
  s = call(s, 'QUESTION', { targetId: S.id, category: clue.category, proposedValue: clue.value });
  assert.deepEqual(E.privateView(s, S.id).self.answerOptions.legalValues, [null]);
  assert.throws(() => E.act(s, { type: 'ANSWER', actorId: S.id, value: clue.value }));
  const next = E.act(s, { type: 'ANSWER', actorId: S.id, value: null });
  assert.equal(next.refusalsUsed, 1); assert.equal(next.liesUsed, 0); assert.equal(next.phase, 'discussion'); assert.equal(next.review.kind, 'unknown');
  assert.equal(next.log.at(-1).text, S.name + ' · 해당 항목은 기억 불명입니다.');
  assert.throws(() => call(next, 'QUESTION', { targetId: S.id, category: 'time', proposedValue: 0 }));
  for (const view of [E.publicView(next), E.privateView(next, next.detectiveId)]) {
    assert.equal(view.players.filter(p => !p.isDetective).length, 5);
    for (const p of view.players) assert.deepEqual(Object.keys(p).sort(), ['id', 'isDetective', 'name']);
  }
});

test('v2 null response text and shape stay role-neutral for suspect and criminal', () => {
  const result = [];
  for (const kind of ['suspect', 'culprit']) {
    let s = structuredClone(prepare(make())); const actor = role(s, kind);
    role(s, 'detective').clues = []; s.fieldReference = undefined;
    s = call(s, 'QUESTION', { targetId: actor.id, category: 'tool', proposedValue: 0 });
    s = E.act(s, { type: 'ANSWER', actorId: actor.id, value: null });
    result.push({ text: s.log.at(-1).text.slice(actor.name.length), reviewKeys: Object.keys(s.review).sort(), replayKeys: Object.keys(s.replayEvents.at(-1)).sort(), historyKeys: Object.keys(s.questionHistory.at(-1)).sort() });
  }
  assert.deepEqual(result[0], result[1]);
});

test('v2 forced valid person/place coordinates preserve every route and exact tool/time', () => {
  for (const person of E.SUSPECTS) for (const place of E.PLACES) {
    if (!person.access && place.entry) continue;
    const s = make(531, 6, { secret: { suspectId: person.id, placeId: place.id, toolId: 't11', timeId: 'time11' } });
    const candidates = E.candidates(E.privateView(s, s.detectiveId));
    assert.ok(candidates.some(c => Object.keys(s.secretNPC).every(k => c[k] === s.secretNPC[k])));
    assert.ok(new Set(candidates.map(c => c.suspectId)).size >= 2);
    assert.equal(E.caseValue(s.secretNPC, 'tool'), 11); assert.equal(E.caseValue(s.secretNPC, 'time'), 11);
  }
});

test('v2 daily question and explicit skip permit exactly seven days and no repeat question', () => {
  let s = make(93, 2);
  for (let day = 1; day <= 7; day++) {
    s = prepare(s); assert.equal(s.round, day);
    if (day === 1) {
      const question = E.actions.options(E.privateView(s, s.detectiveId)).questions[0], C = role(s, 'culprit');
      s = call(s, 'QUESTION', { targetId: C.id, category: question.id, proposedValue: question.proposedValues[0] });
      assert.throws(() => call(s, 'QUESTION', { targetId: C.id, category: question.id, proposedValue: question.proposedValues[0] }));
      s = E.act(s, { type: 'ANSWER', actorId: C.id, value: E.caseValue(s.secretNPC, question.id) });
    } else s = call(s, 'INVESTIGATE', { kind: 'pass' });
    assert.throws(() => call(s, 'INVESTIGATE', { kind: 'pass' })); s = call(s, 'ROUND_CONFIRM');
  }
  assert.equal(s.phase, 'final'); assert.equal(s.kits, 2);
  assert.equal(call(s, 'ACCUSE', { suspectId: s.secretNPC.suspectId }).winner, 'investigators');
});

test('legacy default generation and serialized games retain exact RNG, one kit and SEARCH', () => {
  const hashes = { 2: '8852c5d69ad76298bdb4a74d14f623f919b8686cac909b7e0876d2a69ce7f7b9', 4: '56025a3cdc156dcda8e46c6cf9f2330bce084e05697166726287b9136e0a8af3', 6: '7b6bf132d20c419991ebb55a2b1469338b79f9d168fb237a0a017109baf4106f' };
  for (const n of [2, 4, 6]) {
    const s = E.makeGame(names(n), { seed: 417 });
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex'), hashes[n]);
    assert.equal(s.detectiveVersion, undefined); assert.equal(s.kits, 1);
    const searched = call(prepare(JSON.parse(JSON.stringify(s))), 'SEARCH', { recordId: 'portrait' });
    assert.equal(searched.review.kind, 'search'); assert.equal(searched.phase, 'discussion');
  }
  const explicit = E.makeGame(names(2), { seed: 417, detectiveVersion: 1 });
  assert.equal(explicit.detectiveVersion, 1); assert.equal(E.publicView(explicit).detectiveVersion, 1); assert.equal(explicit.kits, 1);
});

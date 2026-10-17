'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Party = require('../lib/party-engine.cjs');
const { safeGame } = require('../lib/game-service.cjs');
const names = count => Array.from({ length: count }, (_, index) => '참가자 ' + (index + 1));
const person = (state, role) => state.players.find(player => player.role === role);
function make(count = 6, seed = 17) {
  return Party.makeGame(names(count), { seed, secret: { suspectId: 's0', placeId: 'p0' } });
}
function reveal(state) {
  while (state.phase === 'reveal') state = Party.act(state, { type: 'ROLE_SEEN', actorId: Party.turnOwner(state) });
  return state;
}
function prepare(state, sealCategory, guardCategory, sealRole = 'culprit') {
  state = reveal(state);
  while (state.phase === 'secret') {
    const actorId = Party.turnOwner(state), player = state.players.find(entry => entry.id === actorId);
    const action = player.role === sealRole && sealCategory ? { kind: 'seal', category: sealCategory }
      : player.role === 'suspect' && guardCategory ? { kind: 'guard', category: guardCategory } : { kind: 'pass' };
    state = Party.act(state, { type: 'SECRET_ACTION', actorId, ...action });
  }
  return state;
}
function investigate(state, event) {
  return Party.act(state, { type: 'INVESTIGATE', actorId: state.detectiveId, ...event });
}
function answer(state, value = 0) {
  return Party.act(state, { type: 'ANSWER', actorId: Party.turnOwner(state), value });
}
function outcome(state) { return person(state, 'culprit').sealOutcome; }
function assertPrivateOutcome(state, expected) {
  assert.deepEqual(outcome(state), expected);
  const publicView = Party.publicView(state);
  assert.equal(publicView.sealOutcome, undefined);
  assert.ok(publicView.players.every(player => player.sealOutcome === undefined));
  for (const player of state.players) {
    const view = safeGame(state, player.id);
    assert.deepEqual(view.self.sealOutcome, player.role === 'culprit' ? expected : undefined);
    if (player.role !== 'culprit') assert.equal(view.self.sealOutcomes, undefined);
    assert.equal(view.sealOutcome, undefined);
  }
}

test('new 2–6 player cases give detective exactly one person hint and one scene hint, with distinct witness clues', () => {
  for (let count = 2; count <= 6; count++) for (let seed = 0; seed < 100; seed++) {
    const state = make(count, seed), detective = person(state, 'detective');
    assert.equal(state.rulesVersion, 3);
    assert.equal(detective.clues.length, 2);
    assert.equal(detective.clues.filter(clue => ['coat', 'hand', 'item'].includes(clue.category)).length, 1);
    assert.equal(detective.clues.filter(clue => ['zone', 'light'].includes(clue.category)).length, 1);
    const witnesses = state.players.filter(player => player.role === 'witness');
    assert.ok(witnesses.every(player => player.clues.length === 1));
    const clues = state.players.flatMap(player => player.clues);
    assert.equal(clues.length, 2 + witnesses.length);
    assert.equal(new Set(clues.map(clue => clue.category)).size, clues.length);
    assert.ok(clues.every(clue => clue.value === 0));
    assert.equal(state.kits, 1);
    assert.equal(state.liesUsed, 0);
    if (count === 2) assert.deepEqual(state.facts.map(fact => fact.category).sort(), detective.clues.map(clue => clue.category).sort());
    else assert.deepEqual(state.facts, []);
  }
});

test('ongoing rulesVersion 2 cases preserve all original cards and resources through legal actions', () => {
  let state = JSON.parse(JSON.stringify(make()));
  state.rulesVersion = 2;
  state.players.forEach(player => { player.clues = player.role === 'witness' ? [{ category: player.id === 'u0' ? 'coat' : 'hand', value: 0 }] : []; });
  const cards = structuredClone(state.players), secret = structuredClone(state.secretNPC);
  state = prepare(state);
  state = investigate(state, { kind: 'pass' });
  state = Party.act(state, { type: 'REVIEW_RESULT', actorId: state.detectiveId, kind: 'confirm' });
  assert.equal(state.rulesVersion, 2);
  assert.deepEqual(state.players, cards);
  assert.deepEqual(state.secretNPC, secret);
  assert.equal(state.kits, 1);
});

test('seal success is resolved only after blocked question or search and is private to culprit', () => {
  for (const kind of ['question', 'search']) {
    let state = prepare(make(), 'coat');
    assertPrivateOutcome(state, undefined);
    state = investigate(state, { kind, category: 'coat', targetId: person(state, 'culprit').id });
    assert.equal(state.phase, 'discussion');
    assertPrivateOutcome(state, { round: 1, success: true, reason: 'blocked' });
    assert.deepEqual(Party.publicView(state).questionHistory, [{ round: 1, category: 'coat', status: 'blocked' }]);
    assert.equal(state.kits, 1);
  }
});

test('guarded question never exposes a seal failure while the answer is pending', () => {
  let state = prepare(make(), 'coat', 'coat');
  state = investigate(state, { kind: 'question', category: 'coat', targetId: person(state, 'culprit').id });
  assert.equal(state.phase, 'answer');
  assertPrivateOutcome(state, undefined);
  assert.deepEqual(Party.publicView(state).questionHistory, []);
  state = answer(state);
  assertPrivateOutcome(state, { round: 1, success: false, reason: 'guarded' });
  assert.deepEqual(Party.publicView(state).questionHistory, [{ round: 1, category: 'coat', status: 'answered' }]);
});

test('missed seal after question waits for the reply and survives next round so slow clients can read it', () => {
  let state = prepare(make(), 'coat');
  state = investigate(state, { kind: 'question', category: 'hand', targetId: person(state, 'culprit').id });
  assertPrivateOutcome(state, undefined);
  state = answer(state);
  const expected = { round: 1, success: false, reason: 'missed' };
  assertPrivateOutcome(state, expected);
  state = Party.act(state, { type: 'REVIEW_RESULT', actorId: state.detectiveId, kind: 'confirm' });
  assertPrivateOutcome(state, expected);
  state = prepare(state);
  state = investigate(state, { kind: 'pass' });
  assertPrivateOutcome(state, expected);
});

test('guarded searches, missed searches, and unused pass seals report distinct private failure outcomes', () => {
  for (const scenario of [
    { seal: 'coat', guard: 'coat', event: { kind: 'search', category: 'coat' }, reason: 'guarded' },
    { seal: 'coat', guard: null, event: { kind: 'search', category: 'hand' }, reason: 'missed' },
    { seal: 'coat', guard: null, event: { kind: 'pass' }, reason: 'unused' }
  ]) {
    let state = prepare(make(), scenario.seal, scenario.guard);
    state = investigate(state, scenario.event);
    assertPrivateOutcome(state, { round: 1, success: false, reason: scenario.reason });
  }
});

test('audit bypasses a prepared seal and reports unused only when that investigation resolves', () => {
  let state = prepare(make());
  state = investigate(state, { kind: 'question', category: 'coat', targetId: person(state, 'culprit').id });
  state = answer(state, 1);
  state = Party.act(state, { type: 'REVIEW_RESULT', actorId: state.detectiveId, kind: 'confirm' });
  state = prepare(state, 'coat');
  assertPrivateOutcome(state, undefined);
  state = investigate(state, { kind: 'audit', statementId: 'statement-1' });
  assertPrivateOutcome(state, { round: 2, success: false, reason: 'unused' });
  assert.equal(state.kits, 0);
  assert.equal(state.facts.at(-1).value, 0);
});

test('accomplice seal outcomes are still delivered to culprit only and never expose extra fields', () => {
  let state = prepare(make(), 'coat', null, 'accomplice');
  state = investigate(state, { kind: 'search', category: 'coat' });
  assertPrivateOutcome(state, { round: 1, success: true, reason: 'blocked' });
  const forged = JSON.parse(JSON.stringify(state));
  for (const player of forged.players) player.sealOutcome = { round: 1, success: true, reason: 'blocked', category: 'hand', guardId: 'u999', truth: forged.secretNPC };
  for (const player of forged.players) {
    assert.deepEqual(safeGame(forged, player.id).self.sealOutcome, player.role === 'culprit' ? { round: 1, success: true, reason: 'blocked' } : undefined);
  }
});

test('question history records unknown replies once and never includes the actual hidden answer', () => {
  let state = prepare(make());
  const witness = person(state, 'witness'), category = Party.CATEGORIES.find(entry => !witness.clues.some(clue => clue.category === entry.id)).id;
  state = investigate(state, { kind: 'question', category, targetId: witness.id });
  assert.deepEqual(Party.publicView(state).questionHistory, []);
  state = answer(state, null);
  assert.deepEqual(Party.publicView(state).questionHistory, [{ round: 1, category, status: 'unknown' }]);
  const view = Party.publicView(state);
  assert.equal(view.questionHistory[0].value, undefined);
  assert.equal(view.questionHistory[0].targetId, undefined);
  assert.ok(Object.isFrozen(view.questionHistory[0]));
  const previous = structuredClone(view.questionHistory);
  state = Party.act(state, { type: 'REVIEW_RESULT', actorId: state.detectiveId, kind: 'confirm' });
  assert.deepEqual(Party.publicView(state).questionHistory, previous);
});

test('legacy missing history is read safely without redistributing cards or exposing private outcome', () => {
  const state = JSON.parse(JSON.stringify(make()));
  delete state.questionHistory;
  delete state.rulesVersion;
  assert.deepEqual(Party.publicView(state).questionHistory, []);
  assert.equal(Party.publicView(state).rulesVersion, 1);
  assert.equal(Party.publicView(state).sealOutcome, undefined);
});

test('bounded culprit-only seal outcome history preserves missed notices across multiple fast rounds', () => {
  let state = prepare(make(), 'coat');
  state = investigate(state, { kind: 'pass' });
  state = Party.act(state, { type: 'REVIEW_RESULT', actorId: state.detectiveId, kind: 'confirm' });
  state = prepare(state, 'hand');
  state = investigate(state, { kind: 'question', category: 'hand', targetId: person(state, 'culprit').id });
  const expected = [{ round: 1, success: false, reason: 'unused' }, { round: 2, success: true, reason: 'blocked' }];
  assert.deepEqual(safeGame(state, person(state, 'culprit').id).self.sealOutcomes, expected);
  assert.deepEqual(outcome(state), expected[1]);
  assert.equal(Party.publicView(state).sealOutcomes, undefined);
  for (const player of state.players.filter(entry => entry.role !== 'culprit')) assert.equal(safeGame(state, player.id).self.sealOutcomes, undefined);
  const forged = JSON.parse(JSON.stringify(state)), culprit = person(forged, 'culprit');
  culprit.sealOutcomes = Array.from({ length: 10 }, (_, index) => ({ round: index % 5 + 1, success: false, reason: 'missed', category: 'coat', guardId: 'u999' }));
  const projected = safeGame(forged, culprit.id).self.sealOutcomes;
  assert.equal(projected.length, 5);
  assert.ok(projected.every(entry => Object.keys(entry).sort().join(',') === 'reason,round,success'));
});

test('owner-only local private cards apply the same culprit-only outcome whitelist', () => {
  const state = JSON.parse(JSON.stringify(make()));
  state.phase = 'secret';
  for (let index = 0; index < state.players.length; index++) {
    const player = state.players[index];
    player.sealOutcome = { round: 1, success: false, reason: 'missed', category: 'coat', guardId: 'u999' };
    player.sealOutcomes = [player.sealOutcome];
    state.turnIndex = index;
    const view = Party.privateView(state, player.id);
    if (player.role === 'culprit') {
      assert.deepEqual(view.self.sealOutcome, { round: 1, success: false, reason: 'missed' });
      assert.deepEqual(view.self.sealOutcomes, [{ round: 1, success: false, reason: 'missed' }]);
    } else {
      assert.equal(view.self.sealOutcome, undefined);
      assert.equal(view.self.sealOutcomes, undefined);
    }
  }
});

test('public completed-question history strips unexpected fields and invalid entries', () => {
  const state = JSON.parse(JSON.stringify(make()));
  state.questionHistory = [
    { round: 1, category: 'coat', status: 'blocked', actualValue: 0, guardId: 'u999' },
    { round: 2, category: 'hand', status: 'answered', value: 1, targetId: 'u0' },
    { round: 6, category: 'item', status: 'unknown' },
    { round: 3, category: 'invalid', status: 'unknown' },
    { round: 3, category: 'item', status: 'pending' },
    null
  ];
  assert.deepEqual(Party.publicView(state).questionHistory, [
    { round: 1, category: 'coat', status: 'blocked' },
    { round: 2, category: 'hand', status: 'answered' }
  ]);
});

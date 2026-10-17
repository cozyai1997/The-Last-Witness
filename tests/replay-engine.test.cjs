'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Party = require('../lib/party-engine.cjs');
const { safeGame } = require('../lib/game-service.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
function make(count = 6) { return Party.makeGame(Array.from({ length: count }, (_, index) => '복기 참가자 ' + (index + 1)), { seed: 17, secret: { suspectId: 's0', placeId: 'p0' } }); }
function person(state, role) { return state.players.find(player => player.role === role); }
function reveal(state) { while (state.phase === 'reveal') state = Party.act(state, { type: 'ROLE_SEEN', actorId: Party.turnOwner(state) }); return state; }
function prepare(state, choose = () => ({ kind: 'pass' })) { while (state.phase === 'secret') { const actorId = Party.turnOwner(state); state = Party.act(state, { type: 'SECRET_ACTION', actorId, ...choose(state.players.find(player => player.id === actorId), state) }); } return state; }
function investigate(state, fields) { return Party.act(state, { type: 'INVESTIGATE', actorId: state.detectiveId, ...fields }); }
function finish(state, suspectId = 's0', placeId = 'p0') { return Party.act(state, { type: 'ACCUSE', actorId: state.detectiveId, suspectId, placeId }); }
function replay(state) { return Party.publicView(state).reveal.replay; }
function nextRound(state) { return Party.act(state, { type: 'REVIEW_RESULT', actorId: state.detectiveId, kind: 'confirm' }); }
function assertHidden(state) {
  for (const view of [Party.publicView(state), ...state.players.map(player => safeGame(state, player.id))]) {
    assert.equal(view.replayEvents, undefined); assert.equal(view.replayVersion, undefined); assert.equal(view.replayComplete, undefined); assert.equal(view.replay, undefined); assert.equal(view.reveal, undefined);
    assert.equal(JSON.stringify(view).includes('replay-'), false, 'no replay record reaches active participant projections');
  }
}

test('new 2–6 player games privately capture exact initial clues but reveal no replay before the ending', () => {
  for (let count = 2; count <= 6; count++) {
    const state = make(count); assert.equal(state.replayVersion, 1); assert.equal(state.replayComplete, true); assert.ok(Object.isFrozen(state.replayEvents));
    assert.deepEqual(state.replayEvents.map(event => [event.actorId, event.category, event.value]), state.players.flatMap(player => player.clues.map(clue => [player.id, clue.category, clue.value])));
    assertHidden(state); const privateView = Party.privateView(state, Party.turnOwner(state)); assert.equal(privateView.replayEvents, undefined); assert.equal(privateView.reveal, undefined);
  }
});

test('question, original lie, audit and accusation retain order and get truthful ending-only annotations', () => {
  let state = prepare(reveal(make())); const culprit = person(state, 'culprit');
  state = investigate(state, { kind: 'question', targetId: culprit.id, category: 'coat', proposedValue: 1 }); assertHidden(state);
  state = Party.act(state, { type: 'ANSWER', actorId: culprit.id, value: 1 }); const claim = clone(state.statements[0]); assertHidden(state);
  state = Party.act(state, { type: 'REVIEW_RESULT', actorId: state.detectiveId, kind: 'audit' }); assertHidden(state);
  state = finish(state); const data = replay(state); assert.equal(data.version, 1); assert.equal(data.complete, true); assert.equal(data.source, 'recorded');
  const route = data.events.filter(event => ['question', 'answer', 'audit', 'accusation'].includes(event.type)); assert.deepEqual(route.map(event => event.type), ['question', 'answer', 'audit', 'accusation']);
  assert.equal(route[0].targetId, culprit.id); assert.equal(route[0].proposedValue, 1); assert.equal(route[0].actualValue, 0);
  assert.equal(route[1].value, 1); assert.equal(route[1].actualValue, 0); assert.equal(route[1].isTrue, false); assert.equal(route[1].statementId, claim.id);
  assert.equal(route[2].value, 1); assert.equal(route[2].actualValue, 0); assert.equal(route[2].isTrue, false); assert.equal(route[2].statementId, claim.id);
  assert.equal(route[3].success, true); assert.deepEqual(state.statements[0], { ...claim, audited: true }); assert.equal(state.liesUsed, 1);
  assert.equal(new Set(data.events.map(event => event.id)).size, data.events.length); assert.ok(Object.isFrozen(data)); assert.ok(Object.isFrozen(data.events[0]));
});

test('unknown replies are recorded without inventing a signed claim or a lie', () => {
  let state = prepare(reveal(make())); const witness = person(state, 'witness'); const category = Party.CATEGORIES.find(entry => !witness.clues.some(clue => clue.category === entry.id)).id;
  state = investigate(state, { kind: 'question', targetId: witness.id, category }); state = Party.act(state, { type: 'ANSWER', actorId: witness.id, value: null }); state = finish(state);
  const unknown = replay(state).events.find(event => event.type === 'unknown'); assert.equal(unknown.actorId, witness.id); assert.equal(unknown.value, null); assert.equal(unknown.isTrue, undefined); assert.equal(unknown.statementId, undefined); assert.equal(state.statements.length, 0);
});

test('blocked questions record one attempt, the true sealer, and no fabricated answer', () => {
  let state = prepare(reveal(make()), (player, current) => player.role === 'accomplice' && !current.sabotage ? { kind: 'seal', category: 'coat' } : { kind: 'pass' });
  const accomplice = person(state, 'accomplice'), culprit = person(state, 'culprit'); state = investigate(state, { kind: 'question', targetId: culprit.id, category: 'coat', proposedValue: 1 }); assertHidden(state); state = finish(state);
  const events = replay(state).events; assert.equal(events.filter(event => event.type === 'question').length, 0); const blocked = events.find(event => event.type === 'blocked-question'); assert.equal(blocked.targetId, culprit.id); assert.equal(blocked.proposedValue, 1);
  assert.equal(events.filter(event => event.type === 'answer').length, 0); const resolution = events.find(event => event.type === 'seal-result'); assert.equal(resolution.actorId, accomplice.id); assert.equal(resolution.success, true); assert.equal(resolution.reason, 'blocked'); assert.equal(resolution.category, 'coat');
});

test('guarded, missed and unused seal results are exact and do not appear twice after verification', () => {
  for (const reason of ['guarded', 'missed', 'unused']) {
    let state = prepare(reveal(make()), (player, current) => player.role === 'culprit' && !current.sabotage ? { kind: 'seal', category: 'coat' } : player.role === 'suspect' && reason === 'guarded' ? { kind: 'guard', category: 'coat' } : { kind: 'pass' });
    if (reason === 'unused') state = investigate(state, { kind: 'pass' });
    else { const culprit = person(state, 'culprit'); state = investigate(state, { kind: 'question', targetId: culprit.id, category: reason === 'missed' ? 'hand' : 'coat' }); state = Party.act(state, { type: 'ANSWER', actorId: culprit.id, value: 1 }); state = Party.act(state, { type: 'REVIEW_RESULT', actorId: state.detectiveId, kind: 'audit' }); }
    state = finish(state); const resolutions = replay(state).events.filter(event => event.type === 'seal-result'); assert.equal(resolutions.length, 1); assert.equal(resolutions[0].reason, reason); assert.equal(resolutions[0].success, false);
  }
});

test('search, shares, suggestions, protection and five confirmations preserve their successful action order', () => {
  let state = reveal(make()); const first = state;
  state = prepare(state, player => player.role === 'detective' || player.role === 'witness' ? { kind: 'share', category: player.clues[0].category } : player.role === 'suspect' ? { kind: 'guard', category: 'coat' } : { kind: 'suggest', category: 'light' });
  state = investigate(state, { kind: 'search', category: 'coat' });
  for (let round = 1; round <= 5; round++) { state = nextRound(state); if (round < 5) state = investigate(prepare(state), { kind: 'pass' }); }
  assert.equal(state.phase, 'final'); assertHidden(state); state = finish(state, 's1'); const data = replay(state);
  assert.equal(data.events.filter(event => event.type === 'share').length, 3); assert.equal(data.events.filter(event => event.type === 'guard').length, 1); assert.equal(data.events.filter(event => event.type === 'suggest').length, 2);
  assert.deepEqual(data.events.filter(event => event.type === 'round-confirm').map(event => event.round), [1, 2, 3, 4, 5]); assert.equal(data.events.at(-1).success, false); assert.equal(data.events.find(event => event.type === 'search').actualValue, 0);
  assert.deepEqual(first.replayEvents, make().replayEvents, 'prior immutable state remains unchanged');
});

test('failed actions and free chat do not add replay entries or reveal private material', () => {
  let state = prepare(reveal(make())); const before = clone(state.replayEvents); assert.throws(() => investigate(state, { kind: 'question', targetId: 'missing', category: 'coat' })); assert.deepEqual(state.replayEvents, before);
  state = Party.act(state, { type: 'ADD_NOTE', speakerId: state.detectiveId, text: '거짓말이라고 주장하는 자유 발언입니다.' }); assert.deepEqual(state.replayEvents, before); assertHidden(state);
  assert.throws(() => { state.replayEvents.push({ type: 'answer' }); }); const fresh = make(); assert.equal(fresh.replayEvents.filter(event => event.type === 'question').length, 0);
});

test('ongoing legacy games upgrade to explicitly partial replay without resetting case, resources or past statements', () => {
  let state = prepare(reveal(make())); const culprit = person(state, 'culprit'); state = investigate(state, { kind: 'question', targetId: culprit.id, category: 'coat', proposedValue: 1 }); state = Party.act(state, { type: 'ANSWER', actorId: culprit.id, value: 1 });
  const old = clone(state); delete old.replayVersion; delete old.replayEvents; delete old.replayComplete; const saved = clone(old); state = nextRound(old); assertHidden(state); state = investigate(prepare(state), { kind: 'pass' }); state = finish(state);
  const data = replay(state); assert.equal(data.complete, false); assert.equal(data.source, 'recorded'); const previous = data.events.find(event => event.type === 'answer'); assert.equal(previous.value, 1); assert.equal(previous.isTrue, false); assert.equal(previous.proposedValue, undefined, 'unrecorded original assumptions are not invented');
  assert.deepEqual(state.secretNPC, saved.secretNPC); assert.deepEqual(state.statements, saved.statements); assert.equal(state.kits, saved.kits); assert.equal(state.liesUsed, saved.liesUsed); assert.equal(data.events.filter(event => event.type === 'round-confirm').length, 1);
});

test('already finished legacy games reconstruct official records only and label incomplete data honestly', () => {
  let state = prepare(reveal(make())); const culprit = person(state, 'culprit'); state = investigate(state, { kind: 'question', targetId: culprit.id, category: 'coat', proposedValue: 1 }); state = Party.act(state, { type: 'ANSWER', actorId: culprit.id, value: 1 }); state = finish(state);
  const old = clone(state); delete old.replayVersion; delete old.replayEvents; delete old.replayComplete; const before = clone(old); const data = replay(old); assert.equal(data.source, 'legacy'); assert.equal(data.complete, false);
  assert.equal(data.events.filter(event => event.type === 'question').length, 0); assert.equal(data.events.find(event => event.type === 'answer').actualValue, 0); assert.equal(data.events.find(event => event.type === 'answer').proposedValue, undefined); assert.deepEqual(old, before, 'reading legacy replay does not mutate persisted games');
});

test('early accusations with no investigation expose a valid short replay and settle an unused seal', () => {
  let state = prepare(reveal(make(2)), player => player.role === 'culprit' ? { kind: 'seal', category: 'coat' } : { kind: 'pass' }); state = finish(state); const data = replay(state); assert.equal(data.complete, true); assert.equal(data.events.filter(event => event.type === 'question').length, 0); assert.equal(data.events.find(event => event.type === 'seal-result').reason, 'unused'); assert.equal(data.events.at(-1).type, 'accusation');
});

test('legacy blocked history never invents whether a missing attempt was a question or a search', () => {
  let state = prepare(reveal(make()), (player, current) => player.role === 'culprit' && !current.sabotage ? { kind: 'seal', category: 'coat' } : { kind: 'pass' });
  state = investigate(state, { kind: 'search', category: 'coat' }); state = finish(state); const old = clone(state); delete old.replayVersion; delete old.replayEvents; delete old.replayComplete;
  const events = replay(old).events; assert.equal(events.filter(event => event.type === 'blocked-question' || event.type === 'question').length, 0); const blocked = events.find(event => event.type === 'legacy-blocked'); assert.equal(blocked.category, 'coat'); assert.equal(blocked.targetId, undefined); assert.equal(blocked.proposedValue, undefined);
});

test('an upgraded legacy blocked review cannot fabricate a failed unused seal at an immediate accusation', () => {
  let state = prepare(reveal(make()), (player, current) => player.role === 'culprit' && !current.sabotage ? { kind: 'seal', category: 'coat' } : { kind: 'pass' });
  state = investigate(state, { kind: 'search', category: 'coat' }); const old = clone(state); delete old.replayVersion; delete old.replayEvents; delete old.replayComplete;
  state = finish(old); const data = replay(state); assert.equal(data.complete, false); assert.equal(data.events.some(event => event.type === 'legacy-blocked'), true); assert.equal(data.events.filter(event => event.type === 'seal-result').length, 0, 'the already resolved legacy concealment is not an unused new concealment');
  assert.equal(person(state, 'culprit').sealOutcome.success, true, 'existing successful outcome remains untouched');
});

test('allowlisted public and private records cannot smuggle hidden replay fields before the ending', () => {
  let state = prepare(reveal(make())); const culprit = person(state, 'culprit'); state = investigate(state, { kind: 'question', targetId: culprit.id, category: 'coat' });
  const forged = clone(state), poison = { replayEvents: [{ type: 'secret-answer', actualValue: 0 }], replayComplete: true, replayVersion: 1, actualValue: 1, isTrue: false, secretNPC: { suspectId: 's0', placeId: 'p0' } };
  forged.pending = { ...forged.pending, ...poison }; forged.statements = [{ id: 'statement-1', round: 1, speakerId: culprit.id, category: 'coat', value: 1, audited: false, ...poison }]; forged.facts = [{ id: 'fact-1', round: 1, category: 'light', value: 0, source: 'search', ...poison }]; forged.log = [{ round: 1, type: 'question', text: '질문', ...poison }]; forged.notes = [{ round: 1, speakerId: culprit.id, text: '기록', ...poison }];
  forged.players.forEach(player => player.clues.forEach(clue => Object.assign(clue, poison)));
  assertHidden(forged);
  for (const view of [Party.publicView(forged), Party.privateView(forged, culprit.id), ...forged.players.map(player => safeGame(forged, player.id))]) {
    for (const record of [...view.statements, ...view.facts, ...view.log, ...view.notes, view.pending, ...(view.self?.clues || [])]) for (const key of ['replayEvents', 'replayComplete', 'replayVersion', 'actualValue', 'isTrue', 'secretNPC']) assert.equal(record[key], undefined, key + ' must be allowlisted out');
  }
});

test('ending replay projection rejects unexpected payload fields and recomputes truth rather than trusting stored annotations', () => {
  let state = prepare(reveal(make())); const culprit = person(state, 'culprit'); state = investigate(state, { kind: 'question', targetId: culprit.id, category: 'coat' }); state = Party.act(state, { type: 'ANSWER', actorId: culprit.id, value: 1 }); state = finish(state); const forged = clone(state), answer = forged.replayEvents.find(event => event.type === 'answer'); answer.isTrue = true; answer.actualValue = 1; answer.passwordHash = 'never'; answer.secretNPC = { suspectId: 's1' }; answer.text = '<script>bad</script>';
  const projected = replay(forged).events.find(event => event.type === 'answer'); assert.equal(projected.isTrue, false); assert.equal(projected.actualValue, 0); assert.equal(projected.passwordHash, undefined); assert.equal(projected.secretNPC, undefined); assert.equal(projected.text, undefined);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createService } = require('../lib/game-service.cjs');
const { MemoryStore } = require('../lib/store.cjs');
const E = require('../public/seven-data.js');
const Actions = require('../public/seven-actions.js');
const { runSevenFlow } = require('./seven-live-http.cjs');

test('new default six-seat service completes four seven-day cases with the shared verdict and question rules', async () => {
  const service = createService({ store: new MemoryStore(), sessionSecret: 'detective-v2-default', rateLimit: 10000 });
  const result = await runSevenFlow(async body => {
    try { return { status: 200, data: await service.handle(body, { ip: 'detective-v2-flow' }) }; }
    catch (error) { return { status: error.status, data: { code: error.code } }; }
  });
  assert.equal(result.detectiveVersion, 2); assert.equal(result.starterChecks, 4);
  assert.equal(result.cases.length, 4); assert.ok(result.cases.every(scenario => scenario.detectiveVersion === 2 && scenario.days === 7));
  assert.ok(result.verdictChecks >= 1 && result.verdictChecks <= 2); assert.equal(result.questionIndependenceChecks, 1);
  assert.ok(result.noSpendRejections >= 20); assert.ok(Number.isInteger(result.memoryUnknownChecks));
  assert.equal(result.replayComparisons, 24); assert.equal(result.credentialsSaved, false);
});

async function fixture() {
  const store = new MemoryStore(), service = createService({ store, sessionSecret: 'detective-v2-service', rateLimit: 10000, gameOptions: { rulesVersion: 4, detectiveVersion: 2, seed: 71 } });
  const tokens = [], credentials = [], call = body => service.handle(body, { ip: 'detective-v2-contract' });
  for (let i = 0; i < 6; i++) {
    credentials.push({ name: 'Verdict Seat ' + i, password: 'PrivatePass42' });
    tokens.push((await call({ op: 'register', ...credentials[i] })).token);
  }
  let room = (await call({ op: 'create', token: tokens[0], capacity: 6, requestId: crypto.randomUUID() })).room;
  for (let i = 1; i < 6; i++) room = (await call({ op: 'join', token: tokens[i], code: room.code, requestId: crypto.randomUUID() })).room;
  for (const token of tokens) room = (await call({ op: 'ready', token, ready: true, revision: room.revision, requestId: crypto.randomUUID() })).room;
  room = (await call({ op: 'start', token: tokens[0], revision: room.revision, requestId: crypto.randomUUID() })).room;
  const poll = async i => (await call({ op: 'poll', token: tokens[i] })).room;
  const body = async (i, event) => ({ op: 'action', token: tokens[i], revision: (await poll(i)).revision, requestId: crypto.randomUUID(), event });
  const action = async (i, event) => (await call(await body(i, event))).room;
  const views = await Promise.all(tokens.map((_, i) => poll(i))), roles = views.map(view => view.game.self.role), ids = views.map(view => view.game.self.id);
  const D = roles.indexOf('detective'), C = roles.indexOf('culprit'), A = roles.indexOf('accomplice'), S = roles.indexOf('suspect');
  while (room.game.phase === 'reveal') room = await action(ids.indexOf(room.game.turnOwnerId), { type: 'ROLE_SEEN' });
  const prepare = async () => {
    room = await poll(D);
    for (let i = 5; i >= 0 && room.game.phase === 'secret'; i--) {
      if ((await poll(i)).game.self.canPrepare) room = await action(i, { type: 'SECRET_ACTION', kind: 'ready' });
    }
    assert.equal(room.game.phase, 'investigate'); return room;
  };
  const rejectUnchanged = async (i, event, code) => {
    const before = await poll(i);
    await assert.rejects(call(await body(i, event)), error => code ? error.code === code : error.status === 400);
    const after = await poll(i); assert.equal(after.revision, before.revision); assert.deepEqual(after.game, before.game);
  };
  const falseQuestion = async target => {
    const detective = (await poll(D)).game, secret = (await poll(C)).game.caseSecret;
    for (const question of Actions.options(detective).questions.sort((a, b) => b.proposedValues.length - a.proposedValues.length)) {
      for (const value of question.proposedValues) {
        if (value === E.caseValue(secret, question.id)) continue;
        const claim = { id: 'candidate', round: detective.round, speakerId: ids[target], category: question.id, value, audited: false };
        if (!Actions.auditAllowed({ ...detective, statements: [...detective.statements, claim] }, claim.id)) continue;
        await action(D, { type: 'QUESTION', targetId: ids[target], category: question.id, proposedValue: question.proposedValues[0] });
        await action(target, { type: 'ANSWER', value });
        const answered = (await poll(D)).game, statement = answered.statements.at(-1);
        assert.equal(Actions.auditAllowed(answered, statement.id), true); return statement;
      }
    }
    assert.fail('The deterministic fixture needs an independent unresolved false claim');
  };
  await prepare();
  return { store, service, tokens, credentials, call, poll, body, action, prepare, rejectUnchanged, falseQuestion, D, C, A, S, ids };
}

test('two verdicts share one case budget and concurrent request receipts cannot spend either twice across a service resume', async () => {
  const f = await fixture(), first = await f.falseQuestion(f.C);
  await f.action(f.D, { type: 'ROUND_CONFIRM' }); await f.prepare();
  const before = await f.poll(f.D), auditBody = await f.body(f.D, { type: 'AUDIT', statementId: first.id });
  const duplicates = await Promise.all([f.call(auditBody), f.call(auditBody)]);
  assert.ok(duplicates.every(result => result.room.revision === before.revision + 1 && result.room.game.kits === 1));
  const audited = await f.poll(f.D);
  assert.equal(audited.game.phase, 'investigate'); assert.equal(audited.game.round, 2);
  assert.deepEqual(audited.game.questionHistory, before.game.questionHistory);
  await assert.rejects(f.call({ ...auditBody, requestId: crypto.randomUUID() }), error => error.code === 'REVISION_CONFLICT');

  const oldToken = f.tokens[f.D], resumedService = createService({ store: f.store, sessionSecret: 'detective-v2-service', rateLimit: 10000 });
  const logged = await resumedService.handle({ op: 'login', ...f.credentials[f.D] }, { ip: 'detective-v2-resume' });
  f.tokens[f.D] = logged.token;
  assert.equal(logged.room.game.detectiveVersion, 2); assert.equal(logged.room.game.kits, 1); assert.deepEqual(logged.room.game, audited.game);
  await assert.rejects(f.call({ op: 'poll', token: oldToken }), error => error.status === 401);

  const second = await f.falseQuestion(f.A); assert.notDeepEqual([second.category, second.value], [first.category, first.value]);
  const reviewBody = await f.body(f.D, { type: 'REVIEW_AUDIT' }), competing = { ...reviewBody, requestId: crypto.randomUUID() };
  const attempts = await Promise.allSettled([f.call(reviewBody), f.call(competing)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const acceptedBody = attempts[0].status === 'fulfilled' ? reviewBody : competing, after = await f.poll(f.D);
  assert.equal(after.game.kits, 0); assert.equal(after.game.phase, 'discussion');
  assert.equal(after.game.facts.filter(fact => fact.source === 'audit').length, 2);
  assert.equal(after.game.statements.filter(statement => statement.audited).length, 2);
  const replay = await f.call(acceptedBody); assert.equal(replay.room.revision, after.revision); assert.deepEqual(replay.room.game, after.game);
  await assert.rejects(f.call({ ...acceptedBody, event: { type: 'AUDIT', statementId: first.id } }), error => error.code === 'REQUEST_ID_REUSED');
  await f.rejectUnchanged(f.D, { type: 'AUDIT', statementId: second.id });
});

test('another speaker repeating a proved false proposition and a persisted initially known claim cannot spend a verdict', async () => {
  const f = await fixture(), first = await f.falseQuestion(f.C);
  await f.action(f.D, { type: 'REVIEW_AUDIT' });
  assert.equal((await f.poll(f.D)).game.kits, 1);
  await f.action(f.D, { type: 'ROUND_CONFIRM' }); await f.prepare();
  const detective = (await f.poll(f.D)).game, category = Actions.options(detective).questions.find(question => question.id === first.category);
  assert.ok(category, 'A false multivalue claim excludes only one value, leaving this category unresolved');
  assert.ok(!category.proposedValues.includes(first.value));
  await f.action(f.D, { type: 'QUESTION', targetId: f.ids[f.A], category: category.id, proposedValue: category.proposedValues[0] });
  await f.action(f.A, { type: 'ANSWER', value: first.value });
  const repeated = (await f.poll(f.D)).game, second = repeated.statements.at(-1);
  assert.notEqual(first.speakerId, second.speakerId); assert.equal(second.category, first.category); assert.equal(second.value, first.value);
  assert.equal(Actions.auditAllowed(repeated, second.id), false); assert.ok(!Actions.options(repeated).audits.some(statement => statement.id === second.id));
  await f.rejectUnchanged(f.D, { type: 'AUDIT', statementId: second.id });
  await f.rejectUnchanged(f.D, { type: 'REVIEW_AUDIT' });
  assert.equal((await f.poll(f.D)).game.kits, 1);

  // A persisted fixture may contain a statement that predates stricter question
  // filtering. The server must also enforce the projected audit rule for it.
  const clue = repeated.self.clues[0], document = await f.store.get('witness:world');
  const storedRoom = Object.values(document.value.rooms)[0];
  const known = { id: 'statement-known-initial', round: 1, speakerId: f.ids[f.C], category: clue.category, value: clue.value, audited: false };
  storedRoom.game.statements.push(known);
  assert.equal(await f.store.CAS('witness:world', document.rev, document.value), true);
  const knownView = (await f.poll(f.D)).game;
  assert.equal(Actions.auditAllowed(knownView, known.id), false);
  await f.rejectUnchanged(f.D, { type: 'AUDIT', statementId: known.id });
  for (const statementId of ['missing-statement', null, {}, '__proto__']) await f.rejectUnchanged(f.D, { type: 'AUDIT', statementId });
  assert.equal((await f.poll(f.D)).game.kits, 1);
});

test('a suspect who recovered their identity still answers memory unknown without spending criminal refusal or revealing their role', async () => {
  const f = await fixture();
  for (let round = 1; round <= 2; round++) {
    await f.action(f.D, { type: 'INVESTIGATE', kind: 'pass' }); await f.action(f.D, { type: 'ROUND_CONFIRM' });
    await f.action(f.S, { type: 'SECRET_ACTION', kind: 'memory' }); await f.prepare();
  }
  const suspect = (await f.poll(f.S)).game; assert.equal(suspect.self.identity.known, true);
  const detective = (await f.poll(f.D)).game, criminal = (await f.poll(f.C)).game;
  const question = Actions.options(detective).questions[0]; assert.ok(question);
  assert.ok(detective.players.some(player => player.id === f.ids[f.S] && !player.isDetective));
  await f.action(f.D, { type: 'QUESTION', targetId: f.ids[f.S], category: question.id, proposedValue: question.proposedValues[0] });
  assert.deepEqual((await f.poll(f.S)).game.self.answerOptions.legalValues, [null]);
  await f.rejectUnchanged(f.S, { type: 'ANSWER', value: E.caseValue(criminal.caseSecret, question.id) });
  await f.action(f.S, { type: 'ANSWER', value: null });
  const after = (await f.poll(f.D)).game, criminalAfter = (await f.poll(f.C)).game;
  assert.equal(after.review.kind, 'unknown'); assert.equal(after.review.value, null); assert.deepEqual(after.statements, detective.statements);
  assert.equal(criminalAfter.remainingRefusals, criminal.remainingRefusals); assert.equal(criminalAfter.remainingLies, criminal.remainingLies);
  assert.equal(after.log.at(-1).text.includes('용의자'), false);
  assert.ok(after.players.every(player => Object.keys(player).sort().join(',') === 'id,isDetective,name'));
});

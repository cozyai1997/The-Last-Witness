'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createService } = require('../lib/game-service.cjs');
const { MemoryStore } = require('../lib/store.cjs');
const E = require('../lib/seven-engine.cjs');
const D = require('../public/seven-data.js');
const clone = value => JSON.parse(JSON.stringify(value));
const WORLD = 'witness:world';
let templatePromise;

async function fixture() {
  templatePromise ||= (async () => {
    const store = new MemoryStore();
    const service = createService({ store, sessionSecret: 'pacing-only', rateLimit: 10000, gameOptions: { rulesVersion: 4, seed: 71 } });
    const credentials = [], tokens = [];
    const call = body => service.handle(body, { ip: 'pacing-template' });
    for (let i = 0; i < 6; i++) {
      credentials.push({ name: 'Pacing ' + i, password: 'PrivatePass42' });
      tokens.push((await call({ op: 'register', ...credentials[i] })).token);
    }
    let room = (await call({ op: 'create', token: tokens[0], capacity: 6, requestId: crypto.randomUUID() })).room;
    for (let i = 1; i < 6; i++) room = (await call({ op: 'join', token: tokens[i], code: room.code, requestId: crypto.randomUUID() })).room;
    for (const token of tokens) room = (await call({ op: 'ready', token, ready: true, revision: room.revision, requestId: crypto.randomUUID() })).room;
    room = (await call({ op: 'start', token: tokens[0], revision: room.revision, requestId: crypto.randomUUID() })).room;
    while (room.game.phase === 'reveal') {
      const views = await Promise.all(tokens.map(token => call({ op: 'poll', token })));
      const owner = views.findIndex(view => view.room.game.self.id === room.game.turnOwnerId);
      room = (await call({ op: 'action', token: tokens[owner], revision: room.revision, requestId: crypto.randomUUID(), event: { type: 'ROLE_SEEN' } })).room;
    }
    return { document: await store.get(WORLD), tokens, credentials, code: room.code };
  })();
  const template = await templatePromise, store = new MemoryStore();
  store.documents.set(WORLD, clone(template.document));
  const service = createService({ store, sessionSecret: 'pacing-only', rateLimit: 10000 });
  const tokens = template.tokens.slice();
  const call = body => service.handle(body, { ip: 'pacing-check' });
  const poll = async i => (await call({ op: 'poll', token: tokens[i] })).room;
  const action = async (i, event, extra = {}) => {
    const room = await poll(i);
    return (await call({ op: 'action', token: tokens[i], revision: room.revision, requestId: crypto.randomUUID(), event, ...extra })).room;
  };
  const views = await Promise.all(tokens.map((_, i) => poll(i)));
  const roleIndex = role => views.findIndex(view => view.game.self.role === role);
  const prepare = async () => {
    let room = await poll(0);
    for (let i = 5; i >= 0 && room.game.phase === 'secret'; i--) {
      const own = await poll(i);
      if (own.game.self.canPrepare) room = await action(i, { type: 'SECRET_ACTION', kind: 'ready' });
    }
    assert.equal(room.game.phase, 'investigate');
    return room;
  };
  return { store, service, tokens, credentials: template.credentials, code: template.code, call, poll, action, views, roleIndex, prepare };
}

function assertNeutralPreparation(view, reference) {
  assert.equal(view.flowVersion, 2);
  assert.ok(Array.isArray(view.preparationReadyIds));
  assert.ok(view.players.every(player => Object.keys(player).sort().join(',') === 'id,isDetective,name'));
  for (const field of ['secretNPC', 'caseWorld', 'seed', 'replayEvents', 'liesUsed', 'refusalsUsed']) assert.equal(view[field], undefined);
  assert.equal(view.reveal, undefined);
  assert.equal(view.log.some(entry => entry.type === 'personal' && /기억|제보|봉쇄|보호|memory|report|seal|guard/.test(entry.text)), false);
  if (!['culprit', 'accomplice'].includes(view.self.role)) {
    for (const field of ['caseSecret', 'seals', 'remainingLies', 'remainingRefusals', 'partnerIds']) assert.equal(view[field], undefined);
  }
  if (reference) assert.deepEqual(view.preparationReadyIds, reference);
}

test('simultaneous six-seat preparation is actor-bound, keeps action kinds private, and resumes after login', async () => {
  const f = await fixture(), S = f.roleIndex('suspect'), W = f.roleIndex('witness');
  const initial = await f.poll(S);
  assertNeutralPreparation(initial.game, []);
  assert.notEqual(initial.game.turnOwnerId, initial.game.self.id, 'This test must use a non-owner preparation actor');
  const room = await f.action(S, { type: 'SECRET_ACTION', kind: 'memory', actorId: f.views[W].game.self.id });
  assert.equal(room.game.self.identity.memoryLeft, 1);
  assert.equal(room.game.self.preparationReady, true); assert.equal(room.game.self.canPrepare, false);
  const views = await Promise.all(f.tokens.map((_, i) => f.poll(i)));
  for (const view of views) assertNeutralPreparation(view.game, [room.game.self.id]);
  for (let i = 0; i < views.length; i++) if (i !== S) assert.equal(views[i].game.self.identity.memoryLeft, f.views[i].game.self.identity.memoryLeft);
  const before = JSON.stringify(room.game), previousToken = f.tokens[S];
  const logged = await f.call({ op: 'login', ...f.credentials[S] }); f.tokens[S] = logged.token;
  assert.equal(logged.room.code, f.code); assert.equal(JSON.stringify(logged.room.game), before);
  await assert.rejects(f.call({ op: 'poll', token: previousToken }), error => error.status === 401);
  await assert.rejects(f.action(S, { type: 'SECRET_ACTION', kind: 'memory' }), error => error.status === 403 || error.status === 400);
  assert.equal((await f.poll(S)).game.self.identity.memoryLeft, 1);
  await f.prepare();
});

test('concurrent preparation uses CAS, cannot double-charge a power, and supports safe retry receipts', async () => {
  const f = await fixture(), S = f.roleIndex('suspect'), C = f.roleIndex('culprit');
  const room = await f.poll(S), revision = room.revision;
  const bodies = [
    { op: 'action', token: f.tokens[S], revision, requestId: crypto.randomUUID(), event: { type: 'SECRET_ACTION', kind: 'memory' } },
    { op: 'action', token: f.tokens[C], revision, requestId: crypto.randomUUID(), event: { type: 'SECRET_ACTION', kind: 'seal', category: 'gender' } }
  ];
  const results = await Promise.allSettled(bodies.map(body => f.call(body)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const conflict = results.find(result => result.status === 'rejected'); assert.equal(conflict.reason.code, 'REVISION_CONFLICT');
  const succeeded = results.findIndex(result => result.status === 'fulfilled'), failed = 1 - succeeded;
  const currentS = await f.poll(S), currentC = await f.poll(C);
  assert.equal(currentS.game.self.identity.memoryLeft, succeeded === 0 ? 1 : 2);
  assert.equal(currentC.game.self.sabotageLeft, succeeded === 1 ? 1 : 2);
  const retry = await f.call({ ...bodies[failed], revision: currentS.revision });
  assert.equal(retry.room.revision, revision + 2);
  const duplicate = await f.call(bodies[failed]); assert.equal(duplicate.room.revision, revision + 2);
  assert.equal((await f.poll(S)).game.self.identity.memoryLeft, 1);
  assert.equal((await f.poll(C)).game.self.sabotageLeft, 1);
  await assert.rejects(f.call({ ...bodies[failed], event: { type: 'SECRET_ACTION', kind: 'ready' } }), error => error.code === 'REQUEST_ID_REUSED');
  assert.equal((await f.poll(S)).game.preparationReadyIds.length, 2);
});

test('free direction, testimony and identity memo preserve the active player, daily readiness and certified evidence', async () => {
  const f = await fixture(), S = f.roleIndex('suspect'), W = f.roleIndex('witness'), Dindex = f.roleIndex('detective');
  const initial = await f.poll(S), facts = clone(initial.game.facts), statements = clone(initial.game.statements);
  const category = D.CATEGORIES[0].id;
  const suggestion = await f.action(W, { type: 'SUGGEST', category, text: '서로 모순된 진술을 먼저 대조해 주세요.', speakerId: initial.game.self.id });
  assert.equal(suggestion.game.suggestions.at(-1).kind, 'direction');
  assert.equal(suggestion.game.suggestions.at(-1).speakerId, f.views[W].game.self.id);
  const testimony = await f.action(W, { type: 'OFFER_TESTIMONY', category, value: 0, text: '이것은 아직 검증되지 않은 내 기억입니다.' });
  assert.equal(testimony.game.suggestions.at(-1).kind, 'testimony');
  assert.equal(testimony.game.suggestions.at(-1).value, 0);
  const memo = await f.action(S, { type: 'IDENTITY_MEMO', suspectId: D.SUSPECTS[0].id, text: '나는 이 인물일 가능성이 있다.' });
  assert.equal(memo.game.self.identityGuess.suspectId, D.SUSPECTS[0].id);
  assert.equal(memo.game.self.identity.known, false); assert.equal(memo.game.self.identity.characterId, undefined);
  assert.equal(memo.game.turnOwnerId, initial.game.turnOwnerId);
  assert.deepEqual(memo.game.preparationReadyIds, initial.game.preparationReadyIds);
  assert.deepEqual(memo.game.facts, facts); assert.deepEqual(memo.game.statements, statements);
  const outsider = (await f.poll(W)).game; assert.equal(outsider.self.identityGuess, undefined);
  await assert.rejects(f.action(W, { type: 'IDENTITY_MEMO', suspectId: D.SUSPECTS[1].id, text: '권한 없는 메모' }), error => error.status === 400);
  await f.prepare();
  const investigation = await f.poll(W);
  await f.action(W, { type: 'SUGGEST', category: D.CATEGORIES[1].id, text: '공식 수사 중에도 제안할 수 있습니다.' });
  const after = await f.poll(Dindex); assert.equal(after.game.phase, 'investigate'); assert.equal(after.game.turnOwnerId, investigation.game.turnOwnerId);
  assert.equal(after.game.kits, investigation.game.kits); assert.deepEqual(after.game.facts, facts);
});

test('already acquired original rejects without consuming a day, ability, audit kit or room revision', async () => {
  const f = await fixture(), Dindex = f.roleIndex('detective');
  await f.prepare();
  await f.action(Dindex, { type: 'SEARCH', recordId: 'portrait' });
  await f.action(Dindex, { type: 'ROUND_CONFIRM' }); await f.prepare();
  const before = await f.poll(Dindex);
  await assert.rejects(f.action(Dindex, { type: 'SEARCH', recordId: 'portrait' }), error => error.status === 400);
  const after = await f.poll(Dindex);
  assert.equal(after.revision, before.revision); assert.deepEqual(after.game, before.game);
  const outsider = f.roleIndex('witness');
  await assert.rejects(f.action(outsider, { type: 'SEARCH', recordId: 'scene', actorId: after.game.self.id }), error => error.status === 403);
  assert.deepEqual((await f.poll(Dindex)).game, before.game);
});

test('known questions and publicly resolved ability categories are rejected without charging resources', async () => {
  const f = await fixture(), Dindex = f.roleIndex('detective'), C = f.roleIndex('culprit');
  await f.prepare();
  const detective = await f.poll(Dindex), clue = detective.game.self.clues[0];
  await assert.rejects(f.action(Dindex, { type: 'QUESTION', targetId: f.views[C].game.self.id, category: clue.category, proposedValue: clue.value }), error => error.status === 400);
  assert.deepEqual(await f.poll(Dindex), detective);
  await f.action(Dindex, { type: 'SEARCH', recordId: 'portrait' });
  const original = (await f.poll(Dindex)).game.facts.find(fact => fact.recordId === 'portrait');
  assert.equal(original.allowedValues.length, 1);
  await f.action(Dindex, { type: 'ROUND_CONFIRM' });
  const criminal = await f.poll(C);
  await assert.rejects(f.action(C, { type: 'SECRET_ACTION', kind: 'seal', category: original.category }), error => error.status === 400);
  assert.deepEqual(await f.poll(C), criminal);
  assert.equal(criminal.game.self.sabotageLeft, 2);
  assert.equal(criminal.game.self.canPrepare, true);
});

test('serialized seven-day rooms without flowVersion retain the sequential personal turn contract', async () => {
  const f = await fixture(), document = await f.store.get(WORLD), stored = document.value.rooms[f.code];
  delete stored.game.flowVersion; delete stored.game.preparationReadyIds;
  f.store.documents.set(WORLD, document);
  const room = await f.poll(0), owner = f.views.findIndex(view => view.game.self.id === room.game.turnOwnerId), other = (owner + 1) % 6;
  assert.equal(room.game.rulesVersion, 4); assert.notEqual(room.game.flowVersion, 2);
  await assert.rejects(f.action(other, { type: 'SECRET_ACTION', kind: 'pass' }), error => error.status === 403);
  const moved = await f.action(owner, { type: 'SECRET_ACTION', kind: 'pass' });
  assert.equal(moved.game.phase, 'secret'); assert.notEqual(moved.game.turnOwnerId, room.game.turnOwnerId);
  assert.notEqual(moved.game.flowVersion, 2);
  assert.equal((await f.store.get(WORLD)).value.rooms[f.code].game.flowVersion, undefined, 'Polling or acting cannot silently upgrade a running legacy case');
  assert.equal(moved.game.round, 1); assert.equal(moved.game.maxRounds, 7);
});

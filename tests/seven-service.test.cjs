'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createService } = require('../lib/game-service.cjs');
const { MemoryStore } = require('../lib/store.cjs');
const { runSevenFlow, assertPairedRoutes } = require('./seven-live-http.cjs');

test('paired-route HTTP assertions reject invalid, duplicate, and incompatible public options', () => {
  const E = require('../lib/seven-engine.cjs'), reference = E.publicView(E.makeGame(['Route A','Route B'], { seed: 71 })).fieldReference;
  assert.equal(assertPairedRoutes(reference), 72);
  for (const corrupt of [
    value => { value.people[0].routes[0].toolId = 't999'; },
    value => { value.people[0].routes[1] = { ...value.people[0].routes[0] }; },
    value => { value.people[0].routes.pop(); },
    value => { value.people[0].toolIds = require('../public/seven-data.js').TOOLS.filter(t => t.id !== value.people[0].routes[0].toolId).slice(0,6).map(t => t.id); }
  ]) { const broken = JSON.parse(JSON.stringify(reference)); corrupt(broken); assert.throws(() => assertPairedRoutes(broken)); }
});

test('authenticated six-seat v4 service preserves private identity/report through four seven-day outcomes and reconnects', async () => {
  const service = createService({ store: new MemoryStore(), sessionSecret: 'seven-service-only', rateLimit: 10000, gameOptions: { rulesVersion: 4, seed: 71 } });
  const result = await runSevenFlow(async body => { try { return { status: 200, data: await service.handle(body, { ip: 'seven-integration' }) }; } catch (error) { return { status: error.status, data: { code: error.code } }; } });
  assert.equal(result.cases.length, 4); assert.ok(result.privateChecks > 200); assert.equal(result.replayComparisons, 24); assert.equal(result.credentialsSaved, false); assert.equal(result.pairedRoutes, true); assert.equal(result.pairedRouteChecks, 1728);
  assert.equal(result.simultaneousPreparation, true); assert.ok(result.nonOwnerPreparations >= 100); assert.ok(result.preparationChecks > 100);
  assert.equal(result.freeEventChecks, 3);
});

test('v4 service binds actor identity, validates strict inputs, and CAS receipts cannot consume a turn twice', async () => {
  const service = createService({ store: new MemoryStore(), sessionSecret: 'seven-service-only', gameOptions: { rulesVersion: 4, seed: 17 } });
  const call = body => service.handle(body, { ip: 'seven-authority' }), tokens = [];
  for (const name of ['Authority A','Authority B']) tokens.push((await call({ op: 'register', name, password: 'PrivatePass42' })).token);
  let room = (await call({ op: 'create', token: tokens[0], capacity: 2, requestId: crypto.randomUUID() })).room;
  room = (await call({ op: 'join', token: tokens[1], code: room.code, requestId: crypto.randomUUID() })).room;
  for (let i = 0; i < 2; i++) room = (await call({ op: 'ready', token: tokens[i], ready: true, revision: room.revision, requestId: crypto.randomUUID() })).room;
  room = (await call({ op: 'start', token: tokens[0], revision: room.revision, requestId: crypto.randomUUID() })).room;
  const views = await Promise.all(tokens.map(token => call({ op: 'poll', token }))), ownerIndex = views.findIndex(v => v.room.game.self.id === room.game.turnOwnerId);
  await assert.rejects(call({ op: 'action', token: tokens[1-ownerIndex], revision: room.revision, requestId: crypto.randomUUID(), event: { type: 'ROLE_SEEN', actorId: room.game.turnOwnerId } }), e => e.status === 403);
  const body = { op: 'action', token: tokens[ownerIndex], revision: room.revision, requestId: crypto.randomUUID(), event: { type: 'ROLE_SEEN', actorId: 'forged', role: 'culprit', characterId: 's0', secretNPC: { suspectId: 's0' } } };
  const outcomes = await Promise.all([call(body), call(body)]); assert.equal(outcomes[0].room.revision, room.revision + 1); assert.equal(outcomes[1].room.revision, room.revision + 1);
  await assert.rejects(call({ ...body, requestId: crypto.randomUUID() }), e => e.code === 'REVISION_CONFLICT');
  room = (await call({ op: 'poll', token: tokens[0] })).room;
  await assert.rejects(call({ op: 'action', token: tokens[0], revision: room.revision, requestId: crypto.randomUUID(), event: { type: 'ADD_NOTE', text: { html: '<script>' } } }), e => e.status === 400);
  const before = JSON.stringify(room.game); assert.equal(JSON.stringify((await call({ op: 'poll', token: tokens[0] })).room.game), before);
});

test('new default is v4 while persisted explicit legacy rooms remain byte-for-byte v3 on a new service instance', async () => {
  const store = new MemoryStore(), legacy = createService({ store, sessionSecret: 'version-shared', gameOptions: { seed: 17 } });
  const tokens = [];
  for (const name of ['Legacy A','Legacy B']) tokens.push((await legacy.handle({ op: 'register', name, password: 'PrivatePass42' }, { ip: 'legacy' })).token);
  let room = (await legacy.handle({ op: 'create', token: tokens[0], capacity: 2, requestId: crypto.randomUUID() }, { ip: 'legacy' })).room;
  room = (await legacy.handle({ op: 'join', token: tokens[1], code: room.code, requestId: crypto.randomUUID() }, { ip: 'legacy' })).room;
  for (const token of tokens) room = (await legacy.handle({ op: 'ready', token, ready: true, revision: room.revision, requestId: crypto.randomUUID() }, { ip: 'legacy' })).room;
  room = (await legacy.handle({ op: 'start', token: tokens[0], revision: room.revision, requestId: crypto.randomUUID() }, { ip: 'legacy' })).room; assert.equal(room.game.rulesVersion, 3);
  const modern = createService({ store, sessionSecret: 'version-shared' }), before = JSON.stringify(room);
  const resumed = (await modern.handle({ op: 'poll', token: tokens[0] }, { ip: 'modern' })).room; assert.equal(JSON.stringify(resumed), before);
  const snapshots = await Promise.all(tokens.map(token => modern.handle({ op: 'poll', token }, { ip: 'modern' }))), index = snapshots.findIndex(v => v.room.game.self.id === resumed.game.turnOwnerId);
  const moved = (await modern.handle({ op: 'action', token: tokens[index], revision: resumed.revision, requestId: crypto.randomUUID(), event: { type: 'ROLE_SEEN' } }, { ip: 'modern' })).room; assert.equal(moved.game.rulesVersion, 3);
  const fresh = createService({ store: new MemoryStore(), sessionSecret: 'modern-default' });
  const freshTokens = []; for (const name of ['Modern A','Modern B']) freshTokens.push((await fresh.handle({ op: 'register', name, password: 'PrivatePass42' }, { ip: 'new' })).token);
  let newRoom = (await fresh.handle({ op: 'create', token: freshTokens[0], capacity: 2, requestId: crypto.randomUUID() }, { ip: 'new' })).room;
  newRoom = (await fresh.handle({ op: 'join', token: freshTokens[1], code: newRoom.code, requestId: crypto.randomUUID() }, { ip: 'new' })).room;
  for (const token of freshTokens) newRoom = (await fresh.handle({ op: 'ready', token, ready: true, revision: newRoom.revision, requestId: crypto.randomUUID() }, { ip: 'new' })).room;
  newRoom = (await fresh.handle({ op: 'start', token: freshTokens[0], revision: newRoom.revision, requestId: crypto.randomUUID() }, { ip: 'new' })).room; assert.equal(newRoom.game.rulesVersion, 4); assert.equal(newRoom.game.maxRounds, 7); assert.equal(newRoom.game.flowVersion, 2);
  assert.equal(newRoom.game.detectiveVersion, 2); assert.equal(newRoom.game.kits, 2);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createService, GameError } = require('../lib/game-service.cjs');
const { MemoryStore } = require('../lib/store.cjs');
const E = require('../lib/seven-engine.cjs');

function clientWithTyping() {
  const writes = [];
  const presentation = { busy: () => false, cancel() {}, type(element, text) {
    let done = false, resolve;
    const promise = new Promise(r => { resolve = r; });
    element.textContent = text.slice(0, 1);
    const handle = { element, text, promise, get done() { return done; }, finish() {
      if (done) return;
      done = true; element.textContent = text; resolve({ cancelled: false });
    }, cancel() {
      if (done) return;
      done = true; resolve({ cancelled: true });
    } };
    writes.push(handle); return handle;
  } };
  const source = fs.readFileSync(path.join(__dirname, 'online-ui.test.cjs'), 'utf8');
  const start = source.indexOf('function makeClient('), end = source.indexOf('async function settle()', start);
  const harness = source.slice(start, end)
    .replace("['catalog.js','detective-options.js','case-interface.js','case-replay.js']", "['catalog.js','detective-options.js','case-interface.js','case-replay.js','seven-data.js','seven-actions.js','seven-app.js']")
    .replace('if(options.practice){', 'window.WitnessSevenData=context.WitnessSevenData; if(options.practice){');
  const make = new Function('fs', 'path', 'vm', 'crypto', 'assert', 'GameError', 'publicDir', harness + '; return makeClient;')(fs, path, vm, crypto, assert, GameError, path.join(__dirname, '../public'));
  return { client: make(createService({ store: new MemoryStore() }), 998, { presentation }), writes };
}

function game(phase) {
  const state = E.makeGame(['탐정', '동료'], { seed: 721, flowVersion: 2, detectiveVersion: 2 });
  const g = E.privateView(state, state.detectiveId);
  return { ...g, phase, round: 2, turnOwnerId: g.self.id, kits: 2, facts: [], statements: [], self: { ...g.self, clues: [], canPrepare: phase === 'secret' } };
}
function room(g) {
  return { code: 'ABC234', caseId: 'reading-privacy', capacity: 2, status: 'playing', revision: 1, hostId: g.self.id, meId: g.self.id, members: g.players.map(p => ({ id: p.id, gameId: p.id, name: p.name, ready: true, online: true })), game: g };
}
async function settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }
async function dispatch(client, name) { for (const callback of client.listeners['window-' + name] || []) callback(); await settle(); }

for (const wasPrivate of [false, true]) test('blurring a partial public review unlocks controls without a room update; prior private visibility ' + wasPrivate, async () => {
  const { client, writes } = clientWithTyping(), g = game('discussion');
  g.statements = [{ id: 'statement', round: 2, speakerId: g.players.find(p => p.id !== g.self.id).id, category: 'gender', value: 0, audited: false }];
  g.review = { kind: 'answer', round: 2, targetId: g.statements[0].speakerId, category: 'gender', value: 0, proposedValue: 0, statementId: 'statement', verified: false };
  client.sessions.set('reading-privacy:seven-story:2', '1');
  client.api.acceptRoom(room(g), true); await settle();
  assert.equal(client.api.getModalKind(), 'seven-review');
  assert.equal(writes.length, 1);
  if (wasPrivate) { await client.api.act('seven-private-show', { dataset: {} }); await settle(); }
  const reading = writes.at(-1), countBeforeBlur = writes.length;
  assert.notEqual(reading.element.textContent, reading.text);
  for (const action of ['seven-round-confirm', 'seven-review-audit']) assert.equal(client.document.querySelector('[data-action="' + action + '"]').disabled, true);
  await dispatch(client, 'blur');
  assert.equal(client.api.getModalKind(), 'seven-review');
  assert.equal(client.api.getPrivate(), false);
  assert.equal(client.document.querySelector('[data-seven-typed]').textContent, reading.text);
  for (const action of ['seven-round-confirm', 'seven-review-audit']) assert.equal(client.document.querySelector('[data-action="' + action + '"]').disabled, false);
  await dispatch(client, 'focus');
  assert.equal(writes.length, countBeforeBlur, 'Focus does not restart the completed public text');
  assert.equal(client.api.getRoom().game.phase, 'discussion');
  assert.equal(client.requests.length, 0, 'Completing public text spends no game action');
});

test('blurring a partial public story completes reading while keeping explicit continuation and privacy gates', async () => {
  const { client, writes } = clientWithTyping(), g = game('secret');
  client.api.acceptRoom(room(g), true); await settle();
  assert.equal(client.api.getModalKind(), 'seven-story');
  assert.equal(writes.length, 1);
  assert.equal(client.document.querySelector('[data-action="seven-story-continue"]').disabled, true);
  await dispatch(client, 'blur');
  assert.equal(client.document.querySelector('[data-seven-typed]').textContent, writes[0].text);
  assert.equal(client.document.querySelector('[data-action="seven-story-continue"]').disabled, false);
  assert.equal(client.sessions.has('reading-privacy:seven-story:2'), false, 'Blur does not consume the story');
  await dispatch(client, 'focus');
  assert.equal(client.api.getModalKind(), 'seven-story');
  assert.equal(writes.length, 1);
  await client.api.act('seven-story-continue', { dataset: {} }); await settle();
  assert.equal(client.api.getModalKind(), 'seven-personal');
  assert.equal(client.api.getPrivate(), false);
  assert.ok(client.document.querySelector('[data-action="seven-private-show"]'));
  assert.equal(client.requests.length, 0);
});

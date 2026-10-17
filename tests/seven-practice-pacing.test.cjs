'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const E = require('../lib/seven-engine.cjs');
test('six-seat practice prepares all computers in one shared tick, including a free proposal and power choice', async () => {
  const tasks = new Map(); let id = 0;
  const context = { console, setTimeout(fn) { tasks.set(++id, fn); return id; }, clearTimeout(key) { tasks.delete(key); } };
  context.window = context; vm.createContext(context); vm.runInContext(fs.readFileSync(require.resolve('../public/seven-practice.js'), 'utf8'), context);
  const api = context.WitnessSevenPractice.create({ engine: E });
  let snapshot = await api.start({ count: 6, role: 'detective', seed: 71 }), steps = 0;
  function tick() { const next = tasks.entries().next().value; assert.ok(next); tasks.delete(next[0]); next[1](); }
  while (snapshot.room.game.phase === 'reveal' && steps++ < 12) {
    if (snapshot.room.game.turnOwnerId === snapshot.room.game.self.id) await api.request({ op: 'action', event: { type: 'ROLE_SEEN' } });
    else tick();
    snapshot = await api.request({ op: 'poll' });
  }
  assert.equal(snapshot.room.game.phase, 'secret');
  assert.equal(snapshot.room.game.self.preparationReady, false);
  tick(); snapshot = await api.request({ op: 'poll' });
  assert.equal(snapshot.room.game.preparationReadyIds.length, 5, 'All computers prepare together while the human chooses');
  assert.equal(snapshot.room.game.suggestions.length, 5, 'Optional free contributions do not each add a waiting tick');
  assert.equal(snapshot.room.game.self.preparationReady, false);
  assert.equal(snapshot.room.game.phase, 'secret');
  assert.equal(tasks.size, 0, 'No computer busy loop while waiting for the human');
  api.stop();
});

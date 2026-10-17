'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const E = require('../lib/seven-engine.cjs'), A = require('../public/seven-actions.js');
const plain = value => JSON.parse(JSON.stringify(value));
function harness(engine = E) {
  const tasks = new Map(); let timer = 0;
  const context = { console, WitnessSevenActions: A, setTimeout(fn) { tasks.set(++timer, fn); return timer; }, clearTimeout(id) { tasks.delete(id); } }; context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../public/seven-practice.js'), 'utf8'), context);
  return { api: context.WitnessSevenPractice.create({ engine }), policy: context.WitnessSevenPractice.chooseComputerEvent, next() { const task = tasks.entries().next().value; assert.ok(task, 'A computer must have a scheduled legal action'); tasks.delete(task[0]); task[1](); }, tasks };
}
test('both practice initialization passes explicitly opt into detective version 2', async () => {
  const calls = [], h = harness({ ...E, makeGame(names, options) { calls.push(options); return E.makeGame(names, options); } });
  const result = await h.api.start({ count: 4, role: 'suspect', seed: 71 });
  assert.equal(calls.length, 2); assert.ok(calls.every(options => options.detectiveVersion === 2)); assert.equal(result.room.game.detectiveVersion, 2); h.api.stop();
});
test('v2 computer never falls back to SEARCH and audits only shared eligible statements', () => {
  const h = harness(), g = { rulesVersion: 4, flowVersion: 2, detectiveVersion: 2, phase: 'investigate', round: 4, self: { id: 'u0', role: 'detective', clues: E.CATEGORIES.map(c => ({ category: c.id, value: 0 })) }, players: [{ id: 'u0' }, { id: 'u1' }], facts: [], statements: [], questionHistory: [], kits: 2 };
  assert.deepEqual(plain(h.policy(E, g, () => .3)), { type: 'INVESTIGATE', kind: 'pass' });
  g.phase = 'discussion'; g.review = { kind: 'answer', statementId: 'known' }; g.statements = [{ id: 'known', category: 'hand', value: 1, speakerId: 'u1', audited: false }];
  assert.deepEqual(plain(h.policy(E, g, () => .3)), { type: 'ROUND_CONFIRM' });
});
for (const count of [2, 3, 4, 5, 6]) for (const role of new Set(E.ROLE_PACKS[count])) test('detective-v2 practice finishes seven days with ' + count + ' seats as ' + role, async () => {
  const h = harness(); let result = await h.api.start({ count, role, seed: 71 }), tick = 0; const memory = { records: [], questions: [] };
  assert.equal(result.room.game.detectiveVersion, 2);
  while (result.room.status !== 'finished' && tick++ < 250) {
    const g = result.room.game;
    if (g.turnOwnerId === g.self.id) result = await h.api.request({ op: 'action', event: h.policy(E, g, () => .31, memory) });
    else { h.next(); result = await h.api.request({ op: 'poll' }); }
  }
  assert.ok(tick < 250, 'Every role must finish without an illegal action or bot loop'); assert.equal(result.room.game.round, 7); assert.equal(result.room.game.phase, 'finished'); assert.equal(h.tasks.size, 0);
  assert.equal(result.room.game.reveal.replay.events.some(event => event.type === 'search'), false); h.api.stop();
});

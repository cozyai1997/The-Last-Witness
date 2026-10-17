'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const E = require('../lib/seven-engine.cjs');
const source = fs.readFileSync(path.join(__dirname, '../public/seven-practice.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function harness(engine = E) {
  const tasks = new Map(), changes = [], projections = [];
  let timerId = 0, network = 0, storage = 0;
  const context = { crypto: crypto.webcrypto, Uint32Array, console,
    setTimeout(fn, delay) { assert.ok(delay >= 700 && delay <= 1400); tasks.set(++timerId, fn); return timerId; }, clearTimeout(id) { tasks.delete(id); },
    fetch() { network++; throw Error('No online request from practice'); },
    sessionStorage: { getItem() { storage++; throw Error('No account access'); }, setItem() { storage++; throw Error('No account writes'); } },
    localStorage: { getItem() { storage++; throw Error('No account access'); }, setItem() { storage++; throw Error('No account writes'); } }
  };
  context.window = context; vm.createContext(context); vm.runInContext(source, context);
  const wrapped = { ...engine, privateView(state, id) { const view = engine.privateView(state, id); projections.push({ id, phase: view.phase, known: view.self.identity.known }); return view; } };
  const api = context.WitnessSevenPractice.create({ engine: wrapped });
  return { api, context, tasks, changes, projections, counts: () => ({ network, storage }), next() { const first = tasks.entries().next().value; assert.ok(first, 'A bot action is scheduled'); tasks.delete(first[0]); first[1](); }, policy: context.WitnessSevenPractice.chooseComputerEvent };
}
function assertPrivate(result) {
  const room = result.room; assert.equal(result.account, null); assert.equal(room.practice, true); assert.equal(room.local, true); assert.equal(room.meId, 'practice-human');
  assert.ok(room.members.every(m => !Object.hasOwn(m, 'role') && !Object.hasOwn(m, 'characterId')));
  const g = room.game; assert.equal(g.rulesVersion, 4); assert.equal(g.maxRounds, 7);
  for (const key of ['secretNPC','caseWorld','replayEvents','liesUsed','refusalsUsed']) assert.equal(g[key], undefined);
  assert.ok(g.players.every(p => Object.keys(p).sort().join(',') === 'id,isDetective,name'));
  if (g.phase !== 'finished') assert.equal(g.reveal, undefined);
  if (!['culprit','accomplice'].includes(g.self.role)) for (const key of ['caseSecret','remainingLies','remainingRefusals','partnerIds','seals']) assert.equal(g[key], undefined);
  if (!g.self.identity.known) assert.equal(g.self.identity.characterId, undefined);
}
async function play(h, options) {
  let result = await h.api.start({ ...options, onChange: value => h.changes.push(plain(value)) }), steps = 0;
  const memory = { records: [], questions: [] };
  while (result.room.status !== 'finished' && steps++ < 250) {
    assertPrivate(result); const view = result.room.game;
    if (view.turnOwnerId === view.self.id) result = await h.api.request({ op: 'action', revision: result.room.revision, requestId: 'human-' + steps, event: h.policy(E, view, () => .31, memory) });
    else { h.next(); result = await h.api.request({ op: 'poll' }); }
  }
  assert.ok(steps < 250, 'Seven days finish without blocked bot turns'); assertPrivate(result); return result;
}
for (const count of [2,3,4,5,6]) for (const role of new Set(E.ROLE_PACKS[count])) test('v4 local practice completes seven days with ' + count + ' seats as ' + role, async () => {
  const h = harness(), result = await play(h, { count, role, name: '연습 참가자', seed: 71 });
  assert.equal(result.room.game.round, 7); assert.equal(result.room.game.phase, 'finished'); assert.equal(result.room.game.self.role, role); assert.equal(result.room.game.self.name, '연습 참가자');
  assert.equal(result.room.game.reveal.replay.version, 2); assert.equal(result.room.game.reveal.replay.complete, true);
  assert.deepEqual(plain(result.room.game.reveal.players.map(p => p.role).sort()), E.ROLE_PACKS[count].slice().sort());
  assert.equal(new Set(result.room.game.reveal.players.map(p => p.characterId)).size, count); assert.equal(h.tasks.size, 0); assert.deepEqual(h.counts(), { network: 0, storage: 0 });
  if (count >= 4) {
    const memories = result.room.game.reveal.replay.events.filter(e => e.type === 'memory'); assert.deepEqual(plain(memories.map(e => e.candidates.length)), [2,1]);
    assert.equal(result.room.game.reveal.replay.events.filter(e => e.type === 'report').length, 1);
  }
});
test('practice privacy boundary is detached and actor/revision/receipt protections survive restart', async () => {
  const h = harness(); let result = await h.api.start({ count: 6, role: 'suspect', seed: 17 });
  const initial = plain(result.room.game.self.identity), caseId = result.room.caseId;
  result.room.game.self.identity.candidates.length = 0; result.room.members[0].name = 'forged';
  result = await h.api.request({ op: 'poll' }); assert.deepEqual(plain(result.room.game.self.identity), initial); assert.notEqual(result.room.members[0].name, 'forged');
  while (result.room.game.turnOwnerId !== result.room.game.self.id) { h.next(); result = await h.api.request({ op: 'poll' }); }
  const body = { op: 'action', revision: result.room.revision, requestId: 'duplicate-receipt', event: { type: 'ROLE_SEEN', actorId: 'forged' } };
  const first = await h.api.request(body), repeated = await h.api.request(body); assert.equal(first.room.revision, repeated.room.revision);
  await assert.rejects(h.api.request({ ...body, event: { type: 'ADD_NOTE', text: 'different' } }), e => e.code === 'REQUEST_ID_REUSED');
  await assert.rejects(h.api.request({ op: 'action', revision: first.room.revision - 1, event: { type: 'ADD_NOTE', text: 'stale' } }), e => e.code === 'REVISION_CONFLICT');
  const obsolete = h.tasks.values().next().value;
  result = await h.api.request({ op: 'restart', seed: 18 }); assert.notEqual(result.room.caseId, caseId); assert.equal(result.room.game.self.role, 'suspect');
  h.api.stop(); const count = h.changes.length; obsolete?.(); assert.equal(h.tasks.size, 0); assert.equal(h.changes.length, count); assert.equal((await h.api.request({ op: 'poll' })).room, null);
  for (const options of [{ count: 3, role: 'suspect' }, { count: 5, role: 'accomplice' }, { count: 1 }, { seed: -1 }, { role: 'owner' }]) await assert.rejects(h.api.start(options));
});
test('computer detective uses its candidate projection and S does not read an unearned identity', async () => {
  const wrong = { suspectId: 's11', placeId: 'p5', toolId: 't0', timeId: 'time0' }, h = harness({ ...E, candidates: () => [wrong] });
  const result = await play(h, { count: 2, role: 'culprit', seed: 17 }); assert.deepEqual(plain(result.room.game.accusation), { suspectId: wrong.suspectId });
  const identity = { known: false, memoryLeft: 2 }; Object.defineProperty(identity, 'characterId', { get() { throw Error('Unearned identity read'); } });
  assert.deepEqual(plain(h.policy(E, { phase: 'secret', round: 1, self: { role: 'suspect', identity, clues: [] }, facts: [], statements: [] }, () => .5)), { type: 'SECRET_ACTION', kind: 'memory' });
});
test('WitnessPractice explicitly routes v4 while keeping the legacy default', async () => {
  let selected = null; const legacy = fs.readFileSync(path.join(__dirname, '../public/practice.js'), 'utf8');
  const context = { crypto: crypto.webcrypto, Uint32Array, setTimeout: () => 1, clearTimeout() {}, WitnessSevenPractice: { start(options) { selected = options; return { room: { game: { rulesVersion: 4 } } }; }, active: () => true, request: body => body, stop: () => ({ room: null }) } };
  context.window = context; vm.createContext(context); vm.runInContext(legacy, context);
  const result = await context.WitnessPractice.start({ count: 4, role: 'suspect', rulesVersion: 4 }); assert.equal(selected.role, 'suspect'); assert.equal(result.room.game.rulesVersion, 4); assert.equal(context.WitnessPractice.active(), true); assert.equal(context.WitnessPractice.request({ op: 'poll' }).op, 'poll'); context.WitnessPractice.stop();
});
test('default browser adapter lazily loads the full generated engine without replacing the public catalog', async () => {
  const scripts = [], tasks = new Map(); let id = 0;
  const context = { crypto: crypto.webcrypto, Uint32Array, setTimeout(fn) { tasks.set(++id, fn); return id; }, clearTimeout(key) { tasks.delete(key); },
    fetch() { throw Error('Browser practice cannot call an API'); },
    document: { createElement: () => ({ remove() {} }), head: { appendChild(script) { scripts.push(script.src); assert.equal(script.src, '/seven-practice-engine.js'); vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/seven-practice-engine.js'), 'utf8'), context); script.onload(); } } }
  };
  context.window = context; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/seven-data.js'), 'utf8'), context); const catalog = context.WitnessSevenData;
  vm.runInContext(source, context); assert.equal(scripts.length, 0);
  const result = await context.WitnessSevenPractice.start({ count: 4, role: 'suspect', seed: 17 });
  assert.deepEqual(scripts, ['/seven-practice-engine.js']); assert.equal(result.room.game.rulesVersion, 4); assert.equal(result.room.game.self.identity.candidates.length, 3);
  assert.equal(context.WitnessSevenData, catalog); assert.equal(typeof context.WitnessSevenEngine.act, 'function');
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  assert.equal(hash(fs.readFileSync(path.join(__dirname, '../public/seven-practice-engine.js'))), hash(fs.readFileSync(path.join(__dirname, '../lib/seven-engine.cjs'))), 'The browser practice bundle must contain the exact current engine');
  context.WitnessSevenPractice.stop(); assert.equal(tasks.size, 0);
});
test('stopping during lazy engine loading cannot resurrect a cancelled practice case', async () => {
  let script;
  const context = { crypto: crypto.webcrypto, Uint32Array, setTimeout() { throw Error('Cancelled loading cannot schedule bots'); }, clearTimeout() {},
    document: { createElement: () => ({ remove() {} }), head: { appendChild(value) { script = value; } } }
  };
  context.window = context; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/seven-data.js'), 'utf8'), context); vm.runInContext(source, context);
  const pending = context.WitnessSevenPractice.start({ count: 4, role: 'suspect', seed: 17 }); assert.equal(script.src, '/seven-practice-engine.js');
  context.WitnessSevenPractice.stop(); vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/seven-practice-engine.js'), 'utf8'), context); script.onload();
  assert.equal((await pending).room, null); assert.equal(context.WitnessSevenPractice.active(), false);
});
test('computer policies complete varied cases using each actor privateView exclusively', () => {
  const h = harness(); let finished = 0;
  for (const count of [2,3,4,5,6]) for (let seed = 0; seed < 20; seed++) {
    let state = E.makeGame(Array.from({ length: count }, (_, i) => '정책 ' + i), { seed }), tick = 0, random = seed + 1;
    const rng = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296; };
    const memories = Object.fromEntries(E.publicView(state).players.map(p => [p.id, { records: [], questions: [] }]));
    while (state.phase !== 'finished' && tick++ < 250) {
      const actorId = E.turnOwner(state), view = E.privateView(state, actorId);
      const event = h.policy(E, view, rng, memories[actorId]); state = E.act(state, { ...event, actorId });
    }
    assert.ok(tick < 250, 'All projected bot policies must make progress for count=' + count + ', seed=' + seed); assert.equal(state.round, 7); finished++;
  }
  assert.equal(finished, 100);
});

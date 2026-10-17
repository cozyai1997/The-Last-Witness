'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const E = require('../lib/party-engine.cjs');
const root = path.join(__dirname, '..');
const practiceSource = fs.readFileSync(path.join(root, 'public/practice.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(root, 'lib/party-engine.cjs'), 'utf8').replace('root.WitnessParty = api;', 'root.WitnessPracticeEngine = api;');
const plain = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const tasks = new Map(), delays = [], changes = [], scripts = [];
  let nextId = 0, apiCalls = 0, storageCalls = 0;
  const onlineCatalog = Object.freeze({ onlineOnly: true });
  const context = {
    crypto: crypto.webcrypto, Uint32Array, console, WitnessParty: onlineCatalog,
    setTimeout(fn, delay) { const id = ++nextId; tasks.set(id, { fn, delay }); delays.push(delay); return id; },
    clearTimeout(id) { tasks.delete(id); },
    fetch() { apiCalls++; throw new Error('Practice must never contact any API.'); },
    sessionStorage: { getItem() { storageCalls++; throw new Error('No login token access'); }, setItem() { storageCalls++; throw new Error('No login token writes'); }, removeItem() { storageCalls++; throw new Error('No login token removal'); } },
    localStorage: { getItem() { storageCalls++; throw new Error('No browser account access'); }, setItem() { storageCalls++; throw new Error('No browser account writes'); } },
    document: {
      createElement() { return { remove() {} }; },
      head: { appendChild(script) { scripts.push(script.src); vm.runInContext(engineSource, context); if (options.candidates) context.WitnessPracticeEngine = { ...context.WitnessPracticeEngine, candidates: () => options.candidates }; script.onload(); } }
    }
  };
  context.window = context;
  vm.createContext(context); vm.runInContext(practiceSource, context);
  return {
    api: context.WitnessPractice, context, tasks, delays, changes, scripts, onlineCatalog,
    counts: () => ({ apiCalls, storageCalls }),
    onChange: value => changes.push(plain(value)),
    nextBot() { const item = tasks.entries().next().value; assert.ok(item, 'A computer turn has a scheduled action.'); tasks.delete(item[0]); item[1].fn(); }
  };
}
function valueOf(world, category) {
  const i = E.CATEGORIES.findIndex(c => c.id === category);
  return i < 3 ? E.SUSPECTS.find(p => p.id === world.suspectId).bits[i] : E.PLACES.find(p => p.id === world.placeId).bits[i - 3];
}
function humanEvent(view) {
  if (view.phase === 'reveal') return { type: 'ROLE_SEEN' };
  if (view.phase === 'secret') { const clue = view.self.clues.find(c => !view.self.shared.includes(c.category)); return clue && !(view.rulesVersion >= 2 && view.players.length === 2) ? { type: 'SECRET_ACTION', kind: 'share', category: clue.category } : { type: 'SECRET_ACTION', kind: 'pass' }; }
  if (view.phase === 'investigate') {
    const pool = E.candidates(view), category = E.CATEGORIES.find(c => !view.facts.some(f => f.category === c.id))?.id;
    if (pool.length < 2 || !category) return { type: 'INVESTIGATE', kind: 'pass' };
    return { type: 'INVESTIGATE', kind: 'question', targetId: view.players.find(p => p.id !== view.self.id).id, category, proposedValue: 1 };
  }
  if (view.phase === 'answer') { const known = view.self.clues.find(c => c.category === view.pending.category) || view.facts.find(f => f.category === view.pending.category); return { type: 'ANSWER', value: view.caseSecret ? valueOf(view.caseSecret, view.pending.category) : known ? known.value : null }; }
  if (view.phase === 'discussion') {
    if (view.review) return view.review.kind === 'answer' && !view.review.verified && view.kits > 0 && view.round >= 3 ? { type: 'REVIEW_RESULT', kind: 'audit' } : { type: 'REVIEW_RESULT', kind: 'confirm' };
    if (view.round < 5) return { type: 'END_ROUND' };
  }
  if (view.phase === 'final' || view.phase === 'discussion' && view.round === 5) { const pick = E.candidates(view)[0]; return { type: 'ACCUSE', ...pick }; }
  assert.fail('Unexpected human phase: ' + view.phase);
}
function assertSafe(data) {
  assert.equal(data.account, null); const room = data.room; if (!room) return;
  assert.equal(room.code, 'PRACTICE'); assert.equal(room.practice, true); assert.equal(room.local, true); assert.equal(room.mode, 'practice');
  assert.match(room.caseId, /^practice-/); assert.equal(room.meId, 'practice-human');
  assert.equal(room.members.filter(m => !m.isBot).length, 1); assert.ok(room.members.every(m => !Object.hasOwn(m, 'role') && !Object.hasOwn(m, 'clues')));
  const g = room.game; assert.equal(g.secretNPC, undefined); assert.equal(g.liesUsed, undefined); assert.equal(g.guard, undefined);
  assert.ok(g.players.every(p => Object.keys(p).every(k => ['id', 'name', 'isDetective'].includes(k))));
  if (!['culprit', 'accomplice'].includes(g.self.role)) for (const key of ['caseSecret', 'remainingLies', 'partnerIds', 'sabotage']) assert.equal(g[key], undefined);
  if (g.phase !== 'finished') assert.equal(g.reveal, undefined);
}
async function play(h, options) {
  let result = await h.api.start({ ...options, onChange: h.onChange }), steps = 0;
  while (result.room.status !== 'finished' && steps++ < 300) {
    assertSafe(result); const view = result.room.game;
    if (view.turnOwnerId === view.self.id) result = await h.api.request({ op: 'action', revision: result.room.revision, requestId: 'human-' + steps, event: humanEvent(view) });
    else { h.nextBot(); result = await h.api.request({ op: 'poll' }); }
  }
  assert.ok(steps < 300, 'All computer/human turns complete without getting stuck.'); assertSafe(result); return result;
}

for (const count of [2, 3, 4, 5, 6]) for (const role of ['detective', 'culprit']) test('local practice: ' + count + ' seats with a human ' + role + ' complete five rounds', async () => {
  const h = harness(), result = await play(h, { count, role, name: '테스트 플레이어', seed: 17 });
  assert.equal(result.room.game.self.role, role); assert.equal(result.room.game.self.name, '테스트 플레이어'); assert.equal(result.room.game.round, 5); assert.equal(result.room.game.phase, 'finished'); assert.equal(result.room.members.length, count);
  assert.deepEqual(plain(result.room.game.reveal.players.map(p => p.role)).sort(), plain(E.ROLE_PACKS[count]).sort());
  assert.equal(h.context.WitnessParty, h.onlineCatalog, 'The online public catalog is never replaced.'); assert.deepEqual(h.scripts, ['/practice-engine.js']);
  assert.ok(h.delays.length > 0 && h.delays.every(ms => ms >= 700 && ms <= 1400)); assert.deepEqual(h.counts(), { apiCalls: 0, storageCalls: 0 });
  assert.equal(h.tasks.size, 0, 'A completed match has no bot timer.'); assert.equal(h.changes.at(-1).room.status, 'finished');
});

test('local practice: random role, detached projection, duplicate action receipt and actor binding', async () => {
  const h = harness(); let result = await h.api.start({ count: 6, role: 'random', seed: 29, onChange: h.onChange }); assertSafe(result);
  const revision = result.room.revision, beforeClues = plain(result.room.game.self.clues); result.room.game.self.clues.push({ category: 'coat', value: 1 }); result.room.members[0].name = 'forged';
  result = await h.api.request({ op: 'poll' }); assert.equal(result.room.revision, revision); assert.deepEqual(plain(result.room.game.self.clues), beforeClues); assert.notEqual(result.room.members[0].name, 'forged');
  while (result.room.game.turnOwnerId !== result.room.game.self.id) { h.nextBot(); result = await h.api.request({ op: 'poll' }); }
  const event = humanEvent(result.room.game), body = { op: 'action', requestId: 'practice-receipt', revision: result.room.revision, event: { ...event, actorId: 'u999', speakerId: 'u999' } };
  const once = await h.api.request(body), twice = await h.api.request(body); assert.equal(twice.room.revision, once.room.revision);
  h.api.stop(); assert.equal(h.api.active(), false); assert.equal(h.tasks.size, 0);
});

test('local practice: restart gives a fresh case and higher revision, and stop cancels stale bot callbacks', async () => {
  const h = harness(); let result = await h.api.start({ count: 4, role: 'culprit', seed: 17, onChange: h.onChange });
  while (h.tasks.size === 0) { result = await h.api.request({ op: 'action', event: humanEvent(result.room.game) }); }
  const oldTask = h.tasks.values().next().value.fn, previousCase = result.room.caseId, previousRevision = result.room.revision;
  const restarted = await h.api.request({ op: 'restart', seed: 18 }); assert.notEqual(restarted.room.caseId, previousCase); assert.ok(restarted.room.revision > previousRevision); assert.equal(restarted.room.game.self.role, 'culprit');
  h.api.stop(); const notifications = h.changes.length; oldTask(); assert.equal(h.changes.length, notifications); assert.equal(h.tasks.size, 0); assert.equal((await h.api.request({ op: 'poll' })).room, null); assert.equal((await h.api.request({ op: 'leave' })).room, null);
  await assert.rejects(() => h.api.request({ op: 'action', event: { type: 'ROLE_SEEN' } }), e => e.status === 409);
});

test('local practice: an out-of-turn human cannot drive a bot, and no account or server operation is supported', async () => {
  const h = harness(); let result = await h.api.start({ count: 3, role: 'detective', seed: 17 });
  while (result.room.game.turnOwnerId === result.room.game.self.id) result = await h.api.request({ op: 'action', event: humanEvent(result.room.game) });
  await assert.rejects(() => h.api.request({ op: 'action', event: { type: 'ROLE_SEEN', actorId: result.room.game.turnOwnerId } }), e => e.status === 403);
  for (const op of ['login', 'register', 'create', 'join', 'ready', 'start', 'kick']) await assert.rejects(() => h.api.request({ op }));
  assert.deepEqual(h.counts(), { apiCalls: 0, storageCalls: 0 }); h.api.stop();
});

test('local practice: the computer detective accuses from its candidate view, rather than the actual concealed case', async () => {
  const initial = E.makeGame(['a', 'b'], { seed: 17 }), secret = initial.secretNPC;
  const alternatives = E.SUSPECTS.flatMap(s => E.PLACES.map(p => ({ suspectId: s.id, placeId: p.id }))).filter(w => w.suspectId !== secret.suspectId || w.placeId !== secret.placeId).slice(0, 2);
  const h = harness({ candidates: alternatives }), result = await play(h, { count: 2, role: 'culprit', seed: 17 });
  assert.ok(alternatives.some(w => w.suspectId === result.room.game.accusation.suspectId && w.placeId === result.room.game.accusation.placeId)); assert.equal(result.room.game.winner, 'criminals', 'A test-supplied ambiguous candidate list does not get overridden by hidden truth.');
});

test('local practice: validation and lazy loading leave online identity untouched', async () => {
  const h = harness(); assert.equal(h.scripts.length, 0); assert.equal(h.api.active(), false);
  for (const options of [{ count: 1 }, { count: 7 }, { role: 'admin' }, { seed: -1 }, { seed: 1.5 }, { name: 'x'.repeat(21) }]) await assert.rejects(() => h.api.start(options));
  assert.equal(h.scripts.length, 0); assert.deepEqual(h.counts(), { apiCalls: 0, storageCalls: 0 }); assert.equal(h.context.WitnessParty, h.onlineCatalog);
});

test('local practice: only the culprit receives a settled failed seal outcome', async t => {
  const h = harness(); t.after(() => h.api.stop());
  let result = await h.api.start({ count: 2, role: 'culprit', seed: 17 });
  while (result.room.game.phase === 'reveal') {
    if (result.room.game.turnOwnerId === result.room.game.self.id) result = await h.api.request({ op: 'action', event: { type: 'ROLE_SEEN' } });
    else { h.nextBot(); result = await h.api.request({ op: 'poll' }); }
  }
  assert.equal(result.room.game.phase, 'secret');
  const initial = E.makeGame(['a', 'b'], { seed: 17 });
  const known = initial.players.find(p => p.role === 'detective').clues[0].category;
  result = await h.api.request({ op: 'action', event: { type: 'SECRET_ACTION', kind: 'seal', category: known } });
  assert.equal(result.room.game.self.sealOutcome, undefined, 'a prepared seal has no premature outcome');
  h.nextBot(); result = await h.api.request({ op: 'poll' });
  if (result.room.game.phase === 'answer') result = await h.api.request({ op: 'action', event: { type: 'ANSWER', value: valueOf(result.room.game.caseSecret, result.room.game.pending.category) } });
  assert.equal(result.room.game.phase, 'discussion');
  assert.equal(result.room.game.self.sealOutcome?.round, 1);
  assert.equal(result.room.game.self.sealOutcome?.success, false);
  assert.ok(['missed', 'unused'].includes(result.room.game.self.sealOutcome?.reason));
  assert.equal(result.room.game.self.sealOutcomes.length, 1);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../public/seven-data.js');
const A = require('../public/seven-actions.js');
const view = () => ({ facts: [], statements: [], questionHistory: [], self: { clues: [] } });

test('questions combine personal knowledge, certified ranges and false audits', () => {
  const g = view();
  g.self.clues.push({ category: 'gender', value: 0 });
  g.facts.push({ category: 'tool', source: 'record', recordId: 'tool', allowedValues: [0, 2, 4] });
  g.statements.push({ id: 'lie', category: 'tool', value: 2, audited: true, isTrue: false });
  const options = A.options(g);
  assert.ok(!options.questions.some(c => c.id === 'gender'));
  assert.deepEqual(options.questions.find(c => c.id === 'tool').proposedValues, [0, 4]);
  assert.equal(A.questionAllowed(g, 'tool', 2), false);
  assert.equal(A.questionAllowed(g, 'tool', 0), true);
});

test('acquired originals cannot be selected twice and blocked originals remain available', () => {
  const g = view();
  g.facts.push({ category: 'hand', source: 'record', recordId: 'portrait', allowedValues: [0] });
  g.questionHistory.push({ round: 1, recordId: 'tool', category: 'tool', status: 'blocked' });
  const records = A.options(g).records;
  assert.equal(records.find(r => r.id === 'portrait').available, false);
  assert.equal(records.find(r => r.id === 'portrait').acquired, true);
  assert.equal(records.find(r => r.id === 'tool').available, true);
});

test('ability targets use public progress only, ignoring criminal answers and private clues', () => {
  const g = view();
  g.self.clues.push({ category: 'gender', value: 0 });
  g.caseSecret = { suspectId: 's0', placeId: 'p0', toolId: 't0', timeId: 'time0' };
  assert.equal(A.abilityAllowed(g, 'gender'), true);
  g.facts.push({ category: 'gender', value: 0, source: 'record', recordId: 'portrait' });
  assert.equal(A.abilityAllowed(g, 'gender'), false);
  assert.equal(A.abilityAllowed(g, '__proto__'), false);
  const before = A.options(g);
  g.caseSecret = { suspectId: 's11', placeId: 'p11', toolId: 't11', timeId: 'time11' };
  g.seals = [{ category: 'time' }];
  assert.deepEqual(A.options(g), before);
});

test('unverified offers and manual exclusions never become certified question filters', () => {
  const g = view();
  g.suggestions = [{ kind: 'testimony', category: 'hand', value: 0 }];
  g.marked = { person: D.SUSPECTS.map(p => p.id) };
  assert.equal(A.questionAllowed(g, 'hand', 0), true);
  assert.equal(A.questionAllowed(g, 'hand', 1), true);
  assert.equal(A.options(g).remaining.person.length, 12);
});

test('question history keeps source, target and retry status without hidden memory', () => {
  const g = view();
  g.questionHistory = [{ round: 1, targetId: 'u2', category: 'tool', status: 'unknown' }, { round: 2, targetId: 'u1', category: 'time', status: 'blocked' }];
  assert.deepEqual(A.history(g, 'u2', 'tool'), [g.questionHistory[0]]);
  assert.equal(A.questionAllowed(g, 'tool', 0), true);
});

test('excluded cards name sufficient permitted evidence instead of revealing hidden crime coordinates', () => {
  const g = view(), excluded = D.SUSPECTS.find(p => p.hand === 0);
  g.facts.push({ category: 'hand', value: 1, source: 'record', recordId: 'portrait' });
  g.caseSecret = { suspectId: 'never-show-this' };
  const reasons = A.exclusionReasons(g, 'person', excluded.id);
  assert.ok(reasons.some(r => /주로 쓰는 손/.test(r.text)));
  assert.ok(reasons.some(r => /목격 스케치/.test(r.label)));
  assert.doesNotMatch(JSON.stringify(reasons), /never-show-this/);
  assert.deepEqual(A.exclusionReasons(g, 'person', D.SUSPECTS.find(p => p.hand === 1).id), []);
  const privateOnly = view(); privateOnly.self.clues.push({ category: 'hand', value: 1 });
  assert.ok(A.exclusionReasons(privateOnly, 'person', excluded.id).some(r => r.source === 'private'));
});

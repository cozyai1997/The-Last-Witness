'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../lib/party-engine.cjs');
const helperPath = path.join(__dirname, '../public/detective-options.js');
function api() { assert.ok(fs.existsSync(helperPath), 'shared detective option helper exists'); return require(helperPath); }
function view(fields = {}) { return { phase: 'investigate', round: 2, players: [{ id: 'd', name: '탐정' }, { id: 'c', name: '상대' }], detectiveId: 'd', self: { id: 'd', name: '탐정', role: 'detective', clues: [], shared: [] }, facts: [], statements: [], questionHistory: [], kits: 1, ...fields }; }
function ui(drafts = {}) {
  const context = { window: { WitnessParty: G, WitnessDetectiveOptions: api() } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/case-interface.js'), 'utf8'), context);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return context.window.WitnessCaseUI.create({ G, drafts, esc, icon: () => '', options: (all, selected) => all.map(x => '<option value="' + x.id + '"' + (selected === x.id ? ' selected' : '') + '>' + (x.label || x.name) + '</option>').join(''), category: id => G.CATEGORIES.find(c => c.id === id), playerName: id => id === 'd' ? '탐정' : '상대', disabled: value => value ? ' disabled' : '', mine: () => true, fieldValue: () => '', roleLabel: role => G.ROLES[role].label });
}
test('questions omit own true clues, official facts, statements, unknown answers and historically blocked categories', () => {
  const g = view({ self: { role: 'detective', clues: [{ category: 'coat', value: 0 }] }, facts: [{ category: 'zone', value: 1 }], statements: [{ category: 'hand', value: 1 }], questionHistory: [{ round: 1, category: 'item', status: 'unknown' }, { round: 2, category: 'light', status: 'blocked' }] });
  assert.deepEqual(api().availableCategories(g), []);
  assert.deepEqual(api().availableCategories(view({ questionHistory: [{ category: 'coat', status: 'answered' }] })).map(c => c.id), ['hand', 'item', 'zone', 'light']);
  assert.deepEqual(api().availableCategories(view({ review: { kind: 'unknown', category: 'item' } })).map(c => c.id), ['coat', 'hand', 'zone', 'light']);
  assert.deepEqual(api().availableCategories(view({ review: { kind: 'blocked', category: 'light' } })).map(c => c.id), ['coat', 'hand', 'item', 'zone']);
});
test('question selections normalize stale category and assumption together; an exhausted list has no question', () => {
  const g = view({ facts: [{ category: 'coat', value: 0 }] });
  let selected = api().questionSelection(g, { category: 'coat', proposedValue: '8' });
  assert.equal(selected.category, 'hand'); assert.equal(selected.proposedValue, 0);
  assert.deepEqual(selected.values, [{ value: 0, label: '왼손잡이' }, { value: 1, label: '오른손잡이' }]);
  selected = api().questionSelection(g, { category: 'zone', proposedValue: '1' });
  assert.equal(selected.category, 'zone'); assert.equal(selected.proposedValue, 1);
  const empty = api().questionSelection(view({ facts: G.CATEGORIES.map(c => ({ category: c.id, value: 0 })) }), { category: 'coat', proposedValue: 1 });
  assert.equal(empty.category, null); assert.equal(empty.proposedValue, null); assert.deepEqual(empty.values, []);
});
test('legacy completed official logs are read without treating pending questions or free speech as completed investigations', () => {
  const g = view({ questionHistory: undefined, log: [
    { type: 'blocked', text: '수사 봉쇄 · 외투 색상 · 이번 라운드의 수사가 종료되었습니다.' },
    { type: 'unknown', text: '참가자 · 주로 쓰는 손: 모름' },
    { type: 'question', text: '참가자에게 질문 · 착용 물품' },
    { type: 'note', text: '수사 봉쇄 · 장소 구역 · 이번 라운드의 수사가 종료되었습니다.' }
  ], notes: [{ text: '참가자 · 조명: 모름' }] });
  assert.deepEqual(api().availableCategories(g).map(c => c.id), ['item', 'zone', 'light']);
});
test('accusation options use official evidence and detective memories, preserve possible lies, and ignore manual exclusions', () => {
  const g = view({ self: { role: 'detective', clues: [{ category: 'coat', value: 1 }] }, facts: [{ category: 'zone', value: 0 }], statements: [{ category: 'hand', value: 0, audited: false }], excluded: ['s4', 'p0'] });
  const before = JSON.stringify(g), options = api().accusationCandidates(g);
  assert.deepEqual(options.suspects.map(s => s.id), ['s4', 's5', 's6', 's7']);
  assert.deepEqual(options.places.map(p => p.id), ['p0', 'p1']);
  assert.equal(JSON.stringify(g), before, 'filtering does not mutate safe view or private clues');
  assert.equal(api().accusationCandidates(view()).suspects.length, 8);
  assert.equal(api().accusationCandidates(view()).places.length, 4);
});
test('verified lie styling requires completed verification and compares an old audit against its original statement', () => {
  const answer = view({ review: { kind: 'answer', category: 'hand', value: 1, actualValue: 0, verified: true, statementId: 's1' }, statements: [{ id: 's1', category: 'hand', value: 1, audited: true }] });
  assert.equal(api().reviewVerdict(answer), 'lie');
  let html = ui().review(answer); assert.match(html, /class="case-review is-verified-lie"/); assert.match(html, /거짓 진술로 확인했습니다/);
  const unverified = { ...answer, review: { ...answer.review, verified: false } };
  assert.equal(api().reviewVerdict(unverified), null); assert.doesNotMatch(ui().review(unverified), /is-verified-lie|거짓 진술로 확인했습니다/);
  const trueAnswer = { ...answer, review: { ...answer.review, value: 0 } };
  assert.equal(api().reviewVerdict(trueAnswer), 'truth'); assert.doesNotMatch(ui().review(trueAnswer), /is-verified-lie/);
  const oldAudit = { ...answer, review: { ...answer.review, kind: 'audit', value: 0 } };
  assert.equal(api().reviewVerdict(oldAudit), 'lie'); assert.match(ui().review(oldAudit), /is-verified-lie/);
  assert.equal(api().reviewVerdict(view({ review: { kind: 'search', value: 0, actualValue: 0, verified: true } })), null);
});
test('investigation renders matching filtered category and assumption options, and disables exhausted questions', () => {
  const drafts = { questionCategory: 'coat', questionProposed: '1' }, g = view({ facts: [{ category: 'coat', value: 0 }] });
  const html = ui(drafts).investigation(g, 'question');
  assert.equal(drafts.questionCategory, 'hand'); assert.equal(drafts.questionProposed, '0');
  assert.doesNotMatch(html, /<option value="coat"/); assert.match(html, /왼손잡이/); assert.doesNotMatch(html, /짙은 외투/);
  const empty = ui().investigation(view({ facts: G.CATEGORIES.map(c => ({ category: c.id, value: 0 })) }), 'question');
  assert.match(empty, /data-action="question"[^>]*disabled/); assert.match(empty, /질문할 새 항목이 없습니다/);
  assert.match(empty, /data-id="search"/); assert.match(empty, /data-id="audit"/); assert.match(empty, /data-action="skip"/);
});

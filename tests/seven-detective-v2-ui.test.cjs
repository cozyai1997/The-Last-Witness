'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const D = require('../public/seven-data.js'), A = require('../public/seven-actions.js'), UI = require('../public/seven-app.js');
function view(phase = 'investigate') {
  return { rulesVersion: 4, flowVersion: 2, detectiveVersion: 2, round: 3, maxRounds: 7, phase, detectiveId: 'u0', turnOwnerId: 'u0', kits: 2,
    players: [{ id: 'u0', name: '탐정닉', isDetective: true }, { id: 'u1', name: '익명 하나', isDetective: false }, { id: 'u2', name: '익명 둘', isDetective: false }],
    self: { id: 'u0', name: '나', role: 'detective', clues: [{ category: 'hand', value: 0 }, { category: 'entry', value: 1 }], identity: { known: false } },
    facts: [], statements: [{ id: 'past', round: 1, speakerId: 'u1', category: 'tool', value: 2, audited: false }, { id: 'known', round: 1, speakerId: 'u2', category: 'hand', value: 1, audited: false }], questionHistory: [], notes: [] };
}
function ui(g, extra = {}) { return UI.create({ data: D, actions: A, getGame: () => g, ...extra }); }
test('v2 offers one daily question, all anonymous targets and separate case-wide verdicts without SEARCH', async () => {
  const g = view(), sent = [], U = ui(g, { send: async event => sent.push(event) });
  const html = U.personal(g, true), board = U.render(g);
  assert.match(html, /오늘의 공식 질문/); assert.match(html, /사건 전체 두 번/);
  assert.match(html, /value="u1"/); assert.match(html, /value="u2"/);
  assert.doesNotMatch(html, /data-action="seven-search"|data-id="search"|탐정의 공식 수사/);
  assert.match(board, /공식 질문/); assert.match(board, /2 \/ 2/); assert.doesNotMatch(board, /공식 수사 <b>하루 1회/);
  await U.handle('seven-search', { id: 'tool' }); assert.equal(sent.length, 0);
  await U.handle('seven-tab', { id: 'search' }); assert.doesNotMatch(U.personal(g, true), /data-action="seven-search"/);
  delete g.detectiveVersion; assert.match(ui(g).personal(g, true), /data-id="search"/); assert.match(ui(g).render(g), /공식 수사 <b>하루 1회/);
});
test('v2 question and verdict panes keep separate controls while tab navigation spends nothing', async () => {
  const g = view(), sent = [], U = ui(g, { send: async event => sent.push(event) });
  const question = U.personal(g,true); assert.match(question, /data-action="seven-tab" data-id="audit"/); assert.doesNotMatch(question, /class="seven-verdict-panel|data-action="seven-audit"/);
  assert.match(question, /질문은 하루 한 번. 진술 판별은 사건 전체 두 번이며 질문 기회와 별개입니다./);
  await U.handle('seven-tab', { id: 'audit' }); const audit = U.personal(g,true);
  assert.match(audit, /data-action="seven-audit" data-id="past"/); assert.doesNotMatch(audit, /id="seven-question-target"|data-action="seven-investigate-pass"/); assert.equal(sent.length,0);
  await U.handle('seven-tab', { id: 'question' }); assert.match(U.personal(g,true), /id="seven-question-target"/); assert.equal(sent.length,0);
});
test('v2 past-verdict panel stays available during review and guards known or already resolved claims', async () => {
  const g = view('discussion'), sent = []; g.review = { kind: 'pass', round: 3 };
  const U = ui(g, { send: async event => sent.push(event) });
  const html = U.review(g); assert.match(html, /data-action="seven-audit" data-id="past"/); assert.doesNotMatch(html, /data-action="seven-audit" data-id="known"/);
  assert.match(html, /<details class="seven-verdict-panel seven-review-verdicts"><summary>/); assert.match(html, /class="seven-verdict-scroll"/);
  await U.handle('seven-audit', { id: 'known' }); assert.equal(sent.length, 0);
  await U.handle('seven-audit', { id: 'past' }); assert.deepEqual(sent, [{ type: 'AUDIT', statementId: 'past' }]);
  g.statements[0].audited = true; g.statements[0].isTrue = false;
  await U.handle('seven-audit', { id: 'past' }); assert.equal(sent.length, 1);
  assert.match(U.review(g), /seven-verified-lie/); assert.match(U.review(g), /거짓으로 검증/);
  assert.equal(g.phase, 'discussion'); assert.equal(g.review.kind, 'pass');
});
test('v2 current-answer verdict uses the shared eligibility check and preserves red verified-lie treatment', async () => {
  const g = view('discussion'), sent = []; g.review = { kind: 'answer', statementId: 'known', targetId: 'u2', category: 'hand', value: 1 };
  const U = ui(g, { send: async event => sent.push(event) });
  assert.doesNotMatch(U.review(g), /data-action="seven-review-audit"/);
  assert.match(U.review(g), /이 답변은 기존 관찰·기록으로 대조할 수 있어 판별권을 사용하지 않습니다./);
  await U.handle('seven-review-audit'); assert.equal(sent.length, 0);
  g.review = { kind: 'answer', statementId: 'past', targetId: 'u1', category: 'tool', value: 2 };
  assert.match(U.review(g), /data-action="seven-review-audit"/);
  await U.handle('seven-review-audit'); assert.deepEqual(sent, [{ type: 'REVIEW_AUDIT' }]);
  g.review.verified = true; g.review.isTrue = false; g.statements[0].audited = true; g.statements[0].isTrue = false;
  assert.match(U.review(g), /seven-review is-verified-lie/); assert.match(U.review(g), /거짓으로 검증된 공식 진술/);
});
test('v2 review shows an independently audited current answer even when the original review stays unverified', async () => {
  const g = view('discussion'), U = ui(g); g.review = { kind: 'answer', round: 3, statementId: 'past', targetId: 'u1', category: 'tool', value: 2, proposedValue: 1, verified: false };
  assert.doesNotMatch(U.review(g), /is-verified-lie/);
  g.statements[0].audited = true; g.statements[0].isTrue = false; g.kits = 1;
  const html = U.review(g); assert.match(html, /seven-review is-verified-lie/); assert.match(html, /거짓으로 검증된 공식 진술/);
  assert.doesNotMatch(html, /아직 검증되지 않은 공식 진술|data-action="seven-review-audit"/);
  assert.match(html, /탐정이 확인한 진술: 사건 도구 · 청동상/); assert.match(html, /data-seven-typed/);
  assert.equal(g.review.verified, false, 'The UI preserves the original review projection');
});
test('v2 suspect official response remains memory unknown even with a known clue and never submits a numeric answer', async () => {
  const g = view('answer'), sent = []; g.turnOwnerId = 'u2'; g.self = { id: 'u2', name: '나', role: 'suspect', clues: [{ category: 'hand', value: 0 }], identity: { known: false, candidates: [], memoryLeft: 2 } }; g.pending = { category: 'hand', proposedValue: 0, targetId: 'u2' };
  const U = ui(g, { send: async event => sent.push(event) });
  assert.match(U.personal(g, true), /기억 불명/); assert.match(U.personal(g, true), /data-value="unknown"/);
  await U.handle('seven-answer', { value: '0' }); assert.equal(sent.length, 0);
  await U.handle('seven-answer', { value: 'unknown' }); assert.deepEqual(sent, [{ type: 'ANSWER', value: null }]);
});
test('v2 detective information explains the two distinct initial answers and leaves public references readable', async () => {
  const g = view(), U = ui(g); await U.handle('seven-private-pane', { id: 'information' });
  assert.match(U.personal(g, true), /9개 항목.*서로 다른 2개/);
  let modal = ''; const V = ui(g, { openModal: (kind, title, body) => { modal = body; } });
  await V.handle('seven-card-detail', { kind: 'tool', id: D.TOOLS[0].id }); assert.match(modal, new RegExp(D.TOOLS[0].name));
});
test('v2 public null-result and history use one memory-unknown description without a role assertion', () => {
  const g = view('discussion'); g.review = { kind: 'unknown', targetId: 'u2', category: 'tool', proposedValue: 1 }; g.questionHistory = [{ round: 2, targetId: 'u2', category: 'tool', proposedValue: 1, status: 'unknown' }];
  const U = ui(g); assert.match(U.review(g), /기억 불명/); assert.match(U.ledger(g), /기억 불명/); assert.doesNotMatch(U.review(g), /용의자|목격자|미진술로 답/);
});
test('real v2 detective can verify yesterday before still asking today and verify again before confirming', async () => {
  const E = require('../lib/seven-engine.cjs'); let state = E.makeGame(['D','C','W','S'], { seed: 71, detectiveVersion: 2, roleOrder: ['detective','culprit','witness','suspect'] });
  const act = (actorId, event) => { state = E.act(state, { ...event, actorId }); };
  const g = () => E.privateView(state,state.detectiveId);
  function prepare() { while (state.phase === 'reveal') act(E.turnOwner(state), { type: 'ROLE_SEEN' }); for (const p of state.players) if (state.phase === 'secret') act(p.id, { type: 'SECRET_ACTION', kind: 'ready' }); }
  prepare(); const first = A.options(g()).questions[0];
  act(state.detectiveId, { type: 'QUESTION', targetId: 'u1', category: first.id, proposedValue: first.proposedValues[0] });
  act('u1', { type: 'ANSWER', value: E.caseValue(state.secretNPC,first.id) });
  const pastId = state.statements[0].id; act(state.detectiveId, { type: 'ROUND_CONFIRM' }); prepare();
  const fields = {}, U = UI.create({ data: D, actions: A, getGame: g, read: id => fields[id] || '', send: async event => act(state.detectiveId,event) });
  await U.handle('seven-audit', { id: pastId }); assert.equal(state.phase, 'investigate'); assert.equal(state.kits,1); assert.match(U.personal(g(),true), /data-action="seven-question"/);
  const next = A.options(g()).questions[0]; fields['seven-question-target'] = 'u1'; fields['seven-question-category'] = next.id; fields['seven-question-proposed'] = String(next.proposedValues[0]);
  await U.handle('seven-question'); assert.equal(state.phase,'answer');
  act('u1', { type: 'ANSWER', value: E.caseValue(state.secretNPC,next.id) });
  await U.handle('seven-review-audit'); assert.equal(state.phase,'discussion'); assert.equal(state.round,2); assert.equal(state.kits,0); assert.match(U.review(g()), /참으로 검증된 공식 진술/);
  await U.handle('seven-round-confirm'); assert.equal(state.round,3);
});

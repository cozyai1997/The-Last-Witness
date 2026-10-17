'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../lib/party-engine.cjs');
const file = path.join(__dirname, '../public/case-replay.js');
function replay() {
  assert.ok(fs.existsSync(file), 'A finished case must expose a replay renderer.');
  return require(file).create({ G });
}
function finished(complete = true) {
  return { phase: 'finished', round: 2, detectiveId: 'd', winner: 'investigators', players: [{ id: 'd', name: '탐정' }, { id: 'c', name: '목격자' }], reveal: {
    secret: { suspectId: 's0', placeId: 'p0' }, players: [{ id: 'd', name: '탐정', role: 'detective' }, { id: 'c', name: '목격자', role: 'culprit' }],
    replay: { version: 1, source: complete ? 'recorded' : 'legacy', complete, events: [
      { id: 'e1', round: 1, type: 'initial-clue', actorId: 'd', category: 'coat', value: 0, kind: 'private' },
      { id: 'e2', round: 1, type: 'question', actorId: 'd', targetId: 'c', category: 'hand', proposedValue: 0 },
      { id: 'e3', round: 1, type: 'answer', actorId: 'c', category: 'hand', value: 1, statementId: 's1', actualValue: 0, isTrue: false },
      { id: 'e4', round: 1, type: 'audit', actorId: 'd', targetId: 'c', category: 'hand', value: 1, statementId: 's1', actualValue: 0, isTrue: false },
      { id: 'e5', round: 1, type: 'round-confirm', actorId: 'd' },
      { id: 'e6', round: 2, type: 'seal', actorId: 'c', category: 'light' },
      { id: 'e7', round: 2, type: 'blocked-question', actorId: 'd', targetId: 'c', category: 'light', proposedValue: 0 },
      { id: 'e8', round: 2, type: 'seal-result', actorId: 'c', category: 'light', success: true, reason: 'blocked' },
      { id: 'e9', round: 2, type: 'accusation', actorId: 'd', suspectId: 's0', placeId: 'p0', success: true }
    ] }
  } };
}

test('replay is inaccessible before the server marks a case finished, even with stray reveal data', () => {
  const R = replay(), g = finished(); g.phase = 'answer';
  assert.deepEqual(R.events(g), []);
  assert.equal(R.render(g), '');
  assert.deepEqual(R.summary(g), { total: 0, questions: 0, lies: 0, verified: 0, complete: false });
});
test('summary counts blocked attempts once, and distinguishes lies from verification events', () => {
  assert.deepEqual(replay().summary(finished()), { total: 9, questions: 2, lies: 1, verified: 1, complete: true });
});
test('day filtering preserves server chronology and selected-step navigation stays inside filtered events', () => {
  const R = replay(), g = finished(), before = JSON.stringify(g);
  assert.deepEqual(R.events(g, 2).map(e => e.id), ['e6', 'e7', 'e8', 'e9']);
  const html = R.render(g, { round: 2, index: 99 });
  assert.match(html, /data-step-index="3"/);
  assert.match(html, /data-round="2"/);
  assert.match(html, /data-replay-step="e9"/);
  assert.match(html, /data-action="replay-next"[^>]*disabled/);
  assert.doesNotMatch(html, /data-replay-step="e1"/);
  assert.equal(JSON.stringify(g), before, 'Rendering must not mutate a finished room.');
});
test('answer playback preserves the original lie beside the revealed truth and its later audit', () => {
  const html = replay().render(finished(), { index: 2 });
  assert.match(html, /원래 공식 답변[\s\S]*오른손잡이/);
  assert.match(html, /실제 사건의 진실[\s\S]*왼손잡이/);
  assert.match(html, /종료 후 확인된 거짓/);
  assert.match(html, /이후 DAY-01에서 검증/);
  assert.match(html, /case-replay-step is-lie/);
});
test('unverified lies are identified only as end-of-game revelation, not an in-game audit', () => {
  const g = finished(); g.reveal.replay.events = g.reveal.replay.events.filter(e => e.type !== 'audit');
  const html = replay().render(g, { index: 2 });
  assert.match(html, /플레이 중 미검증/);
  assert.doesNotMatch(html, /이후 DAY-01에서 검증/);
});
test('legacy replay warns about missing steps without inventing an assertion or speaker', () => {
  const g = finished(false); g.reveal.replay.events = [{ id: 'old1', round: 1, type: 'question', category: 'hand' }];
  const html = replay().render(g);
  assert.match(html, /일부 기록만 복기/);
  assert.match(html, /당시 질문 문구와 대상은 남아 있지 않습니다/);
  assert.doesNotMatch(html, /왼손잡이.*진술이 맞습니까/);
});
test('malicious player names and unknown event values cannot become executable HTML', () => {
  const g = finished(); g.reveal.players[1].name = '<img src=x onerror="bad()">'; g.players[1].name = g.reveal.players[1].name;
  const html = replay().render(g, { index: 2 });
  assert.ok(html.includes('&lt;img src=x onerror=&quot;bad()&quot;&gt;'));
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script/);
});
test('unknown answers and unsuccessful concealment retain their meaning without becoming false statements', () => {
  const g = finished(); g.reveal.replay.events = [{ id: 'u', round: 1, type: 'unknown', actorId: 'c', category: 'zone' }, { id: 'f', round: 1, type: 'seal-result', actorId: 'c', category: 'zone', success: false, reason: 'guarded' }];
  const R = replay();
  assert.equal(R.summary(g).lies, 0);
  assert.match(R.render(g, { index: 0 }), /모름.*진실·거짓 판정 대상이 아닙니다/s);
  assert.match(R.render(g, { index: 1 }), /현장 보호.*은폐 실패/s);
});
test('empty or unavailable archives give a truthful empty state with no enabled navigation', () => {
  const g = finished(false); delete g.reveal.replay;
  const html = replay().render(g);
  assert.match(html, /복기할 상세 기록이 없습니다/);
  assert.equal(replay().summary(g).total, 0);
  assert.doesNotMatch(html, /data-action="replay-next"(?![^>]*disabled)/);
});
test('an old blocked record does not invent a question attempt when question versus search is unknown', () => {
  const g = finished(false); g.reveal.replay.events = [{ id: 'old-block', round: 1, type: 'legacy-blocked', category: 'zone' }];
  const R = replay();
  assert.equal(R.summary(g).questions, 0);
  assert.match(R.render(g), /질문\/감식 구분 기록 없음/);
  assert.doesNotMatch(R.render(g), /질문이 전달되지 않았습니다/);
});

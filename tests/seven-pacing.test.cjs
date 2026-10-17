'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lib/seven-engine.cjs');
const make = (n = 6, extra = {}) => E.makeGame(Array.from({ length: n }, (_, i) => '참가자 ' + i), { seed: 17, ...extra });
function reveal(s) { while (s.phase === 'reveal') s = E.act(s, { type: 'ROLE_SEEN', actorId: E.turnOwner(s) }); return s; }
function ready(s) { while (s.phase === 'secret') s = E.act(s, { type: 'SECRET_ACTION', actorId: E.turnOwner(s), kind: 'ready' }); return s; }
const detective = (s, type, fields = {}) => E.act(s, { type, actorId: s.detectiveId, ...fields });
const role = (s, name) => s.players.find(p => p.role === name);

test('new games accept simultaneous daily preparation in any seat order and never expose secret action types', () => {
  let s = reveal(make()); assert.equal(s.flowVersion, 2); assert.deepEqual(s.preparationReadyIds, []);
  const S = role(s, 'suspect'), A = role(s, 'accomplice');
  assert.notEqual(E.turnOwner(s), S.id);
  s = E.act(s, { type: 'SECRET_ACTION', actorId: S.id, kind: 'memory' });
  assert.equal(s.phase, 'secret'); assert.deepEqual(s.preparationReadyIds, [S.id]);
  assert.equal(E.privateView(s, S.id).self.preparationReady, true);
  assert.equal(E.privateView(s, S.id).self.canPrepare, false);
  assert.equal(E.privateView(s, A.id).self.canPrepare, true);
  const pub = E.publicView(s);
  assert.deepEqual(pub.preparationReadyIds, [S.id]); assert.equal(pub.flowVersion, 2);
  for (const key of ['identity', 'guard', 'seals', 'replayEvents', 'liesUsed']) assert.equal(pub[key], undefined);
  assert.ok(pub.log.every(entry => !/기억|제보|봉쇄|용의자/.test(entry.text)));
  const snapshot = JSON.stringify(s);
  assert.throws(() => E.act(s, { type: 'SECRET_ACTION', actorId: S.id, kind: 'memory' }), /준비/);
  assert.equal(JSON.stringify(s), snapshot);
  s = ready(s); assert.equal(s.phase, 'investigate'); assert.equal(s.preparationReadyIds.length, 6);
  s = detective(s, 'INVESTIGATE', { kind: 'pass' }); s = detective(s, 'ROUND_CONFIRM');
  assert.equal(s.round, 2); assert.deepEqual(s.preparationReadyIds, []);
  assert.ok(s.players.every(p => E.privateView(s, p.id).self.canPrepare));
});

test('serialized v4 games without flowVersion retain sequential personal turns', () => {
  const plain = JSON.parse(JSON.stringify(make(4, { flowVersion: 1 }))); delete plain.flowVersion; delete plain.preparationReadyIds;
  let s = reveal(plain); const first = E.turnOwner(s), other = s.players.find(p => p.id !== first);
  assert.throws(() => E.act(s, { type: 'SECRET_ACTION', actorId: other.id, kind: 'pass' }), /차례/);
  s = E.act(s, { type: 'SECRET_ACTION', actorId: first, kind: 'pass' });
  assert.equal(s.phase, 'secret'); assert.notEqual(E.turnOwner(s), first);
  assert.equal(E.publicView(s).preparationReadyIds, undefined);
  assert.equal(E.privateView(s, first).self.canPrepare, undefined);
});

test('readiness cannot distinguish a memory, a criminal seal, or an ordinary ready action', () => {
  const initial = reveal(make());
  for (const [actor, action] of [[role(initial, 'suspect'), { kind: 'memory' }], [role(initial, 'culprit'), { kind: 'seal', category: 'tool' }]]) {
    const active = E.act(initial, { type: 'SECRET_ACTION', actorId: actor.id, ...action });
    const idle = E.act(initial, { type: 'SECRET_ACTION', actorId: actor.id, kind: 'ready' });
    assert.deepEqual(E.publicView(active), E.publicView(idle));
  }
});

test('shared seal contention and obsolete ability selections never consume readiness or private resources', () => {
  let s = reveal(make()); const C = role(s, 'culprit'), A = role(s, 'accomplice'), S = role(s, 'suspect');
  s = E.act(s, { type: 'SECRET_ACTION', actorId: C.id, kind: 'seal', category: 'tool' });
  let snapshot = JSON.stringify(s);
  assert.throws(() => E.act(s, { type: 'SECRET_ACTION', actorId: A.id, kind: 'seal', category: 'time' }), /하나/);
  assert.equal(JSON.stringify(s), snapshot); assert.equal(E.privateView(s, A.id).self.canPrepare, true);
  s = ready(s); s = detective(s, 'SEARCH', { recordId: 'portrait' });
  const category = s.facts[0].category; s = detective(s, 'ROUND_CONFIRM'); snapshot = JSON.stringify(s);
  for (const [actor, kind] of [[C, 'seal'], [S, 'guard']]) {
    assert.throws(() => E.act(s, { type: 'SECRET_ACTION', actorId: actor.id, kind, category }), /확인/);
    assert.equal(JSON.stringify(s), snapshot); assert.equal(E.privateView(s, actor.id).self.canPrepare, true);
  }
});

test('direction proposals, testimony offers and private identity notes are free and editable without certifying truth', () => {
  let s = reveal(make()); const S = role(s, 'suspect'), W = role(s, 'witness'), C = role(s, 'culprit');
  const readyBefore = s.preparationReadyIds.slice(), liesBefore = s.liesUsed;
  s = E.act(s, { type: 'SUGGEST', actorId: C.id, category: 'tool', text: '도구 흔적을 먼저 대조합시다.' });
  s = E.act(s, { type: 'SUGGEST', actorId: C.id, category: 'tool', text: '시간 기록과 도구를 함께 보죠.' });
  const value = W.clues[0].value, category = W.clues[0].category;
  s = E.act(s, { type: 'OFFER_TESTIMONY', actorId: W.id, category, value, text: '기억을 공식 질문으로 확인해 주세요.' });
  s = E.act(s, { type: 'OFFER_TESTIMONY', actorId: C.id, category: 'tool', value: (E.caseValue(s.secretNPC, 'tool') + 1) % 12, text: '제가 본 도구입니다.' });
  s = E.act(s, { type: 'IDENTITY_MEMO', actorId: S.id, suspectId: 's0', text: '첫 추정' });
  s = E.act(s, { type: 'IDENTITY_MEMO', actorId: S.id, suspectId: 's1', text: '수정한 추정' });
  assert.equal(s.phase, 'secret'); assert.deepEqual(s.preparationReadyIds, readyBefore);
  assert.equal(s.liesUsed, liesBefore); assert.equal(s.facts.length, 0); assert.equal(s.statements.length, 0);
  const pub = E.publicView(s); assert.equal(pub.suggestions.length, 3);
  assert.equal(pub.suggestions.filter(e => e.kind === 'direction').length, 1);
  assert.equal(pub.suggestions.find(e => e.speakerId === W.id).value, value);
  assert.equal(pub.identityGuess, undefined); assert.equal(E.privateView(s, C.id).self.identityGuess, undefined);
  assert.equal(E.privateView(s, S.id).self.identityGuess.suspectId, 's1');
  assert.equal(new Set(s.replayEvents.map(e => e.id)).size, s.replayEvents.length);
  assert.throws(() => E.act(s, { type: 'IDENTITY_MEMO', actorId: C.id, suspectId: 's0', text: '침입' }));
  assert.throws(() => E.act(s, { type: 'OFFER_TESTIMONY', actorId: s.detectiveId, category, value }));
  assert.throws(() => E.act(s, { type: 'OFFER_TESTIMONY', actorId: W.id, category, value: 100 }));
  assert.throws(() => E.act(make(), { type: 'SUGGEST', actorId: C.id, category: 'tool', text: '아직 비밀 확인 전' }));
});

test('neutral preparation and free contributions complete seven days for every player count', () => {
  for (let count = 2; count <= 6; count++) {
    let s = reveal(make(count));
    for (let day = 1; day <= 7; day++) {
      for (const actor of s.players.slice().reverse()) {
        s = E.act(s, { type: 'SUGGEST', actorId: actor.id, category: 'time', text: '날짜별 기록을 함께 대조해 봅시다.' });
        s = E.act(s, { type: 'SECRET_ACTION', actorId: actor.id, kind: 'ready' });
      }
      assert.equal(s.phase, 'investigate'); assert.equal(s.round, day);
      s = detective(s, 'INVESTIGATE', { kind: 'pass' }); s = detective(s, 'ROUND_CONFIRM');
    }
    assert.equal(s.phase, 'final'); s = detective(s, 'ACCUSE', { suspectId: s.secretNPC.suspectId });
    assert.equal(s.winner, 'investigators'); const pub = E.publicView(s);
    assert.equal(pub.reveal.replay.events.filter(e => e.type === 'prepare-ready').length, count * 7);
    assert.equal(pub.reveal.replay.events.filter(e => e.type === 'secret-pass').length, 0);
    for (const player of s.players) assert.deepEqual(E.privateView(s, player.id).reveal.replay, pub.reveal.replay);
  }
});

test('acquired original records reject duplicate search without spending a day or mutating sources', () => {
  let s = ready(reveal(make())); const original = JSON.stringify(s.caseWorld);
  s = detective(s, 'SEARCH', { recordId: 'portrait' });
  s = detective(s, 'ROUND_CONFIRM'); s = ready(s); const snapshot = JSON.stringify(s);
  assert.throws(() => detective(s, 'SEARCH', { recordId: 'portrait' }), /확보|열람|조사/);
  assert.equal(JSON.stringify(s), snapshot); assert.equal(s.phase, 'investigate'); assert.equal(JSON.stringify(s.caseWorld), original);
});

test('publicly resolved or privately known questions are rejected without spending an investigation', () => {
  let s = ready(reveal(make())); const D = role(s, 'detective'), C = role(s, 'culprit'), clue = D.clues[0], snapshot = JSON.stringify(s);
  assert.throws(() => detective(s, 'QUESTION', { targetId: C.id, category: clue.category, proposedValue: clue.value }), /확인|조사|선택|확정/);
  assert.equal(JSON.stringify(s), snapshot); assert.equal(s.phase, 'investigate');
});

test('voluntary offers do not bypass the shared formal lie limit or turn audited originals into editable evidence', () => {
  let s = reveal(make()); const C = role(s, 'culprit'), A = role(s, 'accomplice'), original = JSON.stringify(s.caseWorld);
  for (const actor of [C, A]) {
    const value = (E.caseValue(s.secretNPC, 'tool') + 1) % 12;
    s = E.act(s, { type: 'OFFER_TESTIMONY', actorId: actor.id, category: 'tool', value, text: '증언 신청' });
    assert.equal(s.liesUsed, actor === C ? 0 : 1);
    s = ready(s); s = detective(s, 'QUESTION', { targetId: actor.id, category: 'tool', proposedValue: value });
    s = E.act(s, { type: 'ANSWER', actorId: actor.id, value });
    assert.equal(s.liesUsed, actor === C ? 1 : 2); s = detective(s, 'ROUND_CONFIRM');
  }
  s = ready(s); const truth = E.caseValue(s.secretNPC, 'tool');
  s = detective(s, 'QUESTION', { targetId: C.id, category: 'tool', proposedValue: truth });
  const snapshot = JSON.stringify(s);
  assert.throws(() => E.act(s, { type: 'ANSWER', actorId: C.id, value: (truth + 1) % 12 }), /거짓말/);
  assert.equal(JSON.stringify(s), snapshot); assert.equal(JSON.stringify(s.caseWorld), original);
});

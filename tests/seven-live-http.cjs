'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../public/seven-data.js');
const Actions = require('../public/seven-actions.js');

function assertPairedRoutes(reference) {
  assert.equal(reference.version, 2, 'The public source contract must use paired routes');
  assert.equal(reference.people.length, 12); assert.equal(reference.places.length, 12);
  assert.equal(new Set(reference.people.map(p => p.suspectId)).size, 12);
  assert.equal(new Set(reference.places.map(p => p.placeId)).size, 12);
  const validRange = (values, catalog) => {
    assert.equal(values.length, 6); assert.equal(new Set(values).size, 6);
    assert.ok(values.every(id => catalog.some(item => item.id === id)), 'Every public range uses valid catalog entries');
  };
  for (const place of reference.places) {
    assert.ok(E.PLACES.some(item => item.id === place.placeId)); validRange(place.toolIds, E.TOOLS); validRange(place.timeIds, E.TIMES);
  }
  let checked = 0;
  for (const person of reference.people) {
    const profile = E.SUSPECTS.find(item => item.id === person.suspectId); assert.ok(profile);
    validRange(person.placeIds, E.PLACES); validRange(person.toolIds, E.TOOLS); validRange(person.timeIds, E.TIMES);
    assert.equal(person.routes.length, 6, 'Each person has six paired compatibility options');
    assert.equal(new Set(person.routes.map(route => [route.placeId,route.toolId,route.timeId].join('/'))).size, 6, 'Paired options must be distinct tuples');
    for (const route of person.routes) {
      assert.deepEqual(Object.keys(route).sort(), ['placeId','timeId','toolId']);
      assert.ok(E.PLACES.some(item => item.id === route.placeId)); assert.ok(E.TOOLS.some(item => item.id === route.toolId)); assert.ok(E.TIMES.some(item => item.id === route.timeId));
      assert.ok(person.placeIds.includes(route.placeId)); assert.ok(person.toolIds.includes(route.toolId)); assert.ok(person.timeIds.includes(route.timeId));
      const place = reference.places.find(item => item.placeId === route.placeId), scene = E.PLACES.find(item => item.id === route.placeId);
      assert.ok(place.toolIds.includes(route.toolId)); assert.ok(place.timeIds.includes(route.timeId));
      assert.ok(profile.access !== 0 || scene.entry === 0, 'General access cannot contain a staff-only route');
      assert.equal(E.fitsReference({ suspectId: person.suspectId, ...route }, reference), true, 'Each paired option fits public marginal ranges'); checked++;
    }
  }
  return checked;
}

// Transport is replaceable only for the service integration suite. The command
// line entry point below always exercises real POST /api/room requests.
async function runSevenFlow(transport, options = {}) {
  for (const catalog of [E.SUSPECTS,E.PLACES,E.TOOLS,E.TIMES]) assert.equal(catalog.length, 12, 'The final release has twelve entries on every board');
  const timings = [], tokens = [], credentials = [], suffix = crypto.randomBytes(3).toString('hex');
  let latest = null, replayComparisons = 0, privateChecks = 0, reLogins = 0, pairedRouteChecks = 0, preparationChecks = 0, nonOwnerPreparations = 0, freeEventChecks = 0;
  let detectiveVersion = null, starterChecks = 0, verdictChecks = 0, questionIndependenceChecks = 0, noSpendRejections = 0, memoryUnknownChecks = 0, criminalLieBudgetChecks = 0, criminalRefusalChecks = 0;
  const request = async (body, expected = 200) => {
    const start = Date.now(), response = await transport(body); timings.push(Date.now() - start);
    assert.equal(response.status, expected, body.op + ': unexpected status (' + (response.data?.code || 'OK') + ')');
    const data = response.data;
    if (data.room) latest = data.room;
    if (data.room?.game) {
      const game = data.room.game; assert.equal(game.rulesVersion, 4); privateChecks++;
      if (game.flowVersion >= 2) {
        assert.ok(Array.isArray(game.preparationReadyIds));
        assert.ok(game.preparationReadyIds.every(id => game.players.some(player => player.id === id)));
        assert.equal(new Set(game.preparationReadyIds).size, game.preparationReadyIds.length);
        if (game.phase === 'secret') {
          assert.equal(game.self.preparationReady, game.preparationReadyIds.includes(game.self.id));
          assert.equal(game.self.canPrepare, !game.self.preparationReady);
          preparationChecks++;
        }
      }
      for (const key of ['secretNPC','caseWorld','seed','replayEvents','replayVersion','liesUsed','refusalsUsed']) assert.equal(game[key], undefined, 'Private raw state must stay server side: ' + key);
      assert.ok(game.players.every(p => Object.keys(p).sort().join(',') === 'id,isDetective,name'));
      assert.ok(data.room.members.every(m => !Object.hasOwn(m, 'role') && !Object.hasOwn(m, 'characterId')));
      if (game.phase !== 'finished') assert.equal(game.reveal, undefined);
      if (!['culprit','accomplice'].includes(game.self.role)) for (const key of ['caseSecret','remainingLies','remainingRefusals','partnerIds','seals']) assert.equal(game[key], undefined);
      if (!game.self.identity.known) assert.equal(game.self.identity.characterId, undefined);
      if (game.self.role !== 'suspect') { assert.equal(game.self.sealedReport, undefined); assert.equal(game.self.identityGuess, undefined); }
      for (const token of tokens) assert.ok(!JSON.stringify(data.room).includes(token));
    }
    return data;
  };
  const poll = async i => (await request({ op: 'poll', token: tokens[i] })).room;
  const mutate = async (i, op, extra = {}) => (await request({ op, token: tokens[i], revision: latest?.revision, requestId: crypto.randomUUID(), ...extra })).room;
  const rejectAction = async (i, event, expected = 400) => request({ op: 'action', token: tokens[i], revision: latest.revision, requestId: crypto.randomUUID(), event }, expected);
  const rejectUnchanged = async (i, event, expected = 400) => {
    const before = await poll(i); await rejectAction(i, event, expected); const after = await poll(i);
    assert.equal(after.revision, before.revision, 'Rejected actions cannot change the room revision');
    assert.deepEqual(after.game, before.game, 'Rejected actions cannot spend a question, verdict or power'); noSpendRejections++;
  };
  for (let i = 0; i < 7; i++) {
    credentials.push({ name: '칠일' + suffix + '-' + (i + 1), password: crypto.randomBytes(10).toString('base64url') });
    const registered = await request({ op: 'register', ...credentials[i], requestId: crypto.randomUUID() }); assert.equal(registered.room, null); tokens.push(registered.token);
  }
  // Registration and later login are separate requests with existing accounts.
  for (let i = 0; i < 6; i++) { const old = tokens[i], logged = await request({ op: 'login', ...credentials[i] }); tokens[i] = logged.token; assert.notEqual(tokens[i], old); reLogins++; }
  let room = await mutate(0, 'create', { capacity: 6 }); const code = room.code;
  for (let i = 1; i < 6; i++) room = await mutate(i, 'join', { code });
  assert.equal(room.members.length, 6);
  await request({ op: 'join', token: tokens[6], code, requestId: crypto.randomUUID() }, 409);
  await request({ op: 'poll', token: 'X'.repeat(43) }, 401);
  await request({ op: 'start', token: tokens[1], revision: latest.revision, requestId: crypto.randomUUID() }, 403);
  const cases = [
    { id: 'correct-character', reportDay: 3, accusation: 'C', wantTeam: 'investigators', wantS: 'win', extended: true },
    { id: 'dual-success', reportDay: 3, accusation: 'other', wantTeam: 'criminals', wantS: 'win' },
    { id: 'self-accusation-priority', reportDay: 6, accusation: 'S', wantTeam: 'criminals', wantS: 'loss' },
    { id: 'neutral-deadline', reportDay: null, accusation: 'C', wantTeam: 'investigators', wantS: 'survived', deadline: true }
  ];
  const caseResults = [];
  let previousCaseId = null;
  for (const scenario of cases) {
    for (let i = 0; i < 6; i++) await mutate(i, 'ready', { ready: true });
    room = await mutate(0, 'start'); assert.notEqual(room.caseId, previousCaseId); previousCaseId = room.caseId;
    const views = []; for (let i = 0; i < 6; i++) views.push(await poll(i));
    for (const view of views) {
      pairedRouteChecks += assertPairedRoutes(view.game.fieldReference);
      assert.deepEqual(view.game.fieldReference, views[0].game.fieldReference, 'Every seat receives the same public paired compatibility data');
    }
    const ids = views.map(v => v.game.self.id), roles = views.map(v => v.game.self.role);
    assert.deepEqual(roles.slice().sort(), ['detective','culprit','witness','witness','suspect','accomplice'].sort());
    const D = roles.indexOf('detective'), C = roles.indexOf('culprit'), A = roles.indexOf('accomplice'), S = roles.indexOf('suspect');
    const modern = views[D].game.detectiveVersion === 2;
    detectiveVersion = modern ? 2 : 1;
    const secret = views[C].game.caseSecret;
    assert.equal(E.fitsReference(secret, views[C].game.fieldReference), true, 'The permitted criminal case fits a public paired route');
    assert.equal(views[C].game.self.identity.characterId, secret.suspectId, 'The actual criminal character owns the case truth');
    assert.equal(views[S].game.self.identity.candidates.length, 3); assert.equal(views[S].game.self.identity.known, false);
    if (modern) {
      const detective = views[D].game, clues = detective.self.clues, candidates = E.candidates(detective);
      assert.equal(detective.kits, 2, 'Each new case starts with two shared verdicts');
      assert.equal(clues.length, 2); assert.equal(new Set(clues.map(clue => clue.category)).size, 2);
      assert.ok(clues.every(clue => E.CATEGORIES.some(category => category.id === clue.category) && clue.value === E.caseValue(secret, clue.category)));
      assert.ok(new Set(candidates.map(candidate => candidate.suspectId)).size >= 2, 'Starting answers and the detective innocence cannot identify one culprit');
      assert.ok(candidates.some(candidate => candidate.suspectId === secret.suspectId), 'Starting knowledge preserves the real culprit');
      const targets = detective.players.filter(player => !player.isDetective);
      assert.equal(targets.length, 5); assert.ok(targets.some(player => player.id === ids[S]), 'The anonymous suspect remains in the same target roster');
      assert.ok(Actions.options(detective).records.every(record => !record.available)); starterChecks++;
    } else {
      assert.equal(views[D].game.self.clues.filter(c => E.CATEGORIES.find(x => x.id === c.category).group === 'person').length, 1);
      assert.equal(views[D].game.self.clues.filter(c => E.CATEGORIES.find(x => x.id === c.category).group === 'place').length, 1);
    }
    const owner = () => ids.indexOf(latest.game.turnOwnerId);
    const ownerAction = event => { const i = owner(); assert.ok(i >= 0); return mutate(i, 'action', { event }); };
    if (scenario.extended) {
      await mutate(S, 'action', { event: { type: 'ADD_NOTE', speakerId: ids[C], text: '역할 확인 중 자유 토론 <b>기록</b>' } });
      assert.equal(latest.game.notes.at(-1).speakerId, ids[S]);
      const wrong = (owner() + 1) % 6; await rejectAction(wrong, { type: 'ROLE_SEEN', actorId: latest.game.turnOwnerId }, 403);
    }
    while (latest.game.phase === 'reveal') await ownerAction({ type: 'ROLE_SEEN' });
    if (scenario.extended && latest.game.flowVersion >= 2) {
      const W = roles.indexOf('witness'), clue = views[W].game.self.clues[0], before = latest.game;
      await mutate(W, 'action', { event: { type: 'OFFER_TESTIMONY', category: clue.category, value: clue.value, text: '제가 기억하는 단편을 공식 질문으로 확인해 주세요.', actorId: ids[C] } });
      assert.equal(latest.game.suggestions.at(-1).speakerId, ids[W]); assert.equal(latest.game.suggestions.at(-1).kind, 'testimony'); freeEventChecks++;
      await mutate(W, 'action', { event: { type: 'SUGGEST', category: clue.category, text: '이 증언을 다른 원본 기록과 대조해 주세요.' } });
      assert.equal(latest.game.suggestions.at(-1).kind, 'direction'); freeEventChecks++;
      await mutate(S, 'action', { event: { type: 'IDENTITY_MEMO', suspectId: views[S].game.self.identity.candidates[0], text: '아직 확정하지 않은 내 정체 가설.' } });
      assert.ok(latest.game.self.identityGuess); assert.equal(latest.game.self.identity.characterId, undefined); freeEventChecks++;
      assert.equal(latest.game.phase, before.phase); assert.equal(latest.game.turnOwnerId, before.turnOwnerId);
      assert.deepEqual(latest.game.preparationReadyIds, before.preparationReadyIds);
      assert.deepEqual(latest.game.facts, before.facts); assert.deepEqual(latest.game.statements, before.statements);
      assert.equal((await poll(W)).game.self.identityGuess, undefined);
    }
    let ownCharacter = null, firstFalseStatement = null, falseAnswers = 0;
    for (let round = 1; round <= 7; round++) {
      assert.equal(latest.game.round, round); let sPassed = false;
      while (latest.game.phase === 'secret') {
        const simultaneous = latest.game.flowVersion >= 2;
        // Reverse seats exercise simultaneous preparation rather than quietly
        // allowing a sequential-only server to pass the online release test.
        const i = simultaneous ? ids.findLastIndex(id => !latest.game.preparationReadyIds.includes(id)) : owner();
        assert.ok(i >= 0);
        let event = { type: 'SECRET_ACTION', kind: simultaneous ? 'ready' : 'pass' };
        if (i === S && round <= 2) event = { type: 'SECRET_ACTION', kind: 'memory' };
        else if (i === S && round === scenario.reportDay) event = { type: 'SECRET_ACTION', kind: 'report', suspectId: secret.suspectId, text: '기억과 사건 원본의 관찰 경로를 대조한 봉인 제보.' };
        else if (scenario.extended && i === C && round === 1) event = { type: 'SECRET_ACTION', kind: 'seal', category: 'gender' };
        else if (scenario.extended && i === C && round === 2) event = { type: 'SECRET_ACTION', kind: 'seal', category: 'hand' };
        else if (scenario.extended && i === A && round === 3) event = { type: 'SECRET_ACTION', kind: 'seal', category: 'work' };
        if (modern && event.kind === 'seal') {
          const actor = (await poll(i)).game, detective = (await poll(D)).game, questions = Actions.options(detective).questions;
          const permitted = Actions.options(actor).abilities.filter(ability => ability.available && (!questions.length || questions.some(question => question.id !== ability.id)));
          const category = permitted.find(ability => ability.id === event.category) || permitted[0];
          event = category ? { ...event, category: category.id } : { type: 'SECRET_ACTION', kind: 'ready' };
        }
        if (i === S && scenario.deadline && round === 7) { await rejectAction(S, { type: 'SECRET_ACTION', kind: 'report', suspectId: secret.suspectId, text: '마감 뒤 제보' }); }
        if (i === S && round > scenario.reportDay && scenario.reportDay !== null) await rejectAction(S, { type: 'SECRET_ACTION', kind: 'report', suspectId: secret.suspectId, text: '바꿀 수 없는 두 번째 제보' });
        if (simultaneous && ids[i] !== latest.game.turnOwnerId) nonOwnerPreparations++;
        const before = latest.revision; room = await mutate(i, 'action', { event }); assert.equal(room.revision, before + 1);
        if (i === S) {
          sPassed = true; const own = (await poll(S)).game;
          assert.equal(own.self.identity.candidates.length, round === 1 ? 2 : 1);
          if (round === 1) { assert.equal(own.self.identity.known, false); assert.equal(own.self.identity.characterId, undefined); }
          else { ownCharacter = own.self.identity.characterId; assert.equal(own.self.identity.known, true); assert.ok(ownCharacter); }
          if (round === scenario.reportDay) { assert.equal(own.self.sealedReport.suspectId, secret.suspectId); assert.equal(own.self.sealedReport.round, round); assert.equal(own.self.sealedReport.correct, undefined); assert.equal(own.self.sealedReport.isCorrect, undefined); }
          if (scenario.deadline && round === 6) await rejectAction(S, { type: 'SECRET_ACTION', kind: 'report', suspectId: secret.suspectId, text: '오늘 준비를 마친 뒤 보낸 제보' }, simultaneous && own.phase === 'secret' ? 400 : 403);
        }
      }
      assert.equal(sPassed, true); assert.equal(latest.game.phase, 'investigate');
      await rejectAction(D, { type: 'ACCUSE', suspectId: secret.suspectId });
      if (modern && scenario.extended) {
        await rejectUnchanged(D, { type: 'SEARCH', recordId: round % 2 ? 'portrait' : 'tool' });
        await rejectUnchanged(D, { type: 'INVESTIGATE', kind: 'search', recordId: 'time' });
        // Later questions may be exhausted by a valid random starter pair. Keep
        // no-spend coverage unconditional: an unknown statement cannot use a
        // verdict, change the room revision, or consume today's question.
        if (round === 1) await rejectUnchanged(D, { type: 'AUDIT', statementId: 'missing-statement' });
        if (round === 2) {
          const before = (await poll(D)).game, criminalBefore = (await poll(C)).game;
          assert.ok(Actions.auditAllowed(before, firstFalseStatement.id), 'The earlier independent claim remains unresolved');
          await mutate(D, 'action', { event: { type: 'AUDIT', statementId: firstFalseStatement.id } });
          const after = (await poll(D)).game, criminalAfter = (await poll(C)).game;
          assert.equal(after.phase, 'investigate'); assert.equal(after.round, round); assert.equal(after.kits, 1);
          assert.equal(after.turnOwnerId, before.turnOwnerId); assert.deepEqual(after.questionHistory, before.questionHistory);
          assert.deepEqual(after.pending, before.pending); assert.deepEqual(after.review, before.review);
          const verdict = after.statements.find(statement => statement.id === firstFalseStatement.id);
          assert.equal(verdict.isTrue, false); assert.equal(verdict.actualValue, undefined);
          assert.deepEqual(criminalAfter.self.sealOutcomes, criminalBefore.self.sealOutcomes, 'A verdict before the daily question cannot resolve today seals');
          assert.equal(Actions.auditAllowed(after, firstFalseStatement.id), false);
          await rejectUnchanged(D, { type: 'AUDIT', statementId: firstFalseStatement.id });
          verdictChecks++; questionIndependenceChecks++;
        }
      }
      if (scenario.extended && round <= 4) {
        const target = round === 2 ? A : C;
        const detective = (await poll(D)).game, choices = Actions.options(detective).questions;
        const criminal = modern ? (await poll(C)).game : null;
        const unsealed = choice => !modern || !(criminal.seals || []).some(seal => seal.category === choice.id);
        let question, value;
        if (modern && round <= 2) {
          // Choose an actually unresolved false proposition from permitted
          // detective options; a random false answer may already be disproved.
          for (const choice of choices.filter(unsealed).sort((a, b) => b.proposedValues.length - a.proposedValues.length)) {
            const falseValue = choice.proposedValues.find(proposed => {
              if (proposed === E.caseValue(secret, choice.id)) return false;
              const statement = { id: 'policy-candidate', round, speakerId: ids[target], category: choice.id, value: proposed, audited: false };
              return Actions.auditAllowed({ ...detective, statements: [...detective.statements, statement] }, statement.id);
            });
            if (falseValue !== undefined) { question = choice; value = falseValue; break; }
          }
        } else {
          question = choices.filter(unsealed).find(choice => choice.id === 'tool') || choices.filter(unsealed).find(choice => ['time','camera','zone','entry'].includes(choice.id)) || (modern && choices.filter(unsealed)[0]);
          value = question && (round === 3 ? null : round <= 2 ? (E.caseValue(secret, question.id) + 1) % E.CATEGORIES.find(category => category.id === question.id).values.length : E.caseValue(secret, question.id));
        }
        if (!question && modern) {
          // New starter pairs can combine with the first verdict to resolve
          // every remaining category. Passing is the valid daily completion.
          await mutate(D, 'action', { event: { type: 'INVESTIGATE', kind: 'pass' } });
        } else {
          assert.ok(question, 'The integration policy needs an unresolved official question');
          const event = { type: 'QUESTION', targetId: ids[target], category: question.id, proposedValue: question.proposedValues[0] };
          await mutate(D, 'action', { event }); assert.equal(latest.game.phase, 'answer');
          if (round === 1) await mutate(S, 'action', { event: { type: 'ADD_NOTE', text: '답변 대기 중에도 대화' } });
          if (modern && round === 2) await rejectUnchanged(D, { type: 'AUDIT', statementId: firstFalseStatement.id }, 403);
          await mutate(target, 'action', { event: { type: 'ANSWER', value } });
          if (round <= 2) { falseAnswers++; assert.equal((await poll(C)).game.remainingLies, 2 - falseAnswers); criminalLieBudgetChecks++; }
          if (modern) await rejectUnchanged(D, event);
          if (round === 3) { assert.equal((await poll(A)).game.remainingRefusals, 0); criminalRefusalChecks++; }
          if (modern && round === 1) firstFalseStatement = latest.game.statements.at(-1);
          if (modern && round === 2 || !modern && round === 4) {
            const statement = latest.game.statements.at(-1), before = (await poll(D)).game;
            if (modern) assert.ok(Actions.options(before).audits.some(entry => entry.id === statement.id));
            await mutate(D, 'action', { event: { type: 'REVIEW_AUDIT' } }); assert.equal(latest.game.kits, 0); assert.equal(latest.game.review.isTrue, !modern); assert.equal(latest.game.review.actualValue, undefined); assert.equal(latest.game.statements.at(-1).value, statement.value);
            if (modern) { verdictChecks++; await rejectUnchanged(D, { type: 'REVIEW_AUDIT' }); }
          }
        }
      } else if (modern && scenario.extended && (round === 5 || round === 6)) {
        const detective = (await poll(D)).game, criminal = (await poll(C)).game;
        const question = Actions.options(detective).questions.find(choice => !(criminal.seals || []).some(seal => seal.category === choice.id));
        if (question) {
          const before = { lies: criminal.remainingLies, refusals: criminal.remainingRefusals, statements: detective.statements.length };
          const event = { type: 'QUESTION', targetId: ids[S], category: question.id, proposedValue: question.proposedValues[0] };
          await mutate(D, 'action', { event }); assert.equal(latest.game.phase, 'answer');
          const suspect = (await poll(S)).game; assert.deepEqual(suspect.self.answerOptions.legalValues, [null], 'The suspect always receives only memory-unknown as an official answer');
          await rejectUnchanged(S, { type: 'ANSWER', value: E.caseValue(secret, question.id) });
          await mutate(S, 'action', { event: { type: 'ANSWER', value: null } });
          const after = (await poll(C)).game;
          assert.equal(after.review.value, null); assert.equal(after.statements.length, before.statements);
          assert.equal(after.remainingLies, before.lies); assert.equal(after.remainingRefusals, before.refusals);
          await rejectUnchanged(D, event); memoryUnknownChecks++;
        } else await mutate(D, 'action', { event: { type: 'INVESTIGATE', kind: 'pass' } });
      } else if (!modern && scenario.extended && round === 5) await mutate(D, 'action', { event: { type: 'SEARCH', recordId: 'portrait' } });
      else if (!modern && scenario.extended && round === 6) await mutate(D, 'action', { event: { type: 'SEARCH', recordId: 'tool' } });
      else await mutate(D, 'action', { event: { type: 'INVESTIGATE', kind: 'pass' } });
      assert.equal(latest.game.phase, 'discussion');
      const outsiders = [D,C,A].filter(i => i !== S);
      for (const i of outsiders) { const checked = (await poll(i)).game; assert.equal(checked.self.sealedReport, undefined); assert.equal(checked.log.some(e => e.type === 'personal' && /제보|기억/.test(e.text)), false); }
      if (scenario.extended && round === 3) {
        for (let i = 0; i < 6; i++) {
          const before = await poll(i), old = tokens[i], relogged = await request({ op: 'login', ...credentials[i] }); tokens[i] = relogged.token; reLogins++;
          assert.equal(relogged.room.meId, before.meId); assert.deepEqual(relogged.room.game, before.game); assert.notEqual(tokens[i], old); await request({ op: 'poll', token: old }, 401);
        }
        const old = tokens[S]; await request({ op: 'logout', token: old }); await request({ op: 'poll', token: old }, 401); const relogged = await request({ op: 'login', ...credentials[S] }); tokens[S] = relogged.token; reLogins++; assert.equal(relogged.room.code, code);
      }
      await mutate(D, 'action', { event: { type: 'ROUND_CONFIRM' } }); assert.equal(latest.game.phase, round === 7 ? 'final' : 'secret'); assert.equal(latest.game.round, round === 7 ? 7 : round + 1);
    }
    assert.notEqual(ownCharacter, secret.suspectId);
    const third = E.SUSPECTS.find(p => p.id !== ownCharacter && p.id !== secret.suspectId).id;
    const accusation = scenario.accusation === 'S' ? ownCharacter : scenario.accusation === 'other' ? third : secret.suspectId;
    if (scenario.extended) await mutate(S, 'action', { event: { type: 'ADD_NOTE', text: '최종 고발 직전 토론' } });
    room = await mutate(D, 'action', { event: { type: 'ACCUSE', suspectId: accusation } }); assert.equal(room.status, 'finished'); assert.equal(room.game.winner, scenario.wantTeam); assert.deepEqual(room.game.accusation, { suspectId: accusation });
    const reveal = room.game.reveal; assert.equal(reveal.players.find(p => p.role === 'culprit').characterId, reveal.secretNPC.suspectId); assert.equal(new Set(reveal.players.map(p => p.characterId)).size, 6);
    assert.equal(reveal.suspectResult.status, scenario.wantS); assert.equal(reveal.suspectResult.earlyTracking, scenario.wantS === 'win' && scenario.reportDay <= 4);
    assert.equal(reveal.replay.version, 2); assert.equal(reveal.replay.complete, true); assert.equal(reveal.replay.source, 'recorded'); assert.equal(reveal.replay.events.filter(e => e.type === 'round-confirm').length, 7);
    for (let i = 0; i < 6; i++) { const final = await poll(i); assert.deepEqual(final.game.reveal.replay, reveal.replay); replayComparisons++; }
    if (modern && scenario.extended) assert.equal(reveal.replay.events.filter(event => event.type === 'audit').length, verdictChecks);
    caseResults.push({ scenario: scenario.id, detectiveVersion: modern ? 2 : 1, days: 7, team: scenario.wantTeam, suspect: scenario.wantS, replayIdentical: true });
    room = await mutate(0, 'restart'); assert.equal(room.status, 'lobby'); assert.equal(room.game, null); assert.equal(room.caseId, undefined); assert.ok(room.members.every(m => !m.ready && !m.gameId));
    options.onProgress?.({ completedCases: caseResults.length, totalCases: cases.length, scenario: scenario.id, requests: timings.length });
  }
  for (let i = 0; i < 6; i++) { await poll(i); await mutate(i, 'leave'); }
  assert.equal(await poll(0), null);
  return { passed: true, checkedAt: new Date().toISOString(), rulesVersion: 4, detectiveVersion, starterChecks, verdictChecks, questionIndependenceChecks, noSpendRejections, memoryUnknownChecks, criminalLieBudgetChecks, criminalRefusalChecks, finalInput: 'person-only', catalog: { people: E.SUSPECTS.length, places: E.PLACES.length, tools: E.TOOLS.length, times: E.TIMES.length }, pairedRoutes: true, fieldReferenceVersion: 2, pairedRouteChecks, preparationChecks, nonOwnerPreparations, freeEventChecks, simultaneousPreparation: nonOwnerPreparations > 0, sessions: 7, simultaneousPlayers: 6, cases: caseResults, requests: timings.length, maxRequestMs: Math.max(...timings), averageRequestMs: Math.round(timings.reduce((a,b) => a+b,0)/timings.length), privateChecks, replayComparisons, reLogins, memory: '3-2-1', sealedReportPrivacy: true, reportOnce: true, day6OwnTurnDeadline: true, earlyAccusationBlocked: true, accountResume: true, oldTokenRevoked: true, actorBoundToSession: true, actualCCharacter: true, dualSuccess: true, selfAccusationPriority: true, neutralNoReport: true, sharedLiesAndRefusal: criminalLieBudgetChecks > 0 && criminalRefusalChecks > 0, auditVerdictOnly: true, restart: true, credentialsSaved: false };
}
module.exports = { runSevenFlow, assertPairedRoutes };
if (require.main === module) {
  const base = (process.env.BASE_URL || 'http://127.0.0.1:4174').replace(/\/$/, '');
  const transport = async body => {
    const response = await fetch(base + '/api/room', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    assert.match(response.headers.get('cache-control') || '', /no-store/); return { status: response.status, data: await response.json() };
  };
  runSevenFlow(transport, { onProgress: progress => console.log(JSON.stringify({ progress })) }).then(result => {
    const report = { base, transport: 'real-http', ...result }, output = process.env.TEST_REPORT || path.join(__dirname, '../work/seven-http-result.json');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }).catch(error => { console.error('Seven-day HTTP check failed: ' + error.message); process.exitCode = 1; });
}

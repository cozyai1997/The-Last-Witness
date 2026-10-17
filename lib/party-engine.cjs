(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WitnessParty = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MAX_ROUNDS = 5;
  var LIE_LIMIT = 2;
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(function (key) { freeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }
  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') {
      var result = {};
      Object.keys(value).forEach(function (key) { result[key] = copy(value[key]); });
      return result;
    }
    return value;
  }
  function fail(message) { throw new Error(message); }
  var CATEGORIES = freeze([
    { id: 'coat', label: '외투 색상', values: ['짙은 외투', '밝은 외투'] },
    { id: 'hand', label: '주로 쓰는 손', values: ['왼손잡이', '오른손잡이'] },
    { id: 'item', label: '착용 물품', values: ['장갑', '손목시계'] },
    { id: 'zone', label: '장소 구역', values: ['실내', '실외'] },
    { id: 'light', label: '조명', values: ['밝은 조명', '어두운 조명'] }
  ]);
  var names = ['서도윤', '윤서하', '강시온', '한유진', '이태오', '정하린', '백지후', '차수아'];
  var jobs = ['기록 연구원', '전시 기획자', '야간 경비원', '시설 기술자', '사진 기자', '복원 전문가', '정원 관리사', '자료 수집가'];
  var SUSPECTS = freeze(names.map(function (name, index) {
    return { id: 's' + index, name: name, job: jobs[index], bits: [(index >> 2) & 1, (index >> 1) & 1, index & 1] };
  }));
  var PLACES = freeze([
    { id: 'p0', name: '기록보관실', bits: [0, 0] },
    { id: 'p1', name: '지하 기계실', bits: [0, 1] },
    { id: 'p2', name: '중앙 정원', bits: [1, 0] },
    { id: 'p3', name: '뒷골목', bits: [1, 1] }
  ]);
  var ROLES = freeze({
    detective: { label: '탐정', team: 'investigators' },
    culprit: { label: '범인', team: 'criminals' },
    witness: { label: '목격자', team: 'investigators' },
    suspect: { label: '용의자', team: 'investigators' },
    accomplice: { label: '공범', team: 'criminals' }
  });
  var ROLE_PACKS = freeze({
    2: ['detective', 'culprit'],
    3: ['detective', 'culprit', 'witness'],
    4: ['detective', 'culprit', 'witness', 'suspect'],
    5: ['detective', 'culprit', 'witness', 'witness', 'suspect'],
    6: ['detective', 'culprit', 'witness', 'witness', 'suspect', 'accomplice']
  });
  function categoryById(id) {
    var entry = CATEGORIES.find(function (category) { return category.id === id; });
    if (!entry) fail('유효한 수사 항목을 선택하세요.');
    return entry;
  }
  function suspectById(id) {
    var entry = SUSPECTS.find(function (suspect) { return suspect.id === id; });
    if (!entry) fail('사건 속 용의자 한 명을 선택하세요.');
    return entry;
  }
  function placeById(id) {
    var entry = PLACES.find(function (place) { return place.id === id; });
    if (!entry) fail('유효한 사건 장소를 선택하세요.');
    return entry;
  }
  function playerById(state, id) {
    var entry = state.players.find(function (player) { return player.id === id; });
    if (!entry) fail('유효한 참가자를 선택하세요.');
    return entry;
  }
  function isCriminal(player) { return ROLES[player.role].team === 'criminals'; }
  function caseValue(secret, category) {
    categoryById(category);
    var index = CATEGORIES.findIndex(function (entry) { return entry.id === category; });
    return index < 3 ? suspectById(secret.suspectId).bits[index] : placeById(secret.placeId).bits[index - 3];
  }
  function randomSeed() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
      var values = new Uint32Array(1);
      globalThis.crypto.getRandomValues(values);
      return values[0];
    }
    return Math.floor(Math.random() * 4294967296);
  }
  function seeded(seed) {
    var value = seed >>> 0;
    return function () {
      value = (value + 0x6D2B79F5) >>> 0;
      var mixed = value;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(entries, random) {
    var result = entries.slice();
    for (var i = result.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var temporary = result[i]; result[i] = result[j]; result[j] = temporary;
    }
    return result;
  }
  function makeGame(playerNames, options) {
    options = options || {};
    if (!Array.isArray(playerNames) || playerNames.length < 2 || playerNames.length > 6) fail('참가자는 2명부터 6명까지 가능합니다.');
    playerNames = playerNames.map(function (name) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 20) fail('참가자 이름은 1자부터 20자까지 입력하세요.');
      return name.trim();
    });
    var seed = options.seed === undefined ? randomSeed() : options.seed;
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) fail('유효한 난수 시드가 필요합니다.');
    var random = seeded(seed);
    var roles = shuffled(ROLE_PACKS[playerNames.length], random);
    var secret = options.secret ? copy(options.secret) : {
      suspectId: SUSPECTS[Math.floor(random() * SUSPECTS.length)].id,
      placeId: PLACES[Math.floor(random() * PLACES.length)].id
    };
    suspectById(secret.suspectId); placeById(secret.placeId);
    secret = { suspectId: secret.suspectId, placeId: secret.placeId };
    var players = playerNames.map(function (name, index) {
      var role = roles[index];
      return { id: 'u' + index, name: name, role: role, clues: [], shared: [], sabotageLeft: role === 'culprit' ? 2 : role === 'accomplice' ? 1 : 0, guardLeft: role === 'suspect' ? 1 : 0 };
    });
    var detective = players.find(function (player) { return player.role === 'detective'; });
    var witnesses = players.filter(function (player) { return player.role === 'witness'; });
    var personHint = shuffled(CATEGORIES.slice(0, 3), random)[0];
    var sceneHint = shuffled(CATEGORIES.slice(3), random)[0];
    [personHint, sceneHint].forEach(function (category) {
      detective.clues.push({ category: category.id, value: caseValue(secret, category.id) });
    });
    var witnessCategories = shuffled(CATEGORIES.filter(function (category) {
      return category.id !== personHint.id && category.id !== sceneHint.id;
    }), random);
    witnesses.forEach(function (witness, index) {
      var category = witnessCategories[index].id;
      witness.clues.push({ category: category, value: caseValue(secret, category) });
    });
    var state = {
      rulesVersion: 3, phase: 'reveal', round: 1, players: players, detectiveId: detective.id, turnIndex: 0,
      kits: 1, liesUsed: 0, secretNPC: secret, sabotage: null, guard: null,
      statements: [], facts: [], log: [], notes: [], questionHistory: [], pending: null, review: null, winner: null, accusation: null,
      replayVersion: 1, replayComplete: true, replayEvents: []
    };
    if (players.length === 2) {
      detective.clues.forEach(function (clue) {
        addFact(state, clue.category, 'share', { speakerId: detective.id });
        detective.shared.push(clue.category);
        addLog(state, 'initial', '기초 수사 자료 · ' + categoryById(clue.category).label);
      });
    }
    players.forEach(function (player) {
      player.clues.forEach(function (clue) {
        appendReplay(state, 'initial-clue', { actorId: player.id, category: clue.category, value: clue.value, kind: players.length === 2 && player.id === detective.id ? 'official' : 'private' });
      });
    });
    return freeze(state);
  }
  function turnOwner(state) {
    if (!state || !Array.isArray(state.players)) fail('유효한 게임 상태가 필요합니다.');
    if (state.phase === 'reveal' || state.phase === 'secret') return state.players[state.turnIndex].id;
    if (state.phase === 'answer') return state.pending.targetId;
    if (state.phase === 'investigate' || state.phase === 'discussion' || state.phase === 'final') return state.detectiveId;
    if (state.phase === 'finished') return null;
    fail('유효한 게임 단계가 아닙니다.');
  }
  function requirePhase(state, phases) { if (!phases.includes(state.phase)) fail('현재 단계에서는 이 행동을 할 수 없습니다.'); }
  function requireOwner(state, actorId) { playerById(state, actorId); if (turnOwner(state) !== actorId) fail('현재 차례인 참가자만 행동할 수 있습니다.'); }
  function requireDetective(state, actorId) { if (playerById(state, actorId).role !== 'detective') fail('탐정만 수사를 진행할 수 있습니다.'); }
  function addLog(state, type, text) { state.log.push({ round: state.round, type: type, text: text }); }
  function addFact(state, category, source, extra) {
    var fact = { id: 'fact-' + (state.facts.length + 1), round: state.round, category: category, value: caseValue(state.secretNPC, category), source: source };
    if (extra) Object.keys(extra).forEach(function (key) { fact[key] = extra[key]; });
    state.facts.push(fact);
    return fact;
  }
  function advancePrivate(state, nextPhase) {
    state.turnIndex += 1;
    if (state.turnIndex >= state.players.length) {
      state.turnIndex = 0;
      state.phase = nextPhase;
    }
    skipDuoDetective(state);
  }
  function quickDuo(state) { return state.rulesVersion >= 2 && state.players.length === 2; }
  function skipDuoDetective(state) {
    if (!quickDuo(state) || state.phase !== 'secret') return;
    while (state.turnIndex < state.players.length && state.players[state.turnIndex].role === 'detective') state.turnIndex += 1;
    if (state.turnIndex >= state.players.length) { state.turnIndex = 0; state.phase = 'investigate'; }
  }
  function nextRound(state) {
    state.round += 1; state.turnIndex = 0; state.phase = 'secret';
    state.sabotage = null; state.guard = null; state.pending = null; state.review = null;
    skipDuoDetective(state);
    addLog(state, 'round', state.round + '라운드 시작');
  }
  function setReview(state, kind, fields) { state.review = Object.assign({ kind: kind, round: state.round }, fields || {}); }
  function blocked(state, category) {
    return state.sabotage && state.sabotage.category === category && (!state.guard || state.guard.category !== category);
  }
  function addQuestionHistory(state, category, status) {
    if (!Array.isArray(state.questionHistory)) state.questionHistory = [];
    state.questionHistory.push({ round: state.round, category: category, status: status });
  }
  function settleSeal(state, investigationCategory) {
    if (!state.sabotage) return;
    var culprit = state.players.find(function (player) { return player.role === 'culprit'; });
    if (!culprit) return;
    var success = !!state.review && state.review.kind === 'blocked';
    var reason = success ? 'blocked' : !investigationCategory ? 'unused'
      : investigationCategory === state.sabotage.category && state.guard && state.guard.category === investigationCategory ? 'guarded' : 'missed';
    culprit.sealOutcome = { round: state.round, success: success, reason: reason };
    culprit.sealOutcomes = (Array.isArray(culprit.sealOutcomes) ? culprit.sealOutcomes : []).filter(function (entry) { return entry.round !== state.round; }).concat([copy(culprit.sealOutcome)]).slice(-MAX_ROUNDS);
  }
  function safeSealOutcome(outcome) {
    if (!outcome || !Number.isInteger(outcome.round) || outcome.round < 1 || outcome.round > MAX_ROUNDS || typeof outcome.success !== 'boolean' || !['blocked', 'guarded', 'missed', 'unused'].includes(outcome.reason)) return null;
    return { round: outcome.round, success: outcome.success, reason: outcome.reason };
  }
  function pick(record, keys) {
    var result = {};
    if (record) keys.forEach(function (key) { if (record[key] !== undefined && (record[key] === null || ['string', 'number', 'boolean'].includes(typeof record[key]))) result[key] = record[key]; });
    return result;
  }
  function safeClues(clues) { return (Array.isArray(clues) ? clues : []).map(function (clue) { return pick(clue, ['category', 'value']); }); }
  function appendReplay(state, type, fields) {
    var entry = { id: 'replay-' + (state.replayEvents.length + 1), round: state.round, type: type };
    Object.keys(fields || {}).forEach(function (key) { if (fields[key] !== undefined) entry[key] = fields[key]; });
    state.replayEvents.push(entry);
  }
  function legacyReplay(state) {
    var entries = [], position = 0;
    function add(round, type, fields, order) { entries.push(Object.assign({ round: round, type: type, order: order, position: position++ }, fields || {})); }
    (state.facts || []).forEach(function (fact) {
      if (fact.source === 'audit') {
        var statement = (state.statements || []).find(function (entry) { return entry.id === fact.statementId; });
        add(fact.round, 'audit', { actorId: state.detectiveId, category: fact.category, statementId: fact.statementId, targetId: statement && statement.speakerId, value: statement && statement.value }, 3);
      } else add(fact.round, fact.source === 'share' ? 'share' : 'search', { actorId: fact.source === 'share' ? fact.speakerId : state.detectiveId, category: fact.category, value: fact.value }, fact.source === 'share' ? 0 : 2);
    });
    (state.statements || []).forEach(function (statement) { add(statement.round, 'answer', { actorId: statement.speakerId, category: statement.category, value: statement.value, statementId: statement.id }, 2); });
    (state.questionHistory || []).forEach(function (entry) {
      if (entry.status === 'blocked') add(entry.round, 'legacy-blocked', { actorId: state.detectiveId, category: entry.category }, 1);
      if (entry.status === 'unknown') add(entry.round, 'unknown', { category: entry.category, value: null }, 2);
    });
    if (state.accusation) add(state.round, 'accusation', { actorId: state.detectiveId, suspectId: state.accusation.suspectId, placeId: state.accusation.placeId, success: state.winner === 'investigators' }, 4);
    entries.sort(function (left, right) { return left.round - right.round || left.order - right.order || left.position - right.position; });
    return entries.map(function (entry, index) { var result = pick(entry, ['round', 'type', 'actorId', 'targetId', 'category', 'value', 'statementId', 'suspectId', 'placeId', 'success']); result.id = 'replay-' + (index + 1); return result; });
  }
  function ensureReplay(next, previous) {
    if (previous.replayVersion === 1 && Array.isArray(previous.replayEvents)) return;
    next.replayVersion = 1; next.replayComplete = false; next.replayEvents = legacyReplay(previous);
  }
  function recordReplay(previous, next, event) {
    ensureReplay(next, previous);
    var fields = { actorId: event.actorId }, type = null, statement;
    if (event.type === 'SECRET_ACTION') {
      type = event.kind === 'pass' ? 'secret-pass' : event.kind;
      if (event.kind !== 'pass') fields.category = event.category;
      if (event.kind === 'share') fields.value = caseValue(previous.secretNPC, event.category);
    } else if (event.type === 'INVESTIGATE') {
      type = event.kind === 'pass' ? 'investigate-pass' : event.kind;
      if (event.kind === 'question' || event.kind === 'search') {
        fields.category = event.category;
        if (event.kind === 'question') { fields.targetId = event.targetId; fields.proposedValue = event.proposedValue === undefined ? 0 : event.proposedValue; }
        if (next.review && next.review.kind === 'blocked') type = 'blocked-' + event.kind;
        else if (event.kind === 'search') fields.value = caseValue(previous.secretNPC, event.category);
      } else if (event.kind === 'audit') {
        statement = previous.statements.find(function (entry) { return entry.id === event.statementId; });
        fields.category = statement.category; fields.statementId = statement.id; fields.targetId = statement.speakerId; fields.value = statement.value;
      }
    } else if (event.type === 'ANSWER') {
      type = event.value === null ? 'unknown' : 'answer'; fields.category = previous.pending.category; fields.value = event.value;
      fields.proposedValue = previous.pending.proposedValue === undefined ? 0 : previous.pending.proposedValue;
      if (next.review && next.review.statementId) fields.statementId = next.review.statementId;
    } else if (event.type === 'REVIEW_RESULT' && event.kind === 'audit') {
      type = 'audit'; statement = previous.statements.find(function (entry) { return entry.id === previous.review.statementId; });
      fields.category = statement.category; fields.statementId = statement.id; fields.targetId = statement.speakerId; fields.value = statement.value;
    } else if (event.type === 'END_ROUND' || event.type === 'REVIEW_RESULT' && event.kind === 'confirm') type = 'round-confirm';
    else if (event.type === 'ACCUSE') { type = 'accusation'; fields.suspectId = event.suspectId; fields.placeId = event.placeId; fields.success = next.winner === 'investigators'; }
    var needsResolution = previous.sabotage && !next.replayEvents.some(function (entry) { return entry.round === previous.round && entry.type === 'seal-result'; }) &&
      ((previous.phase === 'investigate' || previous.phase === 'answer') && next.phase === 'discussion' || event.type === 'ACCUSE' && previous.phase === 'investigate');
    function resolution() {
      var investigationCategory = event.type === 'ANSWER' ? previous.pending.category : event.type === 'INVESTIGATE' && ['question', 'search'].includes(event.kind) ? event.category : null;
      var success = !!next.review && next.review.kind === 'blocked' && event.type !== 'ACCUSE';
      var reason = success ? 'blocked' : !investigationCategory ? 'unused' : investigationCategory === previous.sabotage.category && previous.guard && previous.guard.category === investigationCategory ? 'guarded' : 'missed';
      appendReplay(next, 'seal-result', { actorId: previous.sabotage.actorId, category: previous.sabotage.category, success: success, reason: reason });
    }
    if (needsResolution && event.type === 'ACCUSE') resolution();
    if (type) { appendReplay(next, type, fields); next.replayEvents[next.replayEvents.length - 1].round = previous.round; }
    if (needsResolution && event.type !== 'ACCUSE') resolution();
  }
  function finalReplay(state) {
    var recorded = state.replayVersion === 1 && Array.isArray(state.replayEvents);
    var validTypes = ['initial-clue', 'share', 'suggest', 'seal', 'guard', 'secret-pass', 'question', 'blocked-question', 'blocked-search', 'legacy-blocked', 'search', 'audit', 'investigate-pass', 'answer', 'unknown', 'seal-result', 'round-confirm', 'accusation'];
    var events = (recorded ? state.replayEvents : legacyReplay(state)).filter(function (entry) {
      return entry && validTypes.includes(entry.type) && Number.isInteger(entry.round) && entry.round >= 1 && entry.round <= MAX_ROUNDS;
    }).map(function (entry, index) {
      var result = pick(entry, ['round', 'type', 'actorId', 'targetId', 'category', 'value', 'proposedValue', 'statementId', 'suspectId', 'placeId', 'success', 'reason', 'kind']);
      result.id = 'replay-' + (index + 1);
      if (CATEGORIES.some(function (category) { return category.id === result.category; })) {
        result.actualValue = caseValue(state.secretNPC, result.category);
        if (['answer', 'audit'].includes(result.type) && (result.value === 0 || result.value === 1)) result.isTrue = result.value === result.actualValue;
      }
      return result;
    });
    return { version: 1, source: recorded ? 'recorded' : 'legacy', complete: recorded && state.replayComplete === true, events: events };
  }
  function act(state, event) {
    turnOwner(state);
    if (state.phase === 'finished') fail('이미 종료된 게임입니다.');
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') fail('유효한 행동이 필요합니다.');
    var next = copy(state), actor, category, statement, truth, fact;
    switch (event.type) {
      case 'ROLE_SEEN':
        requirePhase(state, ['reveal']); requireOwner(state, event.actorId);
        advancePrivate(next, 'secret');
        break;
      case 'SECRET_ACTION':
        requirePhase(state, ['secret']); requireOwner(state, event.actorId);
        actor = playerById(next, event.actorId);
        if (quickDuo(state) && (event.kind === 'share' || event.kind === 'suggest')) fail('2인전은 단서 공개와 수사 제안을 따로 준비하지 않습니다.');
        if (event.kind === 'share') {
          category = categoryById(event.category);
          if (!['detective', 'witness'].includes(actor.role) || !actor.clues.some(function (clue) { return clue.category === category.id; })) fail('본인이 가진 단서만 공개할 수 있습니다.');
          if (actor.shared.includes(category.id)) fail('이미 공개한 개인 단서입니다.');
          addFact(next, category.id, 'share', { speakerId: actor.id });
          actor.shared.push(category.id);
          addLog(next, 'share', actor.name + ' · 개인 단서 공개 · ' + category.label);
        } else if (event.kind === 'seal') {
          category = categoryById(event.category);
          if (!isCriminal(actor) || actor.sabotageLeft <= 0) fail('사용할 수 있는 봉쇄가 없습니다.');
          if (state.sabotage) fail('이번 라운드의 봉쇄는 이미 준비되었습니다.');
          actor.sabotageLeft -= 1;
          next.sabotage = { category: category.id, actorId: actor.id };
        } else if (event.kind === 'guard') {
          category = categoryById(event.category);
          if (actor.role !== 'suspect' || actor.guardLeft <= 0) fail('사용할 수 있는 보호가 없습니다.');
          actor.guardLeft -= 1;
          next.guard = { category: category.id, actorId: actor.id };
        } else if (event.kind === 'suggest') {
          category = categoryById(event.category);
          addLog(next, 'suggest', actor.name + ' · 수사 제안 · ' + category.label);
        } else if (event.kind !== 'pass') fail('유효한 비공개 행동을 선택하세요.');
        advancePrivate(next, 'investigate');
        break;
      case 'INVESTIGATE':
        requirePhase(state, ['investigate']); requireDetective(state, event.actorId);
        if (event.kind === 'question' || event.kind === 'search') {
          category = categoryById(event.category);
          if (event.kind === 'question') {
            actor = playerById(state, event.targetId);
            if (actor.id === state.detectiveId) fail('질문할 다른 참가자를 선택하세요.');
            if (event.proposedValue !== undefined && event.proposedValue !== 0 && event.proposedValue !== 1) fail('질문의 주장 값은 0 또는 1이어야 합니다.');
          } else if (state.kits <= 0) fail('남은 감식 키트가 없습니다.');
          if (blocked(state, category.id)) {
            addLog(next, 'blocked', '수사 봉쇄 · ' + category.label + ' · 이번 라운드의 수사가 종료되었습니다.');
            setReview(next, 'blocked', Object.assign({ category: category.id }, event.kind === 'question' ? { targetId: actor.id, proposedValue: event.proposedValue === undefined ? 0 : event.proposedValue } : {}));
            addQuestionHistory(next, category.id, 'blocked');
            next.phase = 'discussion';
          } else if (event.kind === 'question') {
            next.pending = { targetId: actor.id, category: category.id, proposedValue: event.proposedValue === undefined ? 0 : event.proposedValue };
            next.review = null;
            next.phase = 'answer';
            addLog(next, 'question', actor.name + '에게 질문 · ' + category.label);
          } else {
            next.kits -= 1;
            fact = addFact(next, category.id, 'search');
            setReview(next, 'search', { category: category.id, value: fact.value, verified: true, actualValue: fact.value });
            addLog(next, 'search', '공식 감식 · ' + category.label);
            next.phase = 'discussion';
          }
        } else if (event.kind === 'audit') {
          if (state.kits <= 0) fail('남은 감식 키트가 없습니다.');
          statement = next.statements.find(function (entry) { return entry.id === event.statementId; });
          if (!statement || statement.audited) fail('감사할 미검증 진술을 선택하세요.');
          statement.audited = true;
          next.kits -= 1;
          fact = addFact(next, statement.category, 'audit', { statementId: statement.id });
          setReview(next, 'audit', { category: statement.category, targetId: statement.speakerId, statementId: statement.id, value: fact.value, verified: true, actualValue: fact.value });
          addLog(next, 'audit', '공식 진술 감사 · ' + categoryById(statement.category).label);
          next.phase = 'discussion';
        } else if (event.kind === 'pass') {
          addLog(next, 'pass', '이번 라운드의 수사를 마쳤습니다.');
          setReview(next, 'pass');
          next.phase = 'discussion';
        } else fail('유효한 수사 행동을 선택하세요.');
        if (next.phase === 'discussion') settleSeal(next, event.kind === 'question' || event.kind === 'search' ? category.id : null);
        break;
      case 'ANSWER':
        requirePhase(state, ['answer']); requireOwner(state, event.actorId);
        actor = playerById(state, event.actorId);
        category = categoryById(state.pending.category);
        truth = caseValue(state.secretNPC, category.id);
        if (isCriminal(actor)) {
          if (event.value !== 0 && event.value !== 1) fail('범인 진영은 두 값 중 하나로 정식 답변해야 합니다.');
          if (event.value !== truth && state.liesUsed >= LIE_LIMIT) fail('범인 진영의 거짓말 두 회를 모두 사용했습니다.');
        } else {
          var knows = actor.clues.some(function (clue) { return clue.category === category.id; }) || state.facts.some(function (fact) { return fact.category === category.id; });
          if (knows && event.value !== truth) fail('아는 단서는 사실대로 답변해야 합니다.');
          if (!knows && event.value !== null) fail('모르는 항목은 모름으로 답변해야 합니다.');
        }
        if (event.value === null) {
          addLog(next, 'unknown', actor.name + ' · ' + category.label + ': 모름');
          setReview(next, 'unknown', { category: category.id, targetId: actor.id, value: null, proposedValue: state.pending.proposedValue === undefined ? 0 : state.pending.proposedValue });
        }
        else {
          if (event.value !== truth) next.liesUsed += 1;
          next.statements.push({ id: 'statement-' + (state.statements.length + 1), round: state.round, speakerId: actor.id, category: category.id, value: event.value, audited: false });
          setReview(next, 'answer', { category: category.id, targetId: actor.id, statementId: next.statements[next.statements.length - 1].id, value: event.value, verified: false, proposedValue: state.pending.proposedValue === undefined ? 0 : state.pending.proposedValue });
          addLog(next, 'statement', actor.name + ' · 정식 진술 · ' + category.label + ': ' + category.values[event.value]);
        }
        next.pending = null;
        next.phase = 'discussion';
        addQuestionHistory(next, category.id, event.value === null ? 'unknown' : 'answered');
        settleSeal(next, category.id);
        break;
      case 'ADD_NOTE':
        requirePhase(state, ['reveal', 'secret', 'investigate', 'answer', 'discussion', 'final']); actor = playerById(state, event.speakerId);
        if (typeof event.text !== 'string' || !event.text.trim() || event.text.length > 300) fail('자유 발언은 1자부터 300자까지 입력하세요.');
        next.notes.push({ speakerId: actor.id, text: event.text.trim(), round: state.round });
        break;
      case 'REVIEW_RESULT':
        requirePhase(state, ['discussion']); requireDetective(state, event.actorId);
        if (event.kind === 'audit') {
          if (!state.review || state.review.kind !== 'answer' || state.review.round !== state.round || state.review.verified) fail('방금 공개된 미검증 답변만 확인할 수 있습니다.');
          if (event.statementId !== undefined && event.statementId !== state.review.statementId) fail('방금 공개된 답변만 확인할 수 있습니다.');
          statement = next.statements.find(function (entry) { return entry.id === state.review.statementId && entry.round === state.round; });
          if (!statement || statement.audited) fail('이미 확인했거나 확인할 수 없는 답변입니다.');
          if (state.kits <= 0) fail('남은 감식 키트가 없습니다.');
          statement.audited = true; next.kits -= 1;
          fact = addFact(next, statement.category, 'audit', { statementId: statement.id });
          next.review.verified = true; next.review.actualValue = fact.value;
          addLog(next, 'audit', '방금 답변 검증 · ' + categoryById(statement.category).label);
        } else if (event.kind === 'confirm') {
          if (state.round < MAX_ROUNDS) nextRound(next);
          else next.phase = 'final';
        } else fail('결과 확인 행동을 선택하세요.');
        break;
      case 'END_ROUND':
        requirePhase(state, ['discussion']); requireDetective(state, event.actorId);
        if (state.round >= MAX_ROUNDS) fail('다섯 번째 라운드에는 최종 지목을 해야 합니다.');
        nextRound(next);
        break;
      case 'ACCUSE':
        requirePhase(state, ['discussion', 'investigate', 'final']); requireDetective(state, event.actorId);
        if (state.rulesVersion >= 2 && state.round === MAX_ROUNDS && state.phase !== 'final') fail('마지막 수사 결과를 확인한 뒤 최종 지목하세요.');
        suspectById(event.suspectId); placeById(event.placeId);
        next.accusation = { suspectId: event.suspectId, placeId: event.placeId };
        next.winner = event.suspectId === state.secretNPC.suspectId && event.placeId === state.secretNPC.placeId ? 'investigators' : 'criminals';
        next.phase = 'finished';
        addLog(next, 'accusation', '최종 지목 · ' + suspectById(event.suspectId).name + ' / ' + placeById(event.placeId).name);
        break;
      default: fail('알 수 없는 행동입니다.');
    }
    recordReplay(state, next, event);
    return freeze(next);
  }
  function publicView(state) {
    var view = {};
    ['phase', 'round', 'turnIndex', 'kits', 'detectiveId', 'winner'].forEach(function (key) { view[key] = state[key]; });
    view.statements = state.statements.map(function (entry) { return pick(entry, ['id', 'round', 'speakerId', 'category', 'value', 'audited']); });
    view.facts = state.facts.map(function (entry) { return pick(entry, ['id', 'round', 'category', 'value', 'source', 'speakerId', 'statementId']); });
    view.log = state.log.map(function (entry) { return pick(entry, ['round', 'type', 'text']); });
    view.notes = state.notes.map(function (entry) { return pick(entry, ['round', 'speakerId', 'text']); });
    view.pending = state.pending ? pick(state.pending, ['targetId', 'category', 'proposedValue']) : null;
    view.accusation = state.accusation ? pick(state.accusation, ['suspectId', 'placeId']) : null;
    view.rulesVersion = state.rulesVersion || 1;
    view.questionHistory = (Array.isArray(state.questionHistory) ? state.questionHistory : []).filter(function (entry) {
      return entry && Number.isInteger(entry.round) && entry.round >= 1 && entry.round <= MAX_ROUNDS && CATEGORIES.some(function (category) { return category.id === entry.category; }) && ['blocked', 'answered', 'unknown'].includes(entry.status);
    }).map(function (entry) { return { round: entry.round, category: entry.category, status: entry.status }; });
    view.review = null;
    if (state.review) {
      view.review = pick(state.review, ['kind', 'round', 'category', 'targetId', 'statementId', 'value', 'verified', 'proposedValue']);
      if (state.review.verified === true && (state.review.actualValue === 0 || state.review.actualValue === 1)) view.review.actualValue = state.review.actualValue;
    }
    view.players = state.players.map(function (player) { return { id: player.id, name: player.name, isDetective: player.id === state.detectiveId }; });
    view.turnOwnerId = turnOwner(state);
    if (state.phase === 'finished') {
      view.reveal = {
        secret: pick(state.secretNPC, ['suspectId', 'placeId']),
        players: state.players.map(function (player) { return { id: player.id, name: player.name, role: player.role }; }),
        statements: state.statements.map(function (statement) {
          var result = pick(statement, ['id', 'round', 'speakerId', 'category', 'value', 'audited']);
          result.isTrue = statement.value === caseValue(state.secretNPC, statement.category);
          return result;
        }),
        replay: finalReplay(state)
      };
    }
    return freeze(view);
  }
  function privateView(state, actorId) {
    requirePhase(state, ['reveal', 'secret', 'answer']); requireOwner(state, actorId);
    var actor = playerById(state, actorId), view = copy(publicView(state));
    view.self = { id: actor.id, name: actor.name, role: actor.role, clues: safeClues(actor.clues), shared: copy(actor.shared), sabotageLeft: actor.sabotageLeft, guardLeft: actor.guardLeft };
    if (actor.role === 'culprit') {
      var sealOutcome = safeSealOutcome(actor.sealOutcome);
      if (sealOutcome) view.self.sealOutcome = sealOutcome;
      if (Array.isArray(actor.sealOutcomes)) view.self.sealOutcomes = actor.sealOutcomes.map(safeSealOutcome).filter(Boolean).slice(-MAX_ROUNDS);
    }
    if (isCriminal(actor)) {
      view.caseSecret = pick(state.secretNPC, ['suspectId', 'placeId']);
      view.remainingLies = LIE_LIMIT - state.liesUsed;
      view.partnerIds = state.players.filter(function (player) { return player.id !== actor.id && isCriminal(player); }).map(function (player) { return player.id; });
      view.sabotage = state.sabotage ? pick(state.sabotage, ['category', 'actorId']) : null;
    }
    return freeze(view);
  }
  function candidates(view) {
    if (!view || !Array.isArray(view.facts) || !Array.isArray(view.statements)) fail('공개 수사 기록이 필요합니다.');
    var result = [];
    SUSPECTS.forEach(function (suspect) {
      PLACES.forEach(function (place) {
        var secret = { suspectId: suspect.id, placeId: place.id };
        if (!view.facts.every(function (fact) { return caseValue(secret, fact.category) === fact.value; })) return;
        var contradictions = view.statements.reduce(function (total, statement) { return total + (caseValue(secret, statement.category) !== statement.value ? 1 : 0); }, 0);
        if (contradictions <= LIE_LIMIT) result.push(secret);
      });
    });
    return freeze(result);
  }
  return freeze({ CATEGORIES: CATEGORIES, SUSPECTS: SUSPECTS, PLACES: PLACES, ROLE_PACKS: ROLE_PACKS, ROLES: ROLES, MAX_ROUNDS: MAX_ROUNDS, makeGame: makeGame, act: act, publicView: publicView, privateView: privateView, turnOwner: turnOwner, candidates: candidates });
}));

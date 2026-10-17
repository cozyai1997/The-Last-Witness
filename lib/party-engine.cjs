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
    var recipients = playerNames.length === 2 ? [detective, detective] : playerNames.length < 5 ? [detective, witnesses[0]] : witnesses;
    var clueCategories = shuffled(CATEGORIES, random).slice(0, 2);
    recipients.forEach(function (recipient, index) {
      var category = clueCategories[index].id;
      recipient.clues.push({ category: category, value: caseValue(secret, category) });
    });
    return freeze({
      phase: 'reveal', round: 1, players: players, detectiveId: detective.id, turnIndex: 0,
      kits: 1, liesUsed: 0, secretNPC: secret, sabotage: null, guard: null,
      statements: [], facts: [], log: [], notes: [], pending: null, winner: null, accusation: null
    });
  }
  function turnOwner(state) {
    if (!state || !Array.isArray(state.players)) fail('유효한 게임 상태가 필요합니다.');
    if (state.phase === 'reveal' || state.phase === 'secret') return state.players[state.turnIndex].id;
    if (state.phase === 'answer') return state.pending.targetId;
    if (state.phase === 'investigate' || state.phase === 'discussion') return state.detectiveId;
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
  }
  function blocked(state, category) {
    return state.sabotage && state.sabotage.category === category && (!state.guard || state.guard.category !== category);
  }
  function act(state, event) {
    turnOwner(state);
    if (state.phase === 'finished') fail('이미 종료된 게임입니다.');
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') fail('유효한 행동이 필요합니다.');
    var next = copy(state), actor, category, statement, truth;
    switch (event.type) {
      case 'ROLE_SEEN':
        requirePhase(state, ['reveal']); requireOwner(state, event.actorId);
        advancePrivate(next, 'secret');
        break;
      case 'SECRET_ACTION':
        requirePhase(state, ['secret']); requireOwner(state, event.actorId);
        actor = playerById(next, event.actorId);
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
          } else if (state.kits <= 0) fail('남은 감식 키트가 없습니다.');
          if (blocked(state, category.id)) {
            addLog(next, 'blocked', '수사 봉쇄 · ' + category.label + ' · 이번 라운드의 수사가 종료되었습니다.');
            next.phase = 'discussion';
          } else if (event.kind === 'question') {
            next.pending = { targetId: actor.id, category: category.id };
            next.phase = 'answer';
            addLog(next, 'question', actor.name + '에게 질문 · ' + category.label);
          } else {
            next.kits -= 1;
            addFact(next, category.id, 'search');
            addLog(next, 'search', '공식 감식 · ' + category.label);
            next.phase = 'discussion';
          }
        } else if (event.kind === 'audit') {
          if (state.kits <= 0) fail('남은 감식 키트가 없습니다.');
          statement = next.statements.find(function (entry) { return entry.id === event.statementId; });
          if (!statement || statement.audited) fail('감사할 미검증 진술을 선택하세요.');
          statement.audited = true;
          next.kits -= 1;
          addFact(next, statement.category, 'audit', { statementId: statement.id });
          addLog(next, 'audit', '공식 진술 감사 · ' + categoryById(statement.category).label);
          next.phase = 'discussion';
        } else if (event.kind === 'pass') {
          addLog(next, 'pass', '이번 라운드의 수사를 마쳤습니다.');
          next.phase = 'discussion';
        } else fail('유효한 수사 행동을 선택하세요.');
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
        if (event.value === null) addLog(next, 'unknown', actor.name + ' · ' + category.label + ': 모름');
        else {
          if (event.value !== truth) next.liesUsed += 1;
          next.statements.push({ id: 'statement-' + (state.statements.length + 1), round: state.round, speakerId: actor.id, category: category.id, value: event.value, audited: false });
          addLog(next, 'statement', actor.name + ' · 정식 진술 · ' + category.label + ': ' + category.values[event.value]);
        }
        next.pending = null;
        next.phase = 'discussion';
        break;
      case 'ADD_NOTE':
        requirePhase(state, ['discussion']); actor = playerById(state, event.speakerId);
        if (typeof event.text !== 'string' || !event.text.trim() || event.text.length > 300) fail('자유 발언은 1자부터 300자까지 입력하세요.');
        next.notes.push({ speakerId: actor.id, text: event.text.trim(), round: state.round });
        break;
      case 'END_ROUND':
        requirePhase(state, ['discussion']); requireDetective(state, event.actorId);
        if (state.round >= MAX_ROUNDS) fail('다섯 번째 라운드에는 최종 지목을 해야 합니다.');
        next.round += 1; next.turnIndex = 0; next.phase = 'secret';
        next.sabotage = null; next.guard = null; next.pending = null;
        addLog(next, 'round', next.round + '라운드 시작');
        break;
      case 'ACCUSE':
        requirePhase(state, ['discussion', 'investigate']); requireDetective(state, event.actorId);
        suspectById(event.suspectId); placeById(event.placeId);
        next.accusation = { suspectId: event.suspectId, placeId: event.placeId };
        next.winner = event.suspectId === state.secretNPC.suspectId && event.placeId === state.secretNPC.placeId ? 'investigators' : 'criminals';
        next.phase = 'finished';
        addLog(next, 'accusation', '최종 지목 · ' + suspectById(event.suspectId).name + ' / ' + placeById(event.placeId).name);
        break;
      default: fail('알 수 없는 행동입니다.');
    }
    return freeze(next);
  }
  function publicView(state) {
    var view = {};
    ['phase', 'round', 'turnIndex', 'kits', 'statements', 'facts', 'log', 'notes', 'pending', 'detectiveId', 'winner', 'accusation'].forEach(function (key) { view[key] = copy(state[key]); });
    view.players = state.players.map(function (player) { return { id: player.id, name: player.name, isDetective: player.id === state.detectiveId }; });
    view.turnOwnerId = turnOwner(state);
    if (state.phase === 'finished') {
      view.reveal = {
        secret: copy(state.secretNPC),
        players: state.players.map(function (player) { return { id: player.id, name: player.name, role: player.role }; }),
        statements: state.statements.map(function (statement) {
          var result = copy(statement);
          result.isTrue = statement.value === caseValue(state.secretNPC, statement.category);
          return result;
        })
      };
    }
    return freeze(view);
  }
  function privateView(state, actorId) {
    requirePhase(state, ['reveal', 'secret', 'answer']); requireOwner(state, actorId);
    var actor = playerById(state, actorId), view = copy(publicView(state));
    view.self = { id: actor.id, name: actor.name, role: actor.role, clues: copy(actor.clues), shared: copy(actor.shared), sabotageLeft: actor.sabotageLeft, guardLeft: actor.guardLeft };
    if (isCriminal(actor)) {
      view.caseSecret = copy(state.secretNPC);
      view.remainingLies = LIE_LIMIT - state.liesUsed;
      view.partnerIds = state.players.filter(function (player) { return player.id !== actor.id && isCriminal(player); }).map(function (player) { return player.id; });
      view.sabotage = copy(state.sabotage);
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

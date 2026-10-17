(function (root, factory) {
  'use strict';
  var data = typeof module === 'object' && module.exports ? require('../public/seven-data.js') : root.WitnessSevenData;
  var api = factory(data);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WitnessSevenEngine = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';
  if (!D) throw new Error('WitnessSevenData가 먼저 필요합니다.');
  var MAX_ROUNDS = 7, LIE_LIMIT = 2;
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(function (key) { freeze(value[key]); }); Object.freeze(value);
    }
    return value;
  }
  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') {
      var result = {};
      Object.keys(value).forEach(function (key) { if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') result[key] = copy(value[key]); });
      return result;
    }
    return value;
  }
  function pick(value, keys) {
    var result = {};
    keys.forEach(function (key) { if (value && value[key] !== undefined) result[key] = copy(value[key]); });
    return result;
  }
  function fail(message) { throw new Error(message); }
  function categoryById(id) { var found = D.CATEGORIES.find(function (item) { return item.id === id; }); if (!found) fail('유효한 수사 항목을 선택하세요.'); return found; }
  function inCatalog(entries, id, message) { var found = entries.find(function (item) { return item.id === id; }); if (!found) fail(message); return found; }
  function personById(id) { return inCatalog(D.SUSPECTS, id, '사건 속 인물 한 명을 선택하세요.'); }
  function playerById(state, id) { return inCatalog(state.players, id, '유효한 참가자를 선택하세요.'); }
  function isCriminal(player) { return player.role === 'culprit' || player.role === 'accomplice'; }
  function caseValue(secret, category) { return D.caseValue(secret, category); }
  function seedRandom(seed) {
    var value = seed >>> 0;
    return function () { value = (value + 0x6D2B79F5) >>> 0; var t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function randomSeed() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) { var values = new Uint32Array(1); globalThis.crypto.getRandomValues(values); return values[0]; }
    return Math.floor(Math.random() * 4294967296);
  }
  function shuffle(items, random) {
    var result = items.slice();
    for (var i = result.length - 1; i > 0; i -= 1) { var j = Math.floor(random() * (i + 1)), value = result[i]; result[i] = result[j]; result[j] = value; }
    return result;
  }
  function draw(items, random) { return items[Math.floor(random() * items.length)]; }
  function log(state, type, text) { state.log.push({ round: state.round, type: type, text: text }); }
  function replay(state, type, fields) { state.replayEvents.push(Object.assign({ id: 'replay-' + (state.replayEvents.length + 1), round: state.round, type: type }, copy(fields || {}))); }
  function turnOwner(state) {
    if (!state || !Array.isArray(state.players)) fail('유효한 게임 상태가 필요합니다.');
    if (state.phase === 'reveal' || state.phase === 'secret') return state.players[state.turnIndex].id;
    if (state.phase === 'answer') return state.pending.targetId;
    if (['investigate', 'discussion', 'final'].includes(state.phase)) return state.detectiveId;
    if (state.phase === 'finished') return null;
    fail('유효한 게임 단계가 아닙니다.');
  }
  function requirePhase(state, phases) { if (!phases.includes(state.phase)) fail('현재 단계에서는 이 행동을 할 수 없습니다.'); }
  function requireOwner(state, id) { playerById(state, id); if (turnOwner(state) !== id) fail('현재 차례인 참가자만 행동할 수 있습니다.'); }
  function requireDetective(state, id) { if (state.detectiveId !== id) fail('탐정만 수사를 진행할 수 있습니다.'); }
  function advance(state, phase) { state.turnIndex += 1; if (state.turnIndex >= state.players.length) { state.turnIndex = 0; state.phase = phase; } }
  function sameTraits(a, b) { return D.CATEGORIES.filter(function (c) { return c.group === 'person' && a[c.id] === b[c.id]; }); }
  function resemblanceOptions(culprit) {
    var result = [];
    D.SUSPECTS.forEach(function (other) {
      if (other.id === culprit.id) return;
      var same = sameTraits(culprit, other);
      if (same.length !== 2) return;
      var peers = D.SUSPECTS.filter(function (person) { return same.every(function (c) { return person[c.id] === culprit[c.id]; }); });
      if (peers.length >= 3) result.push({ person: other, categories: same });
    });
    return result;
  }
  function partialValues(size, trueValue, random) { return [trueValue].concat(shuffle(Array.from({ length: size }, function (_, i) { return i; }).filter(function (i) { return i !== trueValue; }), random).slice(0, 5)).sort(function (a, b) { return a - b; }); }
  function initialIdentity(characterId, role, random) {
    if (role !== 'suspect') return { known: true, candidates: [characterId], memory: [], memoryLeft: 0, eliminationOrder: [] };
    var others = shuffle(D.SUSPECTS.filter(function (person) { return person.id !== characterId; }).map(function (p) { return p.id; }), random).slice(0, 2);
    return { known: false, candidates: shuffle([characterId].concat(others), random), memory: [], memoryLeft: 2, eliminationOrder: shuffle(others, random) };
  }
  function includeValue(values, value, random) { if (!values.includes(value)) values[Math.floor(random() * values.length)] = value; }
  function fieldReference(secret, personCategories, records, initialScene, resemblanceId, random) {
    var reference = {
      version: 2, meaning: '인물마다 여섯 개의 가능한 장소·도구·시간 조합입니다. 한 행을 함께 대조하며 실제 방문·사용·현장을 확정하지 않습니다.',
      people: D.SUSPECTS.map(function (person) { return { suspectId: person.id, placeIds: shuffle(D.PLACES.filter(function (p) { return person.access === 1 || p.entry === 0; }), random).slice(0, 6).map(function (p) { return p.id; }), toolIds: shuffle(D.TOOLS, random).slice(0, 6).map(function (t) { return t.id; }), timeIds: shuffle(D.TIMES, random).slice(0, 6).map(function (t) { return t.id; }) }; }),
      places: D.PLACES.map(function (place) { return { placeId: place.id, toolIds: shuffle(D.TOOLS, random).slice(0, 6).map(function (t) { return t.id; }), timeIds: shuffle(D.TIMES, random).slice(0, 6).map(function (t) { return t.id; }) }; })
    };
    var culprit = reference.people.find(function (p) { return p.suspectId === secret.suspectId; });
    var scene = reference.places.find(function (p) { return p.placeId === secret.placeId; });
    includeValue(culprit.placeIds, secret.placeId, random); includeValue(culprit.toolIds, secret.toolId, random); includeValue(culprit.timeIds, secret.timeId, random);
    includeValue(scene.toolIds, secret.toolId, random); includeValue(scene.timeIds, secret.timeId, random);
    var sceneRecord = records.find(function (r) { return r.recordId === 'scene'; });
    var toolRecord = records.find(function (r) { return r.recordId === 'tool'; });
    var timeRecord = records.find(function (r) { return r.recordId === 'time'; });
    var peerIds = D.SUSPECTS.filter(function (person) { return personCategories.every(function (category) { return person[category.id] === caseValue(secret, category.id); }); }).map(function (person) { return person.id; });
    // Preserve C/S and a third plausible person, rather than guaranteeing all
    // same-trait peers. Other peers must actually survive every original source.
    var protectedIds = [secret.suspectId, resemblanceId];
    protectedIds.push(shuffle(peerIds.filter(function (id) { return !protectedIds.includes(id); }), random)[0]);
    reference.people.forEach(function (person) {
      if (person.suspectId === secret.suspectId || !protectedIds.includes(person.suspectId)) return;
      var profile = personById(person.suspectId);
      var possible = reference.places.filter(function (place) {
        var placeProfile = D.PLACES.find(function (p) { return p.id === place.placeId; });
        return (profile.access === 1 || placeProfile.entry === 0) && placeProfile[sceneRecord.category] === sceneRecord.allowedValues[0] && placeProfile[initialScene.category] === initialScene.value;
      });
      var route = draw(possible, random);
      if (!route.toolIds.some(function (id) { return toolRecord.allowedValues.includes(D.TOOLS.findIndex(function (t) { return t.id === id; })); })) includeValue(route.toolIds, D.TOOLS[draw(toolRecord.allowedValues, random)].id, random);
      if (!route.timeIds.some(function (id) { return timeRecord.allowedValues.includes(D.TIMES.findIndex(function (t) { return t.id === id; })); })) includeValue(route.timeIds, D.TIMES[draw(timeRecord.allowedValues, random)].id, random);
      includeValue(person.placeIds, route.placeId, random);
      includeValue(person.toolIds, draw(route.toolIds.filter(function (id) { return toolRecord.allowedValues.includes(D.TOOLS.findIndex(function (t) { return t.id === id; })); }), random), random);
      includeValue(person.timeIds, draw(route.timeIds.filter(function (id) { return timeRecord.allowedValues.includes(D.TIMES.findIndex(function (t) { return t.id === id; })); }), random), random);
    });
    // Every reference profile also has at least one coherent actual work event.
    reference.people.forEach(function (person) {
      var routes = reference.places.filter(function (place) { return person.placeIds.includes(place.placeId); });
      if (routes.some(function (place) { return person.toolIds.some(function (id) { return place.toolIds.includes(id); }) && person.timeIds.some(function (id) { return place.timeIds.includes(id); }); })) return;
      var route = routes[0]; includeValue(person.toolIds, route.toolIds[0], random); includeValue(person.timeIds, route.timeIds[0], random);
    });
    // Public paired possibilities prevent arbitrary cross-products of the broad
    // marginals. Thus a partial location/tool/time source can exclude a person,
    // while none of these rows asserts an actual alibi or reveals player ownership.
    var possibleCoordinates = D.candidates({ facts: [], statements: [], fieldReference: reference });
    reference.people.forEach(function (person) {
      var pool = possibleCoordinates.filter(function (event) { return event.suspectId === person.suspectId; });
      if (pool.length < 6) {
        var preserved = person.suspectId === secret.suspectId ? secret : protectedIds.includes(person.suspectId) ? pool.find(function (event) {
          return caseValue(event, initialScene.category) === initialScene.value && records.every(function (record) { return record.allowedValues.includes(caseValue(event, record.category)); });
        }) : null;
        var target = reference.places.find(function (place) { return place.placeId === (preserved ? preserved.placeId : person.placeIds[0]); });
        function includeRequired(values, needed, keep) { needed.forEach(function (value) { if (!values.includes(value)) values[values.findIndex(function (existing) { return existing !== keep && !needed.includes(existing); })] = value; }); }
        includeRequired(person.toolIds, target.toolIds.slice(0, 2), preserved && preserved.toolId);
        includeRequired(person.timeIds, target.timeIds.slice(0, 3), preserved && preserved.timeId);
        pool = D.candidates({ facts: [], statements: [], fieldReference: reference }).filter(function (event) { return event.suspectId === person.suspectId; });
      }
      var required = null;
      if (person.suspectId === secret.suspectId) required = secret;
      else if (protectedIds.includes(person.suspectId)) required = draw(pool.filter(function (event) {
        return caseValue(event, initialScene.category) === initialScene.value && records.every(function (record) { return record.allowedValues.includes(caseValue(event, record.category)); });
      }), random);
      var selected = shuffle(pool.filter(function (event) { return !required || event.placeId !== required.placeId || event.toolId !== required.toolId || event.timeId !== required.timeId; }), random).slice(0, required ? 5 : 6);
      if (required) selected.push(required);
      person.routes = shuffle(selected, random).map(function (event) { return pick(event, ['placeId', 'toolId', 'timeId']); });
    });
    return reference;
  }
  function makeGame(names, options) {
    options = options || {};
    if (!Array.isArray(names) || names.length < 2 || names.length > 6) fail('참가자는 2명부터 6명까지 가능합니다.');
    names = names.map(function (name) { if (typeof name !== 'string' || !name.trim() || name.trim().length > 20) fail('참가자 이름은 1자부터 20자까지 입력하세요.'); return name.trim(); });
    var seed = options.seed === undefined ? randomSeed() : options.seed;
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) fail('유효한 난수 시드가 필요합니다.');
    var random = seedRandom(seed), pack = D.ROLE_PACKS[names.length], roles = shuffle(pack, random);
    if (options.roleOrder !== undefined) {
      if (!Array.isArray(options.roleOrder) || options.roleOrder.slice().sort().join(',') !== pack.slice().sort().join(',')) fail('인원에 맞는 역할 구성이 필요합니다.');
      roles = options.roleOrder.slice();
    }
    var override = options.secret || {};
    var culpritPerson = override.suspectId === undefined ? draw(D.SUSPECTS, random) : personById(override.suspectId);
    var possibleTwins = resemblanceOptions(culpritPerson), resemblance = draw(possibleTwins, random);
    if (!resemblance) fail('사건 구성을 생성할 수 없습니다.');
    var personCategories = shuffle(resemblance.categories, random);
    var secret = {
      suspectId: culpritPerson.id,
      placeId: override.placeId === undefined ? draw(D.PLACES.filter(function (p) { return culpritPerson.access === 1 || p.entry === 0; }), random).id : inCatalog(D.PLACES, override.placeId, '유효한 사건 장소를 선택하세요.').id,
      toolId: override.toolId === undefined ? draw(D.TOOLS, random).id : inCatalog(D.TOOLS, override.toolId, '유효한 사건 도구를 선택하세요.').id,
      timeId: override.timeId === undefined ? draw(D.TIMES, random).id : inCatalog(D.TIMES, override.timeId, '유효한 사건 시간대를 선택하세요.').id
    };
    if (culpritPerson.access === 0 && inCatalog(D.PLACES, secret.placeId).entry === 1) fail('해당 인물의 출입 권한과 사건 장소가 맞지 않습니다.');
    var remaining = shuffle(D.SUSPECTS.filter(function (person) { return person.id !== culpritPerson.id && (!roles.includes('suspect') || person.id !== resemblance.person.id); }).map(function (person) { return person.id; }), random);
    var players = names.map(function (name, index) {
      var role = roles[index], characterId = role === 'culprit' ? culpritPerson.id : role === 'suspect' ? resemblance.person.id : remaining.pop();
      return { id: 'u' + index, name: name, role: role, characterId: characterId, clues: [], shared: [], sabotageLeft: role === 'culprit' ? 2 : role === 'accomplice' ? 1 : 0, guardLeft: role === 'suspect' ? 1 : 0, identity: initialIdentity(characterId, role, random), sealedReport: null, identityGuess: null };
    });
    var detective = players.find(function (p) { return p.role === 'detective'; });
    var placeFields = D.CATEGORIES.filter(function (c) { return c.group === 'place'; });
    var suspect = players.find(function (p) { return p.role === 'suspect'; });
    // A source records only what was observed. Re-reading returns this exact snapshot.
    var hasGeneralPeer = D.SUSPECTS.some(function (person) { return person.access === 0 && personCategories.every(function (c) { return person[c.id] === culpritPerson[c.id]; }); });
    var sceneField = draw(placeFields.filter(function (c) { return !(hasGeneralPeer && inCatalog(D.PLACES, secret.placeId).entry === 1 && c.id === 'entry'); }), random);
    // D starts with one person observation and one scene observation, never a
    // coordinate. Reading originals plus this memory must still require testimony.
    var possibleInitialScene = placeFields.filter(function (category) {
      return !hasGeneralPeer || D.PLACES.some(function (place) { return place.entry === 0 && place[sceneField.id] === caseValue(secret, sceneField.id) && place[category.id] === caseValue(secret, category.id); });
    });
    var detectiveCategories = [draw(personCategories, random), draw(possibleInitialScene, random)];
    detective.clues = detectiveCategories.map(function (c) { return { category: c.id, value: caseValue(secret, c.id) }; });
    var observationFields = shuffle(D.CATEGORIES.filter(function (c) { return !detectiveCategories.some(function (d) { return d.id === c.id; }); }), random);
    players.filter(function (p) { return p.role === 'witness'; }).forEach(function (p, i) { p.clues.push({ category: observationFields[i].id, value: caseValue(secret, observationFields[i].id) }); });
    if (suspect) { var observation = draw(personCategories, random); suspect.clues.push({ category: observation.id, value: caseValue(secret, observation.id) }); }
    var records = [
      { recordId: 'portrait', category: personCategories[0].id, allowedValues: [caseValue(secret, personCategories[0].id)] },
      { recordId: 'access', category: personCategories[1].id, allowedValues: [caseValue(secret, personCategories[1].id)] },
      { recordId: 'scene', category: sceneField.id, allowedValues: [caseValue(secret, sceneField.id)] },
      { recordId: 'tool', category: 'tool', allowedValues: partialValues(D.TOOLS.length, caseValue(secret, 'tool'), random) },
      { recordId: 'time', category: 'time', allowedValues: partialValues(D.TIMES.length, caseValue(secret, 'time'), random) }
    ];
    var reference = fieldReference(secret, personCategories, records, detective.clues[1], resemblance.person.id, random);
    var possibleEvents = D.candidates({ facts: [], statements: [], fieldReference: reference });
    var worldEvents = D.SUSPECTS.map(function (person) {
      var isCulprit = person.id === secret.suspectId;
      var coordinates = isCulprit ? secret : draw(possibleEvents.filter(function (e) { return e.suspectId === person.id; }), random);
      return Object.assign({}, coordinates, { activity: isCulprit ? '사건 발생' : draw(['근무 기록', '이동 기록', '대기 기록'], random) });
    });
    var state = {
      rulesVersion: 4, maxRounds: MAX_ROUNDS, phase: 'reveal', round: 1, players: players, detectiveId: detective.id, turnIndex: 0,
      kits: 1, liesUsed: 0, refusalsUsed: 0, pending: null, review: null, facts: [], statements: [], notes: [], questionHistory: [], log: [],
      winner: null, accusation: null, secretNPC: secret, fieldReference: reference, caseWorld: { version: 1, crime: copy(secret), events: worldEvents, records: records, fieldReference: copy(reference), resemblance: { suspectId: suspect ? suspect.characterId : null, categories: personCategories.map(function (c) { return c.id; }) } },
      seals: [], guard: null, replayVersion: 2, replayComplete: true, replayEvents: []
    };
    players.forEach(function (p) { p.clues.forEach(function (c) { replay(state, 'initial-clue', { actorId: p.id, category: c.category, value: c.value, kind: 'private' }); }); });
    log(state, 'round', 'DAY 1 · 첫 번째 밤의 수사가 시작되었습니다.');
    return freeze(state);
  }
  function categoryValues(category) { return categoryById(category).values.map(function (_, i) { return i; }); }
  function knowledge(state, player, category) {
    var values = categoryValues(category);
    player.clues.filter(function (clue) { return clue.category === category; }).forEach(function (clue) { values = values.filter(function (value) { return value === clue.value; }); });
    state.facts.filter(function (fact) { return fact.category === category; }).forEach(function (fact) {
      if (fact.source === 'audit') {
        var statement = state.statements.find(function (entry) { return entry.id === fact.statementId; });
        if (statement) values = values.filter(function (value) { return (value === statement.value) === fact.isTrue; });
      } else values = values.filter(function (value) { return fact.allowedValues ? fact.allowedValues.includes(value) : value === fact.value; });
    });
    return values;
  }
  function answerValues(state, player, category) {
    if (isCriminal(player)) {
      var actual = caseValue(state.secretNPC, category), values = categoryValues(category).filter(function (value) { return value === actual || state.liesUsed < LIE_LIMIT; });
      if (state.refusalsUsed < 1) values.push(null);
      return values;
    }
    var known = knowledge(state, player, category);
    return known.length === 1 ? known : [null];
  }
  function blocked(state, category) { return state.seals.some(function (seal) { return seal.category === category; }) && (!state.guard || state.guard.category !== category); }
  function setReview(state, kind, fields) { state.review = Object.assign({ kind: kind, round: state.round }, copy(fields || {})); state.phase = 'discussion'; }
  function history(state, fields) { state.questionHistory.push(Object.assign({ round: state.round }, copy(fields))); }
  function sealOutcome(state, category, wasBlocked) {
    state.seals.forEach(function (seal) {
      var actor = playerById(state, seal.actorId), reason = wasBlocked && seal.category === category ? 'blocked' : category === seal.category && state.guard && state.guard.category === category ? 'guarded' : category ? 'missed' : 'unused';
      var outcome = { round: state.round, success: reason === 'blocked', reason: reason };
      actor.sealOutcome = outcome; if (!actor.sealOutcomes) actor.sealOutcomes = []; actor.sealOutcomes.push(copy(outcome));
      replay(state, 'seal-result', Object.assign({ actorId: actor.id, category: seal.category }, outcome));
    });
  }
  function investigation(state, next, event) {
    requirePhase(state, ['investigate']); requireDetective(state, event.actorId);
    var category, target, original;
    if (event.kind === 'question') {
      target = playerById(state, event.targetId); if (target.id === state.detectiveId) fail('다른 참가자에게 질문하세요.');
      category = categoryById(event.category);
      var proposed = event.proposedValue === undefined ? 0 : event.proposedValue;
      if (!Number.isInteger(proposed) || category.values[proposed] === undefined) fail('유효한 질문 가설을 선택하세요.');
      replay(next, 'question', { actorId: event.actorId, targetId: target.id, category: category.id, proposedValue: proposed });
      if (blocked(state, category.id)) {
        setReview(next, 'blocked', { category: category.id, targetId: target.id, proposedValue: proposed });
        history(next, { category: category.id, targetId: target.id, proposedValue: proposed, status: 'blocked' });
        log(next, 'blocked', '해당 항목의 확인이 잠시 봉쇄되었습니다. 다음 날 다시 질문할 수 있습니다.'); sealOutcome(next, category.id, true);
      } else { next.pending = { targetId: target.id, category: category.id, proposedValue: proposed }; next.phase = 'answer'; log(next, 'question', target.name + '에게 ' + category.label + ' 항목을 질문했습니다.'); }
      return;
    }
    if (event.kind === 'search') {
      inCatalog(D.RECORDS, event.recordId, '원본 기록 하나를 선택하세요.');
      original = state.caseWorld.records.find(function (record) { return record.recordId === event.recordId; });
      category = categoryById(original.category);
      if (blocked(state, category.id)) {
        setReview(next, 'blocked', { category: category.id, recordId: original.recordId }); history(next, { category: category.id, recordId: original.recordId, status: 'blocked' });
        replay(next, 'blocked-search', { actorId: event.actorId, recordId: original.recordId, category: category.id }); log(next, 'blocked', '원본 열람이 잠시 봉쇄되었습니다. 다음 날 다시 열람할 수 있습니다.'); sealOutcome(next, category.id, true); return;
      }
      var fact = next.facts.find(function (entry) { return entry.source === 'record' && entry.recordId === original.recordId; });
      if (!fact) {
        fact = { id: 'fact-' + (next.facts.length + 1), round: state.round, category: category.id, allowedValues: original.allowedValues.slice(), source: 'record', recordId: original.recordId };
        if (fact.allowedValues.length === 1) fact.value = fact.allowedValues[0];
        next.facts.push(fact);
      }
      setReview(next, 'search', pick(fact, ['id', 'recordId', 'category', 'value', 'allowedValues', 'source']));
      history(next, { category: category.id, recordId: original.recordId, status: 'searched' });
      replay(next, 'search', { actorId: event.actorId, recordId: original.recordId, category: category.id, allowedValues: original.allowedValues.slice() });
      log(next, 'search', inCatalog(D.RECORDS, original.recordId).label + '의 부분 기록을 확인했습니다.'); sealOutcome(next, category.id, false); return;
    }
    if (event.kind === 'audit') { audit(state, next, event.statementId); sealOutcome(next, null, false); return; }
    if (event.kind === 'pass') { setReview(next, 'pass'); replay(next, 'investigate-pass', { actorId: event.actorId }); log(next, 'pass', '오늘의 공식 수사를 마쳤습니다.'); sealOutcome(next, null, false); return; }
    fail('공식 수사 행동을 선택하세요.');
  }
  function audit(state, next, statementId) {
    var statement = next.statements.find(function (entry) { return entry.id === statementId; });
    if (!statement || statement.audited) fail('미검증 진술 하나를 선택하세요.');
    if (state.kits < 1) fail('남은 감식 키트가 없습니다.');
    var verdict = caseValue(state.secretNPC, statement.category) === statement.value;
    statement.audited = true; statement.isTrue = verdict; next.kits -= 1;
    next.facts.push({ id: 'fact-' + (next.facts.length + 1), round: state.round, category: statement.category, source: 'audit', statementId: statement.id, isTrue: verdict });
    setReview(next, 'audit', { category: statement.category, targetId: statement.speakerId, statementId: statement.id, value: statement.value, verified: true, isTrue: verdict });
    replay(next, 'audit', { actorId: state.detectiveId, statementId: statement.id, category: statement.category, value: statement.value, isTrue: verdict });
    log(next, 'audit', '감식 결과 · 해당 진술은 ' + (verdict ? '참' : '거짓') + '입니다.');
  }
  function text(value, max, required) {
    if (value === undefined && !required) return '';
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail('유효한 내용을 입력하세요.');
    return value.trim();
  }
  function personal(state, next, event) {
    requirePhase(state, ['secret']); requireOwner(state, event.actorId);
    var actor = playerById(next, event.actorId), kind = event.kind, category;
    if (kind === 'memory') {
      if (actor.role !== 'suspect' || actor.identity.memoryLeft < 1) fail('남은 정체 기억 행동이 없습니다.');
      var eliminated = actor.identity.eliminationOrder.shift();
      actor.identity.candidates = actor.identity.candidates.filter(function (id) { return id !== eliminated; });
      actor.identity.memoryLeft -= 1; actor.identity.known = actor.identity.candidates.length === 1;
      actor.identity.memory.push({ round: state.round, candidates: actor.identity.candidates.slice() });
      replay(next, 'memory', { actorId: actor.id, candidates: actor.identity.candidates.slice(), known: actor.identity.known });
    } else if (kind === 'report') {
      if (actor.role !== 'suspect' || actor.sealedReport || state.round > 6) fail('제보는 DAY 1–6 본인 개인 행동 중 한 번만 가능합니다.');
      personById(event.suspectId);
      actor.sealedReport = { suspectId: event.suspectId, text: text(event.text, 300, true), round: state.round };
      replay(next, 'report', Object.assign({ actorId: actor.id }, actor.sealedReport));
    } else if (kind === 'seal') {
      if (!isCriminal(actor) || actor.sabotageLeft < 1) fail('남은 봉쇄 행동이 없습니다.'); category = categoryById(event.category);
      if (next.seals.length) fail('한 날의 봉쇄는 범인 진영 전체에서 하나만 선택할 수 있습니다.');
      actor.sabotageLeft -= 1; next.seals.push({ actorId: actor.id, category: category.id }); replay(next, 'seal', { actorId: actor.id, category: category.id });
    } else if (kind === 'guard') {
      if (actor.role !== 'suspect' || actor.guardLeft < 1) fail('남은 보호 행동이 없습니다.'); category = categoryById(event.category);
      actor.guardLeft -= 1; next.guard = { actorId: actor.id, category: category.id }; replay(next, 'guard', { actorId: actor.id, category: category.id });
    } else if (kind === 'suggest') {
      var memo = { round: state.round, text: text(event.text, 300, false) };
      if (event.suspectId !== undefined) { if (actor.role !== 'suspect') fail('정체 메모는 용의자만 사용할 수 있습니다.'); personById(event.suspectId); memo.suspectId = event.suspectId; actor.identityGuess = memo; }
      else {
        if (event.category !== undefined) { categoryById(event.category); memo.category = event.category; }
        actor.memo = memo;
        if (memo.category !== undefined) {
          next.suggestions = next.suggestions || [];
          next.suggestions.push({ round: state.round, speakerId: actor.id, category: memo.category, text: memo.text });
        }
      }
      replay(next, event.suspectId === undefined ? 'suggest' : 'identity-guess', Object.assign({ actorId: actor.id }, memo));
    } else if (kind === 'pass') replay(next, 'secret-pass', { actorId: actor.id });
    else fail('개인 행동을 선택하세요.');
    // The log deliberately cannot disclose action kind, identity progress or report existence.
    log(next, 'personal', '개인 행동을 마쳤습니다.'); advance(next, 'investigate');
  }
  function act(state, event) {
    if (!state || state.rulesVersion !== 4 || !event || typeof event !== 'object' || Array.isArray(event)) fail('유효한 7일 게임 행동이 필요합니다.');
    if (state.phase === 'finished') fail('이미 종료된 사건입니다.');
    var actor = playerById(state, event.actorId), next = copy(state), category, values;
    switch (event.type) {
      case 'ROLE_SEEN':
        requirePhase(state, ['reveal']); requireOwner(state, event.actorId); advance(next, 'secret'); replay(next, 'role-seen', { actorId: actor.id }); break;
      case 'SECRET_ACTION': personal(state, next, event); break;
      case 'QUESTION': investigation(state, next, Object.assign({}, event, { kind: 'question' })); break;
      case 'SEARCH': investigation(state, next, Object.assign({}, event, { kind: 'search' })); break;
      case 'AUDIT': investigation(state, next, Object.assign({}, event, { kind: 'audit' })); break;
      case 'INVESTIGATE': investigation(state, next, event); break;
      case 'ANSWER':
        requirePhase(state, ['answer']); requireOwner(state, event.actorId); category = categoryById(state.pending.category); values = answerValues(state, actor, category.id);
        if (!values.includes(event.value)) fail(isCriminal(actor) ? '남은 거짓말·유보 횟수 안에서 답변하세요.' : '관찰 자료로 아는 사실만 답변하고, 모르면 미진술을 선택하세요.');
        if (event.value === null) {
          if (isCriminal(actor)) next.refusalsUsed += 1;
          setReview(next, 'unknown', { category: category.id, targetId: actor.id, proposedValue: state.pending.proposedValue, value: null }); history(next, { category: category.id, targetId: actor.id, proposedValue: state.pending.proposedValue, status: 'unknown' });
          replay(next, 'unknown', { actorId: actor.id, category: category.id }); log(next, 'unknown', actor.name + ' · 해당 항목은 미진술입니다.');
        } else {
          if (event.value !== caseValue(state.secretNPC, category.id)) next.liesUsed += 1;
          var statement = { id: 'statement-' + (state.statements.length + 1), round: state.round, speakerId: actor.id, category: category.id, value: event.value, audited: false };
          next.statements.push(statement); setReview(next, 'answer', { category: category.id, targetId: actor.id, statementId: statement.id, value: event.value, proposedValue: state.pending.proposedValue, verified: false });
          history(next, { category: category.id, targetId: actor.id, proposedValue: state.pending.proposedValue, status: 'answered' }); replay(next, 'answer', { actorId: actor.id, category: category.id, value: event.value, statementId: statement.id }); log(next, 'statement', actor.name + ' · ' + D.claimText(category.id, event.value));
        }
        next.pending = null; sealOutcome(next, category.id, false); break;
      case 'REVIEW_AUDIT':
        requirePhase(state, ['discussion']); requireDetective(state, event.actorId);
        if (!state.review || state.review.kind !== 'answer' || state.review.verified || state.review.round !== state.round) fail('방금 공개된 미검증 답변만 확인할 수 있습니다.');
        if (event.statementId !== undefined && event.statementId !== state.review.statementId) fail('방금 공개된 답변만 확인할 수 있습니다.');
        audit(state, next, state.review.statementId); break;
      case 'ROUND_CONFIRM':
        requirePhase(state, ['discussion']); requireDetective(state, event.actorId); replay(next, 'round-confirm', { actorId: actor.id });
        next.pending = null; next.review = null;
        if (state.round === MAX_ROUNDS) { next.phase = 'final'; log(next, 'final', 'DAY 7 수사 검토가 끝났습니다. 진범 인물을 최종 고발하세요.'); }
        else { next.round += 1; next.turnIndex = 0; next.phase = 'secret'; next.seals = []; next.guard = null; log(next, 'round', 'DAY ' + next.round + ' · 새 수사가 시작되었습니다.'); }
        break;
      case 'ACCUSE':
        requirePhase(state, ['final']); requireDetective(state, event.actorId); if (state.round !== MAX_ROUNDS) fail('DAY 7 최종 검토 이후 고발하세요.');
        personById(event.suspectId);
        next.accusation = { suspectId: event.suspectId }; next.winner = event.suspectId === state.secretNPC.suspectId ? 'investigators' : 'criminals'; next.phase = 'finished';
        replay(next, 'accusation', { actorId: actor.id, suspectId: event.suspectId, success: next.winner === 'investigators' }); log(next, 'accusation', '최종 고발 · ' + personById(event.suspectId).name); break;
      case 'ADD_NOTE':
        requirePhase(state, ['reveal', 'secret', 'investigate', 'answer', 'discussion', 'final']);
        var note = { speakerId: actor.id, text: text(event.text, 300, true), round: state.round }; next.notes.push(note); replay(next, 'note', Object.assign({ actorId: actor.id }, note)); break;
      default: fail('알 수 없는 행동입니다.');
    }
    return freeze(next);
  }
  function suspectResult(state) {
    var suspect = state.players.find(function (p) { return p.role === 'suspect'; });
    if (!suspect) return null;
    var report = suspect.sealedReport, wrongfullyAccused = !!state.accusation && state.accusation.suspectId === suspect.characterId;
    var correctReport = !!report && report.suspectId === state.secretNPC.suspectId;
    var status = wrongfullyAccused ? 'loss' : correctReport ? 'win' : 'survived';
    return { playerId: suspect.id, characterId: suspect.characterId, status: status, reason: wrongfullyAccused ? 'false-accusation' : correctReport ? 'correct-report' : report ? 'incorrect-report' : 'no-report', earlyTracking: status === 'win' && report.round <= 4, report: report ? copy(report) : null };
  }
  function finalReplay(state) {
    return { version: 2, source: 'recorded', complete: state.replayVersion === 2 && state.replayComplete === true, events: state.replayEvents.map(function (event) { return pick(event, ['id', 'round', 'type', 'actorId', 'speakerId', 'targetId', 'category', 'value', 'proposedValue', 'statementId', 'recordId', 'allowedValues', 'isTrue', 'suspectId', 'placeId', 'text', 'candidates', 'known', 'success', 'reason', 'kind']); }) };
  }
  function publicView(state) {
    if (!state || state.rulesVersion !== 4) fail('유효한 7일 게임 상태가 필요합니다.');
    var view = pick(state, ['rulesVersion', 'maxRounds', 'phase', 'round', 'turnIndex', 'kits', 'detectiveId', 'winner', 'accusation']);
    view.players = state.players.map(function (p) { return { id: p.id, name: p.name, isDetective: p.id === state.detectiveId }; });
    view.turnOwnerId = turnOwner(state);
    view.fieldReference = copy(state.fieldReference);
    view.facts = state.facts.map(function (entry) { return pick(entry, ['id', 'round', 'category', 'value', 'allowedValues', 'source', 'recordId', 'statementId', 'isTrue']); });
    view.statements = state.statements.map(function (entry) { var result = pick(entry, ['id', 'round', 'speakerId', 'category', 'value', 'audited']); if (entry.audited) result.isTrue = entry.isTrue; return result; });
    view.pending = state.pending ? pick(state.pending, ['targetId', 'category', 'proposedValue']) : null;
    view.review = state.review ? pick(state.review, ['kind', 'round', 'id', 'recordId', 'category', 'allowedValues', 'source', 'targetId', 'statementId', 'value', 'proposedValue', 'verified', 'isTrue']) : null;
    view.questionHistory = state.questionHistory.map(function (entry) { return pick(entry, ['round', 'category', 'targetId', 'recordId', 'proposedValue', 'status']); });
    view.suggestions = (state.suggestions || []).map(function (entry) { return pick(entry, ['round', 'speakerId', 'category', 'text']); });
    view.notes = state.notes.map(function (entry) { return pick(entry, ['round', 'speakerId', 'text']); });
    view.log = state.log.map(function (entry) { return pick(entry, ['round', 'type', 'text']); });
    if (state.phase === 'finished') {
      view.reveal = {
        secretNPC: copy(state.secretNPC), secret: copy(state.secretNPC),
        players: state.players.map(function (p) { return pick(p, ['id', 'name', 'role', 'characterId', 'clues', 'sealedReport', 'identityGuess']); }),
        statements: state.statements.map(function (entry) { return Object.assign(pick(entry, ['id', 'round', 'speakerId', 'category', 'value', 'audited']), { isTrue: entry.value === caseValue(state.secretNPC, entry.category) }); }),
        suspectResult: suspectResult(state), caseWorld: copy(state.caseWorld), replay: finalReplay(state)
      };
    }
    return freeze(view);
  }
  function privateView(state, actorId) {
    var actor = playerById(state, actorId), view = copy(publicView(state));
    view.self = pick(actor, ['id', 'name', 'role', 'clues', 'shared', 'sabotageLeft', 'guardLeft', 'sealOutcome', 'sealOutcomes', 'memo']);
    view.self.identity = pick(actor.identity, ['known', 'candidates', 'memory', 'memoryLeft']);
    if (actor.identity.known) view.self.identity.characterId = actor.characterId;
    if (actor.role === 'suspect') { view.self.sealedReport = actor.sealedReport ? copy(actor.sealedReport) : null; view.self.identityGuess = actor.identityGuess ? copy(actor.identityGuess) : null; }
    if (isCriminal(actor)) {
      view.caseSecret = copy(state.secretNPC); view.partnerIds = state.players.filter(function (p) { return p.id !== actor.id && isCriminal(p); }).map(function (p) { return p.id; });
      view.remainingLies = LIE_LIMIT - state.liesUsed; view.remainingRefusals = 1 - state.refusalsUsed; view.seals = copy(state.seals);
    }
    if (state.phase === 'answer' && state.pending.targetId === actor.id) view.self.answerOptions = { category: state.pending.category, legalValues: answerValues(state, actor, state.pending.category) };
    return freeze(view);
  }
  return freeze(Object.assign({}, D, { makeGame: makeGame, act: act, turnOwner: turnOwner, publicView: publicView, privateView: privateView, caseValue: caseValue }));
}));

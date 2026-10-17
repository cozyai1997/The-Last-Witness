(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WitnessSevenData = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(function (key) { freeze(value[key]); }); Object.freeze(value);
    }
    return value;
  }
  var CATEGORIES = freeze([
    { id: 'gender', label: '목격된 성별', values: ['남성', '여성'], group: 'person' },
    { id: 'hand', label: '주로 쓰는 손', values: ['왼손', '오른손'], group: 'person' },
    { id: 'work', label: '당일 근무 구분', values: ['기록 업무', '현장 업무'], group: 'person' },
    { id: 'access', label: '출입 권한', values: ['일반 출입', '직원 출입'], group: 'person' },
    { id: 'zone', label: '현장 구역', values: ['본관', '별관', '옥외'], group: 'place' },
    { id: 'entry', label: '현장 진입로', values: ['공용 통로', '직원 통로'], group: 'place' },
    { id: 'camera', label: '현장 카메라', values: ['카메라 있음', '사각지대'], group: 'place' },
    { id: 'tool', label: '사건 도구', values: ['서류칼', '청동상', '전시용 고정끈', '약품', '금속 손전등', '보존용 나무망치', '황동 촛대', '석고 모형', '유리 문진', '수장고 열쇠 묶음', '전시용 쇠사슬', '대리석 받침'], group: 'tool' },
    { id: 'time', label: '사건 시간대', values: ['18:00–18:15', '18:15–18:30', '18:30–18:45', '18:45–19:00', '19:00–19:15', '19:15–19:30', '19:30–19:45', '19:45–20:00', '20:00–20:15', '20:15–20:30', '20:30–20:45', '20:45–21:00'], group: 'time' }
  ]);
  // A public reference describes all twelve people; it never marks player ownership.
  var codes = [2, 1, 4, 3, 6, 7, 8, 9, 12, 11, 14, 13];
  var names = ['서도윤', '윤서하', '강시온', '한유진', '이태오', '정하린', '백지후', '차수아', '오지안', '문재희', '임하준', '배서윤'];
  var jobs = ['기록 연구원', '전시 기획자', '야간 경비원', '시설 기술자', '사진 기자', '복원 전문가', '정원 관리사', '자료 수집가', '물류 담당자', '보존 처리사', '기록 운영 담당자', '전시 안내원'];
  var SUSPECTS = freeze(names.map(function (name, i) {
    return { id: 's' + i, name: name, job: jobs[i], gender: codes[i] & 1, hand: (codes[i] >> 1) & 1, work: (codes[i] >> 2) & 1, access: (codes[i] >> 3) & 1 };
  }));
  var PLACES = freeze([
    { id: 'p0', name: '중앙전시실', zone: 0, entry: 0, camera: 0 },
    { id: 'p1', name: '기록보관실', zone: 0, entry: 1, camera: 0 },
    { id: 'p2', name: '연결회랑', zone: 1, entry: 0, camera: 1 },
    { id: 'p3', name: '복원작업실', zone: 1, entry: 1, camera: 1 },
    { id: 'p4', name: '중앙정원', zone: 2, entry: 0, camera: 0 },
    { id: 'p5', name: '직원하역장', zone: 2, entry: 1, camera: 1 },
    { id: 'p6', name: '기획전시실', zone: 0, entry: 0, camera: 1 },
    { id: 'p7', name: '관장실', zone: 0, entry: 1, camera: 1 },
    { id: 'p8', name: '교육체험실', zone: 1, entry: 0, camera: 0 },
    { id: 'p9', name: '수장고', zone: 1, entry: 1, camera: 0 },
    { id: 'p10', name: '조각산책로', zone: 2, entry: 0, camera: 1 },
    { id: 'p11', name: '설비관리동', zone: 2, entry: 1, camera: 0 }
  ]);
  var TOOLS = freeze(CATEGORIES[7].values.map(function (name, i) { return { id: 't' + i, name: name }; }));
  var TIMES = freeze(CATEGORIES[8].values.map(function (name, i) { return { id: 'time' + i, name: name }; }));
  var RECORDS = freeze([
    { id: 'portrait', label: '목격 스케치 원본', group: 'person', description: '목격자가 확실히 관찰한 특징 하나. 기록마다 관찰 항목이 다릅니다.' },
    { id: 'access', label: '출입 대조 원본', group: 'person', description: '출입 당시 남은 부분 인상 하나. 인물 배정 정보는 없습니다.' },
    { id: 'scene', label: '현장 점검 원본', group: 'place', description: '현장 구조의 부분 특징. 장소 이름을 직접 확정하지 않습니다.' },
    { id: 'tool', label: '도구 감정 원본', group: 'tool', description: '흔적과 양립하는 도구 여섯 종류. 취급 범위·진술과 교차 확인합니다.' },
    { id: 'time', label: '시간 감정 원본', group: 'time', description: '양립 가능한 15분 시간대 여섯 구간. 근무 범위·진술과 교차 확인합니다.' }
  ]);
  var ROLES = freeze({
    detective: { label: '탐정', team: 'investigators' }, culprit: { label: '범인', team: 'criminals' },
    witness: { label: '목격자', team: 'investigators' }, suspect: { label: '용의자', team: 'neutral' }, accomplice: { label: '공범', team: 'criminals' }
  });
  var ROLE_PACKS = freeze({
    2: ['detective', 'culprit'], 3: ['detective', 'culprit', 'witness'],
    4: ['detective', 'culprit', 'witness', 'suspect'], 5: ['detective', 'culprit', 'witness', 'witness', 'suspect'],
    6: ['detective', 'culprit', 'witness', 'witness', 'suspect', 'accomplice']
  });
  function categoryById(id) { return CATEGORIES.find(function (entry) { return entry.id === id; }); }
  function caseValue(secret, category) {
    var item = categoryById(category);
    if (!item || !secret) throw new Error('유효한 사건 항목이 필요합니다.');
    var person = SUSPECTS.find(function (p) { return p.id === secret.suspectId; });
    var place = PLACES.find(function (p) { return p.id === secret.placeId; });
    if (item.group === 'person') { if (!person) throw new Error('유효한 사건 인물이 필요합니다.'); return person[category]; }
    if (item.group === 'place') { if (!place) throw new Error('유효한 사건 장소가 필요합니다.'); return place[category]; }
    var entries = item.group === 'tool' ? TOOLS : TIMES;
    var id = item.group === 'tool' ? secret.toolId : secret.timeId;
    var index = entries.findIndex(function (entry) { return entry.id === id; });
    if (index < 0) throw new Error('유효한 사건 좌표가 필요합니다.');
    return index;
  }
  function claimText(category, value) {
    var item = categoryById(category);
    return item && Number.isInteger(value) && item.values[value] !== undefined ? item.label + ' · ' + item.values[value] : '미진술';
  }
  function fitsReference(secret, reference) {
    var profile = SUSPECTS.find(function (entry) { return entry.id === secret.suspectId; });
    var scene = PLACES.find(function (entry) { return entry.id === secret.placeId; });
    if (!profile || !scene || profile.access === 0 && scene.entry === 1) return false;
    if (!reference) return true;
    if (!Array.isArray(reference.people) || !Array.isArray(reference.places)) return false;
    var person = reference.people.find(function (entry) { return entry.suspectId === secret.suspectId; });
    var place = reference.places.find(function (entry) { return entry.placeId === secret.placeId; });
    return !!person && !!place && (!person.routes || Array.isArray(person.routes) && person.routes.some(function (route) { return route.placeId === secret.placeId && route.toolId === secret.toolId && route.timeId === secret.timeId; })) && Array.isArray(person.placeIds) && person.placeIds.includes(secret.placeId) &&
      Array.isArray(person.toolIds) && person.toolIds.includes(secret.toolId) && Array.isArray(person.timeIds) && person.timeIds.includes(secret.timeId) &&
      Array.isArray(place.toolIds) && place.toolIds.includes(secret.toolId) && Array.isArray(place.timeIds) && place.timeIds.includes(secret.timeId);
  }
  // Constraints use certified originals/verdicts and the two-lie ceiling. No hidden state is read.
  function candidates(view) {
    if (!view || !Array.isArray(view.facts) || !Array.isArray(view.statements)) throw new Error('공개 수사 기록이 필요합니다.');
    var result = [], allowed = {}, contradictions = {}, reference = view.fieldReference;
    CATEGORIES.forEach(function (category) { allowed[category.id] = category.values.map(function (_, i) { return i; }); contradictions[category.id] = category.values.map(function () { return 0; }); });
    var valid = true;
    view.statements.forEach(function (statement) {
      var category = categoryById(statement.category);
      if (!category || !Number.isInteger(statement.value) || category.values[statement.value] === undefined) { valid = false; return; }
      contradictions[category.id] = contradictions[category.id].map(function (count, value) { return count + (value === statement.value ? 0 : 1); });
    });
    function constrain(fact) {
      var category = categoryById(fact.category);
      if (!category) { valid = false; return; }
      if (fact.source === 'audit') {
        var statement = view.statements.find(function (entry) { return entry.id === fact.statementId && entry.category === fact.category; });
        if (!statement || typeof fact.isTrue !== 'boolean') { valid = false; return; }
        allowed[category.id] = allowed[category.id].filter(function (value) { return (value === statement.value) === fact.isTrue; });
      } else allowed[category.id] = allowed[category.id].filter(function (value) { return Array.isArray(fact.allowedValues) ? fact.allowedValues.includes(value) : value === fact.value; });
    }
    view.facts.forEach(constrain);
    if (view.self && Array.isArray(view.self.clues)) view.self.clues.forEach(constrain);
    if (!valid || reference && (!Array.isArray(reference.people) || !Array.isArray(reference.places))) return freeze([]);
    var peopleIndex = Object.create(null), placeIndex = Object.create(null);
    if (reference) { reference.people.forEach(function (entry) { peopleIndex[entry.suspectId] = entry; }); reference.places.forEach(function (entry) { placeIndex[entry.placeId] = entry; }); }
    var personFields = CATEGORIES.filter(function (c) { return c.group === 'person'; }), placeFields = CATEGORIES.filter(function (c) { return c.group === 'place'; });
    var possiblePlaces = PLACES.filter(function (place) { return placeFields.every(function (c) { return allowed[c.id].includes(place[c.id]); }); });
    SUSPECTS.forEach(function (suspect) {
      if (!personFields.every(function (c) { return allowed[c.id].includes(suspect[c.id]); })) return;
      if (view.self && view.self.identity && view.self.identity.known && view.self.role !== 'culprit' && view.self.role !== 'accomplice' && view.self.identity.characterId === suspect.id) return;
      var pr = reference ? peopleIndex[suspect.id] : null;
      if (reference && (!pr || !Array.isArray(pr.placeIds) || !Array.isArray(pr.toolIds) || !Array.isArray(pr.timeIds))) return;
      var personFalse = personFields.reduce(function (sum, c) { return sum + contradictions[c.id][suspect[c.id]]; }, 0);
      if (personFalse > 2) return;
      possiblePlaces.forEach(function (place) {
        if (suspect.access === 0 && place.entry === 1 || pr && !pr.placeIds.includes(place.id)) return;
        var loc = reference ? placeIndex[place.id] : null;
        if (reference && (!loc || !Array.isArray(loc.toolIds) || !Array.isArray(loc.timeIds))) return;
        var falseCount = personFalse + placeFields.reduce(function (sum, c) { return sum + contradictions[c.id][place[c.id]]; }, 0);
        if (falseCount > 2) return;
        var tools = allowed.tool.filter(function (i) { return (!pr || pr.toolIds.includes(TOOLS[i].id)) && (!loc || loc.toolIds.includes(TOOLS[i].id)); });
        var times = allowed.time.filter(function (i) { return (!pr || pr.timeIds.includes(TIMES[i].id)) && (!loc || loc.timeIds.includes(TIMES[i].id)); });
        tools.forEach(function (ti) { times.forEach(function (mi) {
          if (pr && pr.routes && (!Array.isArray(pr.routes) || !pr.routes.some(function (route) { return route.placeId === place.id && route.toolId === TOOLS[ti].id && route.timeId === TIMES[mi].id; }))) return;
          if (falseCount + contradictions.tool[ti] + contradictions.time[mi] <= 2) result.push({ suspectId: suspect.id, placeId: place.id, toolId: TOOLS[ti].id, timeId: TIMES[mi].id });
        }); });
      });
    });
    return freeze(result);
  }
  return freeze({ MAX_ROUNDS: 7, LIE_LIMIT: 2, CATEGORIES: CATEGORIES, SUSPECTS: SUSPECTS, PLACES: PLACES, TOOLS: TOOLS, TIMES: TIMES, RECORDS: RECORDS, ROLES: ROLES, ROLE_PACKS: ROLE_PACKS, candidates: candidates, claimText: claimText, caseValue: caseValue, fitsReference: fitsReference });
}));

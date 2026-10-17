(function (root, factory) {
  'use strict';
  var data = typeof module === 'object' && module.exports ? require('./seven-data.js') : root.WitnessSevenData;
  var api = factory(data);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WitnessSevenActions = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';
  if (!D) throw new Error('사건 공개 자료가 필요합니다.');
  function publicOnly(view) {
    return { facts: view.facts || [], statements: view.statements || [], fieldReference: view.fieldReference };
  }
  function ranges(view, includePrivate) {
    var result = Object.create(null);
    D.CATEGORIES.forEach(function (c) { result[c.id] = c.values.map(function (_, i) { return i; }); });
    function apply(fact) {
      if (!fact || !Object.hasOwn(result, fact.category)) return;
      if (fact.source === 'audit') {
        var statement = (view.statements || []).find(function (s) { return s.id === fact.statementId && s.category === fact.category; });
        if (statement && typeof fact.isTrue === 'boolean') result[fact.category] = result[fact.category].filter(function (v) { return (v === statement.value) === fact.isTrue; });
      } else if (Array.isArray(fact.allowedValues)) result[fact.category] = result[fact.category].filter(function (v) { return fact.allowedValues.includes(v); });
      else if (Number.isInteger(fact.value)) result[fact.category] = result[fact.category].filter(function (v) { return v === fact.value; });
    }
    (view.facts || []).forEach(apply);
    (view.statements || []).forEach(function (s) {
      if (s.audited && typeof s.isTrue === 'boolean' && Object.hasOwn(result, s.category)) result[s.category] = result[s.category].filter(function (v) { return (v === s.value) === s.isTrue; });
    });
    if (includePrivate) ((view.self || {}).clues || []).forEach(apply);
    // Use only the projected reference and permitted knowledge. Private crime
    // coordinates, seals, other players' clues and local pencil marks are ignored.
    var projection = publicOnly(view);
    if (includePrivate && view.self) projection.self = { role: view.self.role, identity: view.self.identity, clues: view.self.clues || [] };
    var candidates = [];
    try { candidates = D.candidates(projection); } catch (_) { /* Invalid records never infer a hidden answer. */ }
    if (candidates.length) D.CATEGORIES.forEach(function (c) {
      var possible = new Set(candidates.map(function (event) { return D.caseValue(event, c.id); }));
      result[c.id] = result[c.id].filter(function (v) { return possible.has(v); });
    });
    return { values: result, candidates: candidates };
  }
  function history(view, targetId, category) {
    return (view.questionHistory || []).filter(function (entry) { return (!targetId || entry.targetId === targetId) && (!category || entry.category === category); }).map(function (entry) { return Object.assign({}, entry); });
  }
  function options(view) {
    view = view || {};
    var personal = ranges(view, true), shared = ranges(publicOnly(view), false), remaining = {};
    [['person', D.SUSPECTS, 'suspectId'], ['place', D.PLACES, 'placeId'], ['tool', D.TOOLS, 'toolId'], ['time', D.TIMES, 'timeId']].forEach(function (entry) {
      var ids = new Set(personal.candidates.map(function (candidate) { return candidate[entry[2]]; }));
      remaining[entry[0]] = entry[1].filter(function (item) { return ids.has(item.id); }).map(function (item) { return item.id; });
    });
    var categories = D.CATEGORIES.map(function (c) {
      var values = personal.values[c.id];
      return { id: c.id, label: c.label, values: c.values.slice(), proposedValues: values.slice(), available: values.length > 1, reason: values.length === 1 ? '확인 완료 · ' + c.values[values[0]] : values.length ? '미확인 · 남은 가정 ' + values.length + '개' : '기록과 양립하는 가정 없음' };
    });
    return {
      questions: categories.filter(function (c) { return c.available; }),
      categories: categories,
      records: D.RECORDS.map(function (record) {
        var fact = (view.facts || []).find(function (f) { return f.source === 'record' && f.recordId === record.id; });
        var previous = (view.questionHistory || []).filter(function (h) { return h.recordId === record.id; }).slice(-1)[0];
        return Object.assign({}, record, { acquired: !!fact, available: !fact, reason: fact ? '확보 완료 · 같은 원본은 다시 조사할 수 없습니다.' : previous && previous.status === 'blocked' ? '이전 봉쇄 · 다시 조사할 수 있습니다.' : '원본 미확보', category: fact ? fact.category : undefined });
      }),
      abilities: D.CATEGORIES.map(function (c) {
        var values = shared.values[c.id], available = values.length > 1;
        return { id: c.id, label: c.label, values: c.values.slice(), available: available, reason: available ? '공개 기록상 미해결 · 남은 가정 ' + values.length + '개' : '공개 기록으로 확인 완료' };
      }),
      remaining: remaining
    };
  }
  function questionAllowed(view, category, proposedValue) {
    var c = D.CATEGORIES.find(function (item) { return item.id === category; });
    if (!c || !Number.isInteger(proposedValue)) return false;
    var values = ranges(view || {}, true).values[c.id];
    return values.length > 1 && values.includes(proposedValue);
  }
  function abilityAllowed(view, category) {
    var c = D.CATEGORIES.find(function (item) { return item.id === category; });
    return !!c && ranges(publicOnly(view || {}), false).values[c.id].length > 1;
  }
  function exclusionReasons(view, kind, id) {
    var coordinate = { person: 'suspectId', place: 'placeId', tool: 'toolId', time: 'timeId' }[kind];
    if (!coordinate || !view) return [];
    var units = [];
    (view.facts || []).filter(function (f) { return f.source !== 'audit'; }).forEach(function (fact) {
      var record = D.RECORDS.find(function (r) { return r.id === fact.recordId; }), c = D.CATEGORIES.find(function (c) { return c.id === fact.category; });
      if (!c) return;
      var values = fact.allowedValues || [fact.value];
      units.push({ facts: [fact], statements: [], clues: [], reason: { source: 'official', label: record ? record.label : '확인된 기록', text: c.label + ' · ' + values.map(function (v) { return c.values[v]; }).join(' 또는 ') } });
    });
    (view.statements || []).forEach(function (statement) {
      var audits = (view.facts || []).filter(function (f) { return f.source === 'audit' && f.statementId === statement.id; });
      var verdict = audits.find(function (f) { return typeof f.isTrue === 'boolean'; });
      units.push({ facts: audits, statements: [statement], clues: [], reason: { source: verdict ? 'official' : 'inference', label: verdict ? '검증된 진술' : '공식 진술의 공동 거짓말 한도', text: D.claimText(statement.category, statement.value) + (verdict ? ' · ' + (verdict.isTrue ? '참으로 확인' : '거짓으로 확인') : ' · 미검증: 전체 거짓말 최대 2회와 함께 대조') } });
    });
    ((view.self || {}).clues || []).forEach(function (clue) { units.push({ facts: [], statements: [], clues: [clue], reason: { source: 'private', label: '나의 확실한 관찰', text: D.claimText(clue.category, clue.value) } }); });
    if (view.self && view.self.identity && view.self.identity.known && !['culprit', 'accomplice'].includes(view.self.role)) units.push({ facts: [], statements: [], clues: [], identity: view.self.identity, reason: { source: 'private', label: '본인 정체 확인', text: '내가 맡은 인물은 진범이 아닙니다. 타인에게 결백을 인증하지는 않습니다.' } });
    function permits(active) {
      var projection = { facts: [], statements: [], fieldReference: view.fieldReference, self: { role: view.self && view.self.role, clues: [] } };
      active.forEach(function (u) { projection.facts.push.apply(projection.facts, u.facts); projection.statements.push.apply(projection.statements, u.statements); projection.self.clues.push.apply(projection.self.clues, u.clues); if (u.identity) projection.self.identity = u.identity; });
      try { return D.candidates(projection).some(function (event) { return event[coordinate] === id; }); } catch (_) { return true; }
    }
    if (permits(units)) return [];
    // Reduce to a sufficient set of visible constraints. Removing an audit also
    // removes its statement, so the proof never relies on an invalid projection.
    var kept = units.slice();
    units.forEach(function (unit) { var trial = kept.filter(function (u) { return u !== unit; }); if (!permits(trial)) kept = trial; });
    var reasons = kept.map(function (unit) { return unit.reason; });
    reasons.push({ source: 'reference', label: '사건 연결 기록 대조', text: '위 자료와 출입·취급·근무의 가능 조합을 함께 대조하면 이 카드와 양립하는 조합이 없습니다.' });
    return reasons;
  }
  return Object.freeze({ options: options, history: history, questionAllowed: questionAllowed, abilityAllowed: abilityAllowed, exclusionReasons: exclusionReasons });
}));

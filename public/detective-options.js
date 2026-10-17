(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/party-engine.cjs'));
  else root.WitnessDetectiveOptions = factory(root.WitnessParty);
}(typeof window !== 'undefined' ? window : globalThis, function (G) {
  'use strict';
  const list = value => Array.isArray(value) ? value : [];
  const valid = fact => fact && G.CATEGORIES.some(c => c.id === fact.category) && (fact.value === 0 || fact.value === 1);
  function knownFacts(g) {
    return list(g?.facts).concat(g?.self?.role === 'detective' ? list(g.self.clues) : []).filter(valid);
  }
  function availableCategories(g) {
    const seen = new Set(knownFacts(g).map(f => f.category));
    list(g?.statements).forEach(s => seen.add(s.category));
    list(g?.questionHistory).forEach(q => {
      if (['answered', 'unknown', 'blocked'].includes(q.status)) seen.add(q.category);
    });
    // Rooms created before structured history still retain their current result.
    if (['answer', 'unknown', 'blocked', 'search'].includes(g?.review?.kind)) seen.add(g.review.category);
    // Legacy rooms used these fixed server-generated records instead of history.
    // Never infer completed investigations from free speech or pending questions.
    list(g?.log).forEach(entry => {
      if (typeof entry?.text !== 'string' || !['blocked', 'unknown'].includes(entry.type)) return;
      G.CATEGORIES.forEach(c => {
        if (entry.type === 'blocked' && entry.text === '수사 봉쇄 · ' + c.label + ' · 이번 라운드의 수사가 종료되었습니다.') seen.add(c.id);
        if (entry.type === 'unknown' && entry.text.endsWith(' · ' + c.label + ': 모름')) seen.add(c.id);
      });
    });
    return G.CATEGORIES.filter(c => !seen.has(c.id));
  }
  function questionSelection(g, selection = {}) {
    const available = availableCategories(g);
    const chosen = available.find(c => c.id === selection.category) || available[0];
    if (!chosen) return { category: null, proposedValue: null, values: [], available };
    // A different question starts from its first assumption, never a stale draft.
    const supplied = Number(selection.proposedValue);
    const proposedValue = chosen.id === selection.category && (supplied === 0 || supplied === 1) ? supplied : 0;
    return { category: chosen.id, proposedValue, values: chosen.values.map((label, value) => ({ value, label })), available };
  }
  function accusationCandidates(g) {
    // Only immutable evidence and this detective's true memories are hard facts.
    // Unverified statements retain the existing two-lie possibility calculation.
    const pairs = G.candidates({ facts: knownFacts(g), statements: list(g?.statements).filter(valid) });
    const suspects = new Set(pairs.map(p => p.suspectId)), places = new Set(pairs.map(p => p.placeId));
    return { suspects: G.SUSPECTS.filter(s => suspects.has(s.id)), places: G.PLACES.filter(p => places.has(p.id)) };
  }
  function reviewVerdict(g) {
    const r = g?.review;
    if (r?.verified !== true || !['answer', 'audit'].includes(r.kind) || (r.actualValue !== 0 && r.actualValue !== 1)) return null;
    const original = r.kind === 'audit' ? list(g.statements).find(s => s.id === r.statementId)?.value : r.value;
    if (original !== 0 && original !== 1) return null;
    return original === r.actualValue ? 'truth' : 'lie';
  }
  return Object.freeze({ availableCategories, questionSelection, accusationCandidates, reviewVerdict });
}));

(function (root) {
  'use strict';
  if (root.WitnessPractice) return;
  let enginePromise = null, match = null, timer = null, generation = 0, revision = 0;
  const HUMAN = 'practice-human';
  const clone = value => JSON.parse(JSON.stringify(value));

  function failure(message, code = 'PRACTICE_INVALID', status = 400) {
    const error = new Error(message); error.code = code; error.status = status; return error;
  }
  function loadEngine() {
    if (root.WitnessPracticeEngine) return Promise.resolve(root.WitnessPracticeEngine);
    if (!enginePromise) enginePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/practice-engine.js'; script.async = true;
      script.onload = () => root.WitnessPracticeEngine ? resolve(root.WitnessPracticeEngine) : reject(failure('연습용 게임을 준비하지 못했습니다.'));
      script.onerror = () => { enginePromise = null; script.remove(); reject(failure('연습용 게임을 불러오지 못했습니다. 연결을 확인해 주세요.')); };
      document.head.appendChild(script);
    });
    return enginePromise;
  }
  function freshSeed() {
    if (root.crypto?.getRandomValues) { const values = new Uint32Array(1); root.crypto.getRandomValues(values); return values[0]; }
    return Math.floor(Math.random() * 4294967296);
  }
  function caseId() { return 'practice-' + (root.crypto?.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)); }
  function seeded(seed) {
    let value = seed >>> 0;
    return () => { value = (value + 0x6D2B79F5) >>> 0; let mixed = value; mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1); mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61); return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296; };
  }

  // This boundary is the only raw-state projection. Human responses and bot
  // policies get their own card and the same public record, never another card.
  function ownView(E, state, playerId) {
    const view = clone(E.publicView(state)), self = state.players.find(p => p.id === playerId);
    view.self = { id: self.id, name: self.name, role: self.role, clues: clone(self.clues), shared: clone(self.shared), sabotageLeft: self.sabotageLeft, guardLeft: self.guardLeft };
    if (self.role === 'culprit' && self.sealOutcome) view.self.sealOutcome = clone(self.sealOutcome);
    if (self.role === 'culprit' && self.sealOutcomes?.length) view.self.sealOutcomes = clone(self.sealOutcomes);
    if (E.ROLES[self.role].team === 'criminals') {
      view.caseSecret = clone(state.secretNPC); view.remainingLies = 2 - state.liesUsed;
      view.partnerIds = state.players.filter(p => p.id !== self.id && E.ROLES[p.role].team === 'criminals').map(p => p.id);
      view.sabotage = clone(state.sabotage);
    }
    return view;
  }
  function response() {
    if (!match) return { room: null, account: null };
    const current = match;
    return { account: null, room: {
      code: 'PRACTICE', caseId: current.caseId, capacity: current.options.count, hostId: HUMAN,
      meId: HUMAN, revision, status: current.state.phase === 'finished' ? 'finished' : 'playing',
      practice: true, mode: 'practice', local: true,
      members: current.state.players.map((p, i) => ({ id: p.id === current.humanId ? HUMAN : 'practice-bot-' + i, name: p.name, ready: true, online: true, gameId: p.id, isBot: p.id !== current.humanId })),
      game: ownView(current.E, current.state, current.humanId)
    } };
  }
  function notify() {
    const data = response();
    if (match?.onChange) { try { match.onChange(data); } catch (_) { /* A view callback cannot break a local match. */ } }
    return data;
  }
  function clearTimer() { if (timer !== null) { clearTimeout(timer); timer = null; } }
  function shouldComputerMove(current) { return current.state.phase !== 'finished' && current.E.turnOwner(current.state) !== current.humanId; }
  function schedule() {
    clearTimer();
    if (!match || !shouldComputerMove(match)) return;
    const stamp = generation, delay = 700 + Math.floor(match.random() * 701);
    timer = setTimeout(() => {
      timer = null; if (!match || generation !== stamp) return;
      const current = match, owner = current.E.turnOwner(current.state);
      // Deliberately pass a safe own-card projection, not current.state.
      const view = ownView(current.E, current.state, owner);
      const event = chooseComputerEvent(current.E, view, current.random, current.memory[owner]);
      applyEvent(current, event, owner); notify(); schedule();
    }, delay);
  }
  function applyEvent(current, event, owner) {
    if (event.type !== 'ADD_NOTE' && current.E.turnOwner(current.state) !== owner) throw failure('현재 차례인 참가자만 행동할 수 있습니다.', 'NOT_YOUR_TURN', 403);
    if (event.type === 'ACCUSE' && current.state.round === 5 && current.state.phase === 'investigate') throw failure('마지막 수사를 마친 뒤 고발해 주세요.');
    const clean = {};
    for (const key of ['type', 'kind', 'category', 'value', 'targetId', 'statementId', 'suspectId', 'placeId', 'text', 'proposedValue']) if (Object.prototype.hasOwnProperty.call(event, key)) clean[key] = event[key];
    clean.actorId = owner; clean.speakerId = owner;
    current.state = current.E.act(current.state, clean); revision += 1;
  }

  // Policy helpers below accept only a public/own-card view. In particular the
  // detective planner cannot access the match or the concealed actual case.
  function valueOf(E, world, category) {
    const i = E.CATEGORIES.findIndex(c => c.id === category);
    return i < 3 ? E.SUSPECTS.find(p => p.id === world.suspectId).bits[i] : E.PLACES.find(p => p.id === world.placeId).bits[i - 3];
  }
  function viable(E, view, includeOwn = true) {
    const facts = view.facts.slice();
    if (includeOwn) for (const clue of view.self.clues) if (!facts.some(f => f.category === clue.category)) facts.push(clue);
    return E.candidates({ ...view, facts });
  }
  function rankedCategories(E, view) {
    const pool = viable(E, view), total = pool.length;
    return E.CATEGORIES.filter(c => !view.facts.some(f => f.category === c.id) && !view.self.clues.some(f => f.category === c.id)).map(c => {
      const zero = pool.filter(w => valueOf(E, w, c.id) === 0).length;
      const branches = [0, 1].map(value => E.candidates({ ...view, statements: [...view.statements, { category: c.id, value }] }).length);
      const repeats = view.statements.filter(s => s.category === c.id).length;
      return { category: c.id, balance: Math.min(zero, total - zero), worst: Math.max(...branches), mean: (branches[0] + branches[1]) / 2, repeats };
    }).sort((a, b) => a.worst - b.worst || a.mean - b.mean || b.balance - a.balance || b.repeats - a.repeats);
  }
  function detectiveInvestigation(E, view, random, memory) {
    const pool = viable(E, view), ranked = rankedCategories(E, view);
    if (pool.length <= 1 || !ranked.length) return { type: 'INVESTIGATE', kind: 'pass' };
    if (view.kits > 0 && view.round >= 4) return { type: 'INVESTIGATE', kind: 'search', category: ranked[0].category };
    const completed = new Set([...(view.questionHistory || []).map(q => q.category), ...view.statements.map(s => s.category), ...view.self.clues.map(c => c.category)]);
    const category = ranked.find(c => !completed.has(c.category))?.category;
    if (!category) return { type: 'INVESTIGATE', kind: 'pass' };
    const targets = view.players.filter(p => p.id !== view.self.id).map(p => ({
      id: p.id, score: view.statements.filter(s => s.speakerId === p.id).length + (memory.unknownTargets.has(p.id) ? -3 : 0), tie: random()
    })).sort((a, b) => b.score - a.score || a.tie - b.tie);
    const values = pool.map(w => valueOf(E, w, category));
    return { type: 'INVESTIGATE', kind: 'question', category, targetId: targets[0].id, proposedValue: values.filter(v => v === 1).length > values.length / 2 ? 1 : 0 };
  }
  function accusation(E, view, random) {
    const pool = viable(E, view);
    if (!pool.length) throw failure('연습 기록의 후보를 계산하지 못했습니다.');
    const pick = pool[Math.floor(random() * pool.length)];
    return { type: 'ACCUSE', suspectId: pick.suspectId, placeId: pick.placeId };
  }
  function chooseComputerEvent(E, view, random, memory) {
    if (view.phase === 'reveal') return { type: 'ROLE_SEEN' };
    if (view.phase === 'secret') {
      const share = view.self.clues.find(c => !view.self.shared.includes(c.category));
      if (share && !(view.rulesVersion >= 2 && view.players.length === 2)) return { type: 'SECRET_ACTION', kind: 'share', category: share.category };
      const ranked = rankedCategories(E, view), category = ranked[0]?.category || E.CATEGORIES[Math.floor(random() * E.CATEGORIES.length)].id;
      if (view.caseSecret && view.self.sabotageLeft > 0 && !view.sabotage && view.round < 5 && random() < .78) return { type: 'SECRET_ACTION', kind: 'seal', category };
      if (view.self.role === 'suspect' && view.self.guardLeft > 0 && [2, 3].includes(view.round)) return { type: 'SECRET_ACTION', kind: 'guard', category };
      return { type: 'SECRET_ACTION', kind: 'pass' };
    }
    if (view.phase === 'investigate') return detectiveInvestigation(E, view, random, memory);
    if (view.phase === 'answer') {
      const category = view.pending.category;
      if (!view.caseSecret) { const known = view.self.clues.find(c => c.category === category) || view.facts.find(f => f.category === category); return { type: 'ANSWER', value: known ? known.value : null }; }
      const actual = valueOf(E, view.caseSecret, category);
      const values = view.remainingLies > 0 ? [actual, 1 - actual] : [actual];
      const choices = values.map(value => ({ value, count: E.candidates({ ...view, statements: [...view.statements, { category, value }] }).length, lie: value !== actual, tie: random() }));
      choices.sort((a, b) => b.count - a.count || Number(a.lie) - Number(b.lie) || a.tie - b.tie);
      if (choices.length > 1 && choices[0].count === choices[1].count && random() < .3) return { type: 'ANSWER', value: 1 - actual };
      return { type: 'ANSWER', value: choices[0].value };
    }
    if (view.phase === 'discussion') {
      if (view.review?.kind === 'unknown' && view.review.targetId) memory.unknownTargets.add(view.review.targetId);
      if (view.review) {
        if (view.review.kind === 'answer' && !view.review.verified && view.review.statementId && view.kits > 0 && view.round >= 3 && viable(E, view).length > 1) return { type: 'REVIEW_RESULT', kind: 'audit' };
        return { type: 'REVIEW_RESULT', kind: 'confirm' };
      }
      return view.round < E.MAX_ROUNDS ? { type: 'END_ROUND' } : accusation(E, view, random);
    }
    if (view.phase === 'final') return accusation(E, view, random);
    throw failure('알 수 없는 연습 단계입니다.');
  }

  async function start(options = {}) {
    const count = options.count === undefined ? 2 : options.count, role = options.role || 'detective';
    if (!Number.isInteger(count) || count < 2 || count > 6) throw failure('연습 인원은 2명부터 6명까지 선택해 주세요.');
    if (!['detective', 'culprit', 'random'].includes(role)) throw failure('탐정·범인·무작위 중 내 역할을 선택해 주세요.');
    const name = typeof options.name === 'string' && options.name.trim() ? options.name.trim() : '나';
    if (name.length > 20) throw failure('연습 이름은 20자 이내로 입력해 주세요.');
    const seed = options.seed === undefined ? freshSeed() : options.seed;
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw failure('유효한 연습 시드를 사용해 주세요.');
    const stamp = ++generation; clearTimer(); match = null;
    const E = await loadEngine(); if (generation !== stamp) return response();
    const names = Array.from({ length: count }, (_, i) => '컴퓨터 ' + (i + 1));
    const initial = E.makeGame(names, { seed });
    const humanIndex = role === 'random' ? 0 : initial.players.findIndex(p => p.role === role);
    names[humanIndex] = name;
    const state = E.makeGame(names, { seed });
    match = { E, state, humanId: state.players[humanIndex].id, options: { count, role, name }, caseId: caseId(), onChange: typeof options.onChange === 'function' ? options.onChange : null, random: seeded(seed ^ 0xA5317C9B), memory: Object.fromEntries(state.players.map(p => [p.id, { unknownTargets: new Set() }])), receipts: new Set() };
    revision += 1; const data = notify(); schedule(); return data;
  }
  async function request(body = {}) {
    if (!match) { if (body.op === 'poll' || body.op === 'leave') return { room: null, account: null }; throw failure('먼저 컴퓨터 연습을 시작해 주세요.', 'PRACTICE_INACTIVE', 409); }
    if (body.op === 'poll') return response();
    if (body.op === 'leave') return stop();
    if (body.op === 'restart') return start({ ...match.options, onChange: match.onChange, ...(body.seed !== undefined ? { seed: body.seed } : {}) });
    if (body.op !== 'action') throw failure('연습에서 사용할 수 없는 요청입니다.');
    if (body.requestId && match.receipts.has(body.requestId)) return response();
    if (body.revision !== undefined && body.revision !== null && body.revision !== revision) throw failure('연습 차례가 바뀌었습니다. 화면을 확인한 뒤 다시 선택해 주세요.', 'REVISION_CONFLICT', 409);
    if (!body.event || typeof body.event.type !== 'string') throw failure('유효한 연습 행동을 선택해 주세요.');
    applyEvent(match, body.event, match.humanId);
    if (body.requestId) match.receipts.add(body.requestId);
    const data = notify(); schedule(); return data;
  }
  function stop() {
    const callback = match?.onChange; generation += 1; clearTimer(); match = null;
    const data = { room: null, account: null }; if (callback) { try { callback(data); } catch (_) {} } return data;
  }
  root.WitnessPractice = Object.freeze({ start, request, active: () => !!match, stop });
}(typeof window !== 'undefined' ? window : globalThis));

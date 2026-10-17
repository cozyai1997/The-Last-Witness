(function (root) {
  'use strict';
  if (root.WitnessSevenPractice) return;
  const HUMAN = 'practice-human', clone = value => JSON.parse(JSON.stringify(value));
  function failure(message, code = 'PRACTICE_INVALID', status = 400) { const error = new Error(message); error.code = code; error.status = status; return error; }
  function freshSeed() { if (root.crypto?.getRandomValues) return root.crypto.getRandomValues(new Uint32Array(1))[0]; return Math.floor(Math.random() * 4294967296); }
  function randomFor(seed) { let n = seed >>> 0; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }
  function optionsFor(E, view) { return E.candidates({ ...view, facts: [...view.facts, ...view.self.clues] }); }
  function knownValue(view, category) {
    const clue = view.self.clues.find(c => c.category === category && Number.isInteger(c.value));
    if (clue) return clue.value;
    const fact = view.facts.find(f => f.category === category && (Number.isInteger(f.value) || f.allowedValues?.length === 1));
    return fact ? (Number.isInteger(fact.value) ? fact.value : fact.allowedValues[0]) : null;
  }
  // This function receives only one privateView. It cannot inspect match state,
  // another player's identity, or an unearned S character assignment.
  function chooseComputerEvent(E, view, random = Math.random, memory = { records: [], questions: [] }) {
    const pick = values => values[Math.floor(random() * values.length)];
    const pool = () => optionsFor(E, view);
    const category = E.CATEGORIES.find(c => knownValue(view, c.id) === null)?.id || E.CATEGORIES[0].id;
    if (view.phase === 'reveal') return { type: 'ROLE_SEEN' };
    if (view.phase === 'secret') {
      if (view.self.role === 'suspect' && view.self.identity.memoryLeft > 0) return { type: 'SECRET_ACTION', kind: 'memory' };
      if (view.self.role === 'suspect' && !view.self.sealedReport && !view.sealedReport && view.round <= 6) {
        const candidates = pool(), candidate = candidates.length ? pick(candidates).suspectId : pick(E.SUSPECTS).id;
        return { type: 'SECRET_ACTION', kind: 'report', suspectId: candidate, text: '공개 수사 기록과 내가 관찰한 자료에 근거한 제보입니다.' };
      }
      if (view.caseSecret && view.self.sabotageLeft > 0 && !view.seals?.length && view.round <= 5 && random() < .55) return { type: 'SECRET_ACTION', kind: 'seal', category };
      if (view.self.role === 'suspect' && view.self.guardLeft > 0 && view.round === 5) return { type: 'SECRET_ACTION', kind: 'guard', category };
      return { type: 'SECRET_ACTION', kind: 'pass' };
    }
    if (view.phase === 'investigate') {
      const available = E.RECORDS.filter(r => !memory.records.includes(r.id));
      if (available.length && (view.round % 2 === 0 || view.round === 7)) { const record = pick(available); memory.records.push(record.id); return { type: 'SEARCH', recordId: record.id }; }
      const categories = E.CATEGORIES.filter(c => knownValue(view, c.id) === null);
      const pairs = categories.flatMap(c => view.players.filter(p => p.id !== view.self.id).map(p => ({ category: c.id, targetId: p.id }))).filter(q => !memory.questions.includes(q.targetId + ':' + q.category));
      if (!pairs.length) return { type: 'INVESTIGATE', kind: 'pass' };
      const question = pick(pairs); memory.questions.push(question.targetId + ':' + question.category);
      return { type: 'QUESTION', ...question, proposedValue: 0 };
    }
    if (view.phase === 'answer') {
      if (!view.caseSecret) return { type: 'ANSWER', value: view.self.answerOptions?.legalValues?.[0] ?? knownValue(view, view.pending.category) };
      const actual = E.caseValue(view.caseSecret, view.pending.category), values = E.CATEGORIES.find(c => c.id === view.pending.category).values;
      if (view.remainingLies > 0 && random() < .4) return { type: 'ANSWER', value: (actual + 1) % values.length };
      return { type: 'ANSWER', value: actual };
    }
    if (view.phase === 'discussion') {
      if (view.review?.kind === 'answer' && !view.review.verified && view.review.statementId && view.kits > 0 && view.round >= 4) return { type: 'REVIEW_AUDIT' };
      return { type: 'ROUND_CONFIRM' };
    }
    if (view.phase === 'final') { const candidates = pool(); const candidate = candidates.length ? pick(candidates) : { suspectId: pick(E.SUSPECTS).id }; return { type: 'ACCUSE', suspectId: candidate.suspectId }; }
    throw failure('알 수 없는 연습 단계입니다.');
  }
  function create(configuration = {}) {
    let match = null, revision = 0, timer = null, generation = 0, enginePromise = null;
    const clearTimer = () => { if (timer !== null) { root.clearTimeout(timer); timer = null; } };
    async function loadEngine() {
      if (configuration.engine) return configuration.engine;
      if (root.WitnessSevenEngine) return root.WitnessSevenEngine;
      if (!enginePromise) enginePromise = new Promise((resolve, reject) => {
        const script = root.document.createElement('script'); script.src = '/seven-practice-engine.js'; script.async = true;
        script.onload = () => root.WitnessSevenEngine ? resolve(root.WitnessSevenEngine) : reject(failure('7일 연습 엔진을 준비하지 못했습니다.'));
        script.onerror = () => { enginePromise = null; script.remove(); reject(failure('7일 연습 엔진을 불러오지 못했습니다.')); };
        root.document.head.appendChild(script);
      });
      return enginePromise;
    }
    function response() {
      if (!match) return { room: null, account: null };
      const { E, state, humanId } = match, view = clone(E.privateView(state, humanId));
      return { account: null, room: { code: 'PRACTICE', caseId: match.caseId, capacity: match.options.count, hostId: HUMAN, meId: HUMAN, revision, status: view.phase === 'finished' ? 'finished' : 'playing', practice: true, mode: 'practice', local: true,
        members: E.publicView(state).players.map((p, index) => ({ id: p.id === humanId ? HUMAN : 'practice-bot-' + index, name: p.name, ready: true, online: true, gameId: p.id, isBot: p.id !== humanId })), game: view } };
    }
    function notify() { const data = response(); try { match?.onChange?.(data); } catch (_) {} return data; }
    function apply(event, owner) {
      if (event.type !== 'ADD_NOTE' && match.E.turnOwner(match.state) !== owner) throw failure('현재 차례인 참가자만 행동할 수 있습니다.', 'NOT_YOUR_TURN', 403);
      const clean = {}; for (const key of ['type','kind','category','value','proposedValue','targetId','statementId','recordId','suspectId','placeId','text']) if (Object.prototype.hasOwnProperty.call(event, key)) clean[key] = event[key];
      clean.actorId = owner; clean.speakerId = owner; match.state = match.E.act(match.state, clean); revision++;
    }
    function schedule() {
      clearTimer(); if (!match || match.state.phase === 'finished' || match.E.turnOwner(match.state) === match.humanId) return;
      const stamp = generation; timer = root.setTimeout(() => {
        timer = null; if (!match || stamp !== generation) return;
        const owner = match.E.turnOwner(match.state), view = clone(match.E.privateView(match.state, owner));
        apply(chooseComputerEvent(match.E, view, match.random, match.memory[owner]), owner); notify(); schedule();
      }, 700 + Math.floor(match.random() * 701));
    }
    async function start(options = {}) {
      const count = options.count ?? 2, role = options.role || 'detective';
      if (!Number.isInteger(count) || count < 2 || count > 6) throw failure('연습 인원은 2명부터 6명까지 선택해 주세요.');
      const name = typeof options.name === 'string' && options.name.trim() ? options.name.trim() : '나';
      if (name.length > 20) throw failure('연습 이름은 20자 이내로 입력해 주세요.');
      const seed = options.seed ?? freshSeed(); if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw failure('유효한 연습 시드를 사용해 주세요.');
      const stamp = ++generation; clearTimer(); match = null;
      const E = await loadEngine(); if (generation !== stamp) return response();
      if (role !== 'random' && !E.ROLE_PACKS[count].includes(role)) throw failure('이 인원 구성에 포함된 역할을 선택해 주세요.');
      const names = Array.from({ length: count }, (_, i) => '컴퓨터 ' + (i + 1));
      const initial = E.makeGame(names, { seed });
      const publicPlayers = E.publicView(initial).players;
      const humanIndex = role === 'random' ? 0 : publicPlayers.findIndex(p => E.privateView(initial, p.id).self.role === role);
      names[humanIndex] = name; const state = E.makeGame(names, { seed }); if (generation !== stamp) return response();
      match = { E, state, humanId: publicPlayers[humanIndex].id, options: { count, role, name, rulesVersion: 4 }, caseId: 'practice-' + (root.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)), onChange: typeof options.onChange === 'function' ? options.onChange : null, random: randomFor(seed ^ 0x719A), memory: Object.fromEntries(publicPlayers.map(p => [p.id, { records: [], questions: [] }])), receipts: new Map() };
      revision++; const data = notify(); schedule(); return data;
    }
    async function request(body = {}) {
      if (!match) { if (body.op === 'poll' || body.op === 'leave') return { room: null, account: null }; throw failure('먼저 컴퓨터 연습을 시작해 주세요.', 'PRACTICE_INACTIVE', 409); }
      if (body.op === 'poll') return response(); if (body.op === 'leave') return stop(); if (body.op === 'restart') return start({ ...match.options, onChange: match.onChange, ...(body.seed !== undefined ? { seed: body.seed } : {}) });
      if (body.op !== 'action' || !body.event || typeof body.event.type !== 'string') throw failure('유효한 연습 행동을 선택해 주세요.');
      const fingerprint = JSON.stringify(body.event);
      if (body.requestId && match.receipts.has(body.requestId)) { if (match.receipts.get(body.requestId) !== fingerprint) throw failure('같은 요청 번호로 다른 행동을 보낼 수 없습니다.', 'REQUEST_ID_REUSED', 409); return response(); }
      if (body.revision !== undefined && body.revision !== revision) throw failure('연습 차례가 바뀌었습니다. 다시 선택해 주세요.', 'REVISION_CONFLICT', 409);
      apply(body.event, match.humanId); if (body.requestId) match.receipts.set(body.requestId, fingerprint);
      const data = notify(); schedule(); return data;
    }
    function stop() { const callback = match?.onChange; generation++; clearTimer(); match = null; const data = { room: null, account: null }; try { callback?.(data); } catch (_) {} return data; }
    return Object.freeze({ start, request, active: () => !!match, stop });
  }
  root.WitnessSevenPractice = Object.freeze({ ...create(), create, chooseComputerEvent });
}(typeof window !== 'undefined' ? window : globalThis));

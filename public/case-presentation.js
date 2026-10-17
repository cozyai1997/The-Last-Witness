(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WitnessCasePresentation = api;
}(typeof window !== 'undefined' ? window : globalThis, function (win) {
  'use strict';
  const STORIES = Object.freeze({
    start: '전시관의 문이 닫혔다. 한 사람은 돌아오지 않았고, 남겨진 이들의 기억은 서로 엇갈린다. 다섯 날의 기록 끝에 탐정은 한 사람과 한 장소를 지목해야 한다.',
    1: '첫 번째 기록을 펼친다. 누구의 말부터 확인할지는 아직 정해지지 않았다. 각자의 기억을 나누고, 탐정의 첫 수사를 준비한다.',
    2: '하루가 지나도 기억이 같은 모양으로 남으리라는 보장은 없다. 두 번째 날의 수사는 말로 전한 기억과 공식 기록을 구분하는 데서 시작된다.',
    3: '말은 단서가 될 수도, 수사를 흐릴 수도 있다. 세 번째 날의 기록을 열고, 확인한 사실과 아직 모르는 것을 차분히 가려낸다.',
    4: '익숙한 이름도, 같은 대답도 한 번 더 살펴야 한다. 네 번째 수사에서는 추측의 빈칸을 돌아보고 마지막 선택을 준비한다.',
    5: '다섯 번째 날, 수사에 남은 기회는 단 한 번. 마지막으로 질문하거나 기록을 확인한 뒤, 모두의 이야기를 듣고 고발을 결정한다.',
    final: '고발을 앞둔 순간, 말과 사실을 다시 나눈다. 탐정이 고를 답은 사람의 역할이 아니라 사건 인물 한 명과 장소 한 곳이다.',
    ending: '고발이 끝나고 마지막 기록을 정리한다. 공식 결과에서 사건의 진상과 각자의 역할을 확인하며, 서로 다른 기억을 되짚어 본다.'
  });
  const OBSERVATIONS = Object.freeze({
    coat: ['그 사람이 짙은 외투를 입었다', '그 사람이 밝은 외투를 입었다'],
    hand: ['그 사람이 왼손을 주로 썼다', '그 사람이 오른손을 주로 썼다'],
    item: ['그 사람이 장갑을 착용했다', '그 사람이 손목시계를 착용했다'],
    zone: ['사건 장소가 실내였다', '사건 장소가 실외였다'],
    light: ['사건 장소의 조명이 밝았다', '사건 장소의 조명이 어두웠다']
  });
  const ROUND_NAMES = ['', '첫 번째 날', '두 번째 날', '세 번째 날', '네 번째 날', '마지막 날'];
  let host = null, story = null, dayBanner = null;
  const completedKeys = new Set(), activeTypes = new Set(), elementTypes = new WeakMap();
  const later = callback => typeof queueMicrotask === 'function' ? queueMicrotask(callback) : Promise.resolve().then(callback);
  function notify(callback, result) { if (typeof callback !== 'function') return; try { const pending = callback(result); if (pending && typeof pending.catch === 'function') pending.catch(function () {}); } catch (_) {} }
  function dayNumber(value) { const number = Number(value); return Number.isInteger(number) ? Math.max(1, Math.min(5, number)) : 1; }
  function name(value, fallback) { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback; }
  function categoryId(value) { return value && typeof value === 'object' ? value.id : value; }
  function reduced() { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function padDay(value) { return 'DAY-' + String(dayNumber(value)).padStart(2, '0'); }
  function root() {
    if (host && host.isConnected) return host;
    const doc = win.document;
    if (!doc || !doc.body) return null;
    if (!doc.querySelector('link[href="/case-presentation.css"]') && !doc.getElementById('cw-presentation-style')) {
      const link = doc.createElement('link'); link.id = 'cw-presentation-style'; link.rel = 'stylesheet'; link.href = '/case-presentation.css'; doc.head.appendChild(link);
    }
    host = doc.getElementById('cw-presentation-root') || doc.createElement('div');
    host.id = 'cw-presentation-root';
    if (!host.isConnected) doc.body.appendChild(host);
    return host;
  }
  function type(element, text, options) {
    options = options || {};
    if (!element || typeof element.textContent === 'undefined') throw new TypeError('글을 표시할 요소가 필요합니다.');
    if (elementTypes.has(element)) elementTypes.get(element).cancel();
    const fullText = String(text == null ? '' : text), letters = Array.from(fullText);
    const speed = Number.isFinite(options.speed) ? Math.max(0, Math.min(250, options.speed)) : 22;
    let timer = null, position = 0, stopped = false, resolve;
    const promise = new Promise(function (done) { resolve = done; });
    element.textContent = ''; element.classList.add('cw-handwriting', 'cw-typing');
    element.setAttribute('aria-label', fullText);
    function clean() { clearTimeout(timer); element.classList.remove('cw-typing'); activeTypes.delete(controller); if (elementTypes.get(element) === controller) elementTypes.delete(element); }
    function finish() {
      if (stopped) return; stopped = true; clean(); element.textContent = fullText;
      const result = { cancelled: false, text: fullText }; resolve(result); later(function () { notify(options.onDone, result); });
    }
    function cancelType() { if (stopped) return; stopped = true; clean(); resolve({ cancelled: true }); }
    const controller = { finish: finish, cancel: cancelType, promise: promise, get done() { return stopped; } };
    activeTypes.add(controller); elementTypes.set(element, controller);
    function tick() {
      if (stopped) return;
      if (element.isConnected === false) { cancelType(); return; }
      position += 1; element.textContent = letters.slice(0, position).join('');
      if (position >= letters.length) { finish(); return; }
      const previous = letters[position - 1];
      const delay = speed + (/[.!?。]/.test(previous) ? 110 : /[,，\n]/.test(previous) ? 55 : 0);
      timer = setTimeout(tick, delay);
    }
    if (!letters.length || speed === 0 || reduced() || win.document && win.document.hidden) later(finish);
    else timer = setTimeout(tick, speed);
    return controller;
  }
  function stopDay(callDone) {
    if (!dayBanner) return;
    const current = dayBanner; dayBanner = null;
    clearTimeout(current.timer); clearTimeout(current.exitTimer); current.element.remove();
    const result = { cancelled: !callDone, day: current.day }; current.resolve(result);
    if (callDone) notify(current.onDone, result);
  }
  function showDay(day, options) {
    options = options || {}; stopDay(false);
    const value = dayNumber(day), container = root();
    if (!container || reduced()) { const result = { cancelled: false, day: value }; later(function () { notify(options.onDone, result); }); return Promise.resolve(result); }
    const element = win.document.createElement('div'); element.className = 'cw-day-banner'; element.setAttribute('aria-hidden', 'true');
    const inner = win.document.createElement('div'); inner.className = 'cw-day-inner';
    const number = win.document.createElement('span'); number.className = 'cw-day-number'; number.textContent = padDay(value);
    const caption = win.document.createElement('span'); caption.className = 'cw-day-caption'; caption.textContent = ROUND_NAMES[value] + ' · 기록을 이어갑니다';
    inner.appendChild(number); inner.appendChild(caption); element.appendChild(inner); container.appendChild(element);
    let resolve; const promise = new Promise(function (done) { resolve = done; });
    const current = { element: element, day: value, onDone: options.onDone, resolve: resolve, timer: null, exitTimer: null };
    dayBanner = current;
    current.timer = setTimeout(function () {
      if (dayBanner !== current) return; element.classList.add('cw-day-leave');
      current.exitTimer = setTimeout(function () { if (dayBanner === current) stopDay(true); }, 240);
    }, 1180);
    return promise;
  }
  function storyCopy(options) {
    const stage = ['start', 'round', 'final', 'ending'].includes(options.stage) ? options.stage : 'round';
    const day = dayNumber(options.day);
    if (stage === 'ending' && ['investigators', 'criminals'].includes(options.winner)) {
      const suspect = name(options.suspectName, '공식 결과의 인물'), place = name(options.placeName, '공식 결과의 장소');
      return options.winner === 'investigators' ? '진술의 조각이 하나로 이어졌다. 사건 인물은 ' + suspect + ', 장소는 ' + place + '. 탐정의 고발이 진실에 닿으며 이번 수사가 끝났다.' : '고발은 진실을 비껴갔다. 사건 인물은 ' + suspect + ', 장소는 ' + place + '. 범인 진영이 고발을 넘기며 이번 수사는 막을 내렸다.';
    }
    return STORIES[stage === 'round' ? day : stage];
  }
  function finishStory(completed, skipped) {
    if (!story) return;
    const current = story; story = null;
    current.typer.cancel(); current.overlay.remove(); win.document.removeEventListener('keydown', current.keyboard, true);
    win.document.body.classList.remove('cw-story-open');
    if (current.previous && current.previous.isConnected && typeof current.previous.focus === 'function') current.previous.focus({ preventScroll: true });
    const result = { cancelled: !completed, skipped: !!skipped, key: current.key, day: current.day, stage: current.stage };
    if (completed && current.key) { completedKeys.add(current.key); if (completedKeys.size > 128) completedKeys.delete(completedKeys.values().next().value); }
    current.resolve(result);
    // Explicit cancel never runs a stale game-transition callback.
    if (completed) notify(current.onDone, result);
  }
  function showStory(options) {
    options = options || {};
    const key = typeof options.key === 'string' ? options.key : '';
    if (story && key && story.key === key) return story.promise;
    if (key && completedKeys.has(key)) { const result = { cancelled: false, skipped: true, key: key, reason: 'already-shown' }; later(function () { notify(options.onDone, result); }); return Promise.resolve(result); }
    finishStory(false, false); stopDay(false);
    const container = root();
    if (!container) { const result = { cancelled: false, skipped: true, reason: 'no-document' }; later(function () { notify(options.onDone, result); }); return Promise.resolve(result); }
    const doc = win.document, day = dayNumber(options.day), stage = ['start', 'round', 'final', 'ending'].includes(options.stage) ? options.stage : 'round';
    const overlay = doc.createElement('div'); overlay.className = 'cw-overlay';
    overlay.innerHTML = '<div class="cw-scene" aria-hidden="true"></div><section class="cw-story" role="dialog" aria-modal="true" aria-labelledby="cw-story-title" aria-describedby="cw-story-text" tabindex="-1"><header class="cw-story-top"><span class="cw-case-label">THE LAST WITNESS / CASE NOTES</span><span class="cw-story-day"></span></header><div class="cw-paper"><div class="cw-paper-meta"><span>ARCHIVE / CASE NOTES</span><span class="cw-paper-count"></span></div><h2 class="cw-story-title" id="cw-story-title"></h2><p class="cw-story-text cw-handwriting" id="cw-story-text" aria-live="off"></p><span class="cw-stamp" aria-hidden="true">LAST WITNESS</span></div><footer class="cw-story-footer"><p class="cw-story-hint">Enter · 빠르게 보기 / 계속<br>Esc · 장면 건너뛰기</p><div class="cw-story-actions"><button type="button" class="cw-button cw-button-quiet" data-cw="fast">빠르게 보기</button><button type="button" class="cw-button cw-button-quiet" data-cw="skip">건너뛰기</button><button type="button" class="cw-button cw-button-primary" data-cw="continue">문장 바로 보기</button></div></footer></section>';
    overlay.querySelector('.cw-story-day').textContent = stage === 'ending' ? 'CASE CLOSED' : padDay(day);
    overlay.querySelector('.cw-paper-count').textContent = day + ' / 5';
    overlay.querySelector('.cw-story-title').textContent = stage === 'start' ? '마지막 출입 기록' : stage === 'final' ? '고발을 앞두고' : stage === 'ending' ? options.winner === 'investigators' ? '진실에 닿은 고발' : options.winner === 'criminals' ? '빗나간 고발' : '마지막 기록' : ROUND_NAMES[day] + '의 기록';
    const text = overlay.querySelector('.cw-story-text'), forward = overlay.querySelector('[data-cw="continue"]'), fast = overlay.querySelector('[data-cw="fast"]');
    container.appendChild(overlay); doc.body.classList.add('cw-story-open');
    let resolve; const promise = new Promise(function (done) { resolve = done; });
    const current = { key: key, day: day, stage: stage, overlay: overlay, previous: doc.activeElement, onDone: options.onDone, resolve: resolve, promise: promise, typer: null, keyboard: null };
    story = current;
    function advance() { if (story !== current) return; if (!current.typer.done) current.typer.finish(); else finishStory(true, false); }
    forward.addEventListener('click', advance); fast.addEventListener('click', function () { current.typer.finish(); });
    overlay.querySelector('[data-cw="skip"]').addEventListener('click', function () { if (story === current) finishStory(true, true); });
    current.keyboard = function (event) {
      if (story !== current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finishStory(true, true); }
      else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') { event.preventDefault(); event.stopImmediatePropagation(); advance(); }
      else if (event.key === 'Tab') {
        const buttons = Array.from(overlay.querySelectorAll('button:not(:disabled)')), first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (doc.activeElement === first || doc.activeElement === overlay.querySelector('.cw-story'))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    doc.addEventListener('keydown', current.keyboard, true);
    current.typer = type(text, storyCopy(options), { speed: 22, onDone: function () { if (story === current) { forward.textContent = stage === 'ending' ? '결과 보기' : '계속'; fast.disabled = true; } } });
    overlay.querySelector('.cw-story').focus({ preventScroll: true });
    return promise;
  }
  function questionText(options) {
    options = options || {}; const id = categoryId(options.category), proposed = options.proposedValue;
    const target = name(options.targetName, '목격자'), detective = name(options.detectiveName, '탐정');
    const previous = options.previous ? '앞서 남긴 진술을 생각하며 답해 주십시오. ' : '';
    if (!OBSERVATIONS[id] || proposed !== 0 && proposed !== 1) return detective + ': ' + target + ' 씨, 그 사건에 관해 알고 있는 내용을 말씀해 주십시오.';
    return detective + ': ' + target + ' 씨, ' + previous + OBSERVATIONS[id][proposed] + '는 진술이 맞습니까?';
  }
  function answerText(options) {
    options = options || {}; const speaker = name(options.name, '목격자'), id = categoryId(options.category);
    if (options.unknown || options.value === null) return speaker + ': 그 항목은 제가 아는 단서에 없습니다. 모릅니다.';
    if (!OBSERVATIONS[id] || options.value !== 0 && options.value !== 1) return speaker + ': 공식 기록에서 제 답변을 확인해 주십시오.';
    return speaker + ': 제 진술은 이렇습니다. ' + OBSERVATIONS[id][options.value] + '는 것입니다.';
  }
  function cancel() { finishStory(false, false); stopDay(false); Array.from(activeTypes).forEach(function (controller) { controller.cancel(); }); }
  return Object.freeze({ showStory: showStory, showDay: showDay, type: type, cancel: cancel, busy: function () { return !!story || !!dayBanner; }, questionText: questionText, answerText: answerText });
}));

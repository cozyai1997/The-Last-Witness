(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WitnessReplay = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  var TITLES = {
    'initial-clue': '처음 받은 참 단서', share: '개인 단서 공식 공개', suggest: '수사 항목 제안',
    seal: '비밀 은폐', guard: '현장 보호', 'secret-pass': '개인 행동 넘김',
    question: '탐정의 질문', 'blocked-question': '은폐로 막힌 질문', 'blocked-search': '은폐로 막힌 감식', 'legacy-blocked': '은폐로 중단된 수사',
    search: '현장 감식', audit: '공식 진술 검증', 'investigate-pass': '공동 수사 넘김',
    answer: '공식 답변', unknown: '모름 답변', 'seal-result': '은폐 결과',
    'round-confirm': '수사 결과 확인', accusation: '탐정의 최종 고발'
  };
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (s) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]; }); }
  function day(round) { return 'DAY-' + String(round).padStart(2, '0'); }
  function binary(value) { return value === 0 || value === 1; }
  function create(config) {
    config = config || {};
    var G = config.G || root.WitnessParty || {}, esc = config.esc || escape;
    function archive(g) { return g && g.phase === 'finished' && g.reveal && g.reveal.replay || null; }
    function events(g, round) {
      var a = archive(g), list = a && Array.isArray(a.events) ? a.events.filter(function (e) { return e && typeof e === 'object' && Number.isInteger(e.round) && e.round >= 1 && e.round <= 5; }) : [];
      return round == null || round === 'all' ? list : list.filter(function (e) { return e.round === Number(round); });
    }
    function summary(g) {
      var all = events(g), a = archive(g);
      return {
        total: all.length,
        questions: all.filter(function (e) { return e.type === 'question' || e.type === 'blocked-question'; }).length,
        lies: all.filter(function (e) { return e.type === 'answer' && e.isTrue === false; }).length,
        verified: all.filter(function (e) { return e.type === 'audit'; }).length,
        complete: !!(a && a.complete === true)
      };
    }
    function category(id) { return (G.CATEGORIES || []).find(function (entry) { return entry.id === id; }); }
    function categoryName(id) { return category(id)?.label || '수사 항목'; }
    function valueName(id, value) { return binary(value) && category(id) ? category(id).values[value] : '기록 없음'; }
    function person(g, id) {
      return (g.reveal?.players || g.players || []).find(function (p) { return p.id === id; }) || null;
    }
    function name(g, id, fallback) { return person(g, id)?.name || fallback || '참가자 기록 없음'; }
    function actor(g, e) {
      var p = person(g, e.actorId), role = p && G.ROLES?.[p.role]?.label;
      return p ? p.name + (role ? ' · ' + role : '') : '행동한 참가자 기록 없음';
    }
    function npc(id) { return (G.SUSPECTS || []).find(function (p) { return p.id === id; })?.name || '인물 기록 없음'; }
    function place(id) { return (G.PLACES || []).find(function (p) { return p.id === id; })?.name || '장소 기록 없음'; }
    function actual(g, e) {
      if (binary(e.actualValue)) return e.actualValue;
      var i = (G.CATEGORIES || []).findIndex(function (c) { return c.id === e.category; }), s = g.reveal?.secret;
      if (i < 0 || !s) return null;
      var record = i < 3 ? (G.SUSPECTS || []).find(function (p) { return p.id === s.suspectId; }) : (G.PLACES || []).find(function (p) { return p.id === s.placeId; });
      return record && binary(record.bits[i < 3 ? i : i - 3]) ? record.bits[i < 3 ? i : i - 3] : null;
    }
    function verdict(g, e) {
      if (e.type !== 'answer' && e.type !== 'audit') return '';
      if (typeof e.isTrue === 'boolean') return e.isTrue ? 'truth' : 'lie';
      return binary(e.value) && binary(actual(g, e)) ? e.value === actual(g, e) ? 'truth' : 'lie' : '';
    }
    function badge(g, e) {
      if (e.type === 'answer') return verdict(g, e) === 'lie' ? '종료 후 확인된 거짓' : verdict(g, e) === 'truth' ? '종료 후 확인된 진실' : '공식 진술';
      if (e.type === 'audit') return '당시 검증 완료';
      if (e.type === 'blocked-question' || e.type === 'blocked-search') return '답변·확정 증거 없음';
      if (e.type === 'seal-result') return e.success ? '은폐 성공' : '은폐 실패';
      if (e.type === 'suggest') return '자유 의견';
      return '';
    }
    function prompt(g, e) {
      if (!e.targetId || !binary(e.proposedValue)) return '당시 질문 문구와 대상은 남아 있지 않습니다. 기록된 조사 항목: ' + categoryName(e.category) + '.';
      var presentation = root.WitnessCasePresentation;
      return presentation?.questionText ? presentation.questionText({ detectiveName: name(g, e.actorId, '탐정'), targetName: name(g, e.targetId, '목격자'), category: e.category, proposedValue: e.proposedValue }) : name(g, e.actorId, '탐정') + ': ' + name(g, e.targetId, '목격자') + ' 씨, 목격 내용이 ' + valueName(e.category, e.proposedValue) + '라는 진술이 맞습니까?';
    }
    function paragraph(text, cls) { return '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(text) + '</p>'; }
    function comparison(g, e) {
      return '<div class="case-replay-comparison"><div><small>원래 공식 답변</small><strong>' + esc(valueName(e.category, e.value)) + '</strong></div><div><small>실제 사건의 진실</small><strong>' + esc(valueName(e.category, actual(g, e))) + '</strong></div></div>';
    }
    function detail(g, e) {
      var cat = categoryName(e.category), fact = valueName(e.category, e.value), body = '';
      switch (e.type) {
        case 'initial-clue':
          body = paragraph(name(g, e.actorId) + '에게 처음 주어진 ' + (e.kind === 'official' ? '공식 시작 단서' : '개인 시작 기억') + '입니다.') + paragraph(cat + ' · ' + fact, 'case-replay-hand'); break;
        case 'share':
          body = paragraph(name(g, e.actorId) + ' 씨가 개인의 참 단서를 모두의 공식 기록에 남겼습니다.') + paragraph(cat + ' · ' + fact, 'case-replay-hand'); break;
        case 'suggest':
          body = paragraph(name(g, e.actorId) + ' 씨가 ' + cat + ' 조사를 제안했습니다.') + paragraph('제안은 자유 의견입니다. 참·거짓 판정이나 공식 증거로 사용하지 않습니다.', 'case-replay-note'); break;
        case 'seal':
          body = paragraph(name(g, e.actorId) + ' 씨가 이번 라운드의 ' + cat + ' 접근을 은폐했습니다.') + paragraph('종료 후 공개된 비밀 행동입니다. 이 행동 자체는 이미 확보된 증거를 바꾸지 않습니다.', 'case-replay-note'); break;
        case 'guard':
          body = paragraph(name(g, e.actorId) + ' 씨가 ' + cat + ' 항목을 현장 보호 대상으로 골랐습니다.') + paragraph('같은 항목에 적용된 은폐를 무시하는 개인 행동입니다.', 'case-replay-note'); break;
        case 'secret-pass': body = paragraph(name(g, e.actorId) + ' 씨가 이번 개인 행동을 넘겼습니다.'); break;
        case 'question':
        case 'blocked-question':
          body = paragraph(prompt(g, e), 'case-replay-hand') + paragraph(cat + ' · 질문 속 가정은 탐정이 확인하려던 내용이며, 공식 답변이나 거짓말 횟수에 포함되지 않습니다.', 'case-replay-note');
          if (e.type === 'blocked-question') body += '<div class="case-replay-outcome is-blocked">이 항목이 은폐되어 질문이 전달되지 않았습니다. 공식 답변은 생기지 않았습니다.</div>';
          break;
        case 'answer': {
          var presentation = root.WitnessCasePresentation, speaker = name(g, e.actorId || e.targetId, '응답자');
          body = paragraph(presentation?.answerText ? presentation.answerText({ name: speaker, category: e.category, value: e.value }) : speaker + ': ' + fact + '였다고 진술합니다.', 'case-replay-hand') + comparison(g, e);
          var audit = e.statementId && events(g).find(function (v) { return v.type === 'audit' && v.statementId === e.statementId; });
          body += '<div class="case-replay-outcome ' + (verdict(g, e) === 'lie' ? 'is-lie' : '') + '"><strong>' + esc(badge(g, e)) + '</strong>' + paragraph(audit ? '이후 ' + day(audit.round) + '에서 검증했습니다. 원래 답변은 바꾸지 않고 보존했습니다.' : '플레이 중 미검증 · 사건이 끝난 뒤 공개된 정답과 대조한 결과입니다.') + '</div>';
          break;
        }
        case 'unknown':
          body = paragraph(name(g, e.actorId || e.targetId, '응답자') + ': ' + cat + '은 기억나지 않습니다. 모릅니다.', 'case-replay-hand') + paragraph('모름 답변은 이진 공식 진술을 만들지 않아 진실·거짓 판정 대상이 아닙니다.', 'case-replay-note'); break;
        case 'search':
          body = paragraph('탐정이 현장 감식 기회를 사용해 ' + cat + '의 확정 증거를 확보했습니다.') + paragraph(fact, 'case-replay-hand') + paragraph('공식 증거는 조작되지 않습니다.', 'case-replay-note'); break;
        case 'blocked-search':
          body = paragraph(cat + '의 현장 감식 접근이 은폐에 막혔습니다.', 'case-replay-hand') + paragraph('이번 시도에서는 새로운 확정 증거를 얻지 못했습니다.', 'case-replay-note'); break;
        case 'legacy-blocked':
          body = paragraph(cat + ' · 은폐로 중단된 수사', 'case-replay-hand') + paragraph('질문/감식 구분 기록 없음 · 과거 기록에는 은폐로 중단된 항목만 남아 있습니다. 질문 대상이나 감식 여부를 추정하지 않습니다.', 'case-replay-note'); break;
        case 'audit':
          body = paragraph('탐정이 ' + name(g, e.targetId, '응답자') + ' 씨의 ' + cat + ' 공식 진술을 검증했습니다.') + comparison(g, e) + '<div class="case-replay-outcome ' + (verdict(g, e) === 'lie' ? 'is-lie' : '') + '"><strong>당시 검증 완료 · ' + (verdict(g, e) === 'lie' ? '거짓 확인' : verdict(g, e) === 'truth' ? '진실 확인' : '판정 기록 없음') + '</strong>' + paragraph('감식·검증 공용 기회를 사용했습니다. 원래 진술은 그대로 보존했습니다.') + '</div>'; break;
        case 'investigate-pass': body = paragraph('탐정이 이번 공동 수사를 넘겼습니다. 새 질문이나 현장 증거는 생기지 않았습니다.'); break;
        case 'seal-result': {
          var reason = { blocked: '탐정의 수사와 은폐 항목이 일치해 수사를 막았습니다.', guarded: '같은 항목의 현장 보호가 은폐를 무시했습니다.', missed: '탐정이 다른 항목을 골라 이번 수사를 막지 못했습니다.', unused: '이번 수사에서는 은폐가 적용될 질문·현장 감식이 진행되지 않았습니다.' }[e.reason] || '상세 사유는 남아 있지 않습니다.';
          body = paragraph(cat + ' · ' + reason, 'case-replay-hand') + '<div class="case-replay-outcome ' + (e.success ? 'is-blocked' : '') + '"><strong>' + (e.success ? '은폐 성공' : '은폐 실패') + '</strong>' + paragraph('비밀 행동과 그 결과는 사건 종료 후 모두에게 공개됩니다.') + '</div>'; break;
        }
        case 'round-confirm': body = paragraph('탐정이 수사 결과를 확인하고 ' + (e.round < 5 ? '다음 날의 수사로 넘어갔습니다.' : '최종 고발을 준비했습니다.')); break;
        case 'accusation':
          body = paragraph(name(g, e.actorId, '탐정') + '의 고발: ' + npc(e.suspectId) + ' / ' + place(e.placeId), 'case-replay-hand') + '<div class="case-replay-comparison"><div><small>최종 고발</small><strong>' + esc(npc(e.suspectId) + ' / ' + place(e.placeId)) + '</strong></div><div><small>공개된 사건 정답</small><strong>' + esc(npc(g.reveal.secret?.suspectId) + ' / ' + place(g.reveal.secret?.placeId)) + '</strong></div></div>' + paragraph(g.winner === 'investigators' ? '인물과 장소를 모두 맞혀 수사 진영이 승리했습니다.' : '고발이 사건 정답과 달라 범인 진영이 승리했습니다.', 'case-replay-note'); break;
        default: body = paragraph('이 행동의 상세 기록은 이 버전에서 표시할 수 없습니다.');
      }
      return body;
    }
    function short(g, e) {
      if (e.type === 'accusation') return npc(e.suspectId) + ' / ' + place(e.placeId);
      if (e.type === 'answer' || e.type === 'search' || e.type === 'share' || e.type === 'initial-clue') return categoryName(e.category) + ' · ' + valueName(e.category, e.value);
      if (e.type === 'audit') return categoryName(e.category) + ' · 검증';
      if (e.category) return categoryName(e.category);
      return name(g, e.actorId, '기록 확인');
    }
    function render(g, state) {
      if (!g || g.phase !== 'finished' || !g.reveal) return '';
      state = state || {};
      var stats = summary(g), round = state.round == null ? 'all' : state.round, lastRound = Math.max(1, Math.min(5, Number(g.round) || 1));
      if (round !== 'all') round = Number.isInteger(Number(round)) && Number(round) >= 1 && Number(round) <= lastRound ? Number(round) : 'all';
      var list = events(g, round), index = Number.isFinite(Number(state.index)) ? Math.floor(Number(state.index)) : 0;
      index = Math.max(0, Math.min(list.length - 1, index));
      var current = list[index], out = '<section class="case-replay" data-step-index="' + index + '" data-round="' + round + '" aria-label="종료된 사건 복기"><header class="case-replay-intro"><div class="case-letter-label">CASE REPLAY / 닫힌 사건의 기록</div><h2>그날의 말, 드러난 진실.</h2><p>질문부터 마지막 고발까지, 남겨진 행동을 시간순으로 살펴보세요. 거짓 판정은 종료 후 공개된 사건 정답을 기준으로 합니다.</p></header><div class="case-replay-stats"><div><strong>' + stats.questions + '</strong><span>질문 시도</span></div><div class="case-replay-lie-count"><strong>' + stats.lies + '</strong><span>거짓 공식 답변</span></div><div><strong>' + stats.verified + '</strong><span>당시 진술 검증</span></div><div><strong>' + stats.total + '</strong><span>남겨진 행동</span></div></div>';
      if (!stats.complete) out += '<div class="case-replay-warning" role="note"><strong>일부 기록만 복기할 수 있습니다.</strong><p>이 사건은 복기 기록 기능이 적용되기 전에 시작되었거나 상세 기록이 남아 있지 않습니다. 확인 가능한 기록만 표시하며, 빠진 질문·대상·행동 순서는 추정하지 않습니다.</p></div>';
      out += '<div class="case-replay-filters" role="group" aria-label="복기할 라운드"><button type="button" data-action="replay-round" data-round="all" aria-pressed="' + (round === 'all') + '">모든 날</button>';
      for (var r = 1; r <= lastRound; r += 1) out += '<button type="button" data-action="replay-round" data-round="' + r + '" aria-pressed="' + (round === r) + '">' + day(r) + '</button>';
      out += '</div>';
      if (!current) return out + '<p class="case-replay-empty">복기할 상세 기록이 없습니다.' + (round === 'all' ? '' : ' 다른 날이나 모든 날을 선택해 주세요.') + '</p><p class="case-replay-note">자유 채팅은 공식 증거가 아니며, 이 복기의 참·거짓 집계에 포함하지 않습니다.</p></section>';
      var v = verdict(g, current), label = badge(g, current);
      out += '<div class="case-replay-layout"><div class="case-replay-stage"><div class="case-replay-position" aria-live="polite">' + day(current.round) + ' <span>기록 ' + (index + 1) + ' / ' + list.length + '</span></div><article class="case-replay-step' + (v === 'lie' ? ' is-lie' : '') + '" data-replay-step="' + esc(current.id || '') + '"><header><p class="case-replay-actor">' + esc(actor(g, current)) + '</p><h3 id="replay-step-title" tabindex="-1">' + esc(TITLES[current.type] || '수사 기록') + '</h3>' + (label ? '<span class="case-replay-badge">' + esc(label) + '</span>' : '') + '</header>' + detail(g, current) + '</article><nav class="case-replay-controls" aria-label="복기 기록 이동">' + [['first', '처음', index === 0], ['prev', '이전', index === 0], ['next', '다음', index === list.length - 1], ['last', '마지막', index === list.length - 1]].map(function (b) { return '<button type="button" data-action="replay-' + b[0] + '"' + (b[2] ? ' disabled' : '') + '>' + b[1] + '</button>'; }).join('') + '</nav></div><aside class="case-replay-timeline" aria-label="사건 흐름"><h3>사건의 흐름</h3><ol>';
      list.forEach(function (e, i) {
        var lie = verdict(g, e) === 'lie', tag = badge(g, e);
        out += '<li' + (lie ? ' class="is-lie"' : '') + '><button type="button" data-action="replay-step" data-index="' + i + '"' + (i === index ? ' aria-current="step"' : '') + '><span class="case-replay-timeline-day">' + day(e.round) + ' · ' + (i + 1) + '</span><strong>' + esc(TITLES[e.type] || '수사 기록') + '</strong><span>' + esc(short(g, e)) + '</span>' + (tag ? '<small>' + esc(tag) + '</small>' : '') + '</button></li>';
      });
      return out + '</ol></aside></div><p class="case-replay-note case-replay-footnote">자유 채팅은 공식 증거가 아니며, 이 복기의 참·거짓 집계에 포함하지 않습니다. 탐정의 질문 속 가정과 참가자의 공식 답변을 구분해 표시합니다.</p></section>';
    }
    return Object.freeze({ summary: summary, events: events, render: render });
  }
  return Object.freeze({ create: create });
}));

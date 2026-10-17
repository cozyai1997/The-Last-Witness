(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WitnessSevenUI = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const STORIES = [
    '',
    '폐관 후, 보안팀은 연구책임자 정윤재의 사망을 확인했다. 그날 밤 전시관에 있던 열두 인물, 열두 장소와 열두 도구, 열두 시간 구간의 기록이 남았다. 정확한 범행 장소와 시간은 아직 알 수 없다. 앞으로 일곱 날의 수사, 기억과 진술을 이어 한 명의 진범을 찾아야 한다.',
    '같은 시간을 기억해도 사람마다 남긴 조각은 다르다. 두 번째 날, 원본 기록의 범위와 누군가의 말을 구분하며 수사를 이어 간다.',
    '기록의 빈칸에 누군가의 말이 들어온다. 세 번째 날, 확인된 사실과 아직 검증하지 않은 진술을 나란히 놓아 본다.',
    '한 가지 특징이 같다고 같은 사람이 되는 것은 아니다. 네 번째 날, 서로 닮은 관찰 너머로 다른 흔적을 찾는다.',
    '다섯 번째 날의 기록을 펼친다. 익숙해진 가설에도 빈틈은 남아 있다. 지나친 확신 대신 아직 풀리지 않은 질문을 고른다.',
    '여섯 번째 날, 봉인 제보의 마지막 기회가 다가온다. 각자의 선택은 각자의 수첩에 남고, 탐정의 수사는 계속된다.',
    '일곱 번째 날이다. 오늘의 수사와 답변 검토를 마치면 탐정은 사건 인물 한 명을 최종 고발한다. 장소·도구·시간의 흔적을 인물과 연결해 보고 마지막 말을 나눈다.'
  ];
  const EVENT_NAMES = { 'blocked-search': '봉쇄된 원본 열람', 'investigate-pass': '공식 수사 넘김', 'identity-guess': '정체 추정 메모', 'initial-clue': '처음 받은 관찰', 'role-seen': '역할 확인', memory: '기억 복원', report: '봉인 제보', suggest: '정체 추정 메모', guard: '기록 보호', seal: '기록 봉쇄', 'seal-result': '봉쇄 결과', question: '공식 질문', answer: '공식 답변', unknown: '미진술', 'blocked-question': '전달되지 않은 질문', search: '원본 기록 수사', audit: '진술 검증', 'review-audit': '현재 답변 검증', 'round-confirm': '하루의 검토 완료', accusation: '최종 고발', pass: '행동 넘김', 'secret-pass': '개인행동 넘김', note: '자유 발언' };
  const PHASES = { reveal: '역할 확인', secret: '개인행동', investigate: '공식 수사', answer: '공식 답변', discussion: '답변·기록 검토', final: '최종 고발', finished: '사건 종료' };
  function create(config) {
    config = config || {};
    const D = config.data, esc = config.esc || (value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    if (!D) throw new TypeError('7일 사건의 공개 자료가 필요합니다.');
    const drafts = config.drafts || Object.create(null), marked = { person: new Set(), place: new Set(), tool: new Set(), time: new Set() };
    let boardTab = 'person', detailSelection = null, sealNotice = null, selectedTab = 'question', replayDay = 'all', replayStep = 0, cueKey = '', storyCase = '', endingShown = '', modalSignature = '', typedKey = '', handles = [];
    const typed = new Set(), readNotices = new Set();
    const getGame = () => config.getGame?.(), getRoom = () => config.getRoom?.(), pending = () => !!config.isPending?.();
    const current = () => config.getModalKind?.() || '';
    const isMine = g => !!g?.self && g.turnOwnerId === g.self.id;
    const role = id => D.ROLES[id]?.label || ({ detective: '탐정', witness: '목격자', culprit: '범인', accomplice: '공범', suspect: '용의자' }[id] || '참가자');
    const category = id => D.CATEGORIES.find(c => c.id === id), person = id => D.SUSPECTS.find(p => p.id === id), location = id => D.PLACES.find(p => p.id === id);
    const personName = id => person(id)?.name || '미기록 인물', placeName = id => location(id)?.name || '미기록 장소';
    const memberName = (g, id) => (g.phase === 'finished' ? g.reveal?.players || g.players || [] : g.players || []).find(p => p.id === id)?.name || '참가자';
    const day = g => 'DAY-' + String(g.round).padStart(2, '0');
    const read = id => config.read ? config.read(id) : typeof document !== 'undefined' ? document.getElementById(id)?.value || '' : '';
    const disabled = value => value || pending() ? ' disabled' : '';
    const button = (action, text, extra, off) => '<button class="btn compact ' + (extra?.includes('data-danger') ? 'danger' : 'outline') + '" data-action="seven-' + action + '"' + (extra || '') + disabled(off) + '>' + text + '</button>';
    const field = (id, label, entries, selected) => '<label class="field"><span>' + esc(label) + '</span><select id="' + id + '" data-draft="' + id + '">' + entries.map(p => '<option value="' + esc(p.id) + '"' + (String(p.id) === String(drafts[id] ?? selected) ? ' selected' : '') + '>' + esc(p.label || p.name) + '</option>').join('') + '</select></label>';
    function catText(id, value) { const c = category(id); return c ? c.label + ' · ' + (c.values[value] ?? '미확인') : '미기록 관찰'; }
    function truth(g, id) {
      const c = category(id), secret = g.caseSecret || g.reveal?.secretNPC || g.reveal?.secret;
      if (!c || !secret) return undefined;
      if (D.caseValue) { try { return D.caseValue(secret, id); } catch (_) { return undefined; } }
      if (c.group === 'person') return person(secret.suspectId)?.[id];
      if (c.group === 'place') return location(secret.placeId)?.[id];
      if (c.group === 'tool') return D.TOOLS.findIndex(t => t.id === secret.toolId);
      if (c.group === 'time') return D.TIMES.findIndex(t => t.id === secret.timeId);
      return undefined;
    }
    function known(g, id) {
      const privateClue = (g.self?.clues || []).find(f => f.category === id);
      if (privateClue) return privateClue.value;
      const fact = (g.facts || []).find(f => f.category === id && (Number.isInteger(f.value) || f.allowedValues?.length === 1));
      if (fact) return Number.isInteger(fact.value) ? fact.value : fact.allowedValues[0];
      return (g.statements || []).find(s => s.category === id && s.audited && s.isTrue)?.value;
    }
    function art(kind, id, label) {
      const index = (kind === 'person' ? D.SUSPECTS : kind === 'place' ? D.PLACES : kind === 'time' ? D.TIMES : D.TOOLS).findIndex(item => item.id === id);
      return '<div class="seven-art seven-art-' + kind + '" data-sprite-index="' + Math.max(0, index) + '" role="img" aria-label="' + esc(label) + '">' + (kind === 'time' ? '<span class="seven-time-overlay">' + esc(D.TIMES[index]?.name || '') + '</span>' : '') + '</div>';
    }
    function traits(item, group) {
      return D.CATEGORIES.filter(c => c.group === group && Number.isInteger(item[c.id])).map(c => '<span>' + esc(c.label) + ' <b>' + esc(c.values[item[c.id]]) + '</b></span>').join('');
    }
    function candidates(g) { try { return D.candidates(g) || []; } catch (_) { return []; } }
    function finalPeople(g) {
      const possible = candidates(g).filter(c => (g.self?.clues || []).every(clue => { try { return D.caseValue ? D.caseValue(c, clue.category) === clue.value : category(clue.category)?.group !== 'person' || person(c.suspectId)?.[clue.category] === clue.value; } catch (_) { return false; } }));
      const ids = new Set(possible.map(c => c.suspectId));
      return D.SUSPECTS.filter(p => ids.has(p.id));
    }
    function links(g, kind, id) {
      const row = kind === 'person' ? g.fieldReference?.people?.find(p => p.suspectId === id) : kind === 'place' ? g.fieldReference?.places?.find(p => p.placeId === id) : null;
      if (!row) return '';
      const routes = Array.isArray(row.routes) && row.routes.length ? '<details class="seven-source-group seven-route-group"><summary>함께 대조할 기록 조합 <b>' + row.routes.length + '</b>개</summary><p class="case-caption">한 행의 장소·도구·시간을 하나의 가능 조합으로 함께 대조합니다. 아래의 항목별 범위는 이 조합들을 넓게 묶은 목록입니다.</p><div class="seven-world-table seven-route-table"><table><thead><tr><th>출입 가능 장소</th><th>취급 가능 도구</th><th>근무 가능 시간</th></tr></thead><tbody>' + row.routes.map(route => '<tr><td>' + esc(placeName(route.placeId)) + '</td><td>' + esc(D.TOOLS.find(t => t.id === route.toolId)?.name || '미기록') + '</td><td>' + esc(D.TIMES.find(t => t.id === route.timeId)?.name || '미기록') + '</td></tr>').join('') + '</tbody></table></div></details>' : '';
      return '<div class="seven-source-links"><small>출입·취급·근무 기록에 등재된 전체 가능 범위</small><p class="case-caption">목록 밖은 기록과 양립하지 않습니다. 목록 안이어도 실제 방문·사용·현장 체류가 확인되는 것은 아닙니다.</p>' + routes + [['placeIds', '출입 가능 장소', placeName], ['toolIds', '취급 가능 도구', id => D.TOOLS.find(t => t.id === id)?.name || '미기록'], ['timeIds', '근무 가능 시간', id => D.TIMES.find(t => t.id === id)?.name || '미기록']].filter(([key]) => Array.isArray(row[key])).map(([key, title, label]) => '<details class="seven-source-group"><summary>' + title + ' <b>' + row[key].length + '</b>개</summary><div class="seven-source-chips">' + row[key].map(value => '<span>' + esc(label(value)) + '</span>').join('') + '</div></details>').join('') + '<small>실제 사건의 좌표는 종료 후에만 공개됩니다.</small></div>';
    }
    function sourceDescription(record) {
      if (record.id === 'tool') return '여러 도구가 양립하는 복수 가능성 부분 기록입니다. 취급 범위·진술과 함께 대조하며 실제 사용을 확정하지 않습니다.';
      if (record.id === 'time') return '여러 사건 시간 구간이 양립하는 복수 가능성 부분 기록입니다. 근무 범위·진술과 함께 대조하며 현장 체류를 확정하지 않습니다.';
      return record.description || '';
    }
    function recordText(f) {
      if (typeof f.isTrue === 'boolean') return '해당 공식 진술은 ' + (f.isTrue ? '참' : '거짓') + '으로 검증됨';
      const c = category(f.category); if (!c) return f.text || '부분 원본 기록';
      const values = f.allowedValues || (Number.isInteger(f.value) ? [f.value] : []);
      return c.label + ' · ' + (values.length ? values.map(v => c.values[v] ?? '미기록').join(' 또는 ') : '아직 미확인');
    }
    function directions(g) {
      if (g.players.length <= 2) return '';
      const entries = (g.suggestions || []).filter(s => category(s.category));
      return '<section class="seven-directions"><h3>수사 방향 제안 <small>참가자가 공개한 제안 · 확정 증거 아님</small></h3>' + (entries.length ? entries.map(s => '<article class="record-card"><small>' + day({ round: s.round }) + ' · ' + esc(memberName(g, s.speakerId)) + '</small><p>' + esc(category(s.category).label) + ' 수사 제안</p>' + (s.text ? '<p>' + esc(s.text) + '</p>' : '') + '</article>').join('') : '<p class="case-caption">아직 공개된 수사 방향 제안이 없습니다.</p>') + '</section>';
    }
    function records(g) {
      return '<section class="seven-records">' + directions(g) + '<h3>공식 증거 <small>공개 원본·검증</small></h3>' + ((g.facts || []).length ? g.facts.map(f => '<article class="record-card"><small>' + day({ round: f.round || 1 }) + ' · ' + esc(({ record: '부분 원본 기록', search: '부분 원본 기록', audit: '진술 검증', share: '관찰 공개' }[f.source] || '공식 기록')) + (f.recordId ? ' / ' + esc(D.RECORDS.find(r => r.id === f.recordId)?.label || '원본') : '') + '</small><p>' + esc(recordText(f)) + '</p></article>').join('') : '<p class="empty">아직 공개된 공식 증거가 없습니다.</p>') + '<h3>공식 진술 <small>검증 전에는 참 또는 거짓</small></h3>' + ((g.statements || []).length ? g.statements.map(s => '<article class="record-card claim' + (s.audited && s.isTrue === false ? ' seven-verified-lie' : '') + '"><small>' + day({ round: s.round || 1 }) + ' · ' + esc(memberName(g, s.speakerId)) + '</small><p>' + esc(catText(s.category, s.value)) + '</p><b>' + (s.audited ? s.isTrue ? '검증된 참 진술' : '검증된 거짓 진술' : '미검증 진술') + '</b></article>').join('') : '<p class="empty">아직 공식 진술이 없습니다.</p>') + '</section>';
    }
    function roster(g) {
      return '<div class="seven-roster" aria-label="닉네임 참가자 프로필">' + g.players.map((p, i) => '<article class="seven-profile"><span class="seven-anonymous" aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span><div><strong>' + esc(p.name) + '</strong><small>' + (p.isDetective || p.id === g.detectiveId ? '공개 역할 · 탐정' : '비공개 역할') + '</small></div>' + (p.id === g.turnOwnerId ? '<span class="tag">현재 차례</span>' : '') + '</article>').join('') + '</div>';
    }
    function pencilX() { return '<svg class="seven-pencil-x" viewBox="0 0 100 100" aria-hidden="true"><path d="M14 12 87 88M12 17 84 89M85 12 12 87M88 15 17 89"/></svg>'; }
    function constrained(g, kind, id) {
      const key = ({ person: 'suspectId', place: 'placeId', tool: 'toolId', time: 'timeId' })[kind], possible = candidates(Object.assign({}, g, { self: undefined }));
      return possible.length > 0 && !possible.some(c => c[key] === id);
    }
    function board(g, kind, items, title) {
      const possible = candidates(Object.assign({}, g, { self: undefined })), key = ({ person: 'suspectId', place: 'placeId', tool: 'toolId', time: 'timeId' })[kind], ids = new Set(possible.map(c => c[key]).filter(Boolean));
      return '<section class="seven-board"><div class="divider-title"><h2>' + title + '</h2><span class="tag">' + items.length + (kind === 'person' ? '명' : '개') + '의 공개 자료</span></div><div class="seven-grid seven-grid-' + kind + '">' + items.map((item, i) => { const excluded = ids.size > 0 && !ids.has(item.id), memo = marked[kind].has(item.id); return '<button class="seven-card seven-card-' + kind + (memo ? ' is-marked' : '') + (excluded ? ' is-constrained' : '') + '" data-seven-' + kind + '="' + esc(item.id) + '" data-action="seven-card-detail" data-kind="' + kind + '" data-id="' + esc(item.id) + '" aria-haspopup="dialog" aria-label="' + esc(item.name) + ' 상세 자료' + (excluded ? ' · 확인한 기록과 불일치' : memo ? ' · 나의 제외 메모' : '') + '">' + art(kind, item.id, item.name + ' 공개 자료') + (excluded || memo ? pencilX() : '') + '<div class="seven-card-info"><small>' + ({ person: 'PERSON', place: 'PLACE', tool: 'TOOL', time: 'TIME' })[kind] + ' ' + String(i + 1).padStart(2, '0') + '</small><strong>' + esc(item.name) + '</strong><span class="seven-mark-label">' + (excluded ? '확인한 기록과 불일치' : memo ? '나의 제외 메모' : '상세 자료 보기') + '</span></div></button>'; }).join('') + '</div></section>';
    }
    function notebook(g) {
      const catalog = { person: D.SUSPECTS, place: D.PLACES, tool: D.TOOLS, time: D.TIMES }, titles = { person: '사건 인물', place: '사건 장소', tool: '도구의 흔적', time: '사건 시간대' };
      return '<section class="seven-notebook"><header class="seven-notebook-heading"><small>CASE RECORDS / PUBLIC NOTEBOOK</small><h2>사건기록 수첩</h2><p>사진을 누르면 특징과 연결 자료를 자세히 확인합니다.</p></header><nav class="seven-notebook-tabs" aria-label="사건기록 분류">' + [['person','인물'],['place','장소'],['tool','도구'],['time','시간']].map(([id,label]) => '<button data-action="seven-board-tab" data-id="' + id + '" aria-pressed="' + (boardTab === id) + '">' + label + '<small>' + catalog[id].length + '</small></button>').join('') + '</nav><div class="seven-notebook-body">' + board(g, boardTab, catalog[boardTab], titles[boardTab]) + (boardTab === 'time' ? '<p class="notice seven-time-context">사건 당일 18:00–21:00의 15분 구간입니다. DAY-01–07은 사건 이후의 수사일이며, 이 시간 카드와 별개입니다.</p>' : '') + '<p class="manual-note-legend">회색 사진과 붉은 연필 X는 제외 표시입니다. 상세 자료에서 공식 제외와 나의 추정 메모를 구분해 확인하세요.</p></div></section>';
    }
    function detail(g) {
      if (!detailSelection) return '';
      const { kind, id } = detailSelection, item = (kind === 'person' ? D.SUSPECTS : kind === 'place' ? D.PLACES : kind === 'tool' ? D.TOOLS : D.TIMES).find(p => p.id === id);
      if (!item) return '';
      const excluded = constrained(g, kind, id), memo = marked[kind].has(id);
      return '<article class="seven-detail"><div class="seven-detail-art' + (excluded || memo ? ' is-excluded' : '') + '">' + art(kind, id, item.name + ' 상세 공개 자료') + (excluded || memo ? pencilX() : '') + '</div><div class="seven-detail-info"><small>PUBLIC REFERENCE / 공개 사건 자료</small><h3>' + esc(item.name) + '</h3>' + (item.job ? '<p>' + esc(item.job) + '</p>' : '') + '<div class="seven-traits">' + (kind === 'person' ? traits(item, 'person') : kind === 'place' ? traits(item, 'place') : esc(item.description || item.detail || (kind === 'tool' ? '취급 가능 범위와 복수 가능성 부분 기록을 대조하는 도구입니다. 실제 사용이 확인되었다는 뜻은 아닙니다.' : '근무 가능 범위와 복수 가능성 부분 기록을 대조하는 시간 구간입니다. 실제 현장 체류가 확인되었다는 뜻은 아닙니다.'))) + '</div>' + links(g, kind, id) + (kind === 'time' ? '<p class="notice">이 카드는 사건 당일 18:00–21:00 안의 15분 구간입니다. 수사일 DAY-01–07을 뜻하지 않습니다. 정확한 시간은 카드의 문자 표기를 기준으로 대조하세요.</p>' : '') + '<p class="notice">' + (excluded ? '확인한 기록과 불일치하여 현재 사건 후보에서 제외됩니다. 최종 고발에서는 나의 참 관찰까지 함께 반영해 남은 후보를 표시합니다.' : '확인한 공개 기록만으로는 아직 제외되지 않은 항목입니다.') + '</p><p class="case-caption">나의 제외 메모는 개인적인 추정이며 공식 증거와 구분됩니다. 메모를 바꿔도 공식 기록과 최종 후보 계산은 바뀌지 않습니다.</p>' + button('mark', memo ? '내 제외 메모 해제' : '내 제외 메모 표시', ' data-kind="' + kind + '" data-id="' + esc(id) + '"') + '</div></article>';
    }
    function render(g, room) {
      if (!g) return '';
      return '<div class="seven-game"><header class="online-section-title"><div><div class="eyebrow">' + (room?.code ? 'ROOM ' + esc(room.code) + ' / ' : '') + day(g) + ' / SEVEN DAYS</div><h1>7일의 기록, 마지막 목격자.</h1><p class="case-caption">역할과 사건 인물은 따로 배정됩니다. 공개 프로필에는 닉네임만 남습니다.</p></div><span class="seven-day-badge">' + g.round + '<small> / 7 DAYS</small></span></header>' + roster(g) + '<section class="seven-turn"><div><small>' + day(g) + ' · ' + esc(PHASES[g.phase] || g.phase) + '</small><h2>' + (isMine(g) ? '지금, 나의 차례입니다.' : esc(memberName(g, g.turnOwnerId)) + '님의 차례') + '</h2><p>' + (g.phase === 'final' ? '7일 수사와 검토가 끝났습니다. 탐정이 사건 인물 한 명을 최종 고발합니다.' : '개인행동 → 탐정의 공식 수사 1회 → 답변·검토 → 하루 확인') + '</p></div>' + button('personal', '나의 수첩 · 행동 열기') + button('ledger', '공식 수사기록') + '</section><div class="seven-resource-strip"><span>공식 수사 <b>하루 1회</b></span><span>진술 검증 <b>' + g.kits + ' / 1</b></span><span>공유 거짓 예산 <b>전체 2회</b></span><span>최종 고발 <b>사건 인물 1명</b></span></div><div class="seven-layout"><div>' + notebook(g) + '<p class="manual-note-legend">제외 표시는 이 기기의 추정 메모입니다. 역할 주장과 정체 추정은 공식 인증이나 면죄부가 되지 않습니다.</p></div><aside class="side-panel seven-side"><div class="eyebrow">SHARED PUBLIC RECORD</div><h2>함께 남긴 기록</h2><p>원본 수사는 기록의 일부를 보여 줍니다. 공식 답변은 검증하기 전까지 참과 거짓 모두 가능하며, 봉쇄·유보된 질문은 다시 물을 수 있습니다.</p>' + records(g) + button('ledger', '기록과 질문 이력 모두 보기') + button('clear-marks', '나의 제외 메모 초기화') + '</aside></div></div>';
    }
    function identity(g) {
      const self = g.self, id = self.identity || {}, knownId = id.known && person(id.characterId) ? id.characterId : null;
      if (knownId) return '<section class="seven-identity is-known"><div class="seven-identity-art">' + art('person', knownId, '내가 확인한 사건 인물') + '</div><div><small>PRIVATE IDENTITY / 확정된 나의 인물</small><h3>' + esc(personName(knownId)) + '</h3><p>이 정체는 나만 확인합니다. 나의 역할 주장이나 정체 메모를 공개해도 공식 인증·면죄부가 되지 않습니다.</p></div></section>';
      return '<section class="seven-identity"><div class="seven-identity-anonymous" role="img" aria-label="아직 확인하지 못한 나의 정체"></div><div><small>PRIVATE IDENTITY</small><h3>정체 미확인</h3><p>나의 인물 후보 <b>' + (id.candidates || []).length + '명</b> · 기억 복원 남음 <b>' + (id.memoryLeft ?? 0) + '회</b></p><div class="seven-identity-candidates">' + (id.candidates || []).map(candidate => '<span class="tag">' + esc(personName(candidate)) + '</span>').join('') + '</div><p>후보 중에 범인이 반드시 있다는 보장은 없습니다. 정체 추정은 공식 인증이나 면죄부가 아닙니다.</p></div></section>';
    }
    function clues(g) {
      return '<section class="seven-private-clues"><h3>나의 관찰 자료 <small>이 화면에만 보이는 단서</small></h3>' + ((g.self.clues || []).length ? g.self.clues.map(c => '<p class="seven-clue">' + esc(catText(c.category, c.value)) + '</p>').join('') : '<p class="empty">내가 확실히 진술할 관찰은 아직 없습니다. 모르는 항목은 미진술합니다.</p>') + '</section>';
    }
    function identityHistory(g) {
      if (g.self.role !== 'suspect') return '';
      const self = g.self, passed = g.round > 6 || g.round === 6 && (g.phase !== 'secret' || Number.isInteger(g.turnIndex) && g.turnIndex > g.players.findIndex(p => p.id === self.id));
      return '<section class="seven-identity-history"><h3>나의 비공개 추적 기록</h3>' + ((self.identity?.memory || []).map(m => '<p class="seven-clue">DAY-' + String(m.round).padStart(2, '0') + ' 기억 복원 · 남은 후보 ' + esc(m.candidates.map(personName).join(', ')) + '</p>').join('') || '<p class="case-caption">아직 기억 복원 기록이 없습니다.</p>') + (self.identityGuess ? '<p>나의 현재 정체 추정: <b>' + esc(personName(self.identityGuess.suspectId)) + '</b> · 개인 메모</p>' : '') + (self.sealedReport ? '<article class="seven-action-card"><h4>DAY-' + String(self.sealedReport.round).padStart(2, '0') + ' 봉인 제보 완료</h4><p>' + esc(personName(self.sealedReport.suspectId)) + ' · ' + esc(self.sealedReport.text) + '</p><small>접수된 내용만 확인할 수 있습니다. 수정·철회·정답 응답은 없습니다.</small></article>' : '<p class="notice">' + (passed ? '봉인 제보 마감 · 이번 사건에는 제보를 남기지 않았습니다.' : '봉인 제보 마감은 DAY-06 나의 개인행동 종료입니다. 접수 기회가 ' + (g.round === 6 ? '오늘 한 번' : '남아') + ' 있습니다.') + '</p>') + '</section>';
    }
    function reportAvailable(g) { return g.self?.role === 'suspect' && g.phase === 'secret' && isMine(g) && g.round <= 6 && !g.self.sealedReport; }
    function secretControls(g) {
      if (!isMine(g) || g.phase !== 'secret') return '<p class="notice">나의 개인행동 차례에 선택할 수 있습니다. 자유 발언은 모든 단계에서 가능합니다.</p>';
      const self = g.self, select = field('seven-secret-category', '기록 항목', D.CATEGORIES);
      let html = '<section class="seven-actions"><h3>오늘의 개인행동 <small>한 가지 선택</small></h3>';
      if (self.role === 'suspect') {
        html += '<div class="seven-action-card"><h4>나의 기억 복원</h4><p>누구도 봉쇄할 수 없는 개인 기억입니다. 3명 → 2명 → 1명, 두 번의 행동으로 나의 정체를 확인합니다.</p>' + button('memory', '기억을 복원한다 · 남은 ' + (self.identity?.memoryLeft ?? 0) + '회', '', !(self.identity?.memoryLeft > 0)) + '</div>';
        html += '<div class="seven-action-card"><h4>진범 봉인 제보 · 단 한 번</h4><p>DAY-06 나의 개인행동이 끝나기 전, 사건 인물과 이유를 봉인합니다. 제출 후 수정·철회·정답 응답은 없습니다. 나 자신이나 미배정 인물도 같은 방식으로 접수합니다.</p>';
        if (self.sealedReport) html += '<div class="notice">DAY-' + String(self.sealedReport.round).padStart(2, '0') + ' 제보 봉인 완료 · ' + esc(personName(self.sealedReport.suspectId)) + '<p>' + esc(self.sealedReport.text) + '</p></div>';
        else if (g.round > 6) html += '<p class="notice">봉인 제보가 마감되었습니다.</p>';
        else html += field('seven-report-person', '제보할 사건 인물', D.SUSPECTS) + '<label class="field"><span>제보 이유</span><textarea id="seven-report-reason" data-draft="seven-report-reason" maxlength="300" placeholder="당신이 추적한 근거를 남겨 주세요.">' + esc(drafts['seven-report-reason'] || '') + '</textarea></label>' + button('report-submit', '이 인물과 이유를 한 번만 봉인 제출', ' data-mutate');
        html += '</div><div class="seven-action-card"><h4>나의 정체 추정 메모</h4><p>나의 개인행동 차례마다 새 추정으로 수정할 수 있습니다. 오늘의 행동을 1회 사용하며, 본인 캐릭터 확인이나 결백 인증이 되지 않습니다.</p>' + field('seven-identity-guess', '추정하는 나의 인물', D.SUSPECTS, self.identityGuess?.suspectId) + button('identity-guess', '오늘의 행동으로 정체 추정 기록') + '</div>';
        html += '<div class="seven-action-card"><h4>기록 보호 · 남은 ' + (self.guardLeft ?? 0) + '회</h4>' + select + button('guard', '오늘 이 항목을 봉쇄에서 보호', '', !self.guardLeft) + '</div>';
      } else if (['culprit', 'accomplice'].includes(self.role)) html += '<div class="seven-action-card"><h4>기록 봉쇄 · 남은 ' + (self.sabotageLeft ?? 0) + '회</h4><p>오늘의 해당 항목 질문·수사를 막을 수 있습니다. 이미 공개된 공식 증거는 변하지 않습니다.</p>' + select + button('seal', '이 항목의 기록을 봉쇄', '', !self.sabotageLeft) + '</div>';
      else if (g.players.length > 2) html += '<div class="seven-action-card"><h4>수사 방향 제안</h4><p>알아보고 싶은 기록 항목을 공개 수첩에 제안합니다. 원본 증거로 확정되지는 않습니다.</p>' + select + button('suggest', '이 항목의 수사를 제안') + '</div>';
      return html + button('secret-pass', '개인행동을 넘기고 다음 차례로') + '</section>';
    }
    function answerControls(g) {
      const q = g.pending; if (!q || !isMine(g) || g.phase !== 'answer') return '';
      const c = category(q.category); if (!c) return '<p>현재 질문 항목을 확인할 수 없습니다.</p>';
      const criminal = ['culprit', 'accomplice'].includes(g.self.role), legal = g.self.answerOptions?.legalValues, value = criminal ? truth(g, c.id) : legal?.find(v => Number.isInteger(v)) ?? known(g, c.id);
      return '<section class="seven-question-paper"><small>' + day(g) + ' / 탐정의 현재 질문</small><h3>“' + esc(c.label) + '에 관해, ' + esc(c.values[q.proposedValue]) + '라는 진술이 맞습니까?”</h3><p class="seven-hand" data-seven-typed>' + esc(memberName(g, g.detectiveId) + ': ' + g.self.name + ' 씨, 이번 사건에서 알고 있는 관찰을 공식 답변으로 남겨 주세요.') + '</p><p>' + (criminal ? '범인·공범의 공유 거짓 남음 ' + g.remainingLies + '회 · 공유 답변 유보 남음 ' + (g.remainingRefusals ?? 0) + '회' : Number.isInteger(value) ? '아는 관찰에 근거한 참 답변만 남길 수 있습니다.' : '이 항목은 내가 확인한 관찰에 없습니다. 미진술로 남깁니다.') + '</p><div class="seven-answer-options">' + c.values.map((text, i) => button('answer', esc(text) + (criminal ? i === value ? ' · 참' : ' · 거짓 예산 사용' : i === value ? ' · 내가 아는 관찰' : ''), ' data-value="' + i + '"', legal ? !legal.includes(i) : criminal ? i !== value && !(g.remainingLies > 0) : i !== value)).join('') + button('answer', criminal ? '답변 유보 · 공유 1회' : '관찰 없음 · 미진술', ' data-value="unknown"', legal ? !legal.includes(null) : criminal ? !(g.remainingRefusals > 0) : Number.isInteger(value)) + '</div><p class="case-caption">공식 답변은 모두의 기록에 남습니다. 자유 발언과 역할 주장은 별도의 대화입니다.</p></section>';
    }
    function investigation(g) {
      const detective = g.self.role === 'detective' && isMine(g) && g.phase === 'investigate';
      if (!detective) return '';
      let html = '<section class="seven-actions"><h3>탐정의 공식 수사 <small>오늘 1회</small></h3>' + directions(g) + '<div class="seven-tabs">' + [['question', '공식 질문'], ['search', '원본 수사'], ['audit', '진술 검증']].map(([id, label]) => button('tab', label, ' data-id="' + id + '" aria-pressed="' + (selectedTab === id) + '"')).join('') + '</div>';
      if (selectedTab === 'question') {
        const catId = drafts['seven-question-category'] || D.CATEGORIES[0].id, c = category(catId) || D.CATEGORIES[0];
        html += '<p>아직 풀리지 않은 질문, 봉쇄되거나 유보된 질문도 다시 물을 수 있습니다.</p><div class="form-grid">' + field('seven-question-target', '공식 답변을 요청할 닉네임', g.players.filter(p => p.id !== g.self.id)) + field('seven-question-category', '질문할 관찰 항목', D.CATEGORIES, c.id) + field('seven-question-proposed', '확인하려는 진술', c.values.map((name, id) => ({ id, name }))) + '</div>' + button('question', '이 진술을 공식 질문한다');
      } else if (selectedTab === 'search') html += '<p>원본 기록의 일부를 확보합니다. 기록 하나가 사건의 전체 정답을 알려 주지는 않습니다.</p><div class="seven-record-options">' + D.RECORDS.map(r => '<article class="seven-action-card"><h4>' + esc(r.label) + '</h4><p>' + esc(sourceDescription(r)) + '</p>' + button('search', '이 원본 기록 수사', ' data-id="' + esc(r.id) + '"') + '</article>').join('') + '</div>';
      else html += '<p>공용 검증 도구 1개를 사용해 공식 진술의 참·거짓만 확인합니다. 정답값은 직접 공개되지 않습니다.</p>' + ((g.statements || []).filter(s => !s.audited).map(s => '<article class="seven-action-card"><p>' + esc(memberName(g, s.speakerId) + ' · ' + catText(s.category, s.value)) + '</p>' + button('audit', '이 공식 진술 검증', ' data-id="' + esc(s.id) + '"', !g.kits) + '</article>').join('') || '<p class="empty">검증할 미확인 진술이 없습니다.</p>');
      return html + button('investigate-pass', '오늘의 공식 수사를 넘긴다') + '</section>';
    }
    function personal(g, visible) {
      if (!g?.self || g.phase === 'finished') return '';
      if (!visible) return '<section class="seven-private-lock"><div class="seven-lock-art"></div><small>' + day(g) + ' / 나만 보는 수첩</small><h3>주변에 다른 화면이 보이지 않나요?</h3><p>내 역할, 정체 후보와 관찰 자료를 엽니다. 화면을 벗어나면 다시 가려집니다.</p>' + button('private-show', '내 비밀 수첩 확인') + '</section>';
      const self = g.self, criminal = ['culprit', 'accomplice'].includes(self.role);
      const roleCopy = { detective: '일곱 날의 수사와 검토 후 사건 인물 한 명을 고발합니다.', witness: '부분 기억을 바탕으로 관찰한 사실을 전합니다.', culprit: '나의 사건 인물이 실제 진범입니다. 탐정의 최종 고발을 피하세요.', accomplice: '범인과 사건의 진실을 공유합니다. 범인 진영과 함께 움직입니다.', suspect: '독립 역할입니다. 내 정체를 찾아가며 진범을 비밀 제보하세요. 탐정에게 실제 나의 인물이 고발되면 개인 패배가 우선합니다.' }[self.role] || '';
      return '<div class="seven-private"><header class="seven-private-head"><small>' + day(g) + ' / ' + esc(PHASES[g.phase]) + '</small><h2>' + esc(self.name) + ' · ' + esc(role(self.role)) + '</h2><p>' + esc(roleCopy) + '</p></header>' + identity(g) + identityHistory(g) + clues(g) + (criminal && g.caseSecret ? '<section class="seven-crime-brief"><h3>범인 진영에만 전달된 진상</h3><p>' + esc(personName(g.caseSecret.suspectId)) + ' / ' + esc(placeName(g.caseSecret.placeId)) + ' / ' + esc(D.TOOLS.find(t => t.id === g.caseSecret.toolId)?.name) + ' / ' + esc(D.TIMES.find(t => t.id === g.caseSecret.timeId)?.name) + '</p><p>함께하는 닉네임: ' + esc((g.partnerIds || []).map(id => memberName(g, id)).join(', ') || '없음') + '</p></section>' : '') + (self.role === 'suspect' ? '<p class="notice">나의 인물이 최종 고발되면 제보 결과와 무관하게 개인 패배입니다. 그 밖에는 정확 제보만 개인 승리, 오제보·미제보는 생존·목표 미달입니다. 범인과 용의자는 동시 승리할 수 있습니다.</p>' : '') + (g.phase === 'reveal' && isMine(g) ? button('role-seen', '내 역할과 목표를 확인했습니다') : '') + (g.phase === 'answer' ? answerControls(g) : '') + secretControls(g) + investigation(g) + (g.phase === 'discussion' && self.role === 'detective' ? button('review', '도착한 답변·기록 검토') : '') + (g.phase === 'final' && self.role === 'detective' ? accuse(g) : '') + '</div>';
    }
    function review(g) {
      if (g.phase !== 'discussion' || g.self?.role !== 'detective') return '';
      const r = g.review || { kind: 'pass' }, statement = (g.statements || []).find(s => s.id === r.statementId), verdict = r.verified ? r.isTrue ?? statement?.isTrue : undefined;
      let text = r.kind === 'answer' ? memberName(g, r.targetId) + ': ' + catText(r.category, r.value) + '라고 진술합니다.' : r.kind === 'unknown' ? '답변자가 이 항목의 관찰을 남기지 않았습니다. 미진술은 거짓 판정이 아니며 다시 질문할 수 있습니다.' : r.kind === 'blocked' ? '누군가 오늘의 기록을 봉쇄했습니다. 이미 공개된 증거는 바뀌지 않습니다. 다른 경로를 선택하거나 다음 날 다시 수사할 수 있습니다.' : r.kind === 'search' ? '원본 기록에서 다음 범위가 확인되었습니다. ' + recordText(r) : r.kind === 'audit' ? '선택한 진술의 참·거짓 검증 결과가 도착했습니다.' : '오늘의 공식 수사를 마쳤습니다. 남은 이야기를 나누고 하루의 검토를 확인해 주세요.';
      const isLie = verdict === false || r.kind === 'audit' && r.isTrue === false;
      return '<section class="seven-review' + (isLie ? ' is-verified-lie' : '') + '"><small>' + day(g) + ' / 도착한 수사 결과</small><h3>' + esc(({ answer: '공식 답변', unknown: '남지 않은 진술', blocked: '봉쇄된 기록', search: '부분 원본 기록', audit: '진술 검증 결과', pass: '오늘의 수사 기록' })[r.kind] || '공식 결과') + '</h3>' + (r.category && Number.isInteger(r.proposedValue) ? '<p>탐정이 확인한 진술: ' + esc(catText(r.category, r.proposedValue)) + '</p>' : '') + '<p class="seven-hand" data-seven-typed>' + esc(text) + '</p>' + (typeof verdict === 'boolean' || r.kind === 'audit' && typeof r.isTrue === 'boolean' ? '<div class="seven-verdict">' + (isLie ? '거짓으로 검증된 공식 진술' : '참으로 검증된 공식 진술') + '<small>검증은 이 진술의 참·거짓만 확정합니다.</small></div>' : '<p class="case-caption">' + (r.kind === 'answer' ? '아직 검증되지 않은 공식 진술입니다.' : '원본 기록과 미진술·봉쇄의 뜻을 구분해 검토하세요.') + '</p>') + '<div class="case-review-actions">' + (r.kind === 'answer' && !r.verified && !statement?.audited ? button('review-audit', '공용 도구로 지금 답변 검증 · ' + g.kits + '개 남음', '', !g.kits) : '') + button('round-confirm', g.round === 7 ? '검토를 마치고 최종 고발로' : '검토를 마치고 DAY-' + String(g.round + 1).padStart(2, '0') + '로') + '</div></section>';
    }
    function ledger(g) {
      return '<div class="seven-ledger"><p class="notice">공식 원본은 변경되지 않습니다. 검증 전 진술, 개인 관찰과 자유 발언은 같은 의미가 아닙니다. 역할 주장은 결백을 인증하지 않습니다.</p>' + records(g) + '<h3>공식 질문·원본 열람 이력</h3>' + ((g.questionHistory || []).map(q => {
        const source = q.recordId ? D.RECORDS.find(r => r.id === q.recordId) : null;
        const label = q.recordId ? '원본 열람 · ' + (source?.label || '기록된 원본') : '공식 질문 · ' + memberName(g, q.targetId);
        const observation = q.recordId ? category(q.category)?.label || '원본 기록' : Number.isInteger(q.proposedValue) ? catText(q.category, q.proposedValue) : (category(q.category)?.label || '관찰 항목') + ' · 당시 확인 문구 미기록';
        const status = q.recordId ? q.status === 'blocked' ? '봉쇄 · 다음 날 원본 재열람 가능' : '부분 원본 열람 완료' : ({ blocked: '봉쇄 · 다음 날 재질문 가능', unknown: '미진술 · 재질문 가능', answered: '답변 기록 있음', pending: '답변 대기' })[q.status] || '질문 기록';
        return '<article class="record-card"><small>' + day({ round: q.round || 1 }) + ' · ' + esc(label) + '</small><p>' + esc(observation) + '</p><b>' + esc(status) + '</b></article>';
      }).join('') || '<p class="empty">아직 공식 질문·원본 열람 이력이 없습니다.</p>') + '</div>';
    }
    function accuse(g) {
      if (g.phase !== 'final' || g.round !== 7 || g.self?.role !== 'detective' || !isMine(g)) return '';
      const remaining = finalPeople(g), selected = remaining.find(p => p.id === drafts.sevenAccusedPerson);
      return '<section class="seven-accuse"><h3>일곱 날의 끝 · 한 명을 고발하라</h3><p>장소·도구·시간의 연결 자료와 나의 참 관찰을 반영해 남은 인물만 표시합니다. 한 명의 사진 카드를 선택하고, 아래에서 마지막으로 확인하세요.</p><div class="seven-accuse-grid" role="group" aria-label="최종 고발할 인물 카드">' + remaining.map(p => '<button class="seven-accuse-card' + (selected?.id === p.id ? ' is-selected' : '') + '" data-action="seven-accuse-select" data-id="' + esc(p.id) + '" aria-pressed="' + (selected?.id === p.id) + '">' + art('person', p.id, p.name + ' 고발 후보 초상') + '<strong>' + esc(p.name) + '</strong><small>' + esc(p.job || '사건 인물') + '</small><span>' + (selected?.id === p.id ? '선택한 인물' : '사진을 눌러 선택') + '</span></button>').join('') + '</div>' + (selected ? '<section class="seven-accuse-confirm" aria-label="선택한 최종 고발 인물"><div class="seven-accuse-confirm-face">' + art('person', selected.id, '최종 고발로 선택한 ' + selected.name) + '</div><div><small>FINAL ACCUSATION / 최종 확인</small><h3>' + esc(selected.name) + '</h3><p>이 사건 인물 한 명을 진범으로 고발합니다. 확정 후에는 되돌릴 수 없으며 진상과 전체 배정이 공개됩니다.</p>' + button('accuse-submit', esc(selected.name) + ' · 최종 고발 확정', ' data-mutate data-danger') + '</div></section>' : '<p class="notice">' + (remaining.length ? '위의 인물 사진을 선택하면 큰 사진과 최종 확인 버튼이 열립니다.' : '현재 자료와 양립하는 인물이 없습니다. 기록을 다시 확인해 주세요.') + '</p>') + '</section>';
    }
    function neutralText(result) { return result?.status === 'win' ? 'WIN · 개인 승리' + (result.early || result.earlyTracking ? ' · 선제 추적' : '') : result?.status === 'loss' ? 'LOSE · 개인 패배' : 'SURVIVED · 생존 · 목표 미달'; }
    function neutralReason(r) {
      return ({ 'false-accusation': '실제 나의 인물이 최종 고발되어 개인 패배가 우선 적용되었습니다.', 'correct-report': '실제 나의 인물은 고발되지 않았으며, 봉인한 인물이 진범과 일치했습니다.', 'incorrect-report': '실제 나의 인물은 고발되지 않아 생존했지만, 봉인한 인물은 진범과 달랐습니다.', 'no-report': '실제 나의 인물은 고발되지 않아 생존했지만, 마감 전 봉인 제보를 남기지 않았습니다.' })[r?.reason] || '';
    }
    function ending(g) {
      if (g.phase !== 'finished' || !g.reveal) return '';
      const r = g.reveal, secret = r.secretNPC || r.secret;
      if (!secret) return '';
      const sPlayer = (r.players || []).find(p => p.role === 'suspect'), sResult = r.suspectResult;
      let text = '일곱 날의 기록이 마지막 장에 닿았습니다. 정윤재 사건의 진범은 ' + personName(secret.suspectId) + '. 실제 장소는 ' + placeName(secret.placeId) + ', 도구는 ' + (D.TOOLS.find(t => t.id === secret.toolId)?.name || '종료 기록의 도구') + ', 시간은 ' + (D.TIMES.find(t => t.id === secret.timeId)?.name || '종료 기록의 시간') + '이었습니다.\n\n';
      text += g.winner === 'investigators' ? '탐정의 고발이 진범에게 닿았습니다. 수사 진영이 승리했습니다.' : '탐정의 고발이 진범을 비껴갔습니다. 범인 진영이 승리했습니다.';
      if (sPlayer && sResult) {
        text += '\n\n독립 용의자 ' + sPlayer.name + '님은 ' + (sResult.status === 'loss' ? '본인 인물이 최종 고발되어 개인 패배했습니다.' : sResult.status === 'win' ? '진범을 봉인 제보해 개인 승리했습니다.' : '생존했지만 봉인 제보 목표를 달성하지 못했습니다.');
        if (sResult.status === 'win' && g.winner === 'criminals') text += ' 범인 진영과 독립 용의자가 함께 승리한 결말입니다.';
      }
      text += '\n\n이제 공개된 진상과 각자의 배정을 살펴보고, 질문과 기억이 어떻게 엇갈렸는지 사건 복기에서 되짚어 보세요.';
      return '<section class="seven-story seven-ending"><div class="seven-story-day">CASE CLOSED<small> / DAY-07</small></div><p class="seven-hand" data-seven-typed>' + esc(text) + '</p><div class="case-review-actions">' + button('ending-continue', '사건 결과와 복기 보기') + '</div></section>';
    }
    function worldRecords(g) {
      if (g.phase !== 'finished' || !g.reveal?.caseWorld) return '';
      const world = g.reveal.caseWorld;
      return '<details class="seven-world-records"><summary>종료 후 공개 · 전체 인물의 실제 동선과 원본</summary><p class="notice">이 표의 실제 좌표는 사건이 끝난 뒤에만 공개됩니다. 플레이 중의 연결 자료는 이보다 넓은 가능 범위를 보여 주었습니다.</p><div class="seven-world-table"><table><thead><tr><th>사건 인물</th><th>실제 장소</th><th>실제 도구</th><th>실제 시간</th><th>활동</th></tr></thead><tbody>' + (world.events || []).map(e => '<tr><th>' + esc(personName(e.suspectId)) + '</th><td>' + esc(placeName(e.placeId)) + '</td><td>' + esc(D.TOOLS.find(t => t.id === e.toolId)?.name || '미기록') + '</td><td>' + esc(D.TIMES.find(t => t.id === e.timeId)?.name || '미기록') + '</td><td>' + esc(e.activity || '기록') + '</td></tr>').join('') + '</tbody></table></div><h3>보존된 전체 원본 기록</h3>' + (world.records || []).map(r => '<article class="record-card"><small>' + esc(D.RECORDS.find(item => item.id === r.recordId)?.label || '원본 기록') + '</small><p>' + esc(recordText(r)) + '</p></article>').join('') + '</details>';
    }
    function result(g) {
      if (g?.phase !== 'finished' || !g.reveal) return '';
      const r = g.reveal, secret = r.secretNPC || r.secret, win = g.winner === 'investigators', sResult = r.suspectResult || g.suspectResult, sPlayers = (r.players || []).filter(p => p.role === 'suspect');
      if (!secret) return '<p class="notice">종료된 사건의 결과를 불러오고 있습니다.</p>';
      return '<div class="seven-game seven-result"><header class="result-header"><span class="result-seal">SEVEN DAYS / CASE REVEALED</span><h1>' + (win ? '수사 진영의 승리' : '범인 진영의 승리') + '</h1><p>' + (win ? '최종 고발한 인물이 실제 진범과 일치했습니다.' : '최종 고발한 인물이 실제 진범을 비껴갔습니다.') + '</p>' + (sPlayers.length ? '<p class="seven-neutral-result">독립 용의자: <b>' + neutralText(sResult) + '</b></p><p>' + esc(neutralReason(sResult)) + (sResult?.report ? ' 제보: ' + esc(personName(sResult.report.suspectId)) + ' · ' + esc(sResult.report.text) : '') + '</p>' : '') + (!win && sResult?.status === 'win' ? '<p class="seven-dual-win">범인 진영과 독립 용의자의 동시 승리</p>' : '') + '</header><section class="seven-solution-grid">' + [['person', secret.suspectId, '실제 사건 인물', personName(secret.suspectId)], ['place', secret.placeId, '실제 범행 장소', placeName(secret.placeId)], ['tool', secret.toolId, '실제 도구', D.TOOLS.find(t => t.id === secret.toolId)?.name], ['time', secret.timeId, '실제 시간대', D.TIMES.find(t => t.id === secret.timeId)?.name]].map(([kind, id, label, name]) => '<article class="solution-card"><small>' + label + '</small>' + art(kind, id, name || label) + '<h2>' + esc(name || '미기록') + '</h2></article>').join('') + '</section><div class="banner"><p>탐정의 최종 고발: <b>' + esc(personName(g.accusation?.suspectId))  + '</b> · DAY-07 종료</p></div><section class="seven-result-roles"><h2>전체 역할과 사건 인물 배정</h2><p>닉네임 프로필의 회색 표시는 이번 목표의 미달·패배입니다. 독립 용의자의 생존과 개인 승패는 진영 결과와 따로 표시합니다.</p><div class="seven-roster">' + (r.players || []).map(p => { const neutral = p.role === 'suspect', successful = neutral ? sResult?.status === 'win' : (['culprit', 'accomplice'].includes(p.role) ? !win : win); return '<article class="seven-profile seven-result-profile' + (!successful ? ' is-inactive' : ' is-winner') + '"><div class="seven-result-face">' + art('person', p.characterId, '종료 후 공개된 배정 인물') + '</div><div><strong>' + esc(p.name) + '</strong><small>' + esc(role(p.role)) + ' · ' + esc(personName(p.characterId)) + '</small><b>' + (neutral ? neutralText(sResult) : successful ? 'WIN · 진영 승리' : 'LOSE · 진영 패배') + '</b></div></article>'; }).join('') + '</div></section><section class="seven-replay-launch"><div><small>END ONLY / 사건의 뒷면</small><h2>7일의 사건 복기</h2><p>원래 진술, 실제 진실, 기억 복원과 봉인 제보가 시간순으로 공개됩니다.</p></div>' + button('replay', '전체 사건 기록과 복기 열기') + '</section>' + worldRecords(g) + '<h2>공식 진술의 실제 진상</h2>' + ((g.statements || []).map(s => '<article class="record-card' + (truth(g, s.category) !== s.value ? ' seven-verified-lie' : '') + '"><small>' + day({ round: s.round }) + ' · ' + esc(memberName(g, s.speakerId)) + '</small><p>원래 답변: ' + esc(catText(s.category, s.value)) + '</p><b>' + (truth(g, s.category) === s.value ? '참 진술' : '거짓 진술 · 실제 ' + esc(catText(s.category, truth(g, s.category)))) + '</b></article>').join('') || '<p class="empty">공식 진술 없이 사건이 끝났습니다.</p>') + '<div class="result-actions">' + (config.isHost?.() ? '<button class="btn primary" data-action="restart" data-mutate>같은 참가자로 새 사건 준비</button>' : '') + '<button class="btn outline" data-action="leave">' + (config.practising?.() ? '연습 끝내기' : '방 나가기') + '</button></div></div>';
    }
    function eventDetail(g, e) {
      const parts = [];
      if (e.targetId) parts.push('대상 · ' + memberName(g, e.targetId));
      if (e.category) { const value = e.value ?? e.proposedValue; parts.push(Number.isInteger(value) ? catText(e.category, value) : category(e.category)?.label || '관찰 항목'); }
      if (e.allowedValues) parts.push(recordText(e));
      if (e.suspectId) parts.push((e.type === 'report' ? '봉인 제보 인물 · ' : '기록 인물 · ') + personName(e.suspectId));
      if (e.placeId) parts.push('장소 · ' + placeName(e.placeId));
      if (e.candidates) parts.push('그때 남은 정체 후보 · ' + e.candidates.map(personName).join(', '));
      if (e.text) parts.push('원문 · ' + e.text);
      if (typeof e.isTrue === 'boolean') parts.push(e.isTrue ? '종료 후 확인된 참' : '종료 후 확인된 거짓');
      if (Number.isInteger(e.actualValue)) parts.push('실제 사건의 진실 · ' + catText(e.category, e.actualValue));
      if (typeof e.success === 'boolean') parts.push(e.success ? '성공' : '실패');
      if (e.type === 'answer') {
        const actual = truth(g, e.category), s = (g.statements || []).find(s => s.id === e.statementId), audit = g.reveal?.replay?.events?.find(a => a.type === 'audit' && a.statementId === e.statementId);
        parts.push('실제 사건의 진실 · ' + catText(e.category, actual));
        parts.push('종료 후 확인된 ' + (actual === e.value ? '참 진술' : '거짓 진술') + (s?.audited && audit ? ' · DAY-' + String(audit.round).padStart(2, '0') + '에서 검증' : ' · 플레이 중 미검증'));
      }
      return parts.map(text => '<p>' + esc(text) + '</p>').join('') || '<p>이 단계의 진행 사실이 공식 기록에 남았습니다.</p>';
    }
    function replay(g, selection) {
      if (g?.phase !== 'finished' || !g.reveal) return '';
      const all = g.reveal.replay?.events || [], round = selection?.round ?? replayDay, list = round === 'all' ? all : all.filter(e => e.round === Number(round));
      const index = Math.max(0, Math.min(list.length - 1, selection?.index ?? replayStep)), e = list[index];
      return '<section class="seven-replay" data-round="' + esc(round) + '" data-step-index="' + index + '"><p class="notice">' + (g.reveal.replay?.complete ? '종료 후 공개된 실제 전체 기록입니다. 나의 기억·제보와 다른 참가자의 비공개 행동까지 확인할 수 있습니다.' : '일부 단계의 상세 기록이 남아 있지 않습니다.') + '</p><div class="seven-replay-days">' + ['all', 1, 2, 3, 4, 5, 6, 7].map(d => button('replay-day', d === 'all' ? '전체' : 'DAY-' + String(d).padStart(2, '0'), ' data-round="' + d + '" aria-pressed="' + (String(d) === String(round)) + '"')).join('') + '</div>' + (e ? '<article class="seven-replay-step" data-replay-step="' + esc(e.id || index) + '"><small>' + day({ round: e.round || 1 }) + ' · ' + esc(memberName(g, e.actorId)) + '</small><h3>' + esc(EVENT_NAMES[e.type] || e.type || '사건 기록') + '</h3>' + eventDetail(g, e) + '</article>' : '<p class="empty">이 날짜에는 복기할 상세 기록이 없습니다.</p>') + '<div class="seven-replay-navigation">' + button('replay-prev', '이전 기록', '', !e || index === 0) + '<span>' + (e ? index + 1 : 0) + ' / ' + list.length + '</span>' + button('replay-next', '다음 기록', '', !e || index === list.length - 1) + '</div><ol class="seven-replay-list">' + list.map((event, i) => '<li><button data-action="seven-replay-step" data-index="' + i + '" aria-current="' + (i === index ? 'step' : 'false') + '"><small>' + day({ round: event.round || 1 }) + '</small><strong>' + esc(EVENT_NAMES[event.type] || event.type || '사건 기록') + '</strong><span>' + esc(memberName(g, event.actorId)) + '</span></button>' + (event.type === 'memory' || event.type === 'report' ? '<div class="seven-replay-secret">' + eventDetail(g, event) + '</div>' : '') + '</li>').join('') + '</ol></section>';
    }
    function cancelTypes() { handles.forEach(h => h.cancel?.()); handles = []; typedKey = ''; }
    function nextSealNotice(g) {
      if (['witness', 'suspect'].includes(g.self?.role)) {
        const rounds = new Set((g.questionHistory || []).filter(q => q.status === 'blocked').map(q => q.round));
        if (g.review?.kind === 'blocked') rounds.add(g.review.round || g.round);
        for (const round of Array.from(rounds).filter(n => Number.isInteger(n) && n >= 1 && n <= 7).sort((a, b) => a - b)) {
          const key = (config.caseId?.() || '') + ':seven-blocked:' + g.self.id + ':' + round;
          if (!readNotices.has(key) && !config.sessionGet?.(key)) return { key, publicBlocked: { round } };
        }
        return null;
      }
      // The detective reads the same public obstruction in their normal review.
      if (!['culprit', 'accomplice'].includes(g.self?.role)) return null;
      const outcomes = g.self.sealOutcomes?.length ? g.self.sealOutcomes : g.self.sealOutcome ? [g.self.sealOutcome] : [];
      for (const outcome of outcomes.slice(-14)) {
        if (!Number.isInteger(outcome.round) || outcome.round < 1 || outcome.round > 7 || typeof outcome.success !== 'boolean') continue;
        const key = (config.caseId?.() || '') + ':seven-seal:' + g.self.id + ':' + outcome.round;
        if (!readNotices.has(key) && !config.sessionGet?.(key)) return { key, outcome };
      }
      return null;
    }
    function notice() {
      if (!sealNotice) return '';
      if (sealNotice.publicBlocked) {
        const round = sealNotice.publicBlocked.round;
        return '<section class="seven-review seven-blocked-notice"><small>' + day({ round }) + ' / PUBLIC RECORD</small><h3>기록의 전달이 잠시 막혔습니다.</h3><p class="seven-hand" data-seven-typed>' + esc('전달될 기록이 잠시 막혔습니다. ' + day({ round }) + ' 수사에서는 해당 항목을 확인하지 못했습니다. 이미 확보한 공식 증거와 진술은 그대로 남아 있습니다. ' + (round < 7 ? '다음 수사일에 같은 항목을 다시 확인하거나 다른 경로를 선택할 수 있습니다.' : '마지막 수사일인 만큼, 남아 있는 공식 기록과 진술을 대조해 최종 고발을 준비하세요.')) + '</p><div class="case-review-actions">' + button('notice-continue', '공개 기록을 읽고 계속') + '</div></section>';
      }
      if (!config.privateVisible?.()) return '<section class="seven-private-lock"><div class="seven-lock-art"></div><small>PRIVATE RECORD / 나만 보는 알림</small><h3>비밀 기록 알림이 도착했습니다.</h3><p>주변에 다른 화면이 보이지 않을 때 나의 기록을 확인하세요. 확인하기 전까지 알림 내용은 가려집니다.</p>' + button('notice-show', '나의 비밀 기록 확인') + '</section>';
      const outcome = sealNotice.outcome;
      const reason = { blocked: '오늘 선택한 항목의 수사를 막았습니다.', guarded: '보호된 기록을 통해 수사가 이어져 봉쇄에 실패했습니다.', missed: '탐정이 다른 항목을 수사해 봉쇄가 적용되지 않았습니다.', unused: '탐정이 진술 검증 또는 수사 넘김을 선택해 봉쇄가 적용되지 않았습니다.' }[outcome.reason] || '오늘의 수사가 끝나 봉쇄 결과가 확정되었습니다.';
      return '<section class="seven-review seven-seal-notice"><small>' + day({ round: outcome.round }) + ' / PRIVATE RECORD</small><h3>' + (outcome.success ? '기록 봉쇄가 성공했습니다.' : '기록 봉쇄가 실패했습니다.') + '</h3><p class="seven-hand" data-seven-typed>' + esc(reason + ' 이미 공개된 공식 증거는 바뀌지 않으며, 사용한 봉쇄 기회는 되돌아오지 않습니다.') + '</p><div class="case-review-actions">' + button('notice-continue', '비밀 기록을 읽고 계속') + '</div></section>';
    }
    function openSealNotice() { open('notice', sealNotice?.publicBlocked ? '공개 수사 기록 알림' : '나만 보는 기록 알림', notice()); }
    function animate() {
      if (!config.modalHost || !config.scene?.type) return;
      const g = getGame(), signature = current() === 'seven-notice' ? sealNotice?.key || '' : (config.caseId?.() || '') + ':' + g?.round + ':' + current() + ':' + JSON.stringify(g?.review || g?.pending || {});
      typedKey = signature;
      const fresh = [];
      config.modalHost.querySelectorAll('[data-seven-typed]').forEach(el => { const text = el.textContent, key = signature + ':' + text; if (typed.has(key)) return; const h = config.scene.type(el, text, { speed: 22 }); handles.push(h); fresh.push(h); Promise.resolve(h.promise).then(out => { if (!out?.cancelled) typed.add(key); }); });
      if (!fresh.some(h => !h.done)) return;
      const actions = config.modalHost.querySelector('.case-review-actions');
      if (actions) actions.innerHTML = button('letter-finish', '빠르게 보기') + actions.innerHTML;
      config.modalHost.querySelectorAll('[data-action="seven-round-confirm"],[data-action="seven-review-audit"],[data-action="seven-notice-continue"],[data-action="seven-ending-continue"]').forEach(el => { el.disabled = true; });
      Promise.all(fresh.map(h => h.promise)).then(values => { if (values.some(v => v?.cancelled) || typedKey !== signature) return; if (['seven-review', 'seven-notice', 'seven-ending'].includes(current())) { modalSignature = ''; refresh(true); } });
    }
    function open(kind, title, body) { cancelTypes(); config.openModal?.('seven-' + kind, title, '<div id="seven-window-body">' + body + '</div>'); modalSignature = ''; animate(); }
    function openPersonal() { const g = getGame(); if (!g || g.phase === 'finished') return; if (g.phase === 'discussion' && g.self.role === 'detective') { openReview(); return; } open('personal', isMine(g) ? '나의 차례 · 비밀 수첩' : '나만 보는 비밀 수첩', personal(g, !!config.privateVisible?.())); }
    function openReview() { const g = getGame(); if (g?.phase === 'discussion' && g.self?.role === 'detective') open('review', '도착한 답변·기록 검토', review(g)); }
    function refresh(force) {
      const g = getGame(), kind = current(); if (!g || !kind.startsWith('seven-') || kind === 'seven-story') return;
      const signature = JSON.stringify([kind, config.privateVisible?.(), pending(), g, selectedTab, replayDay, replayStep, drafts, sealNotice, Object.keys(marked).map(key => Array.from(marked[key]))]);
      if (!force && signature === modalSignature) return;
      if (['seven-review', 'seven-notice', 'seven-ending'].includes(kind) && handles.some(h => !h.done)) return;
      const body = config.modalHost?.querySelector('#seven-window-body'); if (!body) return;
      cancelTypes(); modalSignature = signature;
      body.innerHTML = kind === 'seven-personal' ? personal(g, !!config.privateVisible?.()) : kind === 'seven-review' ? review(g) : kind === 'seven-ledger' ? ledger(g) : kind === 'seven-replay' ? replay(g) : kind === 'seven-detail' ? detail(g) : kind === 'seven-notice' ? notice() : kind === 'seven-ending' ? ending(g) : '';
      animate();
    }
    function pump() {
      const g = getGame(); if (!g || config.hidden?.() || config.scene?.busy?.()) return;
      if (g.phase === 'finished') {
        if (getRoom()?.status !== 'finished' || !g.reveal || !(g.reveal.secretNPC || g.reveal.secret)) return;
        const key = (config.caseId?.() || '') + ':seven-ending';
        if (endingShown === key || config.sessionGet?.(key) || ['seven-story', 'seven-notice'].includes(current())) return;
        endingShown = key; config.sessionSet?.(key, '1'); config.setPrivateVisible?.(false);
        open('ending', '일곱 날의 끝 · 마지막 기록', ending(g)); return;
      }
      if (current() && !['seven-personal', 'seven-review'].includes(current())) return;
      const caseId = config.caseId?.() || '', storyKey = caseId + ':seven-story:' + g.round;
      if (!config.sessionGet?.(storyKey) && storyCase !== storyKey) {
        storyCase = storyKey;
        open('story', day(g) + ' · 7일의 사건 기록', '<section class="seven-story"><div class="seven-story-day">' + day(g) + '<small> / 7 DAYS</small></div><p class="seven-hand" data-seven-typed>' + esc(STORIES[g.round] || STORIES[7]) + '</p>' + button('letter-finish', '문장 바로 보기') + button('story-continue', '기록을 열고 계속') + '</section>'); return;
      }
      if (!(g.phase === 'answer' && isMine(g))) {
        const waiting = nextSealNotice(g);
        if (waiting) { sealNotice = waiting; openSealNotice(); return; }
      }
      const key = caseId + ':' + g.round + ':' + g.phase + ':' + g.turnOwnerId;
      if (isMine(g) && key !== cueKey) { cueKey = key; if (g.phase === 'discussion') openReview(); else openPersonal(); }
    }
    function reset() { cancelTypes(); cueKey = ''; storyCase = ''; endingShown = ''; modalSignature = ''; boardTab = 'person'; detailSelection = null; sealNotice = null; readNotices.clear(); replayDay = 'all'; replayStep = 0; Object.values(marked).forEach(set => set.clear()); }
    function privacy() { cancelTypes(); if (['seven-personal', 'seven-notice', 'seven-ending'].includes(current())) config.closeModal?.(); }
    async function handle(action, data) {
      if (!action.startsWith('seven-')) return false;
      const g = getGame(), d = data || {};
      if (action === 'seven-letter-finish') { handles.forEach(h => h.finish?.()); return true; }
      if (action === 'seven-story-continue') { if (handles.some(h => !h.done)) { handles.forEach(h => h.finish?.()); return true; } config.sessionSet?.(storyCase, '1'); config.closeModal?.(); cueKey = ''; pump(); return true; }
      if (!g || g.rulesVersion !== 4) return true;
      if (action === 'seven-ending-continue') { if (g.phase === 'finished' && getRoom()?.status === 'finished' && current() === 'seven-ending' && !handles.some(h => !h.done)) config.closeModal?.(); return true; }
      if (action === 'seven-notice-show') { if (current() === 'seven-notice' && sealNotice && ['culprit','accomplice'].includes(g.self.role)) { config.setPrivateVisible?.(true); openSealNotice(); } return true; }
      if (action === 'seven-notice-continue') {
        if (current() !== 'seven-notice' || !sealNotice || !sealNotice.publicBlocked && !config.privateVisible?.()) return true;
        if (handles.some(h => !h.done)) return true;
        readNotices.add(sealNotice.key); config.sessionSet?.(sealNotice.key, '1'); sealNotice = null; config.setPrivateVisible?.(false); config.closeModal?.(); cueKey = ''; pump(); return true;
      }
      if (action === 'seven-board-tab') { if (['person','place','tool','time'].includes(d.id)) { boardTab = d.id; config.render?.(); } return true; }
      if (action === 'seven-card-detail') { if (['person','place','tool','time'].includes(d.kind)) { detailSelection = { kind: d.kind, id: d.id }; open('detail', '사건 자료 자세히 보기', detail(g)); } return true; }
      if (action === 'seven-personal') { openPersonal(); return true; }
      if (action === 'seven-private-show') { config.setPrivateVisible?.(true); openPersonal(); return true; }
      if (action === 'seven-review') { openReview(); return true; }
      if (action === 'seven-ledger') { open('ledger', '공식 수사기록과 질문 이력', ledger(g)); return true; }
      if (action === 'seven-replay') { if (g.phase === 'finished') open('replay', '7일의 전체 사건 복기', replay(g)); return true; }
      if (action.startsWith('seven-replay-')) { if (g.phase !== 'finished' || current() !== 'seven-replay') return true; if (action === 'seven-replay-day') { replayDay = d.round === 'all' ? 'all' : Math.min(7, Math.max(1, Number(d.round) || 1)); replayStep = 0; } const list = g.reveal?.replay?.events?.filter(e => replayDay === 'all' || e.round === replayDay) || []; if (action === 'seven-replay-next') replayStep++; if (action === 'seven-replay-prev') replayStep--; if (action === 'seven-replay-step') replayStep = Number(d.index) || 0; replayStep = Math.max(0, Math.min(list.length - 1, replayStep)); refresh(true); return true; }
      if (action === 'seven-mark') { if (marked[d.kind] && (d.kind === 'person' ? person(d.id) : d.kind === 'place' ? location(d.id) : (d.kind === 'tool' ? D.TOOLS : D.TIMES).find(p => p.id === d.id))) { const set = marked[d.kind]; set.has(d.id) ? set.delete(d.id) : set.add(d.id); config.render?.(); } return true; }
      if (action === 'seven-clear-marks') { Object.values(marked).forEach(set => set.clear()); config.render?.(); return true; }
      if (action === 'seven-tab') { if (['question', 'search', 'audit'].includes(d.id)) selectedTab = d.id; refresh(true); return true; }
      if (action === 'seven-accuse-select') { if (g.phase === 'final' && g.self.role === 'detective' && isMine(g) && finalPeople(g).some(p => p.id === d.id)) { drafts.sevenAccusedPerson = d.id; refresh(true); } return true; }
      if (pending() || !isMine(g)) return true;
      let event = null;
      if (action === 'seven-role-seen' && g.phase === 'reveal') event = { type: 'ROLE_SEEN' };
      if (g.phase === 'secret') {
        if (action === 'seven-memory' && g.self.role === 'suspect' && g.self.identity?.memoryLeft > 0) event = { type: 'SECRET_ACTION', kind: 'memory' };
        if (action === 'seven-report-submit' && reportAvailable(g)) { const suspectId = read('seven-report-person'), text = read('seven-report-reason').trim(); if (person(suspectId) && text) event = { type: 'SECRET_ACTION', kind: 'report', suspectId, text }; else config.toast?.('제보할 인물과 이유를 입력해 주세요.'); }
        if (action === 'seven-identity-guess' && g.self.role === 'suspect' && person(read('seven-identity-guess'))) event = { type: 'SECRET_ACTION', kind: 'suggest', suspectId: read('seven-identity-guess'), text: '나의 정체 추정 메모' };
        if (['seven-seal', 'seven-guard', 'seven-suggest'].includes(action) && category(read('seven-secret-category'))) event = { type: 'SECRET_ACTION', kind: action.slice(6), category: read('seven-secret-category') };
        if (action === 'seven-secret-pass') event = { type: 'SECRET_ACTION', kind: 'pass' };
      }
      if (g.phase === 'answer' && action === 'seven-answer') { const c = category(g.pending?.category), criminal = ['culprit', 'accomplice'].includes(g.self.role), value = d.value === 'unknown' ? null : Number(d.value), actual = criminal ? truth(g, c?.id) : known(g, c?.id); if (g.self.answerOptions?.legalValues ? g.self.answerOptions.legalValues.includes(value) : value === null ? criminal ? g.remainingRefusals > 0 : !Number.isInteger(actual) : c && Number.isInteger(value) && value >= 0 && value < c.values.length && (criminal ? value === actual || g.remainingLies > 0 : value === actual)) event = { type: 'ANSWER', value }; }
      if (g.self.role === 'detective' && g.phase === 'investigate') {
        if (action === 'seven-question' && category(read('seven-question-category'))) event = { type: 'QUESTION', targetId: read('seven-question-target'), category: read('seven-question-category'), proposedValue: Number(read('seven-question-proposed')) };
        if (action === 'seven-search' && D.RECORDS.some(r => r.id === d.id)) event = { type: 'SEARCH', recordId: d.id };
        if (action === 'seven-audit' && g.kits > 0 && g.statements.some(s => s.id === d.id && !s.audited)) event = { type: 'AUDIT', statementId: d.id };
        if (action === 'seven-investigate-pass') event = { type: 'INVESTIGATE', kind: 'pass' };
      }
      if (g.self.role === 'detective' && g.phase === 'discussion' && !handles.some(h => !h.done)) {
        if (action === 'seven-review-audit' && g.kits > 0 && g.review?.kind === 'answer' && !g.review.verified) event = { type: 'REVIEW_AUDIT' };
        if (action === 'seven-round-confirm') event = { type: 'ROUND_CONFIRM' };
      }
      if (action === 'seven-accuse-submit' && g.phase === 'final' && g.round === 7 && g.self.role === 'detective' && finalPeople(g).some(p => p.id === drafts.sevenAccusedPerson)) event = { type: 'ACCUSE', suspectId: drafts.sevenAccusedPerson };
      if (event) await config.send?.(event);
      return true;
    }
    return Object.freeze({ render, result, personal, review, ledger, accuse, replay, records, onClose: cancelTypes, openPersonal, openReview, refresh, pump, handle, reset, privacy });
  }
  return Object.freeze({ create });
}));

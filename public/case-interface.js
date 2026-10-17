(function (root) {
  'use strict';
  function create(c) {
    const { G, esc, icon, options, category, npc, place, roleLabel, playerName, truth, disabled, fieldValue, drafts, mine } = c;
    const hand = text => '<p class="case-hand" data-handwritten data-text="' + esc(text) + '">' + esc(text) + '</p>';
    const categoryField = (id, key) => '<label class="field"><span>조사할 항목</span><select id="' + id + '" data-draft="' + key + '">' + options(G.CATEGORIES, drafts[key] || 'coat') + '</select></label>';
    function resource(label, count, explanation, symbol) {
      const id = 'case-resource-' + ({ '공용 거짓말': 'lies', '나의 은폐': 'seal', '감식·검증': 'kit', '현장 보호': 'guard' }[label]);
      return '<div class="case-resource"><button class="case-resource-button" data-action="resource-help" aria-expanded="false" aria-describedby="' + id + '" aria-label="' + esc(label + ' ' + count + ', 기능 설명') + '"><span aria-hidden="true">' + symbol + '</span><span>' + esc(label) + '</span><b>' + esc(count) + '</b><span class="case-info-dot" aria-hidden="true">?</span></button><p id="' + id + '" role="tooltip">' + esc(explanation) + '</p></div>';
    }
    function resources(g) {
      const s = g.self, criminal = G.ROLES[s.role].team === 'criminals';
      let out = criminal ? resource('공용 거짓말', g.remainingLies + ' / 2', '범인과 공범이 함께 쓰는 공식 답변의 거짓말 횟수입니다. 거짓인 답변 하나마다 1회 줄어듭니다. 자유 채팅에는 적용되지 않습니다.', '◇') + resource('나의 은폐', s.sabotageLeft + '회', '선택한 항목의 질문·현장 감식을 이번 라운드에 한 번 막습니다. 이미 공개된 증거는 바꿀 수 없고 진술 검증은 막지 못합니다.', '▧') : '';
      if (s.role === 'detective') out += resource('감식·검증', g.kits + ' / 1', '게임 전체에서 한 번 쓰는 공용 기회입니다. 현장 감식, 과거 진술 검증, 방금 도착한 답변 검증이 이 한 기회를 함께 사용합니다. 매 라운드 회복되지 않습니다.', '⌕');
      if (s.role === 'suspect') out += resource('현장 보호', s.guardLeft + '회', '개인 행동 때 고른 항목과 이번 라운드의 은폐 항목이 같으면 은폐를 무시합니다. 게임 전체 한 번입니다.', '♧');
      return out ? '<div class="case-resources" aria-label="내 역할의 남은 기회">' + out + '</div>' : '';
    }
    function locked() {
      return '<section class="case-locked"><div class="role-art" data-role="sealed" aria-hidden="true"></div><h2>내 비밀 정보가 가려져 있습니다.</h2><p>나의 역할과 개인 단서를 확인하세요.<br>화면을 벗어나면 다시 가려집니다.</p><button class="btn primary" data-action="private-show">' + icon('lock') + '내 정보 확인</button></section>';
    }
    function secretControls(g) {
      const s = g.self, pair = g.players.length === 2 && g.rulesVersion >= 2;
      const share = s.clues.filter(x => !s.shared.includes(x.category));
      let out = '';
      if (!pair && share.length) out += '<section class="private-actions"><h3>개인 단서 공식 공개</h3><p>믿을 수 있는 기억 하나를 모두의 공식 증거로 남깁니다.</p><div class="action-options">' + share.map(x => '<button class="btn compact" data-action="share" data-category="' + x.category + '" data-mutate' + disabled(false) + '>' + esc(category(x.category).values[x.value]) + ' 공개</button>').join('') + '</div></section>';
      if (['culprit', 'accomplice'].includes(s.role)) out += '<section class="private-actions"><h3>수사 접근 은폐</h3><p>탐정이 고를 항목을 예상해 한 라운드 지연시킵니다.</p>' + (g.sabotage ? '<div class="notice">진영이 이미 ' + category(g.sabotage.category).label + ' 항목을 은폐했습니다.</div>' : '<div class="form-grid">' + categoryField('seal-category', 'sealCategory') + '<button class="btn danger" data-action="seal" data-mutate' + disabled(!s.sabotageLeft) + '>이 항목 은폐</button></div>') + '</section>';
      if (s.role === 'suspect') out += '<section class="private-actions"><h3>현장 보호</h3><p>은폐와 같은 항목을 선택하면 이번 방해를 무시합니다.</p><div class="form-grid">' + categoryField('guard-category', 'guardCategory') + '<button class="btn" data-action="guard" data-mutate' + disabled(!s.guardLeft) + '>이 항목 보호</button></div></section>';
      if (!pair) out += '<section class="private-actions"><h3>수사 항목 제안 <span class="tag">자유 의견</span></h3><div class="form-grid">' + categoryField('suggest-category', 'suggestCategory') + '<button class="btn outline" data-action="suggest" data-mutate' + disabled(false) + '>이 항목 제안</button></div></section>';
      return out + '<div class="role-reveal-actions"><button class="btn quiet" data-action="secret-pass" data-mutate' + disabled(false) + '>개인 행동 넘기기</button></div>' + (pair ? '<p class="role-hint">2인전에서는 제안과 단서 공개를 생략합니다. 탐정의 시작 단서는 이미 공식 기록에 있습니다.</p>' : '<p class="role-hint">하나를 선택하면 이번 개인 행동이 끝납니다.</p>');
    }
    function questionText(g) {
      const p = g.pending;
      if (!p) return '';
      return root.WitnessCasePresentation?.questionText({ detectiveName: playerName(g.detectiveId, g), targetName: g.self.name, category: p.category, proposedValue: p.proposedValue ?? 0 }) || g.self.name + ' 씨, 목격한 사람의 ' + category(p.category).label + '에 대해 말씀해 주시겠습니까?';
    }
    function answerControls(g) {
      const q = category(g.pending.category);
      let out = '<section class="case-interrogation"><div class="case-letter-label">DETECTIVE / ' + esc(playerName(g.detectiveId, g)) + '</div>' + hand(questionText(g)) + '<p class="case-caption">사건 속 사람·장소를 목격한 내용에 관한 질문입니다. 본인의 실제 신체 특성을 묻는 것이 아닙니다.</p>';
      if (g.caseSecret) {
        const actual = truth(g.caseSecret, q.id);
        out += '<p class="case-answer-guide">나만 아는 실제 값: <b>' + esc(q.values[actual]) + '</b></p><div class="answer-grid">' + q.values.map((v, i) => '<button class="choice" data-action="answer" data-value="' + i + '" data-mutate' + disabled(i !== actual && !g.remainingLies) + '><strong>' + esc(v) + '</strong><small>' + (i === actual ? '사실대로 진술' : '거짓 진술 · 공용 기회 1회') + '</small></button>').join('') + '</div>';
      } else {
        const known = g.self.clues.find(f => f.category === q.id) || g.facts.find(f => f.category === q.id);
        out += '<div class="notice">확인한 내용만 공식 진술로 답합니다. 기억에 없는 항목은 모른다고 답하세요.</div><div class="answer-grid"><button class="btn primary" data-action="answer" data-value="' + (known ? known.value : 'unknown') + '" data-mutate' + disabled(false) + '>' + (known ? esc(q.values[known.value]) + ' · 확인한 기억으로 답변' : '기억나지 않습니다 · 모름') + '</button></div>';
      }
      return out + '</section>';
    }
    function investigation(g, tab) {
      if (g.self.role !== 'detective' || g.phase !== 'investigate') return '';
      const targets = g.players.filter(p => p.id !== g.self.id).map(p => ({ id: p.id, label: p.name }));
      const selection = root.WitnessDetectiveOptions.questionSelection(g, { category: drafts.questionCategory, proposedValue: drafts.questionProposed });
      drafts.questionCategory = selection.category || '';
      drafts.questionProposed = selection.proposedValue === null ? '' : String(selection.proposedValue);
      const q = selection.category && category(selection.category), noQuestion = !q;
      let body;
      if (tab === 'question') body = '<div class="case-letter-label">QUESTION / 목격 내용 확인</div><h3>누구의 기억을 확인할까요?</h3><p class="case-filter-note">보유 단서·공식 증거·완료된 질문·은폐로 막힌 항목을 제외했습니다.</p><div class="form-grid"><label class="field"><span>질문을 받을 참가자</span><select id="question-target" data-draft="questionTarget"' + disabled(noQuestion) + '>' + options(targets, drafts.questionTarget) + '</select></label><label class="field"><span>조사할 항목</span><select id="question-category" data-draft="questionCategory"' + disabled(noQuestion) + '>' + (noQuestion ? '<option value="">질문할 새 항목이 없습니다</option>' : options(selection.available, selection.category)) + '</select></label></div><label class="field"><span>탐정이 확인할 가정</span><select id="question-proposed" data-draft="questionProposed"' + disabled(noQuestion) + '>' + (noQuestion ? '<option value="">새 질문 없음</option>' : selection.values.map(v => '<option value="' + v.value + '"' + (selection.proposedValue === v.value ? ' selected' : '') + '>' + esc(v.label) + '</option>').join('')) + '</select></label><div class="case-question-preview"><span>' + (noQuestion ? '질문 완료' : '질문 미리보기') + '</span><p>' + (noQuestion ? '새롭게 질문할 항목을 모두 확인했습니다. 지난 진술 검증이나 수사기록 확인 후 다음 단계로 진행하세요.' : esc(root.WitnessCasePresentation?.questionText({ targetName: playerName(drafts.questionTarget || targets[0]?.id, g), category: q.id, proposedValue: selection.proposedValue }) || '선택한 참가자에게 목격 내용을 묻습니다.')) + '</p></div><button class="btn primary full" data-action="question" data-mutate' + disabled(noQuestion) + '>질문 보내기 ' + icon('arrow') + '</button>';
      else if (tab === 'search') {
        const known = new Set(g.facts.concat(g.self.clues).map(f => f.category)), fresh = G.CATEGORIES.filter(x => !known.has(x.id));
        body = '<h3>현장에서 확정 증거 찾기</h3><p>한 항목의 진실을 확인합니다. 감식·검증 공용 기회 1회를 씁니다. 이미 아는 참 단서는 제외합니다.</p><div class="action-options">' + (fresh.length ? fresh.map(x => '<button class="btn compact outline" data-action="search" data-category="' + x.id + '" data-mutate' + disabled(!g.kits) + '>' + x.label + ' 감식</button>').join('') : '<p class="empty">모든 항목의 확정 증거를 확보했습니다.</p>') + '</div>';
      }
      else {
        const candidates = g.statements.filter(s => !s.audited);
        body = '<h3>지난 공식 진술 검증</h3><p>원문을 보존하고 실제 값을 확인합니다. 은폐를 무시하며 공용 기회 1회를 씁니다.</p>' + (candidates.length ? candidates.map(s => '<div class="case-audit-row"><span>DAY-' + String(s.round).padStart(2, '0') + ' · ' + esc(playerName(s.speakerId, g)) + '<br><b>' + category(s.category).values[s.value] + '</b></span><button class="btn compact outline" data-action="audit" data-id="' + s.id + '" data-mutate' + disabled(!g.kits) + '>검증</button></div>').join('') : '<p class="empty">검증할 미확인 공식 진술이 없습니다.</p>');
      }
      return '<section class="case-investigation"><div class="case-section-heading"><span class="case-number">03</span><h2>탐정의 공동수사</h2><span class="tag">오늘 1회</span></div><div class="action-tabs">' + [['question', '질문'], ['search', '현장 감식'], ['audit', '진술 검증']].map(([id, label]) => '<button class="action-tab ' + (tab === id ? 'active' : '') + '" data-action="tab" data-id="' + id + '" aria-pressed="' + (tab === id) + '">' + label + '</button>').join('') + '</div><div class="action-body">' + body + '</div><button class="text-button" data-action="skip">이번 공동 수사 넘기기</button>' + (g.round < 5 ? '<button class="text-button case-early-accuse" data-action="accuse">지금 최종 고발하기</button>' : '') + '</section>';
    }
    function personal(g, visible, tab) {
      if (!visible) return locked();
      const s = g.self, criminal = G.ROLES[s.role].team === 'criminals';
      let info = '';
      if (g.caseSecret) info = '<div class="secret-case-grid"><div><small>실제 사건 인물</small><strong>' + npc(g.caseSecret.suspectId).name + '</strong></div><div><small>실제 범행 장소</small><strong>' + place(g.caseSecret.placeId).name + '</strong></div></div>' + (g.partnerIds?.length ? '<p class="case-partners">같은 진영: ' + g.partnerIds.map(id => esc(playerName(id, g))).join(', ') + '</p>' : '');
      else if (s.clues.length) info = s.clues.map(x => '<div class="clue-card"><span class="tiny-label">' + (s.role === 'detective' ? (['coat', 'hand', 'item'].includes(x.category) ? '사건 인물 힌트' : '현장 힌트') : 'YOUR TRUE MEMORY / 개인 참 단서') + '</span><strong>' + category(x.category).values[x.value] + '</strong><small>' + category(x.category).label + ' · ' + (s.shared.includes(x.category) ? '공식 기록에 공개됨' : '아직 본인만 아는 기억') + '</small></div>').join('');
      else info = '<div class="clue-card"><span class="tiny-label">YOUR INFORMATION</span><strong>처음부터 아는 정답 특성은 없습니다.</strong><small>공식 기록과 다른 사람의 이야기를 비교하세요.</small></div>';
      if (s.role === 'detective' && g.phase === 'investigate' && s.clues.length) info = '<div class="case-memory-strip"><small>나의 시작 기억</small>' + s.clues.map(x => '<span><small>' + (['coat', 'hand', 'item'].includes(x.category) ? '사건 인물 힌트' : '현장 힌트') + '</small> ' + esc(category(x.category).values[x.value]) + '</span>').join('') + '<button class="text-button" data-action="ledger">공식 기록 비교</button></div>';
      let controls = '<p class="public-warning">지금은 ' + esc(playerName(g.turnOwnerId, g)) + '님의 차례입니다. 아래 자유 토론은 언제든 사용할 수 있습니다.</p>';
      if (mine(g)) {
        if (g.phase === 'reveal') controls = '<button class="btn primary full" data-action="role-seen" data-mutate' + disabled(false) + '>내 역할 확인 완료 ' + icon('arrow') + '</button>';
        else if (g.phase === 'secret') controls = secretControls(g);
        else if (g.phase === 'answer') controls = answerControls(g);
        else if (g.phase === 'investigate') controls = investigation(g, tab);
        else if (g.phase === 'discussion') controls = '<button class="btn primary full" data-action="review-open">도착한 수사 결과 확인</button>';
        else if (g.phase === 'final') controls = '<div class="case-final-call">' + hand('마지막 진술까지 모였습니다. 이제, 당신의 결론을 듣겠습니다.') + '<button class="btn danger full" data-action="accuse">탐정 최종 고발</button></div>';
      }
      return '<section class="case-personal"><div class="personal-open"><aside class="personal-role"><div class="role-art" data-role="' + s.role + '" role="img" aria-label="내 ' + roleLabel(s.role) + ' 역할 그림"></div><div class="eyebrow">YOUR SECRET ROLE</div><h2>' + roleLabel(s.role) + '</h2><span class="team-badge ' + (criminal ? 'criminals' : '') + '">' + (criminal ? '범인 진영' : '수사 진영') + '</span>' + resources(g) + '<p class="case-caption">플레이어의 역할과 사건 속 인물은 서로 다릅니다.</p></aside><div class="personal-information">' + info + '<div class="online-private-actions">' + controls + '</div></div></div></section>';
    }
    function review(g) {
      const r = g.review || {}, q = r.category && category(r.category);
      const verdict = root.WitnessDetectiveOptions.reviewVerdict(g), lie = verdict === 'lie';
      let text;
      if (r.kind === 'answer' || r.kind === 'unknown') text = root.WitnessCasePresentation?.answerText({ name: playerName(r.targetId, g), category: r.category, value: r.value, unknown: r.kind === 'unknown' }) || playerName(r.targetId, g) + ' 씨의 답변이 도착했습니다. ' + (r.kind === 'unknown' ? '기억나지 않는다고 합니다.' : q.values[r.value] + '였다고 합니다.');
      else if (r.kind === 'blocked') text = '기록의 일부가 누군가의 손을 탔습니다. ' + (q?.label || '이번 항목') + '에 관한 수사는 오늘 진행할 수 없습니다. 이미 확보한 증거는 그대로 남아 있습니다.';
      else if (r.kind === 'search' || r.kind === 'audit') text = '현장의 기록이 답을 남겼습니다. ' + q.label + ', ' + q.values[r.value] + '. 이 내용은 바뀌지 않는 공식 증거입니다.';
      else text = '오늘의 수사를 마칩니다. 서로의 진술을 기록에 남기고, 다음 결정을 준비하세요.';
      const statement = g.statements.find(x => x.id === r.statementId), eligible = r.kind === 'answer' && statement && !statement.audited && !r.verified;
      const audit = eligible ? '<button class="btn outline" data-action="review-audit" data-mutate' + disabled(!g.kits) + '>답변 검증 <span>잔여 ' + g.kits + '회</span></button>' : '';
      return '<section class="case-review' + (lie ? ' is-verified-lie' : '') + '"' + (lie ? ' aria-label="검증 결과 · 거짓 진술 확인"' : '') + '><div class="case-letter-label">' + (r.kind === 'answer' || r.kind === 'unknown' ? 'OFFICIAL REPLY / ' + esc(playerName(r.targetId, g)) : 'CASE RECORD / DAY-' + String(g.round).padStart(2, '0')) + '</div>' + hand(text) + (r.verified ? '<div class="case-verified' + (lie ? ' is-lie' : '') + '" role="status"><strong>' + (lie ? '거짓 진술로 확인했습니다.' : '진실로 확인했습니다.') + '</strong><p>확정 증거: ' + q.values[r.actualValue] + (r.kind === 'audit' && statement ? ' · 원래 진술: ' + q.values[statement.value] : '') + ' · 원래 답변은 기록에 그대로 남습니다.</p></div>' : '') + '<p class="case-caption">' + (eligible ? '확인은 답변을 읽었다는 뜻입니다. 진실 보장이 필요하면 남은 감식 기회로 검증하세요.' : r.kind === 'unknown' ? '모름은 이진 공식 진술을 만들지 않아 검증할 진술이 없습니다.' : '자유 토론은 하단 채팅에서 계속할 수 있습니다.') + '</p><div class="case-review-actions">' + audit + '<button class="btn primary" data-action="review-confirm" data-mutate' + disabled(false) + '>' + (g.round < 5 ? '확인 · 다음 날로' : '확인 · 최종 고발 준비') + ' ' + icon('arrow') + '</button></div>' + (!g.kits && eligible ? '<p class="case-caption">감식·검증 공용 기회를 이미 사용했습니다.</p>' : '') + '</section>';
    }
    function chat(g, open) {
      const unread = Math.max(0, g.notes.length - c.chatSeen());
      return '<aside class="case-chat ' + (open ? 'is-open' : '') + '" aria-label="하단 자유 토론"><button class="case-chat-toggle" data-action="chat-toggle" aria-expanded="' + open + '" aria-controls="case-chat-body"><span aria-hidden="true">☷</span><strong>자유 토론</strong><span class="case-chat-count">' + (unread ? '+' + unread : g.notes.length) + '</span><span aria-hidden="true">' + (open ? '⌄' : '⌃') + '</span></button><div class="case-chat-body" id="case-chat-body"' + (open ? '' : ' hidden') + '><p class="case-caption">모든 단계에서 대화 가능 · 자유 발언은 공식 증거가 아닙니다.</p><div class="online-chat" id="chat-history" aria-label="자유 토론 기록" aria-live="polite">' + (g.notes.length ? g.notes.map(n => '<article class="chat-item ' + (n.speakerId === g.self.id ? 'mine' : '') + '"><div class="chat-meta">DAY-' + String(n.round).padStart(2, '0') + ' · ' + esc(playerName(n.speakerId, g)) + '</div><p>' + esc(n.text) + '</p></article>').join('') : '<p class="empty">아직 대화가 없습니다. 목격한 기억이나 추리를 나누세요.</p>') + '</div><div class="case-chat-form"><label class="field"><span class="sr-only">자유 발언 · 최대 300자</span><textarea id="chat-text" data-draft="chat" maxlength="300" rows="2" placeholder="추리와 알리바이를 이야기하세요.">' + fieldValue('chat') + '</textarea></label><button class="btn compact" data-action="send-note" data-mutate' + disabled(false) + '>전송</button></div><small>Enter 줄바꿈 · Ctrl/⌘+Enter 전송</small></div></aside>';
    }
    function compact(g) {
      return '<section class="case-self-launch"><button class="case-ledger-launch" data-action="ledger" aria-label="종이와 펜 · 수사기록 열기">' + icon('notebook') + '<span>수사기록</span></button><div><small>MY DOSSIER / 나의 사건 수첩</small><h2>' + (mine(g) ? '내 차례의 메뉴를 열어 주세요.' : '내 정보와 공식 기록을 확인하세요.') + '</h2></div><button class="btn outline compact" data-action="private-toggle">' + icon('lock') + '내 정보 확인</button></section>';
    }
    function banner(g) {
      const labels = { reveal: '역할 확인', secret: '개인 행동', investigate: '탐정의 수사', answer: '목격자 답변', discussion: '수사 결과 확인', final: '최종 고발' };
      const own = mine(g), title = own ? g.phase === 'answer' ? '탐정의 질문이 도착했습니다.' : g.phase === 'discussion' ? '수사 결과를 확인하세요.' : g.phase === 'final' ? '마지막 결론을 내릴 시간입니다.' : '지금은 내 차례입니다.' : playerName(g.turnOwnerId, g) + '님의 ' + labels[g.phase] + '을 기다립니다.';
      return '<section class="online-turn case-turn ' + (own ? 'mine' : '') + '"><span class="case-spinner" aria-hidden="true"></span><div><h2>' + esc(title) + '</h2><p>' + (own ? '진행 창이 자동으로 열립니다. 닫았다면 내 정보 확인에서 다시 열 수 있습니다.' : '수사기록을 살펴보거나 하단 자유 토론에서 이야기를 나누세요.') + '</p></div><span class="tag">DAY-' + String(g.round).padStart(2, '0') + ' · ' + labels[g.phase] + '</span></section>';
    }
    return { locked, personal, secretControls, answerControls, investigation, review, chat, compact, banner, resources };
  }
  root.WitnessCaseUI = Object.freeze({ create });
}(typeof window !== 'undefined' ? window : globalThis));

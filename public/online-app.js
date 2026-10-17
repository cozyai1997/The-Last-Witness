(function () {
  'use strict';
  const G = window.WitnessParty;
  const FX = window.WitnessFX;
  const $ = selector => document.querySelector(selector);
  const app = $('#app'), modalHost = $('#modal-host');
  const TOKEN_KEY = 'last-witness-online-token', NAME_KEY = 'last-witness-online-name';
  const drafts = Object.create(null), marksS = new Set(), marksP = new Set();
  const iconPaths = {
    shield: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z"/><path d="M8 12h8M12 8v8"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="1"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    file: '<path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6m-6 4h6"/>',
    lab: '<path d="M9 2h6M10 2v7L4 20h16L14 9V2M7 15h10"/>',
    question: '<path d="M8 8a4 4 0 1 1 6 3c-2 1-2 2-2 4m0 3v1"/><circle cx="12" cy="12" r="10"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>'
  };
  let token = sessionGet(TOKEN_KEY), nickname = sessionGet(NAME_KEY) || rememberedName();
  let room = null, account = null, capacity = 4, ready = false, restoring = !!token, pending = false;
  let authMode = 'login', authError = '';
  let privateVisible = false, tab = 'question', modalKind = null, lastFocus = null;
  let quality = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'low' : 'high', gore = true;
  let connection = 'busy', connectionText = token ? '접속 복구 중' : '온라인 대기';
  let pollTimer = null, pollBusy = false, generation = 0, toastTimer = null, rulesCache = null;
  let inviteCode = (new URL(window.location.href).searchParams.get('room') || '').trim().toUpperCase().slice(0, 6);

  function sessionGet(key) { try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; } }
  function sessionSet(key, value) { try { value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key); } catch (_) {} }
  function rememberedName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; } }
  function rememberName(name) { nickname = name; sessionSet(NAME_KEY, name); try { localStorage.setItem(NAME_KEY, name); } catch (_) {} }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (iconPaths[name] || iconPaths.file) + '</svg>'; }
  function category(id) { return G.CATEGORIES.find(c => c.id === id); }
  function npc(id) { return G.SUSPECTS.find(p => p.id === id); }
  function place(id) { return G.PLACES.find(p => p.id === id); }
  function roleLabel(id) { return G.ROLES[id]?.label || id; }
  function game() { return room?.game || null; }
  function me() { return room?.members.find(m => m.id === room.meId); }
  function isHost() { return !!room && room.hostId === room.meId; }
  function mine(g = game()) { return !!g?.self && g.turnOwnerId === g.self.id; }
  function playerName(id, g = game()) { return g?.players.find(p => p.id === id)?.name || '참가자'; }
  function truth(secret, id) { const i = G.CATEGORIES.findIndex(c => c.id === id); return i < 3 ? npc(secret.suspectId).bits[i] : place(secret.placeId).bits[i - 3]; }
  function factText(id, value) { const c = category(id); return c ? c.label + ' · ' + c.values[value] : ''; }
  function portrait(index) { return '<div class="photo-sprite" data-photo="s' + index + '" role="img" aria-label="사건 인물 ' + (index + 1) + ' 초상"></div>'; }
  function options(entries, selected) { return entries.map(x => '<option value="' + esc(x.id) + '"' + (x.id === selected ? ' selected' : '') + '>' + esc(x.label || x.name) + '</option>').join(''); }
  function disabled(value) { return value || pending ? ' disabled' : ''; }
  function fieldValue(key, fallback = '') { return esc(drafts[key] ?? fallback); }
  function requestId() { return window.crypto?.randomUUID ? window.crypto.randomUUID() : 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  function toast(message) { clearTimeout(toastTimer); $('#toast-host').innerHTML = '<div class="toast">' + esc(message) + '</div>'; toastTimer = setTimeout(() => { $('#toast-host').innerHTML = ''; }, 4500); }

  function shell(body) {
    return '<div class="shell online-shell"><aside class="rail" aria-label="도구"><div class="brand-mark">' + icon('shield') + '</div><div class="rail-line"></div><span class="rail-word">LAST WITNESS / ONLINE</span><div class="rail-bottom"><button class="rail-button" data-action="rules" aria-label="게임 설명">' + icon('file') + '</button><button class="rail-button" data-action="settings" aria-label="효과 설정">' + icon('eye') + '</button></div></aside><header class="app-header"><div class="brand-name">마지막 목격자 <span class="accent">.</span></div><div class="header-meta"><span class="online-badge">ONLINE / 2–6</span>' + (token && nickname ? '<span class="online-identity">' + esc(nickname) + '</span>' : '') + '<button class="connection" id="connection-status" data-action="refresh" data-state="' + connection + '" title="지금 다시 동기화">' + esc(connectionText) + '</button><button class="text-button" data-action="rules">' + icon('file') + '게임 설명</button>' + (game() && room.status === 'playing' ? '<button class="text-button" data-action="private-toggle">' + icon('lock') + (privateVisible ? '내 정보 가리기' : '내 정보 확인') + '</button>' : '<button class="text-button" data-action="settings">' + icon('eye') + '효과 설정</button>') + (room ? room.status === 'playing' ? '<button class="text-button" data-action="connection-help">접속 안내</button>' : '<button class="text-button" data-action="leave">방 나가기</button>' : '') + (token && !restoring ? '<button class="text-button" data-action="logout">로그아웃</button>' : '') + '</div></header><main class="main" id="main" tabindex="-1">' + guestSaveBanner() + body + '</main><footer class="page-footer"><span>LAST WITNESS · ONLINE</span><span>각자의 비밀 · 함께하는 수사</span></footer></div>';
  }
  function guestSaveBanner() {
    return token && !account && !restoring ? '<section class="account-save-banner" aria-label="현재 참가자 자리 저장"><div><strong>현재 자리를 저장해 두세요.</strong><p>비밀번호를 등록하면 탭을 닫은 뒤에도 같은 방과 역할로 돌아올 수 있습니다.</p></div><button class="btn compact outline" data-action="upgrade">현재 자리 저장 · 비밀번호 등록</button></section>' : '';
  }
  function authFields(mode, upgrade = false) {
    const registration = mode === 'register', nameKey = upgrade ? 'upgradeName' : 'nickname';
    return '<div class="auth-fields" id="auth-fields"><label class="field"><span>' + (registration ? '사용할 고유 닉네임' : '닉네임') + '</span><input id="nickname" data-draft="' + nameKey + '" maxlength="20" autocomplete="username" value="' + fieldValue(nameKey, nickname) + '" placeholder="닉네임 1~20자"' + (pending ? ' disabled' : '') + '></label><label class="field"><span>비밀번호' + (registration ? ' · 8~128자' : '') + '</span><input id="password" type="password" minlength="8" maxlength="128" autocomplete="' + (registration ? 'new-password' : 'current-password') + '" placeholder="' + (registration ? '8자 이상으로 정해 주세요' : '등록한 비밀번호') + '"' + (pending ? ' disabled' : '') + '></label>' + (registration ? '<label class="field"><span>비밀번호 확인</span><input id="password-confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="비밀번호를 다시 입력해 주세요"' + (pending ? ' disabled' : '') + '></label>' : '') + '<p class="auth-error" data-auth-error role="alert"' + (!authError ? ' hidden' : '') + '>' + esc(authError) + '</p><button class="btn primary full" data-action="' + (upgrade ? 'upgrade-submit' : registration ? 'register' : 'login') + '" data-mutate' + disabled(false) + '>' + (upgrade ? '비밀번호 등록 · 현재 자리 저장' : registration ? '계정 만들고 시작하기' : '로그인 · 내 사건으로 돌아가기') + ' ' + icon('arrow') + '</button></div>';
  }
  function authCard() {
    const registration = authMode === 'register';
    return '<section class="online-card login-card account-card" id="online-setup"><div class="eyebrow">' + (registration ? 'CREATE YOUR ACCOUNT' : 'RETURN TO YOUR CASE') + '</div><h2>' + (registration ? '다음에도 이어갈 나의 이름.' : '다시, 나의 사건으로.') + '</h2><p>' + (registration ? '고유한 닉네임과 비밀번호를 정하세요. 탭을 닫아도 같은 계정으로 방과 역할을 이어갑니다.' : '닉네임과 비밀번호로 로그인하면 참여하던 방과 역할이 그대로 돌아옵니다.') + (inviteCode ? '<br><b>' + esc(inviteCode) + '</b> 방으로 초대받았습니다. 기존 사건이 있으면 그 사건으로 먼저 돌아갑니다.' : '') + '</p><div class="auth-tabs" role="tablist" aria-label="계정 접속 방법"><button class="auth-tab ' + (!registration ? 'selected' : '') + '" role="tab" aria-selected="' + !registration + '" aria-controls="auth-fields" data-action="auth-mode" data-mode="login"' + disabled(false) + '>로그인</button><button class="auth-tab ' + (registration ? 'selected' : '') + '" role="tab" aria-selected="' + registration + '" aria-controls="auth-fields" data-action="auth-mode" data-mode="register"' + disabled(false) + '>처음 오셨나요? 계정 만들기</button></div>' + authFields(authMode) + '<p class="online-footer-note">비밀번호는 이 기기에 저장하지 않습니다. 방 기록은 마지막 플레이부터 최대 30일 동안 보관됩니다.</p></section>';
  }

  function introArt() {
    return '<div class="intro-art" aria-hidden="true"><div class="art-circles"></div><span class="evidence-number">08</span><div class="dossier-art"><div class="art-portrait">' + portrait(4) + '<span class="art-bar">IDENTITY UNKNOWN</span></div><div class="blood-art"><svg viewBox="0 0 400 400" fill="currentColor"><path d="M270 0h130v240c-40-10-35-67-66-75-13-4-45 24-49 0-4-28 41-42 28-59-24-32-64 16-75-13-8-23 33-37 32-93Z"/></svg></div></div><div class="art-stamp">LAST WITNESS</div><div class="art-label">CASE FILE 0417 / ONLINE</div></div>';
  }
  function landing() {
    const hero = '<section class="hero"><div class="hero-copy"><div class="eyebrow">ONLINE ASYMMETRIC MYSTERY</div><h1>마지막<span>목격자</span></h1><div class="hero-line"></div><p class="hero-description">각자의 화면에 숨겨진 진실.<br>다섯 번의 수사, 단 한 번의 고발.<br>친구들과 같은 사건에 접속하세요.</p><div class="hero-actions"><button class="btn primary" data-action="scroll-login">사건에 합류하기 ' + icon('arrow') + '</button><button class="btn outline" data-action="rules">게임 설명</button></div></div>' + introArt() + '</section><div class="intro-strip"><div class="intro-stat"><strong>2~6명</strong><span>각자의 기기로 참여</span></div><div class="intro-stat"><strong>초대 코드</strong><span>친구와 같은 방 접속</span></div><div class="intro-stat"><strong>5라운드</strong><span>공동 수사 매 라운드 1회</span></div><div class="intro-stat"><strong>개인 역할</strong><span>내 정보만 나에게</span></div></div>';
    let setup;
    if (restoring) setup = '<section class="online-card login-card" id="online-setup"><div class="eyebrow">RECONNECTING</div><h2>참여 중인 사건을 찾고 있습니다.</h2><p>잠시만 기다려 주세요. 새로고침한 접속을 복구하고 있습니다. 탭을 닫았다면 계정으로 다시 로그인해 돌아올 수 있습니다.</p></section>';
    else if (!token) setup = authCard();
    else setup = '<section id="online-setup"><div class="online-section-title"><div><div class="eyebrow">WELCOME, ' + esc(nickname) + '</div><h1>사건을 만들거나 합류하세요.</h1></div><span class="tag">' + (account ? '계정으로 접속 중' : '이전 참가자 접속') + '</span></div><div class="online-setup-grid"><section class="online-card"><div class="eyebrow">CREATE A ROOM</div><h2>새 사건의 방장이 되기</h2><p>최대 인원을 정하고 초대 링크를 공유하세요.<br>두 명 이상 모두 준비하면 시작할 수 있습니다.</p><div class="count-options" aria-label="방 최대 인원">' + [2, 3, 4, 5, 6].map(n => '<button class="count-button ' + (capacity === n ? 'selected' : '') + '" data-action="capacity" data-count="' + n + '" aria-pressed="' + (capacity === n) + '">' + n + '명</button>').join('') + '</div><button class="btn primary full" data-action="create" data-mutate' + disabled(false) + '>최대 ' + capacity + '명 방 만들기 ' + icon('arrow') + '</button></section><section class="online-card"><div class="eyebrow">JOIN AN INVITATION</div><h2>친구의 사건에 합류하기</h2><p>전달받은 여섯 자리 초대 코드를 입력하세요.</p><label class="field"><span>초대 코드</span><input class="join-code" id="join-code" data-draft="joinCode" maxlength="6" autocomplete="off" spellcheck="false" value="' + fieldValue('joinCode', inviteCode) + '" placeholder="ABC234"></label><button class="btn outline full" data-action="join" data-mutate' + disabled(false) + '>초대받은 방 입장</button></section></div></section>';
    return shell('<div class="online-landing party-intro">' + hero + setup + '<section class="online-how"><ol><li><strong>각자의 화면으로 접속</strong>방장이 초대 링크나 코드를 공유하면 모두 같은 방에 입장합니다.</li><li><strong>혼자 역할을 확인</strong>내 정보는 기본으로 가려집니다. 다른 참가자의 비밀 카드는 내 화면에 오지 않습니다.</li><li><strong>함께 추리하고 이야기</strong>순서대로 개인 행동을 마치고, 탐정의 수사와 자유 토론으로 진실을 좁힙니다.</li></ol></section></div>');
  }

  function lobby() {
    const self = me(), allReady = room.members.length >= 2 && room.members.every(m => m.ready);
    ready = !!self?.ready;
    return shell('<div class="online-lobby"><div class="online-section-title"><div><div class="eyebrow">THE CASE IS GATHERING</div><h1>사람들이 모이면 시작합니다.</h1></div><span class="tag">' + room.members.length + ' / ' + room.capacity + '명</span></div><div class="room-code-box"><div><small>친구에게 알려 줄 초대 코드</small><strong class="code">' + esc(room.code) + '</strong></div><button class="btn outline compact" data-action="copy-invite">' + icon('copy') + '초대 링크 복사</button></div><div class="lobby-grid"><section class="online-card"><div class="eyebrow">PLAYERS IN THE ROOM</div><h2>사건 참가자</h2><div class="lobby-members">' + room.members.map((m, i) => '<article class="lobby-member ' + (m.id === room.meId ? 'me' : '') + '"><div class="member-avatar">' + (i + 1) + '</div><div><div class="member-name">' + esc(m.name) + '</div><div class="member-meta">' + (m.id === room.hostId ? '<span class="tag">방장</span>' : '') + (m.id === room.meId ? '<span class="tag">나</span>' : '') + '<span class="member-online ' + (m.online ? '' : 'offline') + '" data-member-online="' + esc(m.id) + '">' + (m.online ? '접속 중' : '잠시 연결 끊김') + '</span></div></div><span class="member-ready ' + (m.ready ? '' : 'no') + '">' + (m.ready ? '준비 완료' : '준비 중') + '</span>' + (isHost() && m.id !== room.meId ? '<button class="kick-button" data-action="kick" data-id="' + esc(m.id) + '" aria-label="' + esc(m.name) + '님 내보내기">내보내기</button>' : '') + '</article>').join('') + Array.from({ length: Math.max(0, room.capacity - room.members.length) }, () => '<div class="lobby-empty">초대 링크로 다른 참가자가 입장할 수 있습니다.</div>').join('') + '</div><div class="lobby-actions"><button class="btn ' + (ready ? 'outline' : 'primary') + '" data-action="ready" data-mutate' + disabled(false) + '>' + (ready ? '준비 취소' : '준비 완료') + '</button>' + (isHost() ? '<button class="btn primary" data-action="start" data-mutate' + disabled(!allReady) + '>역할 배분 · 사건 시작 ' + icon('arrow') + '</button>' : '') + '</div><p class="lobby-notice">' + (isHost() ? (allReady ? '모두 준비했습니다. 방장이 사건을 시작할 수 있습니다.' : '방장을 포함해 현재 참가자 모두 준비해야 시작할 수 있습니다.') : '준비 완료를 누르고 방장의 시작을 기다려 주세요.') + '<br>현재 인원으로 역할이 배분됩니다. 방이 꽉 차지 않아도 두 명 이상이면 시작할 수 있습니다.</p></section><aside class="online-card"><div class="eyebrow">BEFORE WE BEGIN</div><h2>같은 사건, 서로 다른 비밀.</h2><div class="role-art" data-role="sealed" aria-hidden="true" style="max-width:210px;margin:20px auto"></div><p>탐정의 신원은 모두에게 공개됩니다. 다른 역할과 개인 단서는 각자의 화면에서만 확인합니다.</p><p>수사 진영의 시작 단서는 합계 두 개입니다. 인원이 늘어나도 공동 수사는 매 라운드 한 번, 감식 키트는 합계 한 개입니다.</p><button class="text-button" data-action="rules">온라인 방법과 전체 규칙 ' + icon('arrow') + '</button></aside></div></div>');
  }

  function roster(g) {
    return '<div class="online-roster">' + g.players.map(p => { const m = room.members.find(x => x.gameId === p.id); return '<span class="online-seat ' + (p.id === g.detectiveId ? 'detective ' : '') + (p.id === g.self.id ? 'me' : '') + '">' + esc(p.name) + (p.id === g.detectiveId ? ' · 탐정' : '') + (p.id === g.self.id ? ' · 나' : '') + (m ? '<span class="member-online ' + (m.online ? '' : 'offline') + '" data-member-online="' + esc(m.id) + '">' + (m.online ? '●' : '○') + '</span>' : '') + '</span>'; }).join('') + '</div>';
  }
  function turnBanner(g) {
    const phaseLabels = { reveal: '역할 확인', secret: '개인 행동', investigate: '공동 수사', answer: '공식 답변', discussion: '자유 토론' };
    const mineNow = mine(g);
    let title = g.phase === 'discussion' ? '모두의 이야기를 들을 시간입니다.' : mineNow ? (g.phase === 'investigate' ? '탐정님, 이번 수사를 선택하세요.' : '지금은 내 차례입니다.') : playerName(g.turnOwnerId, g) + '님의 ' + (phaseLabels[g.phase] || '행동') + '을 기다리고 있습니다.';
    const detail = g.phase === 'reveal' ? '순서가 된 참가자가 자기 역할을 확인하고 완료를 눌러 주세요.' : g.phase === 'secret' ? '전원 개인 행동 뒤 탐정의 수사로 이어집니다. 비밀 정보가 필요하면 내 정보 확인을 누르세요.' : g.phase === 'answer' ? '지정된 참가자만 공식 답변을 선택할 수 있습니다. 답변 후 모두의 토론으로 이어집니다.' : g.phase === 'discussion' ? (g.round === 5 ? '마지막 라운드입니다. 함께 토론한 뒤 탐정이 최종 고발합니다.' : '자유 발언은 공식 진술의 거짓말 횟수에 포함되지 않습니다.') : '공동 수사는 라운드마다 한 번입니다. 수사 결과는 모두에게 함께 공개됩니다.';
    return '<section class="online-turn ' + (mineNow ? 'mine' : '') + '"><div><h2>' + esc(title) + '</h2><p>' + esc(detail) + '</p></div><span class="tag">' + (g.phase === 'reveal' ? '준비' : 'R' + g.round + ' / 5') + ' · ' + (phaseLabels[g.phase] || '') + '</span></section>';
  }
  function personalPanel(g) {
    if (!privateVisible) return '<section class="personal-box personal-locked"><div class="role-art" data-role="sealed" aria-hidden="true"></div><div><h2>내 비밀 정보가 가려져 있습니다.</h2><p>내 역할과 개인 단서는 이 화면에서만 확인할 수 있습니다.<br>화면을 벗어나면 다시 가려집니다.</p></div><button class="btn outline" data-action="private-toggle">' + icon('lock') + '내 정보 확인</button></section>';
    const s = g.self, criminal = G.ROLES[s.role].team === 'criminals';
    let info = '';
    if (g.caseSecret) info += '<div class="secret-case-grid"><div><small>실제 사건 인물</small><strong>' + npc(g.caseSecret.suspectId).name + '</strong></div><div><small>실제 범행 장소</small><strong>' + place(g.caseSecret.placeId).name + '</strong></div></div><div class="banner" style="margin-top:12px"><p>진영 공용 거짓말 잔여 <b>' + g.remainingLies + ' / 2회</b><br>나의 은폐 잔여 <b>' + s.sabotageLeft + '회</b>' + (g.partnerIds?.length ? '<br>같은 진영: ' + g.partnerIds.map(id => esc(playerName(id, g))).join(', ') : '') + '</p></div>';
    else if (s.clues.length) info += s.clues.map(c => '<div class="clue-card"><span class="tiny-label">YOUR TRUE MEMORY / 개인 참 단서</span><strong>' + category(c.category).values[c.value] + '</strong><small>' + category(c.category).label + ' · ' + (s.shared.includes(c.category) ? '공식 기록에 공개함' : '아직 본인만 아는 단서') + '</small></div>').join('');
    else info += '<div class="clue-card"><span class="tiny-label">YOUR INFORMATION</span><strong>처음부터 아는 정답 특성은 없습니다.</strong><small>' + (s.role === 'suspect' ? '이번 라운드의 항목을 한 번 보호할 수 있습니다.' : '공식 기록과 다른 사람의 이야기를 함께 검토하세요.') + '</small></div>';
    return '<section class="personal-box"><header class="personal-heading"><strong>' + icon('lock') + ' 나만 보는 개인 화면</strong><button class="text-button" data-action="private-toggle">정보 가리기</button></header><div class="personal-open"><aside class="personal-role"><div class="role-art" data-role="' + s.role + '" role="img" aria-label="내 ' + roleLabel(s.role) + ' 역할 그림"></div><div class="eyebrow">YOUR SECRET ROLE</div><h2>' + roleLabel(s.role) + '</h2><span class="team-badge ' + (criminal ? 'criminals' : '') + '">' + (criminal ? '범인 진영' : '수사 진영') + '</span><p>플레이어 역할과 사건 인물 카드는 서로 다릅니다.</p></aside><div class="personal-information">' + info + '<div class="online-private-actions">' + (mine(g) && g.phase === 'reveal' ? '<button class="btn primary" data-action="role-seen" data-mutate' + disabled(false) + '>내 역할 확인 완료 ' + icon('arrow') + '</button>' : mine(g) && g.phase === 'secret' ? secretControls(g) : mine(g) && g.phase === 'answer' ? answerControls(g) : '<p class="public-warning">' + (g.phase === 'discussion' ? '토론은 공용 화면의 자유 발언에서 진행합니다.' : '내 행동 차례가 되면 이곳에 선택 버튼이 나타납니다.') + '</p>') + '</div></div></div></section>';
  }
  function categorySelect(id, key) { return '<label class="field"><span>항목</span><select id="' + id + '" data-draft="' + key + '">' + options(G.CATEGORIES, drafts[key] || 'coat') + '</select></label>'; }
  function secretControls(g) {
    const s = g.self, share = s.clues.filter(c => !s.shared.includes(c.category));
    let out = '';
    if (share.length) out += '<section class="private-actions"><h3>개인 단서 공식 공개</h3><p>보유한 참 단서 하나를 모두의 공식 증거에 기록합니다.</p><div class="action-options">' + share.map(c => '<button class="btn compact" data-action="share" data-category="' + c.category + '" data-mutate' + disabled(false) + '>' + category(c.category).values[c.value] + ' 공개</button>').join('') + '</div></section>';
    if (['culprit', 'accomplice'].includes(s.role)) out += '<section class="private-actions"><h3>수사 접근 은폐 <span class="tag red">나의 잔여 ' + s.sabotageLeft + '회</span></h3><p>같은 항목의 질문·감식을 한 라운드 지연시킵니다. 공식 증거는 바뀌지 않고 진술 검증은 막지 못합니다.</p>' + (g.sabotage ? '<div class="notice">진영이 이미 ' + category(g.sabotage.category).label + ' 항목을 은폐했습니다.</div>' : '<div class="form-grid">' + categorySelect('seal-category', 'sealCategory') + '<button class="btn danger" data-action="seal" data-mutate' + disabled(!s.sabotageLeft) + '>이 항목 은폐</button></div>') + '</section>';
    if (s.role === 'suspect') out += '<section class="private-actions"><h3>현장 보호 <span class="tag">잔여 ' + s.guardLeft + '회</span></h3><p>이번 라운드의 은폐와 같은 항목을 선택하면 그 방해를 무시합니다.</p><div class="form-grid">' + categorySelect('guard-category', 'guardCategory') + '<button class="btn" data-action="guard" data-mutate' + disabled(!s.guardLeft) + '>이 항목 보호</button></div></section>';
    out += '<section class="private-actions"><h3>수사 항목 제안 <span class="tag">자유 의견</span></h3><div class="form-grid">' + categorySelect('suggest-category', 'suggestCategory') + '<button class="btn outline" data-action="suggest" data-mutate' + disabled(false) + '>이 항목 제안</button></div></section><div class="role-reveal-actions"><button class="btn quiet" data-action="secret-pass" data-mutate' + disabled(false) + '>개인 행동 넘기기</button></div><p class="role-hint">공개·은폐·보호·제안·넘기기 중 하나를 고르면 이번 개인 행동이 끝납니다.</p>';
    return out;
  }
  function answerControls(g) {
    const c = category(g.pending.category);
    let out = '<div class="question-line">공식 질문 · ' + c.label + '<br>' + c.values[0] + ' / ' + c.values[1] + '</div>';
    if (g.caseSecret) { const actual = truth(g.caseSecret, c.id); out += '<p class="small subtle">실제 값: <b>' + c.values[actual] + '</b> · 진영 거짓말 잔여 ' + g.remainingLies + '회</p><div class="answer-grid">' + c.values.map((value, i) => '<button class="choice" data-action="answer" data-value="' + i + '" data-mutate' + disabled(i !== actual && !g.remainingLies) + '><strong>' + value + '</strong><small>' + (i === actual ? '진실한 공식 답변' : '거짓 답변 · 진영 기회 1회 소모') + '</small></button>').join('') + '</div>'; }
    else { const known = g.self.clues.find(f => f.category === c.id) || g.facts.find(f => f.category === c.id); out += '<div class="notice">선한 진영은 확인한 값만 답합니다. 모르는 값을 추측해서 공식 진술로 기록할 수 없습니다.</div><div class="answer-grid"><button class="btn primary" data-action="answer" data-value="' + (known ? known.value : 'unknown') + '" data-mutate' + disabled(false) + '>' + (known ? c.values[known.value] + ' · 확인한 값으로 답변' : '모릅니다 · 공식 진술 추가 없음') + '</button></div>'; }
    return out;
  }

  function factsHTML(g) { return g.facts.length ? g.facts.map(f => '<div class="record-card"><span class="record-label">R' + f.round + ' · ' + ({ share: '개인 단서 공식 공개', search: '현장 조사', audit: '진술 검증' }[f.source] || '공식 증거') + '</span><p>' + factText(f.category, f.value) + '</p><small>확정 · 변경할 수 없는 증거</small></div>').join('') : '<p class="empty">아직 공식 증거가 없습니다.</p>'; }
  function claimsHTML(g) { return g.statements.length ? g.statements.map(s => { const f = g.facts.find(f => f.category === s.category); return '<div class="record-card claim"><span class="record-label">R' + s.round + ' · ' + esc(playerName(s.speakerId, g)) + ' 공식 답변</span><p>' + factText(s.category, s.value) + '</p><small>' + (f ? (f.value === s.value ? '공식 증거와 일치' : '공식 증거와 모순 · 거짓') : '미검증 · 진실 또는 거짓') + '</small></div>'; }).join('') : '<p class="empty">아직 공식 진술이 없습니다.</p>'; }
  function board(g, possible) {
    const ss = new Set(possible.map(c => c.suspectId)), ps = new Set(possible.map(c => c.placeId));
    return '<section class="section-block party-board"><div class="divider-title"><h2><span class="index">01</span>사건 인물 기록</h2><span class="tag">후보 ' + ss.size + ' / 8</span></div><div class="suspect-grid">' + G.SUSPECTS.map((s, i) => '<button class="suspect ' + (marksS.has(s.id) ? 'eliminated ' : '') + (!ss.has(s.id) ? 'auto-excluded' : '') + '" data-action="mark-s" data-id="' + s.id + '" aria-pressed="' + marksS.has(s.id) + '" aria-label="' + s.name + ' · ' + s.bits.map((b, j) => G.CATEGORIES[j].values[b]).join(' · ') + ' · 내 제외 메모"><div class="portrait">' + portrait(i) + '<span class="portrait-id">CASE PERSON / 0' + (i + 1) + '</span></div><div class="suspect-info"><div class="suspect-name">' + s.name + '<span class="tiny-label">0' + (i + 1) + '</span></div><div class="suspect-traits">' + G.CATEGORIES[0].values[s.bits[0]] + ' · ' + (s.bits[1] ? '오른손' : '왼손') + '<br>' + G.CATEGORIES[2].values[s.bits[2]] + '</div>' + (!ss.has(s.id) ? '<span class="auto-label">논리상 제외</span>' : '') + '</div></button>').join('') + '</div><p class="manual-note-legend">카드를 누르면 나만의 제외 메모를 표시합니다. 자동 후보 계산은 공개된 공식 기록만 사용합니다.</p></section><section class="section-block"><div class="divider-title"><h2><span class="index">02</span>범행 장소</h2><span class="tag">후보 ' + ps.size + ' / 4</span></div><div class="place-grid">' + G.PLACES.map((p, i) => '<button class="place ' + (marksP.has(p.id) ? 'eliminated ' : '') + (!ps.has(p.id) ? 'auto-excluded' : '') + '" data-place="' + p.id + '" data-action="mark-p" data-id="' + p.id + '" aria-pressed="' + marksP.has(p.id) + '"><span class="place-id">0' + (i + 1) + '</span><strong>' + p.name + '</strong><small>' + G.CATEGORIES[3].values[p.bits[0]] + ' · ' + G.CATEGORIES[4].values[p.bits[1]] + '</small>' + (!ps.has(p.id) ? '<div class="auto-label">논리상 제외</div>' : '') + '</button>').join('') + '</div></section>';
  }
  function investigation(g) {
    if (g.phase !== 'investigate') return '';
    if (!mine(g)) return '<div class="online-wait"><strong>탐정이 이번 수사를 선택하고 있습니다.</strong>질문·현장 조사·진술 검증 중 하나가 끝나면 결과를 함께 확인합니다.</div>';
    const targets = g.players.filter(p => p.id !== g.self.id);
    let body;
    if (tab === 'question') body = '<h3>다른 참가자에게 한 항목 질문</h3><p>지정된 사람의 개인 화면에 질문이 도착합니다. 답변은 모두의 공식 기록이 됩니다.</p><div class="form-grid"><label class="field"><span>답변할 참가자</span><select id="question-target" data-draft="questionTarget">' + options(targets, drafts.questionTarget) + '</select></label>' + categorySelect('question-category', 'questionCategory') + '</div><button class="btn primary" data-action="question" data-mutate' + disabled(false) + '>이 참가자에게 질문 확정 ' + icon('arrow') + '</button>';
    else if (tab === 'search') body = '<h3>현장 조사 <span class="tag">공용 키트 ' + g.kits + '</span></h3><p>실제 값을 공식 사실로 확인합니다. 은폐에 걸리면 이번 수사는 끝나고 키트는 보존됩니다.</p><div class="action-options">' + G.CATEGORIES.map(c => '<button class="option-button" data-action="search" data-category="' + c.id + '" data-mutate' + disabled(!g.kits || g.facts.some(f => f.category === c.id)) + '>' + c.label + (g.facts.some(f => f.category === c.id) ? ' · 확정' : '') + '</button>').join('') + '</div>';
    else body = '<h3>진술 검증 <span class="tag">공용 키트 ' + g.kits + '</span></h3><p>은폐와 관계없이 실제 값을 확인합니다. 원래 진술은 기록에 남습니다.</p><div class="action-options">' + g.statements.filter(s => !s.audited).map(s => '<button class="option-button" data-action="audit" data-id="' + s.id + '" data-mutate' + disabled(!g.kits) + '>R' + s.round + ' ' + esc(playerName(s.speakerId, g)) + ' · ' + factText(s.category, s.value) + '</button>').join('') + '</div>' + (!g.statements.some(s => !s.audited) ? '<p class="empty">검증할 공식 진술이 없습니다.</p>' : '');
    return '<section class="section-block online-investigation" id="investigation"><div class="divider-title"><h2><span class="index">03</span>탐정의 공동 수사 1회</h2></div><div class="action-tabs" role="tablist">' + [['question', '질문', 'question'], ['search', '현장 조사', 'lab'], ['audit', '진술 검증', 'file']].map(([id, text, name]) => '<button class="tab ' + (tab === id ? 'active' : '') + '" role="tab" aria-selected="' + (tab === id) + '" data-action="tab" data-id="' + id + '">' + icon(name) + text + '</button>').join('') + '</div><div class="action-body">' + body + (tab !== 'question' && !g.kits ? '<p class="notice">공용 감식 키트를 사용했습니다. 질문으로 수사할 수 있습니다.</p>' : '') + '</div><button class="text-button" data-action="skip">이번 공동 수사 넘기기</button></section>';
  }
  function discussion(g) {
    if (g.phase !== 'discussion') return '';
    return '<section class="discussion-scene online-discussion"><div class="eyebrow">OPEN DISCUSSION / FREE SPEECH</div><h2>지금부터는 모두의 차례.</h2><p>기억과 알리바이를 이야기하세요. 자유 발언은 공식 증거가 아니며, 공식 거짓말 횟수에 포함되지 않습니다.</p><div class="online-chat" id="chat-history" aria-live="polite" aria-label="자유 토론 기록">' + (g.notes.length ? g.notes.map(n => '<article class="chat-item ' + (n.speakerId === g.self.id ? 'mine' : '') + '"><div class="chat-meta">R' + n.round + ' · ' + esc(playerName(n.speakerId, g)) + '</div><p>' + esc(n.text) + '</p></article>').join('') : '<div class="empty">아직 기록된 자유 발언이 없습니다. 음성이나 대면 토론과 함께 사용해도 좋습니다.</div>') + '</div><div class="online-note-form"><label class="field"><span>' + esc(g.self.name || nickname) + '님의 자유 발언 · 최대 300자</span><textarea class="free-note" id="chat-text" data-draft="chat" maxlength="300" placeholder="이야기하고 싶은 추리나 의견을 적으세요.">' + fieldValue('chat') + '</textarea></label><button class="btn outline" data-action="send-note" data-mutate' + disabled(false) + '>발언 보내기 ' + icon('arrow') + '</button></div><p class="free-note-hint">내 닉네임으로만 발언합니다. Enter는 줄바꿈, Ctrl/⌘+Enter는 전송입니다.</p></section>';
  }
  function publicGame(g) {
    const possible = G.candidates(g);
    return shell('<div class="party-game online-public-board"><div class="online-section-title"><div><div class="eyebrow">ROOM ' + esc(room.code) + ' / ROUND ' + g.round + ' OF 5</div><h1>같은 사건을 함께 추리합니다.</h1></div><span class="tag">' + room.members.length + '명 접속 방</span></div>' + roster(g) + turnBanner(g) + personalPanel(g) + discussion(g) + '<div class="game-layout"><div><div class="public-status"><div><strong>' + g.round + ' / 5</strong><span>현재 라운드</span></div><div><strong>' + (['reveal', 'secret', 'investigate'].includes(g.phase) ? '1 / 1' : '0 / 1') + '</strong><span>남은 공동 수사</span></div><div><strong>' + g.kits + ' / 1</strong><span>공용 감식 키트</span></div></div>' + board(g, possible) + investigation(g) + (['reveal', 'secret', 'answer'].includes(g.phase) ? '<div class="online-wait"><strong>' + (mine(g) ? '내 차례를 진행해 주세요.' : esc(playerName(g.turnOwnerId, g)) + '님의 차례입니다.') + '</strong>' + (mine(g) ? '위의 내 정보 확인을 열면 이번 단계의 행동을 선택할 수 있습니다.' : '다른 사람의 행동을 기다리는 동안 공식 기록과 사건판을 살펴보세요.') + '</div>' : '') + (g.self.role === 'detective' && (g.phase === 'discussion' || g.phase === 'investigate' && g.round < 5) ? '<div class="online-actions"><button class="btn danger" data-action="accuse">탐정 최종 고발 ' + icon('eye') + '</button>' + (g.phase === 'discussion' && g.round < 5 ? '<button class="btn primary" data-action="end-round" data-mutate' + disabled(false) + '>토론 종료 · 다음 라운드 ' + icon('arrow') + '</button>' : g.round === 5 ? '<span class="public-warning">마지막 라운드 · 토론 후 최종 고발하세요.</span>' : '') + '</div>' : '') + '</div><aside class="side-panel"><div class="eyebrow">SHARED PUBLIC RECORD</div><h2>모두의 수사 기록</h2><p>가능한 사건 <b style="color:var(--gold)">' + possible.length + ' / 32</b><br>공식 답변의 거짓은 진영 합계 최대 2개입니다.</p><div class="mini-heading">OFFICIAL EVIDENCE / 공식 증거</div><div class="record-scroll">' + factsHTML(g) + '</div><div class="mini-heading">FORMAL STATEMENTS / 공식 진술</div><div class="record-scroll">' + claimsHTML(g) + '</div><button class="btn compact outline full" style="margin-top:16px" data-action="ledger">전체 기록 · 후보 조합</button><button class="text-button" data-action="clear-marks">내 제외 메모 초기화</button><p class="online-footer-note">개인 화면의 단서는 공식 공개 전까지 자동 후보 계산에 사용하지 않습니다.</p><div class="timer-line"></div></aside></div></div>');
  }
  function result(g) {
    const r = g.reveal, secret = r.secret, win = g.winner === 'investigators';
    return shell('<div class="result party-result online-result"><header class="result-header"><span class="result-seal">' + (win ? 'CASE CLOSED' : 'CASE UNSOLVED') + '</span><h1>' + (win ? '수사 진영의 승리' : '범인 진영의 승리') + '</h1><p>' + (win ? '사건 인물과 장소를 모두 맞혔습니다. 탐정·목격자·용의자가 함께 승리합니다.' : '최종 고발이 빗나갔습니다. 범인과 공범이 함께 승리합니다.') + '</p></header><div class="case-solution"><article class="solution-card"><span class="eyebrow">실제 사건 인물</span><div class="solution-portrait"><div class="portrait">' + portrait(G.SUSPECTS.findIndex(p => p.id === secret.suspectId)) + '</div></div><h2>' + npc(secret.suspectId).name + '</h2><p>' + npc(secret.suspectId).bits.map((b, i) => G.CATEGORIES[i].values[b]).join(' · ') + '</p></article><article class="solution-card"><span class="eyebrow">실제 범행 장소</span><div class="result-location place" data-place="' + secret.placeId + '" style="height:160px;margin-top:16px"></div><h2>' + place(secret.placeId).name + '</h2><p>' + place(secret.placeId).bits.map((b, i) => G.CATEGORIES[i + 3].values[b]).join(' · ') + '</p></article></div><div class="banner ' + (win ? 'success' : 'error') + '"><p>탐정의 고발: <b>' + npc(g.accusation.suspectId).name + ' / ' + place(g.accusation.placeId).name + '</b><br>' + g.round + '라운드에서 사건 종료</p></div><div class="divider-title"><h2>모든 역할과 진영 공개</h2></div><div class="result-roles">' + r.players.map(p => '<article class="result-role ' + (G.ROLES[p.role].team === g.winner ? 'winner' : '') + '"><div class="role-art" data-role="' + p.role + '" aria-hidden="true"></div><h3>' + esc(p.name) + ' · ' + roleLabel(p.role) + '</h3><p>' + (G.ROLES[p.role].team === 'criminals' ? '범인 진영' : '수사 진영') + '</p>' + (G.ROLES[p.role].team === g.winner ? '<b>공동 승리</b>' : '') + '</article>').join('') + '</div><div class="divider-title"><h2>공식 진술의 진상</h2></div>' + (g.statements.length ? g.statements.map(s => '<div class="record-card claim"><span class="record-label">R' + s.round + ' · ' + esc(playerName(s.speakerId, g)) + '</span><p>' + factText(s.category, s.value) + '</p><small>' + (s.value === truth(secret, s.category) ? '진실' : '거짓 · 실제 ' + category(s.category).values[truth(secret, s.category)]) + '</small></div>').join('') : '<p class="empty">공식 진술 없이 사건이 끝났습니다.</p>') + '<div class="result-actions">' + (isHost() ? '<button class="btn primary" data-action="restart" data-mutate' + disabled(false) + '>같은 참가자로 새 사건 준비</button>' : '<p class="public-warning">방장이 새 사건 준비를 누르면 함께 대기실로 돌아갑니다.</p>') + '<button class="btn outline" data-action="leave">방 나가기</button></div></div>');
  }

  function captureDrafts() { app.querySelectorAll('[data-draft]').forEach(e => { if (e.type !== 'password' && !/password/i.test(e.dataset.draft)) drafts[e.dataset.draft] = e.value; }); }
  function render(skipCapture = false) {
    if (!skipCapture) captureDrafts();
    const active = document.activeElement, focusId = active && app.contains(active) ? active.id : null;
    const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = [window.scrollX, window.scrollY];
    const oldChat = $('#chat-history'), chatScroll = oldChat ? { top: oldChat.scrollTop, atBottom: oldChat.scrollHeight - oldChat.scrollTop - oldChat.clientHeight < 45 } : null;
    const recordScroll = [...app.querySelectorAll('.record-scroll')].map(el => el.scrollTop);
    app.innerHTML = !room ? landing() : room.status === 'lobby' || !room.game ? lobby() : room.status === 'finished' || room.game.phase === 'finished' ? result(room.game) : publicGame(room.game);
    FX?.setPrivate?.(privateVisible); document.body.classList.toggle('private-view', privateVisible);
    if (focusId) { const next = document.getElementById(focusId); if (next && !next.disabled) { next.focus({ preventScroll: true }); if (selection && typeof next.setSelectionRange === 'function' && next.type !== 'number') { try { next.setSelectionRange(...selection); } catch (_) {} } } }
    const nextChat = $('#chat-history'); if (nextChat) nextChat.scrollTop = !chatScroll || chatScroll.atBottom ? nextChat.scrollHeight : chatScroll.top;
    app.querySelectorAll('.record-scroll').forEach((el, i) => { el.scrollTop = recordScroll[i] || 0; });
    window.scrollTo(...scroll); updateConnection(); updateAuthError();
  }
  function updateConnection() { const el = $('#connection-status'); if (el) { el.textContent = connectionText; el.dataset.state = connection; } }
  function updatePresence() { if (!room) return; room.members.forEach(m => document.querySelectorAll('[data-member-online="' + m.id + '"]').forEach(el => { const chip = el.closest('.online-seat'); el.textContent = chip ? (m.online ? '●' : '○') : (m.online ? '접속 중' : '잠시 연결 끊김'); el.classList.toggle('offline', !m.online); })); }
  function acceptRoom(nextRoom, force = false) {
    if (room && nextRoom && room.code === nextRoom.code && nextRoom.revision < room.revision) return;
    const old = room, changedRoom = (old?.code || null) !== (nextRoom?.code || null);
    const phaseChanged = old?.game?.phase !== nextRoom?.game?.phase || old?.game?.turnOwnerId !== nextRoom?.game?.turnOwnerId || old?.game?.round !== nextRoom?.game?.round;
    const changed = changedRoom || old?.revision !== nextRoom?.revision || old?.status !== nextRoom?.status || phaseChanged;
    room = nextRoom;
    const resetDrafts = changedRoom || old?.status === 'finished' && nextRoom?.status === 'lobby';
    if (resetDrafts) { privateVisible = false; marksS.clear(); marksP.clear(); Object.keys(drafts).forEach(k => { if (!['nickname', 'joinCode'].includes(k)) delete drafts[k]; }); closeModal(); }
    if (phaseChanged) { privateVisible = false; if (modalKind && !['rules', 'settings', 'register', 'logout', 'connection'].includes(modalKind)) closeModal(); }
    if (room?.status === 'finished') privateVisible = false;
    if (changed || force) render(resetDrafts); else { updatePresence(); updateConnection(); }
  }
  function acceptAccount(nextAccount) {
    const changed = account?.id !== nextAccount?.id || account?.name !== nextAccount?.name;
    account = nextAccount || null;
    if (account?.name) rememberName(account.name);
    return changed;
  }

  async function request(body) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 14000);
    let response;
    try { response = await fetch('/api/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    let data; try { data = await response.json(); } catch (_) { const error = new Error('서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 동기화해 주세요.'); error.status = response.status; throw error; }
    if (!response.ok || data.error) { const message = typeof data.error === 'string' ? data.error : data.error?.message || data.message || '요청을 처리하지 못했습니다.'; const error = new Error(message); error.status = response.status; error.code = data.code; throw error; }
    return data;
  }
  function expireSession(message = '접속 시간이 만료되었습니다. 닉네임과 비밀번호로 다시 로그인하면 방과 역할을 이어갑니다.') {
    token = ''; room = null; account = null; privateVisible = false; restoring = false; generation += 1;
    authMode = 'login'; authError = message; sessionSet(TOKEN_KEY, ''); clearPasswordFields(); closeModal(); marksS.clear(); marksP.clear();
    Object.keys(drafts).forEach(key => { if (key !== 'nickname') delete drafts[key]; }); render(true);
  }
  async function mutate(op, extra = {}) {
    if (pending) return null;
    captureDrafts(); pending = true; generation += 1;
    document.body.classList.add('is-sending'); document.querySelectorAll('[data-mutate]').forEach(b => { b.disabled = true; });
    connection = 'busy'; connectionText = '요청 전달 중'; updateConnection();
    try {
      const data = await request({ op, ...(token ? { token } : {}), revision: room?.revision ?? null, requestId: requestId(), ...extra });
      if (data.token) { token = data.token; sessionSet(TOKEN_KEY, token); }
      if (op === 'logout') { token = ''; sessionSet(TOKEN_KEY, ''); privateVisible = false; authMode = 'login'; authError = account ? '로그아웃했습니다. 다시 로그인하면 같은 방과 역할로 돌아옵니다.' : '로그아웃했습니다. 비밀번호를 등록하지 않은 이전 자리는 복구할 수 없습니다.'; }
      const accountChanged = Object.prototype.hasOwnProperty.call(data, 'account') ? acceptAccount(data.account) : false;
      connection = 'online'; connectionText = token ? '실시간 동기화' : '로그인 대기'; restoring = false;
      if (Object.prototype.hasOwnProperty.call(data, 'room')) acceptRoom(data.room, accountChanged);
      return data;
    } catch (error) {
      if (op === 'login' && error.status === 401) { authError = '닉네임 또는 비밀번호가 일치하지 않습니다. 입력 내용을 확인해 주세요.'; }
      else if (op === 'register' && error.code === 'NAME_TAKEN') { authError = '이미 사용 중인 닉네임입니다. 다른 닉네임을 정하거나 기존 계정으로 로그인해 주세요.'; }
      else if (['login', 'register'].includes(op) && error.status !== 401) { authError = error.message || '계정 접속을 완료하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'; }
      else if (error.status === 401) { expireSession(); toast('다시 로그인해 내 사건으로 돌아와 주세요.'); }
      else if (error.status === 409 && ['REVISION_CONFLICT', 'BUSY'].includes(error.code)) { toast('방의 상태가 달라졌습니다. 최신 상태를 확인한 뒤 다시 선택해 주세요. 행동은 자동으로 반복하지 않습니다.'); }
      else toast(error.message || '연결을 확인한 뒤 다시 시도해 주세요.');
      connection = error.status ? 'online' : 'offline'; connectionText = error.status ? '최신 상태 확인 중' : '연결 끊김 · 다시 시도';
      return null;
    } finally {
      pending = false; document.body.classList.remove('is-sending'); render();
      if (token) poll();
    }
  }
  function schedulePoll() { clearTimeout(pollTimer); if (token) pollTimer = setTimeout(poll, document.hidden ? 5000 : 2000); }
  async function poll() {
    clearTimeout(pollTimer);
    if (!token || pollBusy || pending) { schedulePoll(); return; }
    pollBusy = true; const atGeneration = generation;
    try {
      const data = await request({ op: 'poll', token, revision: room?.revision ?? null });
      if (atGeneration !== generation) return;
      connection = 'online'; connectionText = '실시간 동기화'; const wasRestoring = restoring; restoring = false;
      const accountChanged = Object.prototype.hasOwnProperty.call(data, 'account') ? acceptAccount(data.account) : false;
      if (Object.prototype.hasOwnProperty.call(data, 'room')) acceptRoom(data.room, accountChanged);
      if (wasRestoring && !room) render(); updateConnection();
    } catch (error) {
      if (atGeneration !== generation) return;
      if (error.status === 401) { expireSession(); toast('다시 로그인해 내 사건으로 돌아와 주세요.'); }
      else { connection = 'offline'; connectionText = '연결 끊김 · 자동 재접속 중'; updateConnection(); if (restoring) { restoring = false; render(); } }
    } finally { pollBusy = false; schedulePoll(); }
  }

  function openModal(kind, title, body) {
    lastFocus = document.activeElement; modalKind = kind;
    modalHost.innerHTML = '<div class="modal-root"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><div class="eyebrow">LAST WITNESS / ONLINE</div><h2 id="modal-title">' + title + '</h2></div><button class="close-btn" data-action="close-modal" aria-label="닫기">×</button></header>' + body + '</section></div>';
    document.body.style.overflow = 'hidden'; modalHost.querySelector('button,select,input,textarea')?.focus();
  }
  function clearPasswordFields() { ['password', 'password-confirm'].forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; }); }
  function updateAuthError() { document.querySelectorAll('[data-auth-error]').forEach(el => { el.textContent = authError; el.hidden = !authError; }); }
  function closeModal() { clearPasswordFields(); modalHost.innerHTML = ''; modalKind = null; document.body.style.overflow = ''; if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true }); }
  function upgradeModal() {
    if (!token || account) return;
    privateVisible = false; authError = ''; render();
    openModal('register', '지금의 방과 역할을 저장하세요', '<p class="small subtle">현재 참가자 자리에 비밀번호를 등록합니다. 진행 중인 방, 역할, 단서, 차례가 그대로 유지됩니다. 등록한 닉네임과 비밀번호로 새 탭에서도 돌아올 수 있습니다.</p>' + authFields('register', true) + '<p class="online-footer-note">닉네임이 이미 사용 중이라면 다른 이름으로 정할 수 있습니다. 사건 속 역할과 단서는 바뀌지 않습니다.</p>');
  }
  function logoutModal() {
    if (!token) return;
    privateVisible = false; render();
    openModal('logout', '로그아웃할까요?', account ? '<p class="small subtle">방과 역할은 그대로 유지됩니다. 탭을 닫아도 같은 닉네임과 비밀번호로 다시 로그인하면 현재 자리로 돌아옵니다.</p><div class="modal-actions"><button class="btn outline" data-action="close-modal">계속 플레이</button><button class="btn danger" data-action="logout-confirm" data-mutate>로그아웃</button></div>' : '<p class="small subtle">아직 비밀번호를 등록하지 않았습니다. 이대로 로그아웃하면 현재 자리를 다시 찾을 수 없습니다. 먼저 현재 자리를 저장해 주세요.</p><div class="modal-actions"><button class="btn primary" data-action="upgrade">비밀번호 등록 · 자리 저장</button><button class="btn danger" data-action="logout-confirm" data-mutate>저장하지 않고 로그아웃</button></div>');
  }
  async function submitAuth(mode, upgrade = false) {
    if (pending) return;
    const name = ($('#nickname')?.value || '').trim();
    const password = $('#password')?.value || '', confirmation = $('#password-confirm')?.value || '';
    clearPasswordFields(); authError = '';
    if (!name || name.length > 20) authError = '닉네임을 1~20자로 입력해 주세요.';
    else if (password.length < 8 || password.length > 128) authError = '비밀번호를 8~128자로 입력해 주세요.';
    else if (mode === 'register' && password !== confirmation) authError = '비밀번호 확인이 일치하지 않습니다. 두 칸을 다시 입력해 주세요.';
    if (authError) { render(); updateAuthError(); return; }
    if (!upgrade) { rememberName(name); drafts.nickname = name; }
    const data = await mutate(mode, { name, password });
    if (!data) { updateAuthError(); return; }
    authError = ''; privateVisible = false;
    if (upgrade) { closeModal(); toast('현재 방과 역할을 계정에 저장했습니다. 다음에도 로그인해 이어갈 수 있습니다.'); }
    if (data.room) inviteCode = '';
    else if (inviteCode && !upgrade) { const code = inviteCode; inviteCode = ''; await mutate('join', { code }); }
    render();
  }
  async function showRules() {
    const online = '<section class="online-rule-intro"><h3>온라인으로 함께하는 방법</h3><p>각자의 기기로 닉네임과 비밀번호를 등록하고 로그인합니다. 방장이 초대 링크나 여섯 자리 코드를 공유하면 같은 방에 입장하세요. 두 명 이상 현재 참가자 모두 준비한 뒤 방장이 시작합니다.</p><p>순서가 된 사람의 화면에만 행동 버튼이 열립니다. 내 정보 확인을 누르면 내 역할·단서를 보고, 화면을 벗어나면 다시 가려집니다. 다른 참가자의 역할 카드는 내 화면에 제공되지 않습니다.</p><p>공식 기록과 차례는 자동으로 동기화됩니다. 탭을 닫거나 로그아웃해도 같은 계정으로 다시 로그인하면 방과 역할이 그대로 돌아옵니다. 로그인 접속은 24시간 유효하며 다시 로그인해 이어갈 수 있습니다. 방 기록은 마지막 플레이부터 최대 30일 동안 보관합니다. 이전 비밀번호 없는 참가자는 현재 자리 저장을 먼저 완료해 주세요.</p></section>';
    openModal('rules', '게임 설명 · 온라인 방법', '<div class="rules-content party-rules">' + online + '<div id="rules-body" class="online-rules-loading">규칙을 불러오고 있습니다.</div></div>');
    try { if (!rulesCache) { const response = await fetch('/party-rules.html', { cache: 'force-cache' }); if (!response.ok) throw new Error(); rulesCache = await response.text(); } if (modalKind === 'rules') { const host = $('#rules-body'); if (host) { host.className = ''; host.innerHTML = rulesCache; } } }
    catch (_) { if (modalKind === 'rules') $('#rules-body').innerHTML = '<p>규칙을 불러오지 못했습니다. <a href="/party-rules.html" target="_blank" rel="noopener">전체 규칙 열기</a></p>'; }
  }
  function settings() { openModal('settings', '분위기 조절', '<p class="small subtle">원본 누아르 이미지 위로 연기·먼지·잔불이 움직입니다. 소리는 없습니다.</p><div class="fx-settings"><label class="check-label">효과 품질 <select id="quality" data-change="quality">' + [['high', '고품질'], ['low', '저사양'], ['off', '끔']].map(([value, text]) => '<option value="' + value + '"' + (quality === value ? ' selected' : '') + '>' + text + '</option>').join('') + '</select></label><label class="check-label"><input type="checkbox" data-change="gore"' + (gore ? ' checked' : '') + '> 혈흔 오버레이</label></div><p class="online-footer-note">혈흔 오버레이를 꺼도 생성 배경에 그려진 사건 흔적은 남습니다.</p>'); }
  function applyFX() { document.body.classList.toggle('gore-off', !gore); document.body.classList.toggle('fx-off', quality === 'off'); document.body.classList.toggle('fx-high', quality === 'high'); FX?.setQuality?.(quality); }
  function privacy() { if (privateVisible) { privateVisible = false; render(); } }
  function ledger() { const g = game(), possible = G.candidates(g); openModal('ledger', '공식 기록과 후보 조합', '<div class="rules-content"><h3>공식 증거 · 항상 진실</h3>' + factsHTML(g) + '<h3>공식 진술 · 거짓은 합계 최대 2회</h3>' + claimsHTML(g) + '<h3>공개 기록 기준 후보 ' + possible.length + '개</h3><div class="candidate-list">' + possible.map(c => '<span class="tag">' + npc(c.suspectId).name + ' / ' + place(c.placeId).name + '</span>').join('') + '</div><p class="online-footer-note">개인 화면에만 있는 단서와 자유 발언, 내 제외 메모는 후보 계산에 넣지 않습니다.</p><h3>진행 기록</h3>' + g.log.map(l => '<p class="small subtle">R' + l.round + ' · ' + esc(l.text) + '</p>').join('') + '</div>'); }
  function accuseModal() { const g = game(); if (!g || g.self.role !== 'detective' || !(g.phase === 'discussion' || g.phase === 'investigate' && g.round < 5)) return; openModal('accuse', '탐정의 최종 고발', '<p class="small subtle">사건 인물 한 명과 장소 한 곳을 고릅니다. 하나라도 틀리면 범인 진영이 승리하며 고발은 한 번뿐입니다.</p><div class="form-grid"><label class="field"><span>사건 인물 · 참가자 역할과 별개</span><select id="accuse-person" data-change="accuse"><option value="">선택하세요</option>' + options(G.SUSPECTS) + '</select></label><label class="field"><span>범행 장소</span><select id="accuse-place" data-change="accuse"><option value="">선택하세요</option>' + options(G.PLACES) + '</select></label></div><div class="notice">확정하면 진상과 모든 역할이 모두에게 공개됩니다.</div><div class="modal-actions"><button class="btn outline" data-action="close-modal">기록 더 보기</button><button class="btn danger" id="confirm-accuse" data-action="confirm-accuse" data-mutate disabled>최종 고발 확정</button></div>'); }
  async function engineAction(event) { const data = await mutate('action', { event }); if (data) { privateVisible = false; render(); } return data; }
  async function copyInvite() { const url = new URL(window.location.origin + window.location.pathname); url.searchParams.set('room', room.code); try { await navigator.clipboard.writeText(url.href); toast('초대 링크를 복사했습니다. 친구에게 전달하세요.'); } catch (_) { openModal('invite', '초대 링크를 복사해 주세요', '<p class="small subtle">아래 주소를 선택해 친구에게 전달하세요.</p><input class="invite-copy" id="invite-link" readonly value="' + esc(url.href) + '">'); $('#invite-link')?.select(); } }

  async function act(action, button) {
    const d = button?.dataset || {};
    if (action === 'scroll-login') { $('#online-setup')?.scrollIntoView({ behavior: quality === 'off' ? 'auto' : 'smooth', block: 'center' }); $('#nickname')?.focus({ preventScroll: true }); }
    else if (action === 'auth-mode') { if (!pending) { clearPasswordFields(); authMode = d.mode === 'register' ? 'register' : 'login'; authError = ''; render(); } }
    else if (action === 'login') await submitAuth('login');
    else if (action === 'register') await submitAuth('register');
    else if (action === 'upgrade') upgradeModal();
    else if (action === 'upgrade-submit') await submitAuth('register', true);
    else if (action === 'logout' || action === 'change-name') logoutModal();
    else if (action === 'logout-confirm') { const data = await mutate('logout'); if (data) { closeModal(); render(); } }
    else if (action === 'capacity') { capacity = Number(d.count); render(); }
    else if (action === 'create') await mutate('create', { capacity });
    else if (action === 'join') { const code = ($('#join-code')?.value || inviteCode || '').trim().toUpperCase(); if (!/^[A-Z2-9]{6}$/.test(code)) { toast('초대 코드 여섯 자리를 확인해 주세요.'); return; } await mutate('join', { code }); }
    else if (action === 'ready') await mutate('ready', { ready: !ready });
    else if (action === 'start') await mutate('start');
    else if (action === 'copy-invite') await copyInvite();
    else if (action === 'connection-help') openModal('connection', '접속을 잠시 벗어날 때', '<p class="small subtle">게임이 진행 중일 때 방과 역할은 유지됩니다. 탭을 닫거나 로그아웃했더라도 같은 계정으로 로그인하면 현재 자리로 돌아옵니다. 로그인 접속은 24시간 유효하며, 만료되면 다시 로그인하면 됩니다. 방 기록은 마지막 플레이부터 최대 30일 보관됩니다.</p><p class="online-footer-note">내 비밀 정보는 창을 벗어날 때 가려집니다. 다른 참가자는 현재 차례를 기다리게 되므로 잠시 자리를 비우면 함께하는 사람에게 알려 주세요.</p>');
    else if (action === 'refresh') await poll();
    else if (action === 'rules') await showRules();
    else if (action === 'rule-jump') { if (['goal', 'components', 'setup', 'play', 'round-end', 'win'].includes(d.id)) modalHost.querySelector('#party-rule-' + d.id)?.scrollIntoView({ block: 'start' }); }
    else if (action === 'settings') settings();
    else if (action === 'close-modal') closeModal();
    else if (action === 'private-toggle') { if (room?.status === 'playing') { privateVisible = !privateVisible; render(); } }
    else if (action === 'role-seen') await engineAction({ type: 'ROLE_SEEN' });
    else if (action === 'share') await engineAction({ type: 'SECRET_ACTION', kind: 'share', category: d.category });
    else if (action === 'seal') await engineAction({ type: 'SECRET_ACTION', kind: 'seal', category: $('#seal-category').value });
    else if (action === 'guard') await engineAction({ type: 'SECRET_ACTION', kind: 'guard', category: $('#guard-category').value });
    else if (action === 'suggest') await engineAction({ type: 'SECRET_ACTION', kind: 'suggest', category: $('#suggest-category').value });
    else if (action === 'secret-pass') await engineAction({ type: 'SECRET_ACTION', kind: 'pass' });
    else if (action === 'answer') await engineAction({ type: 'ANSWER', value: d.value === 'unknown' ? null : Number(d.value) });
    else if (action === 'tab') { tab = d.id; render(); }
    else if (action === 'question') await engineAction({ type: 'INVESTIGATE', kind: 'question', targetId: $('#question-target').value, category: $('#question-category').value });
    else if (action === 'search') await engineAction({ type: 'INVESTIGATE', kind: 'search', category: d.category });
    else if (action === 'audit') await engineAction({ type: 'INVESTIGATE', kind: 'audit', statementId: d.id });
    else if (action === 'skip') openModal('skip', '이번 수사를 넘길까요?', '<p class="small subtle">공동 수사 없이 이번 라운드의 토론으로 넘어갑니다.</p><div class="modal-actions"><button class="btn outline" data-action="close-modal">수사 계속</button><button class="btn danger" data-action="skip-confirm" data-mutate>이번 수사 넘기기</button></div>');
    else if (action === 'skip-confirm') { closeModal(); await engineAction({ type: 'INVESTIGATE', kind: 'pass' }); }
    else if (action === 'mark-s' || action === 'mark-p') { const set = action === 'mark-s' ? marksS : marksP; set.has(d.id) ? set.delete(d.id) : set.add(d.id); render(); }
    else if (action === 'clear-marks') { marksS.clear(); marksP.clear(); render(); }
    else if (action === 'ledger') ledger();
    else if (action === 'send-note') { const text = ($('#chat-text')?.value || '').trim(); if (!text) { toast('자유 발언을 입력해 주세요.'); return; } const data = await mutate('action', { event: { type: 'ADD_NOTE', text } }); if (data) { drafts.chat = ''; const input = $('#chat-text'); if (input) input.value = ''; render(); } }
    else if (action === 'end-round') await engineAction({ type: 'END_ROUND' });
    else if (action === 'accuse') accuseModal();
    else if (action === 'confirm-accuse') { const suspectId = $('#accuse-person')?.value, placeId = $('#accuse-place')?.value; if (suspectId && placeId) { const data = await engineAction({ type: 'ACCUSE', suspectId, placeId }); if (data) closeModal(); } }
    else if (action === 'restart') { const data = await mutate('restart'); if (data) { privateVisible = false; marksS.clear(); marksP.clear(); render(); } }
    else if (action === 'leave') openModal('leave', '이 방에서 나갈까요?', '<p class="small subtle">' + (room?.status === 'playing' ? '진행 중인 사건에서 나갑니다. 다른 참가자의 진행에도 영향을 줄 수 있습니다.' : '다시 참여하려면 초대 코드가 필요합니다.') + '</p><div class="modal-actions"><button class="btn outline" data-action="close-modal">머무르기</button><button class="btn danger" data-action="leave-confirm" data-mutate>방 나가기</button></div>');
    else if (action === 'leave-confirm') { const data = await mutate('leave'); if (data) { closeModal(); inviteCode = ''; const url = new URL(window.location.href); url.searchParams.delete('room'); window.history.replaceState({}, '', url); } }
    else if (action === 'kick') { const target = room.members.find(m => m.id === d.id); if (target) openModal('kick', '참가자를 내보낼까요?', '<p class="small subtle">' + esc(target.name) + '님을 대기실에서 내보냅니다.</p><div class="modal-actions"><button class="btn outline" data-action="close-modal">취소</button><button class="btn danger" data-action="kick-confirm" data-id="' + esc(target.id) + '" data-mutate>내보내기</button></div>'); }
    else if (action === 'kick-confirm') { const data = await mutate('kick', { targetId: d.id }); if (data) closeModal(); }
  }

  document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (!button || button.disabled) return; const action = button.dataset.action; Promise.resolve(act(action, button)).catch(() => toast('요청을 완료하지 못했습니다. 최신 상태를 확인해 주세요.')); if (gore && quality !== 'off' && !['private-toggle', 'close-modal'].includes(action)) FX?.burst?.(event.clientX, event.clientY, 'blood'); });
  document.addEventListener('input', event => { if (event.target.dataset.draft && event.target.type !== 'password' && !/password/i.test(event.target.dataset.draft)) drafts[event.target.dataset.draft] = event.target.value; });
  document.addEventListener('change', event => { const el = event.target; if (el.dataset.draft && el.type !== 'password' && !/password/i.test(el.dataset.draft)) drafts[el.dataset.draft] = el.value; if (el.dataset.change === 'quality') { quality = el.value; applyFX(); } else if (el.dataset.change === 'gore') { gore = el.checked; applyFX(); } else if (el.dataset.change === 'accuse') { const button = $('#confirm-accuse'); if (button) button.disabled = pending || !$('#accuse-person').value || !$('#accuse-place').value; } });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (modalKind) closeModal(); privacy(); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.target.id === 'chat-text') { event.preventDefault(); act('send-note'); }
    else if (event.key === 'Enter' && ['nickname', 'password', 'password-confirm'].includes(event.target.id)) { event.preventDefault(); act(modalKind === 'register' ? 'upgrade-submit' : authMode === 'register' ? 'register' : 'login'); }
    else if (event.key === 'Enter' && event.target.id === 'join-code') { event.preventDefault(); act('join'); }
    if (event.key === 'Tab' && modalKind) { const list = [...modalHost.querySelectorAll('button:not(:disabled),select,input,textarea,a[href]')], first = list[0], last = list.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) privacy(); else poll(); schedulePoll(); });
  window.addEventListener('blur', privacy); window.addEventListener('pagehide', privacy); window.addEventListener('pageshow', event => { if (event.persisted) { privacy(); poll(); } });
  FX?.init?.({ canvas: $('#atmosphere') }); applyFX();
  $('#blood-edge').innerHTML = '<svg viewBox="0 0 400 400" width="100%" height="100%" fill="currentColor"><path d="M270 0h130v240c-40-10-35-67-66-75-13-4-45 24-49 0-4-28 41-42 28-59-24-32-64 16-75-13-8-23 33-37 32-93Z"/><ellipse cx="195" cy="74" rx="12" ry="24"/><circle cx="210" cy="147" r="3"/></svg>';
  render(); if (token) poll();
}());

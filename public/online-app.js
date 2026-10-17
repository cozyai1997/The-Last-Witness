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
    notebook: '<path d="M4 3h13v18H4zM7 7h7M7 11h5M7 15h3M14 17l6-6 2 2-6 6-3 1z"/>',
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

  let chatOpen = false, chatReadCount = 0, privacyLocked = true, autoCueKey = '', activeStoryKey = '', modalSignature = '', ledgerReturn = false;
  let practiceCount = 4, practiceRole = 'detective', practiceSnapshot = null;
  let letterHandles = [];
  let activeNotice = null, reviewLetterKey = '';
  let replayRound = 'all', replayIndex = 0;
  const typedLetters = new Set(), Scene = window.WitnessCasePresentation;
  const U = window.WitnessCaseUI.create({ G, esc, icon, options, category, npc, place, roleLabel, playerName, truth, disabled, fieldValue, drafts, mine, chatSeen: () => chatReadCount });
  const Replay = window.WitnessReplay.create({ G, esc });
  const Seven = window.WitnessSevenUI && window.WitnessSevenData ? window.WitnessSevenUI.create({ data: window.WitnessSevenData, esc, drafts, getGame: game, getRoom: () => room, getModalKind: () => modalKind, send: engineAction, openModal, closeModal, render, modalHost, scene: Scene, privateVisible: () => privateVisible, setPrivateVisible: value => { privateVisible = value; privacyLocked = !value; }, isPending: () => pending, caseId, sessionGet, sessionSet, hidden: () => document.hidden, toast, isHost, practising }) : null;
  function sevenGame(g = game()) { return !!Seven && g?.rulesVersion === 4; }
  function practising() { return !!window.WitnessPractice?.active(); }

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
    return '<div class="shell online-shell"><aside class="rail" aria-label="도구"><div class="brand-mark">' + icon('shield') + '</div><div class="rail-line"></div><span class="rail-word">LAST WITNESS / ONLINE</span><div class="rail-bottom"><button class="rail-button" data-action="rules" aria-label="게임 설명">' + icon('file') + '</button><button class="rail-button" data-action="settings" aria-label="효과 설정">' + icon('eye') + '</button></div></aside><header class="app-header"><div class="brand-name">마지막 목격자 <span class="accent">.</span></div><div class="header-meta"><span class="online-badge">' + (practising() ? 'PRACTICE / LOCAL' : 'ONLINE / 2–6') + '</span>' + ((token || practising()) && nickname ? '<span class="online-identity">' + esc(practising() ? game()?.self.name : nickname) + '</span>' : '') + '<button class="connection" id="connection-status" data-action="refresh" data-state="' + connection + '" title="지금 다시 동기화">' + esc(connectionText) + '</button><button class="text-button" data-action="rules">' + icon('file') + '게임 설명</button>' + (game() && room.status === 'playing' ? '<button class="text-button" data-action="private-toggle">' + icon('lock') + (privateVisible ? '내 정보 가리기' : '내 정보 확인') + '</button>' : '<button class="text-button" data-action="settings">' + icon('eye') + '효과 설정</button>') + (room ? room.status === 'playing' ? '<button class="text-button" data-action="connection-help">접속 안내</button>' : '<button class="text-button" data-action="leave">방 나가기</button>' : '') + (practising() ? '<button class="text-button" data-action="practice-exit">연습 끝내기</button>' : token && !restoring ? '<button class="text-button" data-action="logout">로그아웃</button>' : '') + '</div></header><main class="main" id="main" tabindex="-1">' + (practising() ? '<div class="case-practice-banner"><div>컴퓨터와 연습 중<small>로그인·서버 저장 없이 이 탭에서만 진행됩니다.</small></div><button class="text-button" data-action="practice-exit">연습 끝내기</button></div>' : guestSaveBanner()) + body + '</main><footer class="page-footer"><span>LAST WITNESS · ONLINE</span><span>각자의 비밀 · 함께하는 수사</span></footer></div>' + (game() && room.status === 'playing' ? discussion(game()) : '');
  }
  function guestSaveBanner() {
    return token && !account && !restoring && !practising() ? '<section class="account-save-banner" aria-label="현재 참가자 자리 저장"><div><strong>현재 자리를 저장해 두세요.</strong><p>비밀번호를 등록하면 탭을 닫은 뒤에도 같은 방과 역할로 돌아올 수 있습니다.</p></div><button class="btn compact outline" data-action="upgrade">현재 자리 저장 · 비밀번호 등록</button></section>' : '';
  }
  function authFields(mode, upgrade = false) {
    const registration = mode === 'register', nameKey = upgrade ? 'upgradeName' : 'nickname';
    return '<div class="auth-fields" id="auth-fields"><label class="field"><span>' + (registration ? '사용할 고유 닉네임' : '닉네임') + '</span><input id="nickname" data-draft="' + nameKey + '" maxlength="20" autocomplete="username" value="' + fieldValue(nameKey, nickname) + '" placeholder="닉네임 1~20자"' + (pending ? ' disabled' : '') + '></label><label class="field"><span>비밀번호' + (registration ? ' · 8~16자' : '') + '</span><input id="password" type="password" minlength="8" maxlength="' + (registration ? 16 : 128) + '" autocomplete="' + (registration ? 'new-password' : 'current-password') + '" placeholder="' + (registration ? '8~16자로 정해 주세요' : '등록한 비밀번호') + '"' + (pending ? ' disabled' : '') + '></label>' + (registration ? '<label class="field"><span>비밀번호 확인</span><input id="password-confirm" type="password" minlength="8" maxlength="16" autocomplete="new-password" placeholder="비밀번호를 다시 입력해 주세요"' + (pending ? ' disabled' : '') + '></label>' : '') + '<p class="auth-error" data-auth-error role="alert"' + (!authError ? ' hidden' : '') + '>' + esc(authError) + '</p><button class="btn primary full" data-action="' + (upgrade ? 'upgrade-submit' : registration ? 'register' : 'login') + '" data-mutate' + disabled(false) + '>' + (upgrade ? '비밀번호 등록 · 현재 자리 저장' : registration ? '계정 만들고 시작하기' : '로그인 · 내 사건으로 돌아가기') + ' ' + icon('arrow') + '</button></div>';
  }
  function authCard() {
    const registration = authMode === 'register';
    return '<section class="online-card login-card account-card" id="online-setup"><div class="eyebrow">' + (registration ? 'CREATE YOUR ACCOUNT' : 'RETURN TO YOUR CASE') + '</div><h2>' + (registration ? '다음에도 이어갈 나의 이름.' : '다시, 나의 사건으로.') + '</h2><p>' + (registration ? '고유한 닉네임과 비밀번호를 정하세요. 탭을 닫아도 같은 계정으로 방과 역할을 이어갑니다.' : '닉네임과 비밀번호로 로그인하면 참여하던 방과 역할이 그대로 돌아옵니다.') + (inviteCode ? '<br><b>' + esc(inviteCode) + '</b> 방으로 초대받았습니다. 기존 사건이 있으면 그 사건으로 먼저 돌아갑니다.' : '') + '</p><div class="auth-tabs" role="tablist" aria-label="계정 접속 방법"><button class="auth-tab ' + (!registration ? 'selected' : '') + '" role="tab" aria-selected="' + !registration + '" aria-controls="auth-fields" data-action="auth-mode" data-mode="login"' + disabled(false) + '>로그인</button><button class="auth-tab ' + (registration ? 'selected' : '') + '" role="tab" aria-selected="' + registration + '" aria-controls="auth-fields" data-action="auth-mode" data-mode="register"' + disabled(false) + '>처음 오셨나요? 계정 만들기</button></div>' + authFields(authMode) + '<p class="online-footer-note">새 비밀번호는 8~16자입니다. 이전에 만든 긴 비밀번호도 그대로 로그인할 수 있습니다. 비밀번호는 이 기기에 저장하지 않습니다. 방 기록은 마지막 플레이부터 최대 30일 동안 보관됩니다.</p></section>';
  }

  function introArt() {
    return '<div class="intro-art" aria-hidden="true"><div class="art-circles"></div><span class="evidence-number">08</span><div class="dossier-art"><div class="art-portrait">' + portrait(4) + '<span class="art-bar">IDENTITY UNKNOWN</span></div><div class="blood-art"><svg viewBox="0 0 400 400" fill="currentColor"><path d="M270 0h130v240c-40-10-35-67-66-75-13-4-45 24-49 0-4-28 41-42 28-59-24-32-64 16-75-13-8-23 33-37 32-93Z"/></svg></div></div><div class="art-stamp">LAST WITNESS</div><div class="art-label">CASE FILE 0417 / ONLINE</div></div>';
  }
  function landing() {
    const hero = '<section class="hero"><div class="hero-copy"><div class="eyebrow">ONLINE ASYMMETRIC MYSTERY</div><h1>마지막<span>목격자</span></h1><div class="hero-line"></div><p class="hero-description">각자의 화면에 숨겨진 진실.<br>' + (Seven ? '일곱 날의 수사, 단 한 명의 진범.' : '다섯 번의 수사, 단 한 번의 고발.') + '<br>친구들과 같은 사건에 접속하세요.</p><div class="hero-actions"><button class="btn primary" data-action="scroll-login">사건에 합류하기 ' + icon('arrow') + '</button><button class="btn outline" data-action="rules">게임 설명</button><button class="btn outline" data-action="practice-setup">로그인 없이 컴퓨터와 연습</button></div></div>' + introArt() + '</section><div class="intro-strip"><div class="intro-stat"><strong>2~6명</strong><span>각자의 기기로 참여</span></div><div class="intro-stat"><strong>초대 코드</strong><span>친구와 같은 방 접속</span></div><div class="intro-stat"><strong>' + (Seven ? '7일 수사' : '5라운드') + '</strong><span>' + (Seven ? '질문 하루 1회 · 판별 총 2회' : '공동 수사 매일 1회') + '</span></div><div class="intro-stat"><strong>개인 역할</strong><span>내 정보만 나에게</span></div></div>';
    let setup;
    if (restoring) setup = '<section class="online-card login-card" id="online-setup"><div class="eyebrow">RECONNECTING</div><h2>참여 중인 사건을 찾고 있습니다.</h2><p>잠시만 기다려 주세요. 새로고침한 접속을 복구하고 있습니다. 탭을 닫았다면 계정으로 다시 로그인해 돌아올 수 있습니다.</p></section>';
    else if (!token) setup = authCard();
    else setup = '<section id="online-setup"><div class="online-section-title"><div><div class="eyebrow">WELCOME, ' + esc(nickname) + '</div><h1>사건을 만들거나 합류하세요.</h1></div><span class="tag">' + (account ? '계정으로 접속 중' : '이전 참가자 접속') + '</span></div><div class="online-setup-grid"><section class="online-card"><div class="eyebrow">CREATE A ROOM</div><h2>새 사건의 방장이 되기</h2><p>최대 인원을 정하고 초대 링크를 공유하세요.<br>두 명 이상 모두 준비하면 시작할 수 있습니다.</p><div class="count-options" aria-label="방 최대 인원">' + [2, 3, 4, 5, 6].map(n => '<button class="count-button ' + (capacity === n ? 'selected' : '') + '" data-action="capacity" data-count="' + n + '" aria-pressed="' + (capacity === n) + '">' + n + '명</button>').join('') + '</div><button class="btn primary full" data-action="create" data-mutate' + disabled(false) + '>최대 ' + capacity + '명 방 만들기 ' + icon('arrow') + '</button></section><section class="online-card"><div class="eyebrow">JOIN AN INVITATION</div><h2>친구의 사건에 합류하기</h2><p>전달받은 여섯 자리 초대 코드를 입력하세요.</p><label class="field"><span>초대 코드</span><input class="join-code" id="join-code" data-draft="joinCode" maxlength="6" autocomplete="off" spellcheck="false" value="' + fieldValue('joinCode', inviteCode) + '" placeholder="ABC234"></label><button class="btn outline full" data-action="join" data-mutate' + disabled(false) + '>초대받은 방 입장</button></section></div></section>';
    return shell('<div class="online-landing party-intro">' + hero + setup + '<section class="case-practice-entry"><h3>혼자 먼저 사건을 풀어보고 싶나요?</h3><p>가입 없이 컴퓨터 1~5명과 플레이할 수 있습니다. ' + (Seven ? '인원에 따라 탐정·범인·목격자·독립 용의자·공범을 골라 7일의 흐름을 체험하세요.' : '탐정 또는 범인을 골라 실제 게임 흐름을 체험하세요.') + '</p><button class="btn outline compact" data-action="practice-setup">컴퓨터 테스트 모드 시작</button></section><section class="online-how"><ol><li><strong>각자의 화면으로 접속</strong>방장이 초대 링크나 코드를 공유하면 모두 같은 방에 입장합니다.</li><li><strong>혼자 역할을 확인</strong>내 정보는 기본으로 가려집니다. 다른 참가자의 비밀 카드는 내 화면에 오지 않습니다.</li><li><strong>함께 추리하고 이야기</strong>비밀 준비를 함께 마치고, 증언과 탐정의 수사로 진실을 좁힙니다.</li></ol></section></div>');
  }

  function lobby() {
    const self = me(), allReady = room.members.length >= 2 && room.members.every(m => m.ready);
    ready = !!self?.ready;
    return shell('<div class="online-lobby"><div class="online-section-title"><div><div class="eyebrow">THE CASE IS GATHERING</div><h1>사람들이 모이면 시작합니다.</h1></div><span class="tag">' + room.members.length + ' / ' + room.capacity + '명</span></div><div class="room-code-box"><div><small>친구에게 알려 줄 초대 코드</small><strong class="code">' + esc(room.code) + '</strong></div><button class="btn outline compact" data-action="copy-invite">' + icon('copy') + '초대 링크 복사</button></div><div class="lobby-grid"><section class="online-card"><div class="eyebrow">PLAYERS IN THE ROOM</div><h2>사건 참가자</h2><div class="lobby-members">' + room.members.map((m, i) => '<article class="lobby-member ' + (m.id === room.meId ? 'me' : '') + '"><div class="member-avatar">' + (i + 1) + '</div><div><div class="member-name">' + esc(m.name) + '</div><div class="member-meta">' + (m.id === room.hostId ? '<span class="tag">방장</span>' : '') + (m.id === room.meId ? '<span class="tag">나</span>' : '') + '<span class="member-online ' + (m.online ? '' : 'offline') + '" data-member-online="' + esc(m.id) + '">' + (m.online ? '접속 중' : '잠시 연결 끊김') + '</span></div></div><span class="member-ready ' + (m.ready ? '' : 'no') + '">' + (m.ready ? '준비 완료' : '준비 중') + '</span>' + (isHost() && m.id !== room.meId ? '<button class="kick-button" data-action="kick" data-id="' + esc(m.id) + '" aria-label="' + esc(m.name) + '님 내보내기">내보내기</button>' : '') + '</article>').join('') + Array.from({ length: Math.max(0, room.capacity - room.members.length) }, () => '<div class="lobby-empty">초대 링크로 다른 참가자가 입장할 수 있습니다.</div>').join('') + '</div><div class="lobby-actions"><button class="btn ' + (ready ? 'outline' : 'primary') + '" data-action="ready" data-mutate' + disabled(false) + '>' + (ready ? '준비 취소' : '준비 완료') + '</button>' + (isHost() ? '<button class="btn primary" data-action="start" data-mutate' + disabled(!allReady) + '>역할 배분 · 사건 시작 ' + icon('arrow') + '</button>' : '') + '</div><div class="case-ready-banner ' + (allReady ? 'is-ready' : '') + '" role="status"><span class="case-spinner" aria-hidden="true"></span><div>' + (isHost() ? (allReady ? '모두 준비했습니다. 방장이 사건을 시작할 수 있습니다.' : '방장을 포함해 현재 참가자 모두 준비해야 시작할 수 있습니다.') : '준비 완료를 누르고 방장의 시작을 기다려 주세요.') + '<small>현재 인원으로 역할이 배분됩니다. 방이 꽉 차지 않아도 두 명 이상이면 시작할 수 있습니다.</small></div></div></section><aside class="online-card"><div class="eyebrow">BEFORE WE BEGIN</div><h2>같은 사건, 서로 다른 비밀.</h2><div class="role-art" data-role="sealed" aria-hidden="true" style="max-width:210px;margin:20px auto"></div><p>탐정의 신원은 모두에게 공개됩니다. 다른 역할과 개인 단서는 각자의 화면에서만 확인합니다.</p><p>탐정은 전체 관찰 항목 중 서로 다른 확답 두 개, 목격자는 단서를 한 개씩 받습니다. 탐정은 매 라운드 한 번 질문하며, 참·거짓 판별은 사건 전체에서 두 번 사용할 수 있습니다. 이미 답이 확인된 내용은 자동 제외됩니다.</p><button class="text-button" data-action="rules">온라인 방법과 전체 규칙 ' + icon('arrow') + '</button></aside></div></div>');
  }

  function roster(g) {
    return '<div class="online-roster">' + g.players.map(p => { const m = room.members.find(x => x.gameId === p.id); return '<span class="online-seat ' + (p.id === g.detectiveId ? 'detective ' : '') + (p.id === g.self.id ? 'me' : '') + '">' + esc(p.name) + (p.id === g.detectiveId ? ' · 탐정' : '') + (p.id === g.self.id ? ' · 나' : '') + (m ? '<span class="member-online ' + (m.online ? '' : 'offline') + '" data-member-online="' + esc(m.id) + '">' + (m.online ? '●' : '○') + '</span>' : '') + '</span>'; }).join('') + '</div>';
  }
  function turnBanner(g) { return U.banner(g); }
  function personalPanel(g) { return U.compact(g); }
  function categorySelect(id, key) { return '<label class="field"><span>항목</span><select id="' + id + '" data-draft="' + key + '">' + options(G.CATEGORIES, drafts[key] || 'coat') + '</select></label>'; }
  function secretControls(g) { return U.secretControls(g); }
  function answerControls(g) { return U.answerControls(g); }
  function factsHTML(g) { return g.facts.length ? g.facts.map(f => '<div class="record-card"><span class="record-label">R' + f.round + ' · ' + (g.rulesVersion >= 2 && g.players.length === 2 && f.source === 'share' ? '2인 시작 단서 자동 기록' : ({ share: '개인 단서 공식 공개', search: '현장 조사', audit: '진술 검증' }[f.source] || '공식 증거')) + '</span><p>' + factText(f.category, f.value) + '</p><small>확정 · 변경할 수 없는 증거</small></div>').join('') : '<p class="empty">아직 공식 증거가 없습니다.</p>'; }
  function claimsHTML(g) { return g.statements.length ? g.statements.map(s => { const f = g.facts.find(f => f.category === s.category); return '<div class="record-card claim"><span class="record-label">R' + s.round + ' · ' + esc(playerName(s.speakerId, g)) + ' 공식 답변</span><p>' + factText(s.category, s.value) + '</p><small>' + (f ? (f.value === s.value ? '공식 증거와 일치' : '공식 증거와 모순 · 거짓') : '미검증 · 진실 또는 거짓') + '</small></div>'; }).join('') : '<p class="empty">아직 공식 진술이 없습니다.</p>'; }
  function board(g, possible) {
    const ss = new Set(possible.map(c => c.suspectId)), ps = new Set(possible.map(c => c.placeId));
    return '<section class="section-block party-board"><div class="divider-title"><h2><span class="index">01</span>사건 인물 기록</h2><span class="tag">후보 ' + ss.size + ' / 8</span></div><div class="suspect-grid">' + G.SUSPECTS.map((s, i) => '<button class="suspect ' + (marksS.has(s.id) ? 'eliminated ' : '') + (!ss.has(s.id) ? 'auto-excluded' : '') + '" data-action="mark-s" data-id="' + s.id + '" aria-pressed="' + marksS.has(s.id) + '" aria-label="' + s.name + ' · ' + s.bits.map((b, j) => G.CATEGORIES[j].values[b]).join(' · ') + ' · 내 제외 메모"><div class="portrait">' + portrait(i) + '<span class="portrait-id">CASE PERSON / 0' + (i + 1) + '</span></div><div class="suspect-info"><div class="suspect-name">' + s.name + '<span class="tiny-label">0' + (i + 1) + '</span></div><div class="suspect-traits">' + G.CATEGORIES[0].values[s.bits[0]] + ' · ' + (s.bits[1] ? '오른손' : '왼손') + '<br>' + G.CATEGORIES[2].values[s.bits[2]] + '</div>' + (!ss.has(s.id) ? '<span class="auto-label">논리상 제외</span>' : '') + '</div></button>').join('') + '</div><p class="manual-note-legend">카드를 누르면 나만의 제외 메모를 표시합니다. 자동 후보 계산은 공개된 공식 기록만 사용합니다.</p></section><section class="section-block"><div class="divider-title"><h2><span class="index">02</span>범행 장소</h2><span class="tag">후보 ' + ps.size + ' / 4</span></div><div class="place-grid">' + G.PLACES.map((p, i) => '<button class="place ' + (marksP.has(p.id) ? 'eliminated ' : '') + (!ps.has(p.id) ? 'auto-excluded' : '') + '" data-place="' + p.id + '" data-action="mark-p" data-id="' + p.id + '" aria-pressed="' + marksP.has(p.id) + '"><span class="place-id">0' + (i + 1) + '</span><strong>' + p.name + '</strong><small>' + G.CATEGORIES[3].values[p.bits[0]] + ' · ' + G.CATEGORIES[4].values[p.bits[1]] + '</small>' + (!ps.has(p.id) ? '<div class="auto-label">논리상 제외</div>' : '') + '</button>').join('') + '</div></section>';
  }
  function investigation(g) { return U.investigation(g, tab); }
  function discussion(g) { return U.chat(g, chatOpen); }
  function publicGame(g) {
    if (sevenGame(g)) return shell(Seven.render(g, room));
    const possible = G.candidates(g);
    return shell('<div class="party-game online-public-board"><div class="online-section-title"><div><div class="eyebrow">' + (practising() ? 'COMPUTER PRACTICE' : 'ROOM ' + esc(room.code)) + ' / DAY-' + String(g.round).padStart(2, '0') + '</div><h1>남은 진술, 다섯 번의 수사.</h1></div><span class="tag">' + room.members.length + '명 사건</span></div>' + roster(g) + turnBanner(g) + personalPanel(g) + '<div class="game-layout"><div><div class="public-status"><div><strong>' + g.round + ' / 5</strong><span>현재 라운드</span></div><div><strong>' + (['reveal', 'secret', 'investigate'].includes(g.phase) ? '1 / 1' : '0 / 1') + '</strong><span>남은 공동 수사</span></div><div><strong>' + g.kits + ' / 1</strong><span>감식·검증 공용 기회</span></div></div>' + board(g, possible) + '</div><aside class="side-panel"><div class="eyebrow">SHARED PUBLIC RECORD</div><h2>모두의 수사 기록</h2><p>가능한 사건 <b style="color:var(--gold)">' + possible.length + ' / 32</b><br>공식 답변의 거짓은 진영 합계 최대 2개입니다.</p><div class="mini-heading">OFFICIAL EVIDENCE / 공식 증거</div><div class="record-scroll">' + factsHTML(g) + '</div><div class="mini-heading">FORMAL STATEMENTS / 공식 진술</div><div class="record-scroll">' + claimsHTML(g) + '</div><button class="btn compact outline full" data-action="ledger">' + icon('notebook') + ' 수사기록 열기</button><button class="text-button" data-action="clear-marks">내 제외 메모 초기화</button><p class="online-footer-note">미공개 단서와 자유 발언은 자동 후보 계산에 사용하지 않습니다.</p></aside></div></div>');
  }
  function result(g) {
    if (sevenGame(g)) return shell(Seven.result(g));
    const r = g.reveal, secret = r.secret, win = g.winner === 'investigators';
    return shell('<div class="result party-result online-result"><header class="result-header"><span class="result-seal">' + (win ? 'CASE CLOSED' : 'CASE UNSOLVED') + '</span><h1>' + (win ? '수사 진영의 승리' : '범인 진영의 승리') + '</h1><p>' + (win ? '사건 인물과 장소를 모두 맞혔습니다. 탐정·목격자·용의자가 함께 승리합니다.' : '최종 고발이 빗나갔습니다. 범인과 공범이 함께 승리합니다.') + '</p></header>' + replaySummary(g) + '<div class="case-solution"><article class="solution-card"><span class="eyebrow">실제 사건 인물</span><div class="solution-portrait"><div class="portrait">' + portrait(G.SUSPECTS.findIndex(p => p.id === secret.suspectId)) + '</div></div><h2>' + npc(secret.suspectId).name + '</h2><p>' + npc(secret.suspectId).bits.map((b, i) => G.CATEGORIES[i].values[b]).join(' · ') + '</p></article><article class="solution-card"><span class="eyebrow">실제 범행 장소</span><div class="result-location place" data-place="' + secret.placeId + '" style="height:160px;margin-top:16px"></div><h2>' + place(secret.placeId).name + '</h2><p>' + place(secret.placeId).bits.map((b, i) => G.CATEGORIES[i + 3].values[b]).join(' · ') + '</p></article></div><div class="banner ' + (win ? 'success' : 'error') + '"><p>탐정의 고발: <b>' + npc(g.accusation.suspectId).name + ' / ' + place(g.accusation.placeId).name + '</b><br>' + g.round + '라운드에서 사건 종료</p></div><div class="divider-title"><h2>모든 역할과 진영 공개</h2></div><div class="result-roles">' + r.players.map(p => '<article class="result-role case-result-role ' + (G.ROLES[p.role].team === g.winner ? 'winner' : 'loser') + '"><div class="role-art" data-role="' + p.role + '" aria-hidden="true"></div><h3>' + esc(p.name) + ' · ' + roleLabel(p.role) + '</h3><p>' + (G.ROLES[p.role].team === 'criminals' ? '범인 진영' : '수사 진영') + '</p>' + '<b class="case-team-result">' + (G.ROLES[p.role].team === g.winner ? 'WIN · 공동 승리' : 'LOSE · 진영 패배') + '</b>' + '</article>').join('') + '</div><div class="divider-title"><h2>공식 진술의 진상</h2></div>' + (g.statements.length ? g.statements.map(s => '<div class="record-card claim"><span class="record-label">R' + s.round + ' · ' + esc(playerName(s.speakerId, g)) + '</span><p>' + factText(s.category, s.value) + '</p><small>' + (s.value === truth(secret, s.category) ? '진실' : '거짓 · 실제 ' + category(s.category).values[truth(secret, s.category)]) + '</small></div>').join('') : '<p class="empty">공식 진술 없이 사건이 끝났습니다.</p>') + '<div class="result-actions">' + (isHost() ? '<button class="btn primary" data-action="restart" data-mutate' + disabled(false) + '>같은 참가자로 새 사건 준비</button>' : '<p class="public-warning">방장이 새 사건 준비를 누르면 함께 대기실로 돌아갑니다.</p>') + '<button class="btn outline" data-action="leave">방 나가기</button></div></div>');
  }

  function replaySummary(g) {
    if (g.phase !== 'finished' || !g.reveal) return '';
    const stats = Replay.summary(g);
    return '<section class="case-self-launch case-replay-launch" aria-label="종료된 사건 복기"><div><small>CASE REPLAY / 사건의 뒷면</small><h2>사건 복기</h2><p class="case-caption">질문 ' + stats.questions + '회 · 거짓 공식 답변 ' + stats.lies + '개 · 당시 진술 검증 ' + stats.verified + '회</p></div><button class="btn outline" data-action="replay-open">' + icon('notebook') + '사건 복기 보기</button></section>';
  }
  function openReplay() {
    if (sevenGame()) { Seven.handle('seven-replay'); return; }
    const g = game(); if (room?.status !== 'finished' || g?.phase !== 'finished' || !g.reveal || Scene?.busy()) return;
    if (replayRound !== 'all' && (!Number.isInteger(replayRound) || replayRound < 1 || replayRound > g.round)) replayRound = 'all';
    const list = Replay.events(g, replayRound);
    replayIndex = Math.max(0, Math.min(list.length - 1, Number.isInteger(replayIndex) ? replayIndex : 0));
    openModal('replay', '사건 복기 · 질문과 거짓말의 기록', '<div id="case-replay-body">' + Replay.render(g, { round: replayRound, index: replayIndex }) + '</div>');
  }
  function moveReplay(action, data) {
    const g = game(); if (modalKind !== 'replay' || room?.status !== 'finished' || g?.phase !== 'finished') return;
    if (action === 'replay-round') { const round = Number(data.round); replayRound = data.round === 'all' || !Number.isInteger(round) || round < 1 || round > g.round ? 'all' : round; replayIndex = 0; }
    const last = Math.max(0, Replay.events(g, replayRound).length - 1);
    if (action === 'replay-next') replayIndex += 1;
    else if (action === 'replay-prev') replayIndex -= 1;
    else if (action === 'replay-first') replayIndex = 0;
    else if (action === 'replay-last') replayIndex = last;
    else if (action === 'replay-step' && Number.isInteger(Number(data.index))) replayIndex = Number(data.index);
    replayIndex = Math.max(0, Math.min(last, replayIndex));
    const host = $('#case-replay-body'); if (!host) return;
    host.innerHTML = Replay.render(g, { round: replayRound, index: replayIndex });
    const selector = '[data-action="' + action + '"]' + (action === 'replay-round' ? '[data-round="' + replayRound + '"]' : action === 'replay-step' ? '[data-index="' + replayIndex + '"]' : '');
    const focus = host.querySelector(selector); if (focus && !focus.disabled) focus.focus({ preventScroll: true }); else host.querySelector('#replay-step-title')?.focus({ preventScroll: true });
  }

  function captureDrafts() { [app, modalHost].forEach(host => host.querySelectorAll('[data-draft]').forEach(e => { if (e.type !== 'password' && !/password/i.test(e.dataset.draft)) drafts[e.dataset.draft] = e.value; })); }
  function render(skipCapture = false) {
    if (!skipCapture) captureDrafts();
    if (chatOpen && game()) chatReadCount = game().notes.length;
    const active = document.activeElement, focusId = active && (app.contains(active) || modalHost.contains(active)) ? active.id : null;
    const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = [window.scrollX, window.scrollY];
    const oldChat = $('#chat-history'), chatScroll = oldChat ? { top: oldChat.scrollTop, atBottom: oldChat.scrollHeight - oldChat.scrollTop - oldChat.clientHeight < 45 } : null;
    const recordScroll = [...app.querySelectorAll('.record-scroll')].map(el => el.scrollTop);
    app.innerHTML = !room ? landing() : room.status === 'lobby' || !room.game ? lobby() : room.status === 'finished' || room.game.phase === 'finished' ? result(room.game) : publicGame(room.game);
    refreshCaseModal();
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
    const old = room, changedRoom = (old?.code || null) !== (nextRoom?.code || null) || (old?.caseId || null) !== (nextRoom?.caseId || null);
    const sharedPreparation = old?.game?.flowVersion === 2 && nextRoom?.game?.flowVersion === 2 && old.game.phase === 'secret' && nextRoom.game.phase === 'secret' && old.game.round === nextRoom.game.round;
    const phaseChanged = old?.game?.phase !== nextRoom?.game?.phase || !sharedPreparation && old?.game?.turnOwnerId !== nextRoom?.game?.turnOwnerId || old?.game?.round !== nextRoom?.game?.round;
    const changed = changedRoom || old?.revision !== nextRoom?.revision || old?.status !== nextRoom?.status || phaseChanged;
    room = nextRoom;
    const resetDrafts = changedRoom || old?.status === 'finished' && nextRoom?.status === 'lobby';
    if (resetDrafts) { Seven?.reset(); Scene?.cancel(); activeStoryKey = ''; autoCueKey = ''; replayRound = 'all'; replayIndex = 0; privacyLocked = true; privateVisible = false; marksS.clear(); marksP.clear(); Object.keys(drafts).forEach(k => { if (!['nickname', 'joinCode'].includes(k)) delete drafts[k]; }); closeModal(); }
    if (phaseChanged) { if (modalKind !== 'seven-notice') privateVisible = false; if (modalKind && !activeNotice && !['register', 'logout', 'seven-story', 'seven-notice'].includes(modalKind)) closeModal(); }
    if (room?.status === 'finished') privateVisible = false;
    if (changed || force) render(resetDrafts); else { updatePresence(); updateConnection(); }
    if (changed || force) pumpCaseCues();
  }
  function acceptAccount(nextAccount) {
    const changed = account?.id !== nextAccount?.id || account?.name !== nextAccount?.name;
    account = nextAccount || null;
    if (account?.name) rememberName(account.name);
    return changed;
  }

  async function request(body) {
    if (practising()) return window.WitnessPractice.request(body);
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
    Scene?.cancel(); activeStoryKey = ''; autoCueKey = ''; privacyLocked = true;
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
      const accountChanged = !practising() && Object.prototype.hasOwnProperty.call(data, 'account') ? acceptAccount(data.account) : false;
      connection = 'online'; connectionText = practising() ? '로컬 연습 중' : token ? '실시간 동기화' : '로그인 대기'; restoring = false;
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
      pumpCaseCues(); if (token || practising()) poll();
    }
  }
  function schedulePoll() { clearTimeout(pollTimer); if (token || practising()) pollTimer = setTimeout(poll, document.hidden ? 5000 : 2000); }
  async function poll() {
    clearTimeout(pollTimer);
    if ((!token && !practising()) || pollBusy || pending) { schedulePoll(); return; }
    pollBusy = true; const atGeneration = generation;
    try {
      const data = await request({ op: 'poll', token, revision: room?.revision ?? null });
      if (atGeneration !== generation) return;
      connection = 'online'; connectionText = practising() ? '로컬 연습 중' : '실시간 동기화'; const wasRestoring = restoring; restoring = false;
      const accountChanged = !practising() && Object.prototype.hasOwnProperty.call(data, 'account') ? acceptAccount(data.account) : false;
      if (Object.prototype.hasOwnProperty.call(data, 'room')) acceptRoom(data.room, accountChanged);
      if (wasRestoring && !room) render(); updateConnection();
    } catch (error) {
      if (atGeneration !== generation) return;
      if (error.status === 401) { expireSession(); toast('다시 로그인해 내 사건으로 돌아와 주세요.'); }
      else { connection = 'offline'; connectionText = '연결 끊김 · 자동 재접속 중'; updateConnection(); if (restoring) { restoring = false; render(); } }
    } finally { pollBusy = false; schedulePoll(); }
  }

  function openModal(kind, title, body) {
    const modern = kind.startsWith('seven-');
    lastFocus = document.activeElement; modalKind = kind;
    modalHost.innerHTML = '<div class="modal-root ' + (modern || ['personal', 'review', 'obstruction', 'practice', 'replay'].includes(kind) ? 'case-modal-root' : '') + '"><section class="modal" role="dialog" aria-modal="' + (!['personal', 'review', 'obstruction', 'seven-personal', 'seven-review'].includes(kind)) + '" aria-labelledby="modal-title"><header class="modal-head">' + (['personal', 'review', 'seven-personal', 'seven-review'].includes(kind) ? '<button class="case-ledger-launch" data-action="ledger" aria-label="종이와 펜 · 수사기록 열기">' + icon('notebook') + '<span>수사기록</span></button>' : '') + '<div><div class="eyebrow">LAST WITNESS / ONLINE</div><h2 id="modal-title">' + title + '</h2></div><button class="close-btn" data-action="close-modal" aria-label="닫기">×</button></header>' + body + '</section></div>';
    document.body.style.overflow = 'hidden'; modalHost.querySelector('button,select,input,textarea')?.focus();
  }
  function clearPasswordFields() { ['password', 'password-confirm'].forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; }); }
  function updateAuthError() { document.querySelectorAll('[data-auth-error]').forEach(el => { el.textContent = authError; el.hidden = !authError; }); }
  function closeModal() { Seven?.onClose(); activeNotice?.handle?.cancel?.(); activeNotice = null; reviewLetterKey = ''; letterHandles.forEach(h => h.cancel?.()); letterHandles = []; modalSignature = ''; clearPasswordFields(); modalHost.innerHTML = ''; modalKind = null; document.body.style.overflow = ''; if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true }); }
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
    else if (password.length < 8 || password.length > (mode === 'register' ? 16 : 128)) authError = mode === 'register' ? '비밀번호를 8~16자로 입력해 주세요.' : '등록한 비밀번호를 입력해 주세요.';
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
    const online = '<section class="online-rule-intro"><h3>온라인으로 함께하는 방법</h3><p>각자의 기기로 닉네임과 비밀번호를 등록하고 로그인합니다. 방장이 초대 링크나 여섯 자리 코드를 공유하면 같은 방에 입장하세요. 두 명 이상 현재 참가자 모두 준비한 뒤 방장이 시작합니다.</p><p>새 사건은 모든 참가자가 비밀 준비를 동시에 할 수 있습니다. 공식 질문과 답변은 해당 참가자의 화면에 열립니다. 내 정보 확인을 누르면 내 역할·단서를 보고, 화면을 벗어나면 다시 가려집니다. 다른 참가자의 역할 카드는 내 화면에 제공되지 않습니다.</p><p>공식 기록과 차례는 자동으로 동기화됩니다. 탭을 닫거나 로그아웃해도 같은 계정으로 다시 로그인하면 방과 역할이 그대로 돌아옵니다. 로그인 접속은 24시간 유효하며 다시 로그인해 이어갈 수 있습니다. 방 기록은 마지막 플레이부터 최대 30일 동안 보관합니다. 이전 비밀번호 없는 참가자는 현재 자리 저장을 먼저 완료해 주세요.</p></section>';
    openModal('rules', '게임 설명 · 온라인 방법', '<div class="rules-content party-rules">' + online + '<div id="rules-body" class="online-rules-loading">규칙을 불러오고 있습니다.</div></div>');
    try { if (!rulesCache) { const response = await fetch('/party-rules.html', { cache: 'force-cache' }); if (!response.ok) throw new Error(); rulesCache = await response.text(); } if (modalKind === 'rules') { const host = $('#rules-body'); if (host) { host.className = ''; host.innerHTML = rulesCache; } } }
    catch (_) { if (modalKind === 'rules') $('#rules-body').innerHTML = '<p>규칙을 불러오지 못했습니다. <a href="/party-rules.html" target="_blank" rel="noopener">전체 규칙 열기</a></p>'; }
  }
  function settings() { openModal('settings', '분위기 조절', '<p class="small subtle">원본 누아르 이미지 위로 연기·먼지·잔불이 움직입니다. 배경음악은 오른쪽 아래에서 따로 조절하세요.</p><div class="fx-settings"><label class="check-label">효과 품질 <select id="quality" data-change="quality">' + [['high', '고품질'], ['low', '저사양'], ['off', '끔']].map(([value, text]) => '<option value="' + value + '"' + (quality === value ? ' selected' : '') + '>' + text + '</option>').join('') + '</select></label><label class="check-label"><input type="checkbox" data-change="gore"' + (gore ? ' checked' : '') + '> 혈흔 오버레이</label></div><p class="online-footer-note">혈흔 오버레이를 꺼도 생성 배경에 그려진 사건 흔적은 남습니다.</p>'); }
  function applyFX() { document.body.classList.toggle('gore-off', !gore); document.body.classList.toggle('fx-off', quality === 'off'); document.body.classList.toggle('fx-high', quality === 'high'); FX?.setQuality?.(quality); }
  function privacy() { privacyLocked = true; if (sevenGame()) Seven.privacy(); if (activeNotice && game()?.self.role === 'culprit') closeModal(); if (privateVisible) { privateVisible = false; render(); } }
  function ledger() { if (sevenGame()) { Seven.handle('seven-ledger'); return; } ledgerReturn = ['personal', 'review'].includes(modalKind); const g = game(), possible = G.candidates(g); openModal('ledger', '공식 기록과 후보 조합', '<div class="rules-content"><h3>공식 증거 · 항상 진실</h3>' + factsHTML(g) + '<h3>공식 진술 · 거짓은 합계 최대 2회</h3>' + claimsHTML(g) + '<h3>공개 기록 기준 후보 ' + possible.length + '개</h3><div class="candidate-list">' + possible.map(c => '<span class="tag">' + npc(c.suspectId).name + ' / ' + place(c.placeId).name + '</span>').join('') + '</div><p class="online-footer-note">개인 화면에만 있는 단서와 자유 발언, 내 제외 메모는 후보 계산에 넣지 않습니다.</p><h3>진행 기록</h3>' + g.log.map(l => '<p class="small subtle">R' + l.round + ' · ' + esc(l.text) + '</p>').join('') + '</div>'); }
  function accuseModal() {
    if (sevenGame()) { Seven.openPersonal(); return; }
    const g = game(); if (!g || g.self.role !== 'detective' || !(g.phase === 'final' || g.phase === 'discussion' || g.phase === 'investigate' && g.round < 5)) return;
    const possible = window.WitnessDetectiveOptions.accusationCandidates(g), suspects = possible.suspects.filter(s => !marksS.has(s.id)), places = possible.places.filter(p => !marksP.has(p.id));
    openModal('accuse', '탐정의 최종 고발', '<p class="small subtle">공식 증거와 나의 참 단서, 내 제외 메모를 반영한 후보만 표시합니다. 인물과 장소 중 하나라도 틀리면 범인 진영이 승리하며 고발은 한 번뿐입니다.</p><div class="form-grid"><label class="field"><span>사건 인물 · 참가자 역할과 별개</span><select id="accuse-person" data-change="accuse"><option value="">선택하세요</option>' + options(suspects) + '</select></label><label class="field"><span>범행 장소</span><select id="accuse-place" data-change="accuse"><option value="">선택하세요</option>' + options(places) + '</select></label></div>' + (!suspects.length || !places.length ? '<div class="notice">내 제외 메모 때문에 선택할 후보가 없습니다. 메모를 다시 검토하거나 초기화하세요.<button class="text-button" data-action="clear-marks">내 제외 메모 초기화</button></div>' : '') + '<div class="notice">내 제외 메모는 나의 판단이며 확정 증거가 아닙니다. 확정하면 진상과 모든 역할이 모두에게 공개됩니다.</div><div class="modal-actions"><button class="btn outline" data-action="close-modal">기록 더 보기</button><button class="btn danger" id="confirm-accuse" data-action="confirm-accuse" data-mutate disabled>최종 고발 확정</button></div>');
  }
  async function engineAction(event) { return mutate('action', { event }); }
  async function copyInvite() { const url = new URL(window.location.origin + window.location.pathname); url.searchParams.set('room', room.code); try { await navigator.clipboard.writeText(url.href); toast('초대 링크를 복사했습니다. 친구에게 전달하세요.'); } catch (_) { openModal('invite', '초대 링크를 복사해 주세요', '<p class="small subtle">아래 주소를 선택해 친구에게 전달하세요.</p><input class="invite-copy" id="invite-link" readonly value="' + esc(url.href) + '">'); $('#invite-link')?.select(); } }

  function caseId() { return room?.caseId || room?.code + '-legacy'; }
  function turnCueKey(g) { return caseId() + ':' + g.round + ':' + g.phase + ':' + g.turnOwnerId; }
  function animateLetters() {
    if (!Scene?.type) return;
    const reviewing = modalKind === 'review', letterKey = reviewing ? caseId() + ':' + game()?.round + ':' + JSON.stringify(game()?.review) : '';
    if (reviewing) reviewLetterKey = letterKey;
    const handles = [];
    modalHost.querySelectorAll('[data-handwritten]').forEach(el => {
      const text = el.dataset.text || el.textContent, key = caseId() + ':' + game()?.round + ':' + text;
      if (typedLetters.has(key)) return;
      const handle = Scene.type(el, text, { speed: 24 }); letterHandles.push(handle); handles.push(handle);
      Promise.resolve(handle.promise).then(result => { if (!result?.cancelled) typedLetters.add(key); });
    });
    if (reviewing && handles.some(h => !h.done)) {
      modalHost.querySelectorAll('[data-action="review-confirm"],[data-action="review-audit"]').forEach(b => { b.disabled = true; });
      const actions = modalHost.querySelector('.case-review-actions');
      if (actions) actions.innerHTML = '<button class="btn outline" data-action="letter-finish">빠르게 보기</button>' + actions.innerHTML;
      Promise.all(handles.map(h => h.promise)).then(results => {
        if (results.some(r => r?.cancelled) || modalKind !== 'review' || reviewLetterKey !== letterKey) return;
        if (caseId() + ':' + game()?.round + ':' + JSON.stringify(game()?.review) !== letterKey) { refreshCaseModal(true); return; }
        modalHost.querySelectorAll('[data-action="review-confirm"],[data-action="review-audit"]').forEach(b => { b.disabled = pending || b.dataset.action === 'review-audit' && !game()?.kits; });
        const fast = modalHost.querySelector('[data-action="letter-finish"]'); if (fast) fast.hidden = true;
      });
    }
  }
  function refreshCaseModal(force = false) {
    if (sevenGame()) { Seven.refresh(force); return; }
    const g = game();
    if (!g || !['personal', 'review'].includes(modalKind)) return;
    const next = JSON.stringify([modalKind, privateVisible, pending, tab, g.phase, g.round, g.turnOwnerId, g.self, g.caseSecret, g.kits, g.remainingLies, g.sabotage, g.pending, g.review, g.facts, g.statements, drafts.questionCategory, drafts.questionTarget, drafts.questionProposed]);
    if (!force && next === modalSignature) return;
    if (modalKind === 'review' && letterHandles.some(h => !h.done)) return;
    modalSignature = next;
    letterHandles.forEach(h => h.cancel?.()); letterHandles = [];
    const host = $('#case-window-body');
    if (host) host.innerHTML = modalKind === 'personal' ? U.personal(g, privateVisible, tab) : U.review(g);
    animateLetters();
  }
  function openPersonal() {
    if (sevenGame()) { Seven.openPersonal(); return; }
    const g = game(); if (!g || room.status !== 'playing') return;
    if (g.self.role === 'detective' && g.phase === 'discussion') { openReview(); return; }
    if (modalKind !== 'personal') openModal('personal', g.phase === 'answer' && mine(g) ? '탐정의 질문' : mine(g) && g.phase !== 'reveal' ? '나의 차례 · 사건 수첩' : '나만 보는 개인 화면', '<div id="case-window-body"></div>');
    modalSignature = ''; refreshCaseModal();
  }
  function openReview() {
    if (sevenGame()) { Seven.openReview(); return; }
    const g = game(); if (!g || g.self.role !== 'detective' || g.phase !== 'discussion') return;
    if (modalKind !== 'review') openModal('review', '도착한 수사 결과', '<div id="case-window-body"></div>');
    modalSignature = ''; refreshCaseModal();
  }
  function openTurnCue() {
    const g = game(); if (!g || document.hidden || activeNotice || Scene?.busy()) return;
    if (modalKind && !['personal', 'review', 'obstruction'].includes(modalKind)) return;
    const key = turnCueKey(g), initialKey = caseId() + ':personal-opened';
    if (g.phase === 'finished') return;
    if (!sessionGet(initialKey)) {
      sessionSet(initialKey, '1'); autoCueKey = key; privateVisible = false; openPersonal(); return;
    }
    if (!mine(g) || key === autoCueKey) return;
    autoCueKey = key;
    if (g.phase === 'discussion') openReview();
    else { privateVisible = !privacyLocked && !document.hidden; openPersonal(); }
  }
  function pumpCaseCues() {
    if (sevenGame()) { Seven.pump(); return; }
    const g = game(); if (!g || document.hidden || room.status === 'lobby') return;
    if (activeNotice || Scene?.busy()) return;
    if (showCaseNotice(g)) return;
    const stage = g.phase === 'finished' ? 'ending' : g.phase === 'final' ? 'final' : g.round === 1 ? 'start' : 'round';
    const key = caseId() + ':story:' + stage + ':' + g.round;
    if (!sessionGet(key) && Scene?.showStory) {
      if (activeStoryKey === key) return;
      if (modalKind && !['personal', 'review', 'obstruction'].includes(modalKind)) return;
      Scene.cancel(); closeModal(); activeStoryKey = key; sessionSet(key, '1');
      const expectedCase = caseId();
      const show = () => { if (caseId() !== expectedCase) return; Scene.showStory({ key, day: g.round, stage, winner: g.winner, suspectName: g.reveal ? npc(g.reveal.secret.suspectId).name : undefined, placeName: g.reveal ? place(g.reveal.secret.placeId).name : undefined, onDone: () => { if (caseId() !== expectedCase) return; activeStoryKey = ''; pumpCaseCues(); } }); };
      if (stage === 'round' && Scene.showDay) Scene.showDay(g.round, { onDone: show }); else show();
      return;
    }
    if (!Scene?.busy()) openTurnCue();
  }
  function showCaseNotice(g) {
    const notices = [], culprit = g.self.role === 'culprit';
    if (culprit) {
      const outcomes = g.self.sealOutcomes?.length ? g.self.sealOutcomes : g.self.sealOutcome ? [g.self.sealOutcome] : [];
      outcomes.forEach(o => { if (Number.isInteger(o.round) && typeof o.success === 'boolean') notices.push({ key: caseId() + ':seal:' + o.round, title: o.success ? '은폐가 성공했습니다.' : '은폐가 실패했습니다.', text: o.success ? '당신이 감춘 기록 앞에서 수사가 멈췄습니다. 오늘의 은폐는 성공했습니다. 이미 공개된 증거는 바뀌지 않습니다.' : '감춘 기록이 오늘의 수사를 막지 못했습니다. 은폐에 쓴 기회는 되돌아오지 않습니다. 다음 선택을 준비하세요.' }); });
    } else if (g.self.role !== 'detective') {
      const rounds = new Set((g.questionHistory || []).filter(q => q.status === 'blocked').map(q => q.round));
      if (g.review?.kind === 'blocked') rounds.add(g.review.round || g.round);
      rounds.forEach(day => notices.push({ key: caseId() + ':blocked:' + day, title: '누군가 기록에 손을 댔습니다.', text: '기록의 일부가 지워져, 오늘 이 항목의 수사를 진행할 수 없습니다. 이미 확보한 증거는 그대로 남아 있습니다.' }));
    }
    const notice = notices.find(n => !sessionGet(n.key)); if (!notice) return false;
    if (modalKind && !['personal', 'review', 'obstruction'].includes(modalKind)) return false;
    closeModal();
    openModal('obstruction', notice.title, '<p class="case-letter-label">DAY-' + String(Number(notice.key.split(':').at(-1))).padStart(2, '0') + ' / ' + (culprit ? 'PRIVATE RECORD' : 'CASE RECORD') + '</p><p class="case-hand" id="case-notice-text"></p><div class="case-review-actions"><button class="btn outline" data-action="notice-finish">빠르게 보기</button><button class="btn primary" data-action="notice-continue" disabled>계속</button></div>');
    const current = { ...notice, case: caseId(), ready: false, handle: null }; activeNotice = current;
    const element = $('#case-notice-text');
    const done = result => {
      if (result?.cancelled || activeNotice !== current || current.case !== caseId()) return;
      current.ready = true; const next = modalHost.querySelector('[data-action="notice-continue"]'); if (next) next.disabled = false;
      const fast = modalHost.querySelector('[data-action="notice-finish"]'); if (fast) fast.hidden = true;
    };
    if (Scene?.type) { current.handle = Scene.type(element, notice.text, { speed: 24 }); Promise.resolve(current.handle.promise).then(done); }
    else { element.textContent = notice.text; done({ cancelled: false }); }
    return true;
  }
  function finishNotice() {
    if (!activeNotice) return;
    if (!activeNotice.ready) { activeNotice.handle?.finish?.(); return; }
    sessionSet(activeNotice.key, '1'); closeModal(); pumpCaseCues();
  }
  function practiceSetup() {
    const roles = Seven ? [['detective','탐정'],['culprit','범인'], ...(practiceCount >= 3 ? [['witness','목격자']] : []), ...(practiceCount >= 4 ? [['suspect','독립 용의자 S']] : []), ...(practiceCount === 6 ? [['accomplice','공범']] : []), ['random','무작위']] : [['detective','탐정'],['culprit','범인'],['random','무작위']];
    if (!roles.some(([id]) => id === practiceRole)) practiceRole = 'detective';
    openModal('practice', '컴퓨터와 사건 연습', '<div class="case-practice-options"><p class="case-practice-note">로그인 없이 실제 규칙으로 연습합니다. 나를 제외한 참가자는 컴퓨터가 맡습니다. 연습 상태는 이 탭에서만 유지됩니다.</p><div><h3>나를 포함한 참가 인원</h3><div class="count-options">' + [2,3,4,5,6].map(n => '<button class="count-button ' + (practiceCount === n ? 'selected' : '') + '" data-action="practice-count" data-count="' + n + '" aria-pressed="' + (practiceCount === n) + '">' + n + '명</button>').join('') + '</div></div><div><h3>나의 역할</h3><div class="case-practice-role">' + roles.map(([id,label]) => '<button class="' + (practiceRole === id ? 'selected' : '') + '" data-action="practice-role" data-role="' + id + '" aria-pressed="' + (practiceRole === id) + '">' + label + '</button>').join('') + '</div></div><button class="btn primary full" data-action="practice-start">연습 사건 시작 ' + icon('arrow') + '</button></div>');
  }
  async function startPractice() {
    if (pending || practising()) return;
    if (!window.WitnessPractice) { toast('연습 파일을 준비하지 못했습니다. 새로고침해 주세요.'); return; }
    captureDrafts(); practiceSnapshot = { room, account, nickname, connection, connectionText, restoring }; clearTimeout(pollTimer); generation += 1; replayRound = 'all'; replayIndex = 0;
    Scene?.cancel(); activeStoryKey = ''; autoCueKey = ''; privateVisible = false; privacyLocked = true; chatOpen = false; chatReadCount = 0; closeModal();
    const data = await window.WitnessPractice.start({ count: practiceCount, role: practiceRole, ...(Seven ? { rulesVersion: 4 } : {}), name: '플레이어', onChange: data => { if (practising()) acceptRoom(data.room); } });
    connection = 'online'; connectionText = '로컬 연습 중'; restoring = false; acceptRoom(data.room, true); schedulePoll();
  }
  async function stopPractice() {
    if (!practising()) return;
    window.WitnessPractice.stop(); Scene?.cancel(); closeModal(); generation += 1; clearTimeout(pollTimer); activeStoryKey = ''; autoCueKey = ''; replayRound = 'all'; replayIndex = 0; privateVisible = false; privacyLocked = true;
    const saved = practiceSnapshot; practiceSnapshot = null; room = saved?.room || null; account = saved?.account || null; nickname = saved?.nickname || nickname; restoring = saved?.restoring || false; connection = saved?.connection || 'online'; connectionText = saved?.connectionText || '로그인 대기'; chatOpen = false; chatReadCount = 0; render(true); if (token) poll();
  }

  async function act(action, button) {
    if (sevenGame() && await Seven.handle(action, button?.dataset)) return;
    if (activeNotice && !['notice-finish', 'notice-continue', 'chat-toggle', 'send-note', 'refresh', 'practice-exit', 'logout-confirm', 'restart', 'leave-confirm'].includes(action)) { if (action === 'close-modal') finishNotice(); return; }
    const d = button?.dataset || {};
    if (action === 'notice-finish') { activeNotice?.handle?.finish?.(); return; }
    if (action === 'notice-continue') { if (activeNotice?.ready) finishNotice(); return; }
    if (action === 'letter-finish') { letterHandles.forEach(h => h.finish?.()); return; }
    if (action === 'replay-open') { openReplay(); return; }
    if (['replay-round', 'replay-step', 'replay-prev', 'replay-next', 'replay-first', 'replay-last'].includes(action)) { moveReplay(action, d); return; }
    if (action === 'scroll-login') { $('#online-setup')?.scrollIntoView({ behavior: quality === 'off' ? 'auto' : 'smooth', block: 'center' }); $('#nickname')?.focus({ preventScroll: true }); }
    else if (action === 'auth-mode') { if (!pending) { clearPasswordFields(); authMode = d.mode === 'register' ? 'register' : 'login'; authError = ''; render(); } }
    else if (action === 'login') await submitAuth('login');
    else if (action === 'register') await submitAuth('register');
    else if (action === 'upgrade') upgradeModal();
    else if (action === 'upgrade-submit') await submitAuth('register', true);
    else if (action === 'logout' || action === 'change-name') logoutModal();
    else if (action === 'logout-confirm') { const data = await mutate('logout'); if (data) { closeModal(); render(); } }
    else if (action === 'capacity') { capacity = Number(d.count); render(); }
    else if (action === 'create') await mutate('create', { capacity, ...(Seven ? { rulesVersion: 4 } : {}) });
    else if (action === 'join') { const code = ($('#join-code')?.value || inviteCode || '').trim().toUpperCase(); if (!/^[A-Z2-9]{6}$/.test(code)) { toast('초대 코드 여섯 자리를 확인해 주세요.'); return; } await mutate('join', { code }); }
    else if (action === 'ready') await mutate('ready', { ready: !ready });
    else if (action === 'start') await mutate('start', Seven ? { rulesVersion: 4 } : {});
    else if (action === 'copy-invite') await copyInvite();
    else if (action === 'connection-help') openModal('connection', '접속을 잠시 벗어날 때', '<p class="small subtle">게임이 진행 중일 때 방과 역할은 유지됩니다. 탭을 닫거나 로그아웃했더라도 같은 계정으로 로그인하면 현재 자리로 돌아옵니다. 로그인 접속은 24시간 유효하며, 만료되면 다시 로그인하면 됩니다. 방 기록은 마지막 플레이부터 최대 30일 보관됩니다.</p><p class="online-footer-note">내 비밀 정보는 창을 벗어날 때 가려집니다. 다른 참가자는 현재 차례를 기다리게 되므로 잠시 자리를 비우면 함께하는 사람에게 알려 주세요.</p>');
    else if (action === 'refresh') await poll();
    else if (action === 'rules') await showRules();
    else if (action === 'rule-jump') { if (['goal', 'components', 'setup', 'play', 'round-end', 'win'].includes(d.id)) modalHost.querySelector('#party-rule-' + d.id)?.scrollIntoView({ block: 'start' }); }
    else if (action === 'settings') settings();
    else if (action === 'close-modal') { const back = ledgerReturn && modalKind === 'ledger'; ledgerReturn = false; privateVisible = false; closeModal(); render(); if (back) openPersonal(); else pumpCaseCues(); }
    else if (action === 'private-toggle') { if (room?.status === 'playing') { if (modalKind === 'personal' && privateVisible) { privateVisible = false; refreshCaseModal(true); } else openPersonal(); } }
    else if (action === 'private-show') { privacyLocked = false; privateVisible = true; openPersonal(); }
    else if (action === 'resource-help') { const host = button.closest('.case-resource'); const open = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(open)); host?.classList.toggle('is-open', open); }
    else if (action === 'review-open') openReview();
    else if (action === 'review-audit') { if (!letterHandles.some(h => !h.done)) await engineAction({ type: 'REVIEW_RESULT', kind: 'audit' }); }
    else if (action === 'review-confirm') { if (letterHandles.some(h => !h.done)) return; const g = game(); if (g?.review) await engineAction({ type: 'REVIEW_RESULT', kind: 'confirm' }); else if (g?.round < 5) await engineAction({ type: 'END_ROUND' }); else accuseModal(); }
    else if (action === 'chat-toggle') { chatOpen = !chatOpen; if (chatOpen) chatReadCount = game()?.notes.length || 0; render(); }
    else if (action === 'practice-setup') practiceSetup();
    else if (action === 'practice-count') { practiceCount = Number(d.count); practiceSetup(); }
    else if (action === 'practice-role') { practiceRole = d.role; practiceSetup(); }
    else if (action === 'practice-start') await startPractice();
    else if (action === 'practice-exit') await stopPractice();
    else if (action === 'role-seen') await engineAction({ type: 'ROLE_SEEN' });
    else if (action === 'share') await engineAction({ type: 'SECRET_ACTION', kind: 'share', category: d.category });
    else if (action === 'seal') await engineAction({ type: 'SECRET_ACTION', kind: 'seal', category: $('#seal-category').value });
    else if (action === 'guard') await engineAction({ type: 'SECRET_ACTION', kind: 'guard', category: $('#guard-category').value });
    else if (action === 'suggest') await engineAction({ type: 'SECRET_ACTION', kind: 'suggest', category: $('#suggest-category').value });
    else if (action === 'secret-pass') await engineAction({ type: 'SECRET_ACTION', kind: 'pass' });
    else if (action === 'answer') await engineAction({ type: 'ANSWER', value: d.value === 'unknown' ? null : Number(d.value) });
    else if (action === 'tab') { captureDrafts(); tab = d.id; refreshCaseModal(true); }
    else if (action === 'question') { const selected = window.WitnessDetectiveOptions.questionSelection(game(), { category: $('#question-category')?.value, proposedValue: $('#question-proposed')?.value }); if (!selected.category) { toast('새로 질문할 항목이 없습니다. 기록을 검증하거나 수사를 넘겨 주세요.'); return; } await engineAction({ type: 'INVESTIGATE', kind: 'question', targetId: $('#question-target')?.value, category: selected.category, proposedValue: selected.proposedValue }); }
    else if (action === 'search') await engineAction({ type: 'INVESTIGATE', kind: 'search', category: d.category });
    else if (action === 'audit') await engineAction({ type: 'INVESTIGATE', kind: 'audit', statementId: d.id });
    else if (action === 'skip') openModal('skip', '이번 수사를 넘길까요?', '<p class="small subtle">공동 수사 없이 이번 라운드의 토론으로 넘어갑니다.</p><div class="modal-actions"><button class="btn outline" data-action="close-modal">수사 계속</button><button class="btn danger" data-action="skip-confirm" data-mutate>이번 수사 넘기기</button></div>');
    else if (action === 'skip-confirm') { closeModal(); await engineAction({ type: 'INVESTIGATE', kind: 'pass' }); }
    else if (action === 'mark-s' || action === 'mark-p') { const set = action === 'mark-s' ? marksS : marksP; set.has(d.id) ? set.delete(d.id) : set.add(d.id); render(); }
    else if (action === 'clear-marks') { marksS.clear(); marksP.clear(); render(); if (modalKind === 'accuse') accuseModal(); }
    else if (action === 'ledger') ledger();
    else if (action === 'send-note') { const text = ($('#chat-text')?.value || '').trim(); if (!text) { toast('자유 발언을 입력해 주세요.'); return; } const data = await mutate('action', { event: { type: 'ADD_NOTE', text } }); if (data) { drafts.chat = ''; const input = $('#chat-text'); if (input) input.value = ''; render(); } }
    else if (action === 'end-round') await engineAction({ type: 'END_ROUND' });
    else if (action === 'accuse') accuseModal();
    else if (action === 'confirm-accuse') { const suspectId = $('#accuse-person')?.value, placeId = $('#accuse-place')?.value, possible = window.WitnessDetectiveOptions.accusationCandidates(game()); if (possible.suspects.some(s => s.id === suspectId && !marksS.has(s.id)) && possible.places.some(p => p.id === placeId && !marksP.has(p.id))) { const data = await engineAction({ type: 'ACCUSE', suspectId, placeId }); if (data) closeModal(); } }
    else if (action === 'restart') { const data = await mutate('restart'); if (data) { privateVisible = false; marksS.clear(); marksP.clear(); render(); } }
    else if (action === 'leave' && practising()) await stopPractice();
    else if (action === 'leave') openModal('leave', '이 방에서 나갈까요?', '<p class="small subtle">' + (room?.status === 'playing' ? '진행 중인 사건에서 나갑니다. 다른 참가자의 진행에도 영향을 줄 수 있습니다.' : '다시 참여하려면 초대 코드가 필요합니다.') + '</p><div class="modal-actions"><button class="btn outline" data-action="close-modal">머무르기</button><button class="btn danger" data-action="leave-confirm" data-mutate>방 나가기</button></div>');
    else if (action === 'leave-confirm') { const data = await mutate('leave'); if (data) { closeModal(); inviteCode = ''; const url = new URL(window.location.href); url.searchParams.delete('room'); window.history.replaceState({}, '', url); } }
    else if (action === 'kick') { const target = room.members.find(m => m.id === d.id); if (target) openModal('kick', '참가자를 내보낼까요?', '<p class="small subtle">' + esc(target.name) + '님을 대기실에서 내보냅니다.</p><div class="modal-actions"><button class="btn outline" data-action="close-modal">취소</button><button class="btn danger" data-action="kick-confirm" data-id="' + esc(target.id) + '" data-mutate>내보내기</button></div>'); }
    else if (action === 'kick-confirm') { const data = await mutate('kick', { targetId: d.id }); if (data) closeModal(); }
  }

  document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (!button || button.disabled) return; const action = button.dataset.action; Promise.resolve(act(action, button)).catch(() => toast('요청을 완료하지 못했습니다. 최신 상태를 확인해 주세요.')); if (gore && quality !== 'off' && !['private-toggle', 'close-modal'].includes(action)) FX?.burst?.(event.clientX, event.clientY, 'blood'); });
  document.addEventListener('input', event => { if (event.target.dataset.draft && event.target.type !== 'password' && !/password/i.test(event.target.dataset.draft)) drafts[event.target.dataset.draft] = event.target.value; });
  document.addEventListener('change', event => { const el = event.target; if (el.dataset.draft && el.type !== 'password' && !/password/i.test(el.dataset.draft)) drafts[el.dataset.draft] = el.value; if (el.dataset.change === 'quality') { quality = el.value; applyFX(); } else if (el.dataset.change === 'gore') { gore = el.checked; applyFX(); } else if (el.id === 'seven-question-category') { captureDrafts(); delete drafts['seven-question-proposed']; refreshCaseModal(true); } else if (el.id === 'seven-question-target' || el.id === 'seven-testimony-category') { captureDrafts(); if (el.id === 'seven-testimony-category') delete drafts['seven-testimony-value']; refreshCaseModal(true); } else if (el.id === 'question-category' || el.id === 'question-target' || el.id === 'question-proposed') { captureDrafts(); refreshCaseModal(true); } else if (el.dataset.change === 'accuse') { const button = $('#confirm-accuse'); if (button) button.disabled = pending || !$('#accuse-person').value || !$('#accuse-place').value; } });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (Scene?.busy()) return; if (activeNotice) { event.preventDefault(); finishNotice(); return; } if (modalKind) { ledgerReturn = false; closeModal(); } privacy(); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.target.id === 'chat-text') { event.preventDefault(); act('send-note'); }
    else if (event.key === 'Enter' && ['nickname', 'password', 'password-confirm'].includes(event.target.id)) { event.preventDefault(); act(modalKind === 'register' ? 'upgrade-submit' : authMode === 'register' ? 'register' : 'login'); }
    else if (event.key === 'Enter' && event.target.id === 'join-code') { event.preventDefault(); act('join'); }
    if (event.key === 'Tab' && modalKind && !['personal', 'review', 'obstruction'].includes(modalKind)) { const list = [...modalHost.querySelectorAll('button:not(:disabled),select,input,textarea,a[href]')], first = list[0], last = list.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) privacy(); else { poll(); pumpCaseCues(); } schedulePoll(); });
  window.addEventListener('focus', () => pumpCaseCues());
  window.addEventListener('blur', privacy); window.addEventListener('pagehide', privacy); window.addEventListener('pageshow', event => { if (event.persisted) { privacy(); poll(); } });
  FX?.init?.({ canvas: $('#atmosphere') }); applyFX();
  $('#blood-edge').innerHTML = '<svg viewBox="0 0 400 400" width="100%" height="100%" fill="currentColor"><path d="M270 0h130v240c-40-10-35-67-66-75-13-4-45 24-49 0-4-28 41-42 28-59-24-32-64 16-75-13-8-23 33-37 32-93Z"/><ellipse cx="195" cy="74" rx="12" ry="24"/><circle cx="210" cy="147" r="3"/></svg>';
  render(); if (token) poll();
}());

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../public/seven-data.js');
const A = require('../public/seven-actions.js');
const E = require('../lib/seven-engine.cjs');
const UI = require('../public/seven-app.js');

function setup(role = 'detective') {
  let state = E.makeGame(['탐정닉', '밤의 방문자', '증인 A', '증인 B', '비밀 메모', '그림자'], { seed: 721, roleOrder: ['detective', 'culprit', 'witness', 'witness', 'suspect', 'accomplice'], flowVersion: 2, detectiveVersion: 2 });
  while (state.phase === 'reveal') state = E.act(state, { type: 'ROLE_SEEN', actorId: E.turnOwner(state) });
  const actor = state.players.find(p => p.role === role).id;
  let game = E.privateView(state, actor), modal = '', kind = '', visible = false, renders = 0;
  const sent = [], drafts = {};
  const ui = UI.create({ data: D, actions: A, drafts, getGame: () => game, getModalKind: () => kind, render: () => renders++, privateVisible: () => visible, setPrivateVisible: value => { visible = value; }, openModal: (value, title, html) => { kind = value; modal = html; }, closeModal: () => { kind = ''; modal = ''; }, send: async event => sent.push(event) });
  return { ui, drafts, sent, get game() { return game; }, set game(value) { game = value; }, get modal() { return modal; }, get kind() { return kind; }, get renders() { return renders; }, showPrivate() { visible = true; } };
}

test('situation console groups the compact public controls and six anonymous profiles without private answers', () => {
  const c = setup('culprit'), html = c.ui.render(c.game, { code: 'ABC234' });
  for (const name of ['seven-console', 'seven-command', 'seven-participants', 'seven-catalog', 'seven-console-actions', 'seven-bottom-nav']) assert.match(html, new RegExp('class="[^"]*' + name));
  const roster = html.match(/<section class="seven-participants[\s\S]*?<\/section>/)?.[0] || '';
  assert.equal((roster.match(/class="seven-participant seven-profile/g) || []).length, 6);
  assert.doesNotMatch(roster, /seven-art|characterId|data-character|culprit|accomplice|caseSecret/);
  assert.match(roster, /seven-participant-avatar seven-anonymous[^>]*>[\s\S]*?<svg[\s\S]*?seven-avatar-initial/);
  assert.match(roster, /공개 역할 · 탐정/);
  assert.match(html, /data-action="seven-notebook"/);
  assert.match(html, /data-action="seven-ledger"/);
  assert.match(html, /data-action="seven-personal"/);
  assert.match(html, /data-action="chat-toggle"/);
  assert.match(html, /하루 1회/);
  assert.match(html, /사건 전체 2회/);
  assert.doesNotMatch(html, /범인 진영에만 전달된 진상|함께하는 닉네임|봉인 제보 완료/);
});

test('the footer previews only escaped public chat and opens the established discussion action', () => {
  const c = setup('culprit');
  const empty = c.ui.render(c.game);
  assert.match(empty, /seven-chat-peek/);
  assert.match(empty, /추리와 알리바이를 나누세요/);
  c.game = { ...c.game, notes: [{ round: c.game.round, speakerId: 'u2', text: '<img src=x onerror=1> 공개 알리바이' }, { round: c.game.round + 1, speakerId: 'u2', text: '미래 라운드 기록' }], reveal: { players: [{ id: 'u2', name: '종료 후 비밀 이름' }] } };
  const html = c.ui.render(c.game), peek = html.match(/<section class="seven-chat-peek"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(peek, /data-action="chat-toggle"/);
  assert.match(peek, /자유토론/);
  assert.match(peek, /증인 A/);
  assert.match(peek, /&lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(peek, /<img src=x|종료 후 비밀 이름|미래 라운드 기록|caseSecret|partnerIds|characterId/);
  assert.ok(html.indexOf('class="seven-console-actions"') < html.indexOf('class="seven-chat-peek"'));
  assert.ok(html.indexOf('class="seven-chat-peek"') < html.indexOf('class="seven-bottom-nav"'));
});

test('all four tabs retain twelve cards and switching back preserves the selected and excluded states', async () => {
  const c = setup();
  c.game = { ...c.game, facts: [{ id: 'f1', category: 'hand', value: 0, source: 'record', round: 1 }] };
  for (const kind of ['person', 'place', 'tool', 'time']) {
    await c.ui.handle('seven-board-tab', { id: kind });
    const html = c.ui.render(c.game);
    assert.equal((html.match(/class="seven-reference-card seven-card /g) || []).length, 12);
    assert.equal((html.match(/class="seven-reference-photo"/g) || []).length, 12);
    assert.equal((html.match(new RegExp('data-seven-' + kind + '=', 'g')) || []).length, 12);
    assert.equal((html.match(/data-action="seven-board-tab"/g) || []).length, 4);
  }
  await c.ui.handle('seven-board-tab', { id: 'person' });
  await c.ui.handle('seven-card-detail', { kind: 'person', id: 's1' });
  assert.match(c.ui.render(c.game), /seven-reference-card seven-card seven-card-person is-selected[^>]*data-id="s1"[^>]*aria-pressed="true"/);
  await c.ui.handle('seven-mark', { kind: 'person', id: 's1' });
  assert.match(c.ui.render(c.game), /seven-card-person is-selected is-marked/);
  await c.ui.handle('seven-board-tab', { id: 'time' });
  await c.ui.handle('seven-board-tab', { id: 'person' });
  assert.match(c.ui.render(c.game), /seven-card-person is-selected is-marked/);
  await c.ui.handle('seven-clear-marks');
  const final = c.ui.render(c.game);
  assert.doesNotMatch(final, /is-marked/);
  assert.match(final, /is-constrained/);
  assert.match(final, /seven-pencil-x/);
  assert.equal(c.sent.length, 0);
});

test('location blueprint stays inside the catalog and opens the same public details', async () => {
  const c = setup();
  await c.ui.handle('seven-board-tab', { id: 'place' });
  assert.match(c.ui.render(c.game), /data-action="seven-map-toggle"[^>]*aria-pressed="false"/);
  await c.ui.handle('seven-map-toggle');
  const mapped = c.ui.render(c.game);
  assert.match(mapped, /seven-board-place is-map-view/);
  assert.match(mapped, /seven-location-map/);
  assert.equal((mapped.match(/class="seven-map-node/g) || []).length, 12);
  assert.match(mapped, /실제 동선이 아닌 장소 배치도/);
  await c.ui.handle('seven-card-detail', { kind: 'place', id: 'p0' });
  assert.equal(c.kind, 'seven-detail');
  assert.match(c.modal, /중앙전시실/);
  assert.equal(c.sent.length, 0);
});

test('local notebook and detail controls never send actions, and public cards do not inherit private exclusion reasons', async () => {
  const c = setup();
  await c.ui.handle('seven-notebook');
  assert.equal(c.kind, 'seven-notebook');
  assert.match(c.modal, /사건기록 수첩/);
  c.showPrivate();
  await c.ui.handle('seven-action-notebook', { id: 'person' });
  await c.ui.handle('seven-action-detail', { kind: 'person', id: 's1' });
  await c.ui.handle('seven-card-detail', { kind: 'person', id: 's1' });
  assert.doesNotMatch(c.modal, /나의 확실한 관찰|본인 정체 확인|내가 확인한 관찰·정체/);
  await c.ui.handle('seven-personal');
  assert.equal(c.kind, 'seven-personal');
  await c.ui.handle('seven-ledger');
  assert.equal(c.kind, 'seven-ledger');
  assert.equal(await c.ui.handle('chat-toggle'), false);
  assert.equal(c.sent.length, 0);
});

test('real modal navigation preserves keyboard focus through notebook tabs, map mode and local exclusion updates', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
  const { createService, GameError } = require('../lib/game-service.cjs'), { MemoryStore } = require('../lib/store.cjs');
  // Use the existing application DOM harness so this checks the real modal and
  // online render lifecycle, rather than a separate reproduction of refresh.
  const source = fs.readFileSync(path.join(__dirname, 'online-ui.test.cjs'), 'utf8');
  const start = source.indexOf('function makeClient('), end = source.indexOf('async function settle()', start);
  const harness = source.slice(start, end)
    .replace("['catalog.js','detective-options.js','case-interface.js','case-replay.js']", "['catalog.js','detective-options.js','case-interface.js','case-replay.js','seven-data.js','seven-actions.js','seven-app.js']")
    .replace('if(options.practice){', 'window.WitnessSevenData=context.WitnessSevenData; if(options.practice){');
  const make = new Function('fs', 'path', 'vm', 'crypto', 'assert', 'GameError', 'publicDir', harness + '; return makeClient;')(fs, path, vm, crypto, assert, GameError, path.join(__dirname, '../public'));
  const client = make(createService({ store: new MemoryStore() }), 996), g = setup().game;
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  client.sessions.set('gui-focus:seven-story:1', '1');
  client.api.acceptRoom({ code: 'ABC234', caseId: 'gui-focus', capacity: 6, status: 'playing', revision: 1, hostId: 'u0', meId: g.self.id, members: g.players.map(p => ({ id: p.id, gameId: p.id, name: p.name, ready: true, online: true })), game: g }, true);
  await settle();
  await client.api.act('seven-notebook', { dataset: {} });
  const body = () => client.document.getElementById('seven-window-body');
  const tab = body().querySelector('[data-action="seven-board-tab"][data-id="place"]');
  tab.focus(); await client.api.act('seven-board-tab', tab); await settle();
  assert.equal(client.document.activeElement, body().querySelector('[data-action="seven-board-tab"][data-id="place"]'));
  assert.equal(client.document.activeElement.isConnected, true);
  const toggle = body().querySelector('[data-action="seven-map-toggle"]');
  toggle.focus(); await client.api.act('seven-map-toggle', toggle); await settle();
  assert.equal(client.document.activeElement, body().querySelector('[data-action="seven-map-toggle"]'));
  assert.equal(client.document.activeElement.getAttribute('aria-pressed'), 'true');
  await client.api.act('seven-card-detail', { dataset: { kind: 'place', id: 'p0' } });
  const mark = body().querySelector('[data-action="seven-mark"]');
  mark.focus(); await client.api.act('seven-mark', mark); await settle();
  assert.equal(client.document.activeElement, body().querySelector('[data-action="seven-mark"]'));
  assert.match(client.document.activeElement.textContent, /해제/);
  assert.equal(client.requests.length, 0);
});

test('compact finished dashboard keeps all outcomes and restart controls reachable while full case details open separately', async () => {
  const g = structuredClone(setup().game), roles = ['detective','culprit','witness','witness','suspect','accomplice'];
  g.phase = 'finished'; g.winner = 'criminals'; g.accusation = { suspectId: 's2' };
  g.reveal = { secretNPC: { suspectId: 's0', placeId: 'p0', toolId: 't0', timeId: 'time0' }, players: g.players.map((p,i) => ({ ...p, role: roles[i], characterId: 's'+i })), suspectResult: { status: 'win', early: true, report: { suspectId: 's0', text: '상세에서만 읽는 긴 봉인 제보 <script>비밀</script>' } }, caseWorld: { events: [{ suspectId: 's0', placeId: 'p0', toolId: 't0', timeId: 'time0', activity: '전체 원본의 활동 내용' }], records: [] }, replay: { complete: true, events: [] } };
  let modal = '', kind = ''; const sent = [];
  const u = UI.create({ data: D, actions: A, getGame: () => g, isHost: () => true, getModalKind: () => kind, send: async e => sent.push(e), openModal: (value,title,body) => { kind = value; modal = body; } });
  const html = u.result(g);
  assert.match(html, /seven-result-console/);
  assert.equal((html.match(/class="solution-card"/g) || []).length, 4);
  assert.equal((html.match(/seven-result-profile/g) || []).length, 6);
  assert.match(html, /범인 진영의 승리/);
  assert.match(html, /개인 승리.*선제 추적/s);
  assert.match(html, /동시 승리/);
  assert.match(html, /is-inactive/);
  for (const action of ['seven-replay', 'seven-result-details', 'restart', 'leave']) assert.match(html, new RegExp('data-action="' + action + '"'));
  assert.doesNotMatch(html, /전체 원본의 활동 내용|상세에서만 읽는 긴 봉인 제보|<table|<script>/);
  await u.handle('seven-result-details');
  assert.equal(kind, 'seven-result-details');
  assert.match(modal, /전체 인물의 실제 동선/);
  assert.match(modal, /전체 원본의 활동 내용/);
  assert.match(modal, /상세에서만 읽는 긴 봉인 제보 &lt;script&gt;/);
  await u.handle('seven-replay'); assert.equal(kind, 'seven-replay');
  assert.equal(sent.length, 0);
  g.phase = 'discussion'; assert.equal(u.result(g), '');
});

test('real adapter keeps legacy finished cases scrollable while only seven-day results use the compact result variant', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
  const { createService, GameError, safeGame } = require('../lib/game-service.cjs'), { MemoryStore } = require('../lib/store.cjs');
  const Party = require('../lib/party-engine.cjs');
  const source = fs.readFileSync(path.join(__dirname, 'online-ui.test.cjs'), 'utf8');
  const start = source.indexOf('function makeClient('), end = source.indexOf('async function settle()', start);
  const harness = source.slice(start, end)
    .replace("['catalog.js','detective-options.js','case-interface.js','case-replay.js']", "['catalog.js','detective-options.js','case-interface.js','case-replay.js','seven-data.js','seven-actions.js','seven-app.js']")
    .replace('if(options.practice){', 'window.WitnessSevenData=context.WitnessSevenData; if(options.practice){');
  const make = new Function('fs', 'path', 'vm', 'crypto', 'assert', 'GameError', 'publicDir', harness + '; return makeClient;')(fs, path, vm, crypto, assert, GameError, path.join(__dirname, '../public'));
  const client = make(createService({ store: new MemoryStore() }), 997);
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  const finished = (engine, options) => {
    const state = structuredClone(engine.makeGame(['탐정 계정', '동료 계정'], options));
    state.phase = 'finished'; state.round = engine.MAX_ROUNDS; state.winner = 'investigators';
    state.accusation = { suspectId: state.secretNPC.suspectId, placeId: state.secretNPC.placeId };
    return safeGame(state, state.detectiveId);
  };
  const accept = async (game, code) => {
    client.api.acceptRoom({ code, caseId: code, capacity: 2, status: 'finished', revision: 1, hostId: game.self.id, meId: game.self.id, members: game.players.map(p => ({ id: p.id, gameId: p.id, name: p.name, ready: true, online: true })), game }, true);
    await settle();
  };
  const legacy = finished(Party, { seed: 72 }), modern = finished(E, { seed: 72, detectiveVersion: 2 });
  await accept(legacy, 'OLD234');
  assert.equal(client.document.body.dataset.console, 'legacy-result', 'A long legacy result must not receive the fixed-height seven-day result CSS');
  assert.ok(client.document.querySelector('.online-result'));
  assert.equal(client.document.querySelector('.seven-result-console'), null);
  assert.ok(client.document.querySelector('[data-action="restart"]'));
  await accept(modern, 'NEW234');
  assert.equal(client.document.body.dataset.console, 'result');
  assert.ok(client.document.querySelector('.seven-result-console'));
  assert.ok(client.document.querySelector('[data-action="seven-result-details"]'));
  await accept(legacy, 'OLD235');
  assert.equal(client.document.body.dataset.console, 'legacy-result', 'Returning to a legacy case releases compact result styling');
  assert.equal(client.requests.length, 0);
});

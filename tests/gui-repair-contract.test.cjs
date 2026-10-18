'use strict';
// These contracts exercise application keyboard handling and the real renderer.
// The small DOM harness cannot prove image quality, CSS layout or visibility.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createService, GameError } = require('../lib/game-service.cjs');
const { MemoryStore } = require('../lib/store.cjs');
const E = require('../lib/seven-engine.cjs');

function client() {
  const source = fs.readFileSync(path.join(__dirname, 'online-ui.test.cjs'), 'utf8');
  const start = source.indexOf('function makeClient('), end = source.indexOf('async function settle()', start);
  let harness = source.slice(start, end)
    .replace("['catalog.js','detective-options.js','case-interface.js','case-replay.js']", "['catalog.js','detective-options.js','case-interface.js','case-replay.js','seven-data.js','seven-actions.js','seven-app.js']")
    .replace('if(options.practice){', 'window.WitnessSevenData=context.WitnessSevenData; if(options.practice){');
  // Native HTML tagName is uppercase, while serialization stays lowercase.
  harness = harness.replace('this.tagName=tag.toLowerCase()', 'this.tagName=tag.toUpperCase()')
    .replace('element.tagName!==tag.toLowerCase()', 'element.tagName!==tag.toUpperCase()')
    .replaceAll("this.tagName==='textarea'", "this.tagName==='TEXTAREA'")
    .replaceAll("this.tagName==='select'", "this.tagName==='SELECT'")
    .replaceAll('voidTags.has(this.tagName)', 'voidTags.has(this.tagName.toLowerCase())')
    .replaceAll('voidTags.has(element.tagName)', 'voidTags.has(element.tagName.toLowerCase())')
    .replace('el.tagName===closing[1].toLowerCase()', 'el.tagName===closing[1].toUpperCase()')
    .replaceAll("'<'+this.tagName+", "'<'+this.tagName.toLowerCase()+")
    .replaceAll("'</'+this.tagName+", "'</'+this.tagName.toLowerCase()+");
  // Supply native element properties used by keyboard filtering. These are DOM
  // semantics only; no synthetic bounds or CSS visibility are introduced.
  harness = harness.replace('  focus(){document.activeElement=this;}', `
  matches(selector){return matches(this,selector);}
  get parentElement(){return this.parentNode instanceof Element?this.parentNode:null;}
  get tabIndex(){return this.hasAttribute('tabindex')?Number(this.getAttribute('tabindex')):(['BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY'].includes(this.tagName)||this.tagName==='A'&&this.hasAttribute('href')?0:-1);}
  get open(){return this.hasAttribute('open');}
  focus(){document.activeElement=this;}`);
  const make = new Function('fs', 'path', 'vm', 'crypto', 'assert', 'GameError', 'publicDir', harness + '; return makeClient;')(fs, path, vm, crypto, assert, GameError, path.join(__dirname, '../public'));
  return make(createService({ store: new MemoryStore() }), 998);
}

async function settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }

async function notebook() {
  const c = client();
  let state = E.makeGame(['탐정', '범인', '증인', '용의자'], { seed: 721, roleOrder: ['detective', 'culprit', 'witness', 'suspect'], flowVersion: 2, detectiveVersion: 2 });
  while (state.phase === 'reveal') state = E.act(state, { type: 'ROLE_SEEN', actorId: E.turnOwner(state) });
  const game = E.privateView(state, state.detectiveId);
  c.sessions.set('gui-contract:seven-story:1', '1');
  c.api.acceptRoom({ code: 'ABC234', caseId: 'gui-contract', capacity: 4, status: 'playing', revision: 1, hostId: game.self.id, meId: game.self.id, members: game.players.map(p => ({ id: p.id, gameId: p.id, name: p.name, ready: true, online: true })), game }, true);
  await settle();
  await c.api.act('seven-notebook', { dataset: {} });
  await c.api.act('seven-board-tab', { dataset: { id: 'place' } });
  await settle();
  return c;
}

function tab(c, shiftKey = false) {
  const event = { key: 'Tab', shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
  for (const listener of c.listeners.keydown || []) listener(event);
  return event;
}

for (const map of [false, true]) test('notebook keyboard loop excludes the hidden ' + (map ? 'card catalog' : 'location map'), async () => {
  const c = await notebook();
  if (map) { await c.api.act('seven-map-toggle', { dataset: {} }); await settle(); }
  const host = c.document.getElementById('modal-host'), first = host.querySelector('[data-action="close-modal"]');
  const catalog = host.querySelector('.seven-reference-cards'), locationMap = host.querySelector('.seven-location-map');
  assert.equal(catalog.hidden, map);
  assert.equal(locationMap.hidden, !map);
  const visible = map ? locationMap : catalog;
  const cards = visible.querySelectorAll('[data-action="seven-card-detail"]');
  assert.deepEqual(cards.map(card => card.dataset.id), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11']);
  const last = cards.at(-1);
  first.focus();
  assert.equal(tab(c, true).prevented, true);
  assert.equal(c.document.activeElement === last, true, 'Shift+Tab must reach the visible final location, never its hidden duplicate');
  last.focus();
  assert.equal(tab(c).prevented, true, 'Tab must wrap from the visible last item');
  assert.equal(c.document.activeElement === first, true);
  const hidden = map ? catalog : locationMap;
  hidden.querySelectorAll('[data-action="seven-card-detail"]').at(-1).focus();
  assert.equal(tab(c).prevented, true, 'a focus target hidden by a mode change must return to the active dialog');
  assert.equal(c.document.activeElement === first, true);
  assert.equal(c.requests.length, 0, 'keyboard reading must not mutate a room');
});

test('modal keyboard loop ends at a collapsed disclosure summary rather than its unavailable controls', async () => {
  const c = await notebook(), host = c.document.getElementById('modal-host');
  host.innerHTML = '<section role="dialog"><button id="first">처음</button><button disabled>잠김</button><div hidden><button>숨긴 자료</button></div><button tabindex="-1">프로그램 전용</button><details><summary id="last">기록 열기</summary><button id="collapsed">펼친 뒤의 행동</button></details></section>';
  const first = c.document.getElementById('first'), last = c.document.getElementById('last');
  first.focus();
  assert.equal(tab(c, true).prevented, true);
  assert.equal(c.document.activeElement?.id, 'last', 'the closed disclosure itself stays reachable; its body is outside the Tab order');
  last.focus();
  assert.equal(tab(c).prevented, true);
  assert.equal(c.document.activeElement?.id, 'first');
  last.parentElement.setAttribute('open', '');
  first.focus();
  assert.equal(tab(c, true).prevented, true);
  assert.equal(c.document.activeElement?.id, 'collapsed', 'opening the disclosure restores its action to the keyboard loop');
  assert.equal(c.requests.length, 0);
});

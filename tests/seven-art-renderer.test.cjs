'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../public/seven-data.js');
const A = require('../public/seven-actions.js');
const E = require('../lib/seven-engine.cjs');
const UI = require('../public/seven-app.js');

function setup() {
  const state = E.makeGame(['탐정', '동료'], { seed: 721, flowVersion: 2, detectiveVersion: 2 });
  let game = E.privateView(state, state.detectiveId), modal = '';
  const ui = UI.create({ data: D, actions: A, getGame: () => game, openModal: (_, title, html) => { modal = html; } });
  return { ui, get game() { return game; }, set game(value) { game = value; }, get modal() { return modal; } };
}

function artNodes(html) {
  return [...html.matchAll(/<div class="seven-art seven-art-(\w+)" data-sprite-index="(\d+)" role="img" aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/div>/g)].map(match => ({ kind: match[1], index: Number(match[2]), label: match[3], content: match[4] }));
}

test('all twelve people retain their original atlas cells and accessible identity labels', () => {
  const c = setup(), nodes = artNodes(c.ui.render(c.game));
  assert.equal(nodes.length, 12);
  const cells = [
    [0, 0], [443.5, 0], [887, 0], [1330.5, 0],
    [0, 443.5], [443.5, 443.5], [887, 443.5], [1330.5, 443.5],
    [0, 0], [627, 0], [0, 627], [627, 627]
  ];
  for (const [i, node] of nodes.entries()) {
    assert.equal(node.kind, 'person');
    assert.equal(node.index, i);
    assert.equal(node.label, D.SUSPECTS[i].name + ' 공개 자료');
    const [x, y] = cells[i], size = i < 8 ? 443.5 : 627;
    assert.ok(node.content.includes('viewBox="' + [x, y, size, size].join(' ') + '"'), D.SUSPECTS[i].id);
    assert.match(node.content, /class="seven-art-image"[^>]*preserveAspectRatio="xMidYMid meet"[^>]*aria-hidden="true"[^>]*focusable="false"/);
    assert.ok(node.content.includes('<svg x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" viewBox="' + [x, y, size, size].join(' ') + '" overflow="hidden">'), D.SUSPECTS[i].id + ' clips the source cell before letterboxing');
    assert.doesNotMatch(node.content, /\bid="|clip-path=|<clipPath/);
    assert.ok(node.content.includes('href="images/' + (i < 8 ? 'suspects-atlas.webp" width="1774" height="887"' : 'portraits-v4.webp" width="1254" height="1254"')));
  }
});

test('place, tool and time cells use their native square geometry and keep HTML time labels', async () => {
  const c = setup();
  for (const [kind, file] of [['place', 'locations-v4-12.webp'], ['tool', 'tools-v4-12.webp'], ['time', 'times-v4-12.webp']]) {
    await c.ui.handle('seven-board-tab', { id: kind });
    const nodes = artNodes(c.ui.render(c.game));
    assert.equal(nodes.length, 12);
    for (const [i, node] of nodes.entries()) {
      assert.equal(node.kind, kind);
      assert.equal(node.index, i);
      assert.ok(node.content.includes('viewBox="' + [i % 4 * 362, Math.floor(i / 4) * 362, 362, 362].join(' ') + '"'));
      assert.ok(node.content.includes('<svg x="' + i % 4 * 362 + '" y="' + Math.floor(i / 4) * 362 + '" width="362" height="362"'));
      assert.match(node.content, /overflow="hidden"><image/);
      assert.doesNotMatch(node.content, /\bid="|clip-path=|<clipPath/);
      assert.ok(node.content.includes('href="images/' + file + '" width="1448" height="1086"'));
      if (kind === 'time') assert.ok(node.content.includes('</svg><span class="seven-time-overlay">' + D.TIMES[i].name + '</span>'));
    }
  }
});

test('detail, private identity, accusation and results reuse the same native portrait renderer', async () => {
  const c = setup(), expected = 'viewBox="627 627 627 627"';
  await c.ui.handle('seven-card-detail', { kind: 'person', id: 's11' });
  assert.ok(artNodes(c.modal).some(node => node.index === 11 && node.content.includes(expected)));
  c.game = { ...c.game, self: { ...c.game.self, identity: { known: true, characterId: 's11', candidates: ['s11'] } } };
  const personal = c.ui.personal(c.game, true);
  assert.ok(artNodes(personal).some(node => node.index === 11 && node.content.includes(expected)));
  c.game = { ...c.game, phase: 'final', round: 7, turnOwnerId: c.game.self.id, facts: [], statements: [], self: { ...c.game.self, clues: [], identity: { known: false, candidates: D.SUSPECTS.map(person => person.id) } } };
  assert.ok(artNodes(c.ui.accuse(c.game)).some(node => node.index === 11 && node.content.includes(expected)));
  c.game = { ...c.game, phase: 'finished', winner: 'investigators', accusation: { suspectId: 's11' }, reveal: { secretNPC: { suspectId: 's11', placeId: 'p0', toolId: 't0', timeId: 'time0' }, players: [{ id: 'u0', name: '탐정', role: 'detective', characterId: 's11' }], replay: { complete: true, events: [] } } };
  assert.ok(artNodes(c.ui.result(c.game)).filter(node => node.index === 11 && node.content.includes(expected)).length >= 2);
});

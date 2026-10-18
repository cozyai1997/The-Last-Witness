'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const filename = path.join(__dirname, '../public/seven-rules.js');
const rules = () => { assert.ok(fs.existsSync(filename), 'The seven-day rules renderer must ship with the application'); return require(filename); };

test('current rules provide all six existing navigation targets and accurate seven-day resources', () => {
  const html = rules().render();
  for (const id of ['goal','components','setup','play','round-end','win']) {
    assert.equal((html.match(new RegExp('id="party-rule-' + id + '"', 'g')) || []).length, 1);
    assert.match(html, new RegExp('data-action="rule-jump" data-id="' + id + '"'));
  }
  assert.match(html, /인물 12명·장소 12곳·도구 12종·시간대 12개/);
  assert.match(html, /DAY 7.*인물 한 명/s);
  assert.match(html, /무작위.*서로 다른 2개/s);
  assert.match(html, /질문은 하루 1회/);
  assert.match(html, /진술 검증은 사건 전체 2회/);
  assert.match(html, /질문 기회를 소비하지/);
  assert.match(html, /원본 조사 행동은 제공하지 않습니다/);
  assert.match(html, /C 2회 · A 1회/);
  assert.match(html, /합계 2회/);
  assert.match(html, /합계 1회/);
  assert.match(html, /3명 → 2명 → 1명/);
  assert.match(html, /DAY 6/);
  assert.match(html, /제보.*무관하게.*개인 패배/s);
  assert.match(html, /동시 승리/);
  assert.doesNotMatch(html, /5라운드|8인물|4장소|공동 키트 1개/);
});

test('saved version-four rules keep detective resources and preparation flows independently correct', () => {
  const old = rules().render({ rulesVersion: 4, flowVersion: 1 });
  assert.match(old, /순서대로 개인행동/);
  assert.match(old, /공동 키트 1개/);
  assert.match(old, /질문·원본 수사·과거 진술 검증 중 하나/);
  assert.match(old, /인물 관찰 한 개와 장소 관찰 한 개/);
  assert.match(old, /S도.*아는 참.*모르면 미진술/s);
  assert.match(old, /정체 추정 메모.*개인행동 1회/s);
  assert.doesNotMatch(old, /진술 검증은 사건 전체 2회|S는.*항상 기억 불명/);
  const concurrentOld = rules().render({ rulesVersion: 4, flowVersion: 2 });
  assert.match(concurrentOld, /동시 비밀 준비/); assert.match(concurrentOld, /공동 키트 1개/);
  const sequentialNew = rules().render({ rulesVersion: 4, flowVersion: 1, detectiveVersion: 2 });
  assert.match(sequentialNew, /순서대로 개인행동/); assert.match(sequentialNew, /진술 검증은 사건 전체 2회/);
  const privateText = rules().render({ rulesVersion: 4, flowVersion: 2, detectiveVersion: 2, caseSecret: { secretText: '노출되면 안 되는 정답' }, self: { name: '<script>개인 이름</script>' } });
  assert.doesNotMatch(privateText, /노출되면 안 되는 정답|개인 이름|<script>/);
});

function integratedClient(options = {}) {
  const vm = require('node:vm'), crypto = require('node:crypto'), { createService, GameError } = require('../lib/game-service.cjs'), { MemoryStore } = require('../lib/store.cjs');
  const source = fs.readFileSync(path.join(__dirname, 'online-ui.test.cjs'), 'utf8'), start = source.indexOf('function makeClient('), end = source.indexOf('async function settle()', start);
  let harness = source.slice(start, end).replace("['catalog.js','detective-options.js','case-interface.js','case-replay.js']", "['catalog.js','detective-options.js','case-interface.js','case-replay.js','seven-data.js','seven-actions.js','seven-app.js','seven-rules.js']");
  harness = harness.replace('function makeClient(service,index,options={}){','function makeClient(service,index,options={}){ const rulesFetchGate = options.legacyRulesGate;');
  harness = harness.replace('if(options.practice){', 'window.WitnessSevenData=context.WitnessSevenData; if(options.practice){');
  harness = harness.replace("if(url==='/party-rules.html')return{ok:true,text:async()=>fs.readFileSync(path.join(publicDir,'party-rules.html'),'utf8')};", "if(url==='/legacy-rules-v3.html'){requests.push({op:'legacy-rules',url});if(rulesFetchGate)await rulesFetchGate;return{ok:true,text:async()=>fs.readFileSync(path.join(publicDir,'legacy-rules-v3.html'),'utf8')};}");
  const make = new Function('fs','path','vm','crypto','assert','GameError','publicDir',harness+'; return makeClient;')(fs,path,vm,crypto,assert,GameError,path.join(__dirname,'../public'));
  return make(createService({store:new MemoryStore()}),997,options);
}

test('the real rules action renders seven-day landing and saved variants without fetching cached legacy rules', async () => {
  const c = integratedClient(), open = async () => { await c.api.act('rules',{dataset:{}}); return c.modal(); };
  assert.match(await open(), /질문은 하루 1회/); assert.equal(c.requests.length, 0);
  const lobby = { code:'ABC234',capacity:2,hostId:'u0',meId:'u0',revision:1,status:'lobby',members:[{id:'u0',name:'나',ready:false,online:true}],game:null };
  c.api.acceptRoom({...lobby,rulesVersion:3},true); assert.match(await open(), /5라운드/);
  assert.equal(c.requests.filter(r=>r.op==='legacy-rules').length,1);
  c.api.acceptRoom({...lobby,revision:2},true); const modernLobby = await open();
  assert.match(modernLobby,/진술 검증은 사건 전체 2회/); assert.doesNotMatch(modernLobby,/5라운드|장소 4곳/);
  const E = require('../lib/seven-engine.cjs'), P = require('../lib/party-engine.cjs');
  const project = state => ({...lobby,revision:3,status:'playing',members:state.players.map(p=>({id:p.id,gameId:p.id,name:p.name,ready:true,online:true})),game:E.privateView(state,'u0')});
  const old = E.makeGame(['나','친구'],{seed:71,roleOrder:['detective','culprit'],flowVersion:1});
  c.api.acceptRoom(project(old),true); assert.match(await open(),/공동 키트 1개/); assert.match(c.modal(),/순서대로 개인행동/);
  const current = E.makeGame(['나','친구'],{seed:71,roleOrder:['detective','culprit'],detectiveVersion:2,flowVersion:2});
  c.api.acceptRoom({...project(current),revision:4},true); assert.match(await open(),/진술 검증은 사건 전체 2회/);
  const legacy = P.makeGame(['나','친구'],{seed:71});
  c.api.acceptRoom({...lobby,revision:5,status:'playing',game:P.privateView(legacy,'u0')},true); assert.match(await open(),/5라운드/);
  assert.equal(c.requests.filter(r=>r.op==='legacy-rules').length,1,'only the preserved legacy branch fetches its cached asset');
  assert.equal(c.requests.find(r=>r.op==='legacy-rules').url,'/legacy-rules-v3.html');
});

for (const outcome of ['resolved','rejected']) test('a delayed '+outcome+' legacy rules request cannot replace a reopened seven-day explanation', async () => {
  let release, reject;
  const gate = new Promise((resolve,fail) => { release = resolve; reject = fail; });
  const c = integratedClient({legacyRulesGate:gate}), P = require('../lib/party-engine.cjs'), state = P.makeGame(['나','친구'],{seed:71});
  const room = {code:'ABC234',capacity:2,hostId:'u0',meId:'u0',revision:1,status:'playing',members:state.players.map(p=>({id:p.id,gameId:p.id,name:p.name,ready:true,online:true})),game:P.privateView(state,'u0')};
  c.api.acceptRoom(room,true);
  const pending = c.api.act('rules',{dataset:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.requests.filter(r=>r.op==='legacy-rules').length,1);
  await c.api.act('close-modal',{dataset:{}});
  c.api.acceptRoom({...room,status:'lobby',game:null,revision:2},true);
  await c.api.act('rules',{dataset:{}});
  const currentBody = c.document.getElementById('rules-body'), before = c.modal();
  assert.match(before,/진술 검증은 사건 전체 2회/);
  if(outcome==='resolved')release();else reject(new Error('delayed legacy failure'));
  await pending;
  assert.equal(c.document.getElementById('rules-body'),currentBody);
  assert.equal(c.modal(),before);
  assert.doesNotMatch(c.modal(),/5라운드|규칙을 불러오지 못했습니다/);
});

test('the rules runtime is loaded before the application and verified by the build', () => {
  const index = fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'), build = fs.readFileSync(path.join(__dirname,'../scripts/build.cjs'),'utf8');
  assert.ok(index.includes('/seven-rules.js')); assert.ok(index.indexOf('/seven-rules.js') < index.indexOf('/online-app.js'));
  assert.match(build, /'seven-rules\.js'/);
  assert.match(build, /'legacy-rules-v3\.html'/);
  const legacy = fs.readFileSync(path.join(__dirname,'../public/legacy-rules-v3.html'));
  assert.equal(require('node:crypto').createHash('sha256').update(legacy).digest('hex'),'ee137a2c39198620577c15d880157e76685bac9b6abb077e713a6bd119e2cb74','the historical v3 rules retain their exact source bytes');
  const app = fs.readFileSync(path.join(__dirname,'../public/online-app.js'),'utf8');
  assert.match(app,/fetch\('\/legacy-rules-v3\.html', \{ cache: 'no-store' \}\)/);
});

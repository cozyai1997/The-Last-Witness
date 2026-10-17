'use strict';
// Real room service + real UI in a minimal DOM stub. These tests do not measure
// visual rendering, browser layout, or human game balance.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {createService,GameError,WORLD_KEY}=require('../lib/game-service.cjs');
const {MemoryStore}=require('../lib/store.cjs');
const Party=require('../lib/party-engine.cjs');
const publicDir=path.join(__dirname,'../public');

function makeClient(service,index,options={}){
 const nodes=new Map(),listeners={},sessions=options.sessions||new Map(),remembered=options.remembered||new Map(),requests=[];let version=0;
 class Element{
  constructor(id,owner='app'){this.id=id;this.owner=owner;this._html='';this.value='';this.dataset={};this.style={};this.isConnected=true;this.disabled=false;this.scrollTop=0;this.scrollHeight=100;this.clientHeight=100;this.type='text';}
  get innerHTML(){return this._html;}
  set innerHTML(value){this._html=value;version++;for(const id of [...nodes.keys()])if(!['app','modal-host','toast-host','atmosphere','blood-edge'].includes(id))nodes.delete(id);}
  querySelector(selector){return resolve(selector,this._html,this.id);}
  querySelectorAll(selector){return all(selector,this._html,this.id);}
  contains(element){return element?.owner===this.id;}
  focus(){document.activeElement=this;}
  setSelectionRange(){}
  scrollIntoView(){}
  closest(){return null;}
  select(){}
 }
 for(const id of ['app','modal-host','toast-host','atmosphere','blood-edge'])nodes.set(id,new Element(id,'root'));
 const attributes=text=>Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
 const markup=()=>nodes.get('app').innerHTML+nodes.get('modal-host').innerHTML;
 function elements(html,owner){return [...html.matchAll(/<(input|textarea|select|button)\b([^>]*)(?:>([\s\S]*?)<\/\1>|\/?>)/g)].map((match,i)=>{
  const a=attributes(match[2]),id=a.id||owner+'-anon-'+i+'-'+version;let element=nodes.get(id);
  if(!element){element=new Element(id,owner);element.value=a.value||'';element.type=a.type||'text';element.disabled=/\bdisabled\b/.test(match[2]);
   if(match[1]==='textarea')element.value=match[3]||'';
   if(match[1]==='select'){const options=[...(match[3]||'').matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)],selected=options.find(x=>/\bselected\b/.test(x[1]))||options[0];element.value=selected?attributes(selected[1]).value||'':'';}
   for(const [key,value]of Object.entries(a))if(key.startsWith('data-'))element.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;
   nodes.set(id,element);
  }return element;
 });}
 function resolve(selector,html=markup(),owner='app'){
  if(selector.startsWith('#')){const id=selector.slice(1);if(nodes.has(id))return nodes.get(id);let element=elements(html,owner).find(x=>x.id===id);if(element)return element;
   if(html.includes('id="'+id+'"')){element=new Element(id,owner);nodes.set(id,element);return element;}return null;}
  if(selector==='button,select,input,textarea')return elements(html,owner)[0]||null;
  return null;
 }
 function all(selector,html=markup(),owner='app'){
  const result=elements(html,owner);
  if(selector==='[data-draft]')return result.filter(e=>e.dataset.draft);
  if(selector==='[data-mutate]')return result.filter(e=>Object.hasOwn(e.dataset,'mutate'));
  if(selector==='[data-auth-error]')return [];
  return [];
 }
 const classList={add(){},remove(){},toggle(){}};
 const document={body:{style:{},classList},hidden:false,activeElement:null,querySelector:selector=>resolve(selector),querySelectorAll:selector=>all(selector),getElementById:id=>resolve('#'+id),addEventListener:(name,callback)=>(listeners[name]??=[]).push(callback)};
 const location={href:options.href||'http://localhost/',origin:'http://localhost',pathname:'/'};
 const window={location,history:{replaceState(){}},crypto:{randomUUID:()=>crypto.randomUUID()},WitnessFX:{init(){},setQuality(){},setPrivate(){},burst(){}},scrollX:0,scrollY:0,scrollTo(){},addEventListener:(name,callback)=>(listeners['window-'+name]??=[]).push(callback)};
 const context={document,window,URL,AbortController,matchMedia:()=>({matches:false}),sessionStorage:{getItem:key=>sessions.get(key)||null,setItem:(key,value)=>sessions.set(key,value),removeItem:key=>sessions.delete(key)},localStorage:{getItem:key=>remembered.get(key)||null,setItem:(key,value)=>remembered.set(key,value),removeItem:key=>remembered.delete(key)},setTimeout:()=>1,clearTimeout(){},navigator:{clipboard:{writeText:async()=>{}}},console,
  fetch:async(url,options)=>{
   if(url==='/party-rules.html')return{ok:true,text:async()=>fs.readFileSync(path.join(publicDir,'party-rules.html'),'utf8')};
   const body=JSON.parse(options.body);requests.push(body);
   try{const result=await service.handle(body,{ip:'ui-audit-'+index});return{ok:true,status:200,json:async()=>result};}
   catch(error){if(!(error instanceof GameError))throw error;return{ok:false,status:error.status,json:async()=>({error:error.message,code:error.code})};}
  }
 };
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(publicDir,'catalog.js'),'utf8'),context);
 let source=fs.readFileSync(path.join(publicDir,'online-app.js'),'utf8');const end=source.lastIndexOf('}());');assert.ok(end>0,'UI IIFE boundary exists');
 source=source.slice(0,end)+'window.audit={act,poll,privacy,getRoom:()=>room,getPrivate:()=>privateVisible,getAccount:()=>account,getDrafts:()=>drafts};'+source.slice(end);vm.runInContext(source,context);
 return{document,api:window.audit,requests,listeners,sessions,remembered,html:()=>nodes.get('app').innerHTML,modal:()=>nodes.get('modal-host').innerHTML,toast:()=>nodes.get('toast-host').innerHTML};
}
async function settle(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}
async function act(client,action,dataset={}){await client.api.act(action,{dataset});await settle();}
async function sync(clients){await Promise.all(clients.map(client=>client.api.poll()));await settle();}
const PASSWORD='PrivateCase!7821';
function assertNoPasswordPersisted(client,password=PASSWORD){
 assert.ok(!JSON.stringify([...client.sessions]).includes(password),'password never enters sessionStorage');
 assert.ok(!JSON.stringify([...client.remembered]).includes(password),'password never enters localStorage');
 assert.ok(!JSON.stringify(client.api.getDrafts()).includes(password),'password never enters drafts');
 assert.ok(!client.html().includes(password),'password never appears in room or login markup');
 assert.ok(!client.modal().includes(password),'password never appears in modal markup');
 for(const id of ['password','password-confirm']){const field=client.document.querySelector('#'+id);if(field)assert.equal(field.value,'','submitted password input is cleared');}
}
async function register(client,name){await act(client,'auth-mode',{mode:'register'});client.document.querySelector('#nickname').value=name;client.document.querySelector('#password').value=PASSWORD;client.document.querySelector('#password-confirm').value=PASSWORD;await act(client,'register');assert.ok(client.api.getAccount());assertNoPasswordPersisted(client);}
async function login(client,name){client.document.querySelector('#nickname').value=name;client.document.querySelector('#password').value=PASSWORD;await act(client,'login');assert.ok(client.api.getAccount());assertNoPasswordPersisted(client);}

for(const count of [2,3,4,5,6])test('online UI: '+count+' authenticated clients finish five rounds with private DOM and preserved drafts',async()=>{
 const service=createService({store:new MemoryStore(),gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}},rateLimit:10000});
 const clients=Array.from({length:count},(_,i)=>makeClient(service,i));
 for(const [i,client]of clients.entries())await register(client,'테스트 '+(i+1));
 const host=clients[0];await act(host,'capacity',{count:String(count)});await act(host,'create');const code=host.api.getRoom().code;
 for(const client of clients.slice(1)){client.document.querySelector('#join-code').value=code;await act(client,'join');}
 for(const client of clients){await client.api.poll();await act(client,'ready');}
 await host.api.poll();await act(host,'start');await sync(clients);
 let roleActions=0,secretActions=0,answers=0,discussions=0;
 for(let guard=0;guard<100;guard++){
  await sync(clients);const g=host.api.getRoom().game;if(g.phase==='finished')break;
  const owner=clients.find(client=>client.api.getRoom().game.self.id===g.turnOwnerId);
  const remaining=['reveal','secret','investigate'].includes(g.phase)?1:0;
  assert.ok(host.html().includes('<strong>'+remaining+' / 1</strong><span>남은 공동 수사</span>'),'remaining investigation matches '+g.phase);
  if(g.phase==='reveal'){
   assert.ok(!owner.html().includes('YOUR SECRET ROLE'),'role defaults to masked DOM');await act(owner,'private-toggle');assert.ok(owner.html().includes('YOUR SECRET ROLE'));
   for(const callback of owner.listeners['window-blur']||[])callback();assert.ok(!owner.html().includes('YOUR SECRET ROLE'),'blur removes private role DOM');await act(owner,'private-toggle');await act(owner,'role-seen');roleActions++;
  }else if(g.phase==='secret'){await act(owner,'private-toggle');await act(owner,'secret-pass');secretActions++;
  }else if(g.phase==='investigate'){
   assert.equal(owner.html().includes('data-action="accuse"'),g.round<5,'fifth-round investigation precedes accusation');
   const culprit=clients.find(client=>client.api.getRoom().game.self.role==='culprit').api.getRoom().game.self.id;
   owner.document.querySelector('#question-target').value=culprit;owner.document.querySelector('#question-category').value='coat';await act(owner,'question');
  }else if(g.phase==='answer'){await act(owner,'private-toggle');await act(owner,'answer',{value:'0'});answers++;
  }else if(g.phase==='discussion'){
   discussions++;const detective=clients.find(client=>client.api.getRoom().game.self.role==='detective'),other=clients.find(client=>client!==detective);
   other.document.querySelector('#chat-text').value='작성 중인 개인 발언 '+g.round;other.document.querySelector('#chat-text').focus();const input=other.document.querySelector('#chat-text');await other.api.poll();assert.equal(other.document.querySelector('#chat-text'),input,'same revision retains actual input node');
   detective.document.querySelector('#chat-text').value='<img src=x onerror=alert(1)> 공개 발언';await act(detective,'send-note');await other.api.poll();
   assert.equal(other.document.querySelector('#chat-text').value,'작성 중인 개인 발언 '+g.round,'new revision preserves draft');assert.equal(other.document.activeElement.id,'chat-text','new revision restores focused field');assert.ok(other.html().includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!other.html().includes('<img src=x'));
   await act(other,'ledger');const modal=other.modal();detective.document.querySelector('#chat-text').value='새 기록 '+g.round;await act(detective,'send-note');await other.api.poll();assert.equal(other.modal(),modal,'poll leaves open modal intact');await act(other,'close-modal');
   if(g.round<5)await act(detective,'end-round');else{await act(detective,'accuse');detective.document.querySelector('#accuse-person').value='s0';detective.document.querySelector('#accuse-place').value='p0';await act(detective,'confirm-accuse');}
  }else assert.fail('Unexpected phase '+g.phase);
 }
 await sync(clients);assert.equal(host.api.getRoom().status,'finished');assert.equal(roleActions,count);assert.equal(secretActions,count*5);assert.equal(answers,5);assert.equal(discussions,5);
 for(const client of clients){assert.ok(client.html().includes('수사 진영의 승리'));assert.ok(client.html().includes('모든 역할과 진영 공개'));for(const request of client.requests.filter(r=>r.op==='action')){assert.ok(!Object.hasOwn(request.event,'actorId'));assert.ok(!Object.hasOwn(request.event,'speakerId'));assert.ok(request.requestId);assert.ok(Number.isSafeInteger(request.revision));}}
});

async function playingPair(service){
 const clients=[makeClient(service,101),makeClient(service,102)];await register(clients[0],'돌아올 탐정');await register(clients[1],'이어갈 목격자');
 await act(clients[0],'capacity',{count:'2'});await act(clients[0],'create');clients[1].document.querySelector('#join-code').value=clients[0].api.getRoom().code;await act(clients[1],'join');
 for(const client of clients){await client.api.poll();await act(client,'ready');}await clients[0].api.poll();await act(clients[0],'start');
 for(let i=0;i<4;i++){await sync(clients);const g=clients[0].api.getRoom().game,owner=clients.find(c=>c.api.getRoom().game.self.id===g.turnOwnerId);await act(owner,'private-toggle');await act(owner,g.phase==='reveal'?'role-seen':'secret-pass');}
 await sync(clients);assert.equal(clients[0].api.getRoom().game.phase,'investigate');return clients;
}

test('account UI: closing a tab and logging in restores the exact room and role before following an invite',async()=>{
 const service=createService({store:new MemoryStore(),gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}},rateLimit:10000});
 const [original]=await playingPair(service),before=original.api.getRoom(),oldToken=original.sessions.get('last-witness-online-token');
 await act(original,'private-toggle');assert.ok(original.html().includes('YOUR SECRET ROLE'));
 const nextTab=makeClient(service,103,{remembered:original.remembered,href:'http://localhost/?room=ZZZ999'});
 assert.equal(nextTab.sessions.size,0,'a fresh tab starts without the old session token');await login(nextTab,'돌아올 탐정');
 const after=nextTab.api.getRoom();assert.equal(after.code,before.code);assert.equal(after.meId,before.meId);assert.deepEqual(after.game,before.game);assert.ok(!nextTab.requests.some(r=>r.op==='join'),'restored room takes precedence over incoming invite');assert.ok(!nextTab.html().includes('YOUR SECRET ROLE'),'restored role stays masked until opened');
 assertNoPasswordPersisted(nextTab);assert.notEqual(nextTab.sessions.get('last-witness-online-token'),oldToken);
 await original.api.poll();await settle();assert.equal(original.api.getRoom(),null,'revoked old session returns to login');assert.ok(!original.html().includes('YOUR SECRET ROLE'),'old private DOM is removed');assert.ok(original.html().includes('다시 로그인'));assert.ok(!original.sessions.has('last-witness-online-token'));
});

test('account UI: logout during play preserves the board and login restores it',async()=>{
 const service=createService({store:new MemoryStore(),gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}},rateLimit:10000});
 const [client]=await playingPair(service),before=client.api.getRoom();await act(client,'private-toggle');await act(client,'logout');
 assert.ok(client.modal().includes('방과 역할은 그대로 유지'));assert.ok(!client.html().includes('YOUR SECRET ROLE'));await act(client,'logout-confirm');
 assert.equal(client.api.getRoom(),null);assert.equal(client.api.getAccount(),null);assert.ok(!client.sessions.has('last-witness-online-token'));assert.ok(!client.requests.some(r=>r.op==='leave'),'logout never sends leave');
 await login(client,'돌아올 탐정');assert.equal(client.api.getRoom().meId,before.meId);assert.deepEqual(client.api.getRoom().game,before.game);assertNoPasswordPersisted(client);
});

test('account UI: a legacy guest can save the exact playing seat without exposing role or retaining passwords',async()=>{
 const store=new MemoryStore(),now=Date.now(),sessions={},members=[],tokens=[];
 for(let i=0;i<2;i++){const token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex'),id='m_legacy_ui_'+i;tokens.push(token);sessions[hash]={id,name:'이전 참가자 '+i,roomCode:'ABC234',lastSeen:now,expiresAt:now+86400000,requests:{}};members.push({id,name:'이전 참가자 '+i,tokenHash:hash,ready:true,gameId:'u'+i});}
 let game=Party.makeGame(members.map(m=>m.name),{seed:17,secret:{suspectId:'s0',placeId:'p0'}});while(game.phase==='reveal')game=Party.act(game,{type:'ROLE_SEEN',actorId:Party.turnOwner(game)});while(game.phase==='secret')game=Party.act(game,{type:'SECRET_ACTION',actorId:Party.turnOwner(game),kind:'pass'});
 await store.create(WORLD_KEY,{version:1,sessions,rooms:{ABC234:{code:'ABC234',capacity:2,hostId:members[0].id,revision:3,status:'playing',members,game,expiresAt:now+86400000}},rates:{}});
 const service=createService({store,rateLimit:10000}),client=makeClient(service,201,{sessions:new Map([['last-witness-online-token',tokens[0]],['last-witness-online-name','이전 참가자 0']])});await settle();await client.api.poll();await settle();const before=client.api.getRoom();assert.ok(before);
 assert.equal(client.api.getAccount(),null);assert.ok(client.html().includes('현재 자리 저장 · 비밀번호 등록'));await act(client,'private-toggle');await act(client,'logout');assert.ok(client.modal().includes('현재 자리를 다시 찾을 수 없습니다'));await act(client,'upgrade');assert.ok(!client.html().includes('YOUR SECRET ROLE'));assert.ok(!client.modal().includes('secret-case-grid'));
 client.document.querySelector('#nickname').value='저장한 참가자';client.document.querySelector('#password').value=PASSWORD;client.document.querySelector('#password-confirm').value=PASSWORD;await act(client,'upgrade-submit');const after=client.api.getRoom();
 assert.equal(after.code,before.code);assert.equal(after.meId,before.meId);assert.equal(after.hostId,before.hostId);assert.equal(after.game.self.id,before.game.self.id);assert.equal(after.game.self.role,before.game.self.role);assert.deepEqual(after.game.self.clues,before.game.self.clues);assert.equal(after.game.phase,before.game.phase);assert.equal(after.game.kits,before.game.kits);assert.deepEqual(after.game.caseSecret,before.game.caseSecret);assert.ok(client.api.getAccount());assert.ok(!client.html().includes('account-save-banner'));assertNoPasswordPersisted(client);
 const nextTab=makeClient(service,202,{remembered:client.remembered});await login(nextTab,'저장한 참가자');assert.equal(nextTab.api.getRoom().meId,before.meId);assert.equal(nextTab.api.getRoom().game.self.role,before.game.self.role);
});

test('account UI: invalid registration and login clear password inputs and never create a replacement guest',async()=>{
 const service=createService({store:new MemoryStore(),rateLimit:10000}),client=makeClient(service,301);
 await act(client,'auth-mode',{mode:'register'});client.document.querySelector('#nickname').value='비밀번호 확인';client.document.querySelector('#password').value=PASSWORD;client.document.querySelector('#password-confirm').value=PASSWORD+'wrong';await act(client,'register');assert.ok(client.html().includes('비밀번호 확인이 일치하지'));assert.equal(client.requests.length,0,'invalid confirmation never leaves browser');assertNoPasswordPersisted(client);
 await register(client,'내 계정');await act(client,'logout');await act(client,'logout-confirm');client.document.querySelector('#nickname').value='내 계정';client.document.querySelector('#password').value='WrongPassword!2781';await act(client,'login');assert.equal(client.api.getAccount(),null);assert.equal(client.api.getRoom(),null);assert.ok(client.html().includes('일치하지 않습니다'));assertNoPasswordPersisted(client,'WrongPassword!2781');assert.equal(client.requests.filter(r=>r.op==='register').length,1,'bad login does not generate another guest or account');
});

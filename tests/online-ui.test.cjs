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
 const listeners={},sessions=options.sessions||new Map(),remembered=options.remembered||new Map(),requests=[];
 // A small tree DOM: nested window-body updates must be visible in its parent,
 // while input.value stays separate from its serialized HTML attribute.
 const decode=text=>String(text).replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
 const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
 const dataKey=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
 class TextNode{
  constructor(text){this.text=text;this.parentNode=null;}
  get textContent(){return this.text;}
  get outerHTML(){return escape(this.text);}
 }
 function matches(element,selector){
  if(!(element instanceof Element))return false;
  return selector.split(',').some(part=>{
   const s=part.trim(),notDisabled=s.includes(':not(:disabled)'),plain=s.replace(':not(:disabled)','');
   if(notDisabled&&element.disabled)return false;
   const tag=plain.match(/^[\w-]+/)?.[0];if(tag&&element.tagName!==tag.toLowerCase())return false;
   const id=plain.match(/#([\w-]+)/)?.[1];if(id&&element.id!==id)return false;
   for(const m of plain.matchAll(/\.([\w-]+)/g))if(!element.classList.contains(m[1]))return false;
   for(const m of plain.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))if(!element.hasAttribute(m[1])||(m[2]!==undefined&&element.getAttribute(m[1])!==m[2]))return false;
   return true;
  });
 }
 class Element{
  constructor(tag='div',attributes={}){this.tagName=tag.toLowerCase();this.attributes={...attributes};this.children=[];this.parentNode=null;this.style={};this.scrollTop=0;this.scrollHeight=100;this.clientHeight=100;this._value=undefined;this.selectionStart=0;this.selectionEnd=0;this.selectionDirection='none';
   this.dataset=new Proxy({}, {get:(_,key)=>this.getAttribute(dataKey(key))??undefined,set:(_,key,value)=>{this.setAttribute(dataKey(key),value);return true;}});
   const classes=()=>new Set((this.attributes.class||'').split(/\s+/).filter(Boolean));
   this.classList={contains:key=>classes().has(key),add:(...keys)=>{this.attributes.class=[...new Set([...classes(),...keys])].join(' ');},remove:(...keys)=>{this.attributes.class=[...classes()].filter(x=>!keys.includes(x)).join(' ');},toggle:(key,force)=>{const enabled=force===undefined?!classes().has(key):!!force;enabled?this.classList.add(key):this.classList.remove(key);return enabled;}};
  }
  get id(){return this.attributes.id||'';} set id(value){this.attributes.id=value;}
  get className(){return this.attributes.class||'';} set className(value){this.attributes.class=value;}
  get type(){return this.attributes.type||(this.tagName==='textarea'?'textarea':this.tagName==='select'?'select-one':'text');}
  get disabled(){return this.hasAttribute('disabled');} set disabled(value){value?this.setAttribute('disabled',''):delete this.attributes.disabled;}
  get hidden(){return this.hasAttribute('hidden');} set hidden(value){value?this.setAttribute('hidden',''):delete this.attributes.hidden;}
  get checked(){return this.hasAttribute('checked');} set checked(value){value?this.setAttribute('checked',''):delete this.attributes.checked;}
  get value(){if(this._value!==undefined)return this._value;if(this.tagName==='textarea')return this.textContent;if(this.tagName==='select'){const all=this.querySelectorAll('option'),option=all.find(e=>e.hasAttribute('selected'))||all[0];return option?.getAttribute('value')??option?.textContent??'';}return this.getAttribute('value')||'';}
  set value(value){this._value=String(value);}
  get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
  get innerHTML(){return this.children.map(child=>child.outerHTML).join('');}
  set innerHTML(value){this.children.forEach(child=>{child.parentNode=null;});this.children=[];parseHTML(String(value),this);}
  get outerHTML(){return '<'+this.tagName+Object.entries(this.attributes).map(([key,value])=>' '+key+'="'+escape(value)+'"').join('')+'>'+ (voidTags.has(this.tagName)?'':this.innerHTML+'</'+this.tagName+'>');}
  get textContent(){return this.children.map(child=>child.textContent).join('');}
  set textContent(value){this.children.forEach(child=>{child.parentNode=null;});const text=new TextNode(String(value));text.parentNode=this;this.children=[text];}
  getAttribute(key){return Object.hasOwn(this.attributes,key)?this.attributes[key]:null;}
  hasAttribute(key){return Object.hasOwn(this.attributes,key);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  querySelectorAll(selector){const found=[];function visit(parent){for(const child of parent.children)if(child instanceof Element){if(matches(child,selector))found.push(child);visit(child);}}visit(this);return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  contains(element){for(let node=element;node;node=node.parentNode)if(node===this)return true;return false;}
  focus(){document.activeElement=this;}
  setSelectionRange(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}
  scrollIntoView(){}
  closest(selector){for(let node=this;node;node=node.parentNode)if(matches(node,selector))return node;return null;}
  select(){}
 }
 function parseHTML(html,root){
  const stack=[root],tokens=html.match(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+|</g)||[];
  for(const token of tokens){
   if(token.startsWith('<!--'))continue;
   const closing=token.match(/^<\/([\w-]+)/);if(closing){const i=stack.findLastIndex(el=>el.tagName===closing[1].toLowerCase());if(i>0)stack.length=i;continue;}
   const opening=token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/);
   if(opening){const attributes={};for(const m of opening[2].matchAll(/([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attributes[m[1]]=decode(m[2]??m[3]??m[4]??'');const element=new Element(opening[1],attributes),parent=stack.at(-1);element.parentNode=parent;parent.children.push(element);if(!voidTags.has(element.tagName)&&!token.endsWith('/>'))stack.push(element);}
   else{const text=new TextNode(decode(token)),parent=stack.at(-1);text.parentNode=parent;parent.children.push(text);}
  }
 }
 const document={body:new Element('body'),hidden:false,activeElement:null,querySelector:selector=>document.body.querySelector(selector),querySelectorAll:selector=>document.body.querySelectorAll(selector),getElementById:id=>document.body.querySelector('#'+id),addEventListener:(name,callback)=>(listeners[name]??=[]).push(callback)};
 for(const id of ['app','modal-host','toast-host','atmosphere','blood-edge']){const element=new Element('div',{id});element.parentNode=document.body;document.body.children.push(element);}
 const location={href:options.href||'http://localhost/',origin:'http://localhost',pathname:'/'};
 const window={location,history:{replaceState(){}},crypto:{randomUUID:()=>crypto.randomUUID()},WitnessFX:{init(){},setQuality(){},setPrivate(){},burst(){}},WitnessCasePresentation:{busy:()=>false,showStory:({onDone})=>onDone(),cancel(){},questionText(){return'';},answerText(){return'';},type(element,text){element.textContent=text;return{cancel(){}};}},scrollX:0,scrollY:0,scrollTo(){},addEventListener:(name,callback)=>(listeners['window-'+name]??=[]).push(callback)};
 const context={document,window,URL,AbortController,matchMedia:()=>({matches:false}),sessionStorage:{getItem:key=>sessions.get(key)||null,setItem:(key,value)=>sessions.set(key,value),removeItem:key=>sessions.delete(key)},localStorage:{getItem:key=>remembered.get(key)||null,setItem:(key,value)=>remembered.set(key,value),removeItem:key=>remembered.delete(key)},setTimeout:()=>1,clearTimeout(){},navigator:{clipboard:{writeText:async()=>{}}},console,
  fetch:async(url,options)=>{
   if(url==='/party-rules.html')return{ok:true,text:async()=>fs.readFileSync(path.join(publicDir,'party-rules.html'),'utf8')};
   const body=JSON.parse(options.body);requests.push(body);
   try{const result=await service.handle(body,{ip:'ui-audit-'+index});return{ok:true,status:200,json:async()=>result};}
   catch(error){if(!(error instanceof GameError))throw error;return{ok:false,status:error.status,json:async()=>({error:error.message,code:error.code})};}
  }
 };
 vm.createContext(context);for(const file of ['catalog.js','case-interface.js'])vm.runInContext(fs.readFileSync(path.join(publicDir,file),'utf8'),context);
 if(options.practice){vm.runInContext(fs.readFileSync(path.join(publicDir,'practice-engine.js'),'utf8'),context);window.WitnessPracticeEngine=context.WitnessPracticeEngine;vm.runInContext(fs.readFileSync(path.join(publicDir,'practice.js'),'utf8'),context);assert.ok(window.WitnessPracticeEngine,'real browser practice engine is loaded');assert.ok(window.WitnessPractice,'real browser practice adapter is loaded');}
 let source=fs.readFileSync(path.join(publicDir,'online-app.js'),'utf8');const end=source.lastIndexOf('}());');assert.ok(end>0,'UI IIFE boundary exists');
 source=source.slice(0,end)+'window.audit={act,poll,privacy,getRoom:()=>room,getPrivate:()=>privateVisible,getAccount:()=>account,getDrafts:()=>drafts,getModalKind:()=>modalKind};'+source.slice(end);vm.runInContext(source,context);
 const html=()=>document.getElementById('app').innerHTML,modal=()=>document.getElementById('modal-host').innerHTML;
 return{document,api:window.audit,practice:window.WitnessPractice,requests,listeners,sessions,remembered,html,modal,combined:()=>html()+modal(),toast:()=>document.getElementById('toast-host').innerHTML};
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
async function login(client,name,password=PASSWORD){client.document.querySelector('#nickname').value=name;client.document.querySelector('#password').value=password;await act(client,'login');assert.ok(client.api.getAccount());assertNoPasswordPersisted(client,password);}

async function chatInPhase(clients,phase){
 const sender=clients.at(-1),before=sender.api.getRoom().game,phaseKey=before.round+':'+before.phase;
 assert.ok(sender.document.querySelector('#chat-text'),'chat is available during '+phase);
 if(sender.document.querySelector('#case-chat-body').hidden)await act(sender,'chat-toggle');assert.ok(!sender.document.querySelector('#case-chat-body').hidden,'chat opens during '+phase);
 sender.document.querySelector('#chat-text').value='<img src=x onerror=alert(1)> '+phaseKey;
 await act(sender,'send-note');await sync(clients);
 for(const client of clients){const g=client.api.getRoom().game;assert.equal(g.phase,phase,'chat does not advance '+phase);assert.equal(g.round,before.round);assert.ok(client.html().includes('&lt;img src=x onerror=alert(1)&gt; '+phaseKey),'chat escapes XSS');assert.ok(!client.document.querySelector('img[onerror]'),'escaped chat does not create an image');assert.equal(g.notes.at(-1).speakerId,sender.api.getRoom().game.self.id);}
}

for(const count of [2,3,4,5,6])test('online UI: '+count+' authenticated clients finish five rounds with private DOM and preserved drafts',async()=>{
 const service=createService({store:new MemoryStore(),gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}},rateLimit:10000});
 const clients=Array.from({length:count},(_,i)=>makeClient(service,i));
 for(const [i,client]of clients.entries())await register(client,'테스트 '+(i+1));
 const host=clients[0];await act(host,'capacity',{count:String(count)});await act(host,'create');const code=host.api.getRoom().code;
 for(const client of clients.slice(1)){client.document.querySelector('#join-code').value=code;await act(client,'join');}
 for(const client of clients){await client.api.poll();await act(client,'ready');}
 await host.api.poll();await act(host,'start');await sync(clients);
 for(const client of clients){assert.equal(client.api.getModalKind(),'personal','start automatically opens own information window');assert.ok(client.modal().includes('case-locked'),'initial window is sealed');assert.ok(!client.combined().includes('YOUR SECRET ROLE'),'initial role is absent from DOM');}
 if(count===2){const detective=clients.find(c=>c.api.getRoom().game.self.role==='detective').api.getRoom().game;assert.equal(detective.facts.length,2,'2-player starting clues are official from the start');assert.deepEqual(detective.facts.map(f=>f.category).sort(),detective.self.clues.map(f=>f.category).sort());}
 let roleActions=0,secretActions=0,answers=0,discussions=0,audits=0;const chatted=new Set();
 for(let guard=0;guard<120;guard++){
  await sync(clients);const g=host.api.getRoom().game;if(g.phase==='finished')break;
  const owner=clients.find(client=>client.api.getRoom().game.self.id===g.turnOwnerId);
  const remaining=['reveal','secret','investigate'].includes(g.phase)?1:0;
  assert.ok(host.html().includes('<strong>'+remaining+' / 1</strong><span>남은 공동 수사</span>'),'remaining investigation matches '+g.phase);
  if(!chatted.has(g.phase)){await chatInPhase(clients,g.phase);chatted.add(g.phase);}
  if(g.phase==='reveal'){
   assert.equal(owner.api.getModalKind(),'personal','role turn opens its window');await act(owner,'private-show');assert.ok(owner.modal().includes('YOUR SECRET ROLE'));assert.ok(!owner.html().includes('YOUR SECRET ROLE'),'private role lives only in the modal');
   for(const callback of owner.listeners['window-blur']||[])callback();assert.ok(!owner.combined().includes('YOUR SECRET ROLE'),'blur removes private role DOM');assert.ok(owner.modal().includes('case-locked'),'blur reseals the open window');await act(owner,'private-show');
   assert.ok(owner.modal().includes('data-role="'+owner.api.getRoom().game.self.role+'"'),'own role artwork matches own safe view');
   for(const role of ['detective','culprit','witness','suspect','accomplice'].filter(r=>r!==owner.api.getRoom().game.self.role))assert.ok(!owner.modal().includes('data-role="'+role+'"'),'another role card is absent');
   await act(owner,'role-seen');roleActions++;
  }else if(g.phase==='secret'){
   await act(owner,'private-show');
   if(count===2){assert.equal(owner.api.getRoom().game.self.role,'culprit','2-player detective private turn is skipped');assert.ok(!owner.modal().includes('data-action="share"'));assert.ok(!owner.modal().includes('data-action="suggest"'));}
   else{assert.ok(owner.modal().includes('data-action="suggest"'),'party private turns offer a suggestion');if(owner.api.getRoom().game.self.clues.some(c=>!owner.api.getRoom().game.self.shared.includes(c.category)))assert.ok(owner.modal().includes('data-action="share"'),'party turns can publish an unshared private clue');}
   await act(owner,'secret-pass');secretActions++;
  }else if(g.phase==='investigate'){
   assert.equal(owner.api.getModalKind(),'personal','detective investigation automatically opens');await act(owner,'private-show');assert.ok(owner.modal().includes('case-investigation'));
   assert.equal(owner.modal().includes('data-action="accuse"'),g.round<5,'fifth-round investigation precedes accusation');
   const culprit=clients.find(client=>client.api.getRoom().game.self.role==='culprit').api.getRoom().game.self.id;
   owner.document.querySelector('#question-target').value=culprit;owner.document.querySelector('#question-category').value='coat';owner.document.querySelector('#question-proposed').value='1';
   if(g.round===1){const input=owner.document.querySelector('#question-proposed');input.focus();await owner.api.poll();assert.ok(owner.document.querySelector('#question-proposed')===input,'same revision retains question input');const other=clients.find(c=>c!==owner);other.document.querySelector('#chat-text').value='질문 작성 중인 탐정을 기다립니다.';await act(other,'send-note');await owner.api.poll();assert.equal(owner.api.getModalKind(),'personal','new chat revision preserves the question window');assert.equal(owner.document.querySelector('#question-target').value,culprit);assert.equal(owner.document.querySelector('#question-category').value,'coat');assert.equal(owner.document.querySelector('#question-proposed').value,'1');assert.equal(owner.document.activeElement.id,'question-proposed','question focus survives a new revision');}
   if(g.round<=2){const target=clients.find(c=>c.api.getRoom().game.self.id===culprit);await act(target,g.round===1?'rules':'ledger');assert.equal(target.api.getModalKind(),g.round===1?'rules':'ledger','target can read a nonturn window while waiting');}
   await act(owner,'question');
   assert.equal(owner.api.getRoom().game.pending.proposedValue,1,'chosen question assumption reaches the engine');
   if(g.round<=2){await sync(clients);const target=clients.find(c=>c.api.getRoom().game.self.id===culprit);assert.equal(target.api.getModalKind(),'personal','incoming own question takes priority over rules and ledger');}
  }else if(g.phase==='answer'){
   assert.equal(owner.api.getModalKind(),'personal','question automatically opens target window');await act(owner,'private-show');assert.ok(owner.modal().includes('case-interrogation'),'target has the question and answer controls');assert.ok(owner.modal().includes('data-action="answer"'));await act(owner,'answer',{value:'0'});answers++;
  }else if(g.phase==='discussion'){
   discussions++;const detective=clients.find(client=>client.api.getRoom().game.self.role==='detective'),other=clients.find(client=>client!==detective);
   assert.equal(detective.api.getModalKind(),'review','result automatically opens detective review window');assert.ok(detective.modal().includes('case-review'));assert.ok(detective.modal().includes('data-action="review-confirm"'));
   if(g.round===2){const before=detective.api.getRoom().game,statement=before.statements.at(-1);assert.ok(detective.modal().includes('data-action="review-audit"'));await act(detective,'review-audit');const audited=detective.api.getRoom().game;assert.equal(audited.kits,before.kits-1);assert.equal(audited.review.verified,true);assert.equal(audited.statements.length,before.statements.length);assert.equal(audited.statements.find(s=>s.id===statement.id).value,statement.value,'verification retains original answer');assert.equal(audited.facts.length,before.facts.length+1);assert.ok(detective.modal().includes('case-verified'));assert.ok(!detective.modal().includes('data-action="review-audit"'),'already verified reply cannot be audited twice');audits++;await sync(clients);}
   other.document.querySelector('#chat-text').value='작성 중인 개인 발언 '+g.round;other.document.querySelector('#chat-text').focus();const input=other.document.querySelector('#chat-text');await other.api.poll();assert.ok(other.document.querySelector('#chat-text')===input,'same revision retains actual input node');
   detective.document.querySelector('#chat-text').value='<img src=x onerror=alert(1)> 공개 발언';await act(detective,'send-note');await other.api.poll();
   assert.equal(other.document.querySelector('#chat-text').value,'작성 중인 개인 발언 '+g.round,'new revision preserves draft');assert.equal(other.document.activeElement.id,'chat-text','new revision restores focused field');assert.ok(other.html().includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!other.html().includes('<img src=x'));
   await act(other,'ledger');const modal=other.modal();detective.document.querySelector('#chat-text').value='새 기록 '+g.round;await act(detective,'send-note');await other.api.poll();assert.equal(other.modal(),modal,'poll leaves open modal intact');await act(other,'close-modal');
   const kits=detective.api.getRoom().game.kits;await act(detective,'review-confirm');assert.equal(detective.api.getRoom().game.kits,kits,'confirming a result does not use a forensic kit');assert.equal(detective.api.getRoom().game.phase,g.round<5?'secret':'final');
  }else if(g.phase==='final'){
   assert.equal(owner.api.getModalKind(),'personal','final turn opens detective window');await act(owner,'private-show');assert.ok(owner.modal().includes('data-action="accuse"'));await act(owner,'accuse');owner.document.querySelector('#accuse-person').value='s0';owner.document.querySelector('#accuse-place').value='p0';await act(owner,'confirm-accuse');
  }else assert.fail('Unexpected phase '+g.phase);
 }
 await sync(clients);assert.equal(host.api.getRoom().status,'finished');assert.equal(roleActions,count);assert.equal(secretActions,count===2?5:count*5);assert.equal(answers,5);assert.equal(discussions,5);assert.equal(audits,1);assert.deepEqual([...chatted].sort(),['answer','discussion','final','investigate','reveal','secret'].sort());
 for(const client of clients){assert.ok(client.html().includes('수사 진영의 승리'));assert.ok(client.html().includes('모든 역할과 진영 공개'));for(const request of client.requests.filter(r=>r.op==='action')){assert.ok(!Object.hasOwn(request.event,'actorId'));assert.ok(!Object.hasOwn(request.event,'speakerId'));assert.ok(request.requestId);assert.ok(Number.isSafeInteger(request.revision));}}
});

async function playingPair(service,options={}){
 const clients=[makeClient(service,101,options),makeClient(service,102,options)];await register(clients[0],'돌아올 탐정');await register(clients[1],'이어갈 목격자');
 await act(clients[0],'capacity',{count:'2'});await act(clients[0],'create');clients[1].document.querySelector('#join-code').value=clients[0].api.getRoom().code;await act(clients[1],'join');
 for(const client of clients){await client.api.poll();await act(client,'ready');}await clients[0].api.poll();await act(clients[0],'start');
 for(let i=0;i<8;i++){await sync(clients);const g=clients[0].api.getRoom().game;if(g.phase==='investigate')break;const owner=clients.find(c=>c.api.getRoom().game.self.id===g.turnOwnerId);await act(owner,'private-show');await act(owner,g.phase==='reveal'?'role-seen':'secret-pass');}
 await sync(clients);assert.equal(clients[0].api.getRoom().game.phase,'investigate');return clients;
}

test('account UI: closing a tab and logging in restores the exact room and role before following an invite',async()=>{
 const service=createService({store:new MemoryStore(),gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}},rateLimit:10000});
 const [original]=await playingPair(service),before=original.api.getRoom(),oldToken=original.sessions.get('last-witness-online-token');
 await act(original,'private-show');assert.ok(original.modal().includes('YOUR SECRET ROLE'));
 const nextTab=makeClient(service,103,{remembered:original.remembered,href:'http://localhost/?room=ZZZ999'});
 assert.equal(nextTab.sessions.size,0,'a fresh tab starts without the old session token');await login(nextTab,'돌아올 탐정');
 const after=nextTab.api.getRoom();assert.equal(after.code,before.code);assert.equal(after.meId,before.meId);assert.deepEqual(after.game,before.game);assert.ok(!nextTab.requests.some(r=>r.op==='join'),'restored room takes precedence over incoming invite');assert.ok(!nextTab.combined().includes('YOUR SECRET ROLE'),'restored role stays masked until opened');assert.equal(nextTab.api.getModalKind(),'personal');assert.ok(nextTab.modal().includes('case-locked'));
 assertNoPasswordPersisted(nextTab);assert.notEqual(nextTab.sessions.get('last-witness-online-token'),oldToken);
 await original.api.poll();await settle();assert.equal(original.api.getRoom(),null,'revoked old session returns to login');assert.ok(!original.combined().includes('YOUR SECRET ROLE'),'old private DOM is removed');assert.ok(original.html().includes('다시 로그인'));assert.ok(!original.sessions.has('last-witness-online-token'));
});

test('account UI: logout during play preserves the board and login restores it',async()=>{
 const service=createService({store:new MemoryStore(),gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}},rateLimit:10000});
 const [client]=await playingPair(service),before=client.api.getRoom();await act(client,'private-show');await act(client,'logout');
 assert.ok(client.modal().includes('방과 역할은 그대로 유지'));assert.ok(!client.combined().includes('YOUR SECRET ROLE'));await act(client,'logout-confirm');
 assert.equal(client.api.getRoom(),null);assert.equal(client.api.getAccount(),null);assert.ok(!client.sessions.has('last-witness-online-token'));assert.ok(!client.requests.some(r=>r.op==='leave'),'logout never sends leave');
 await login(client,'돌아올 탐정');assert.equal(client.api.getRoom().meId,before.meId);assert.deepEqual(client.api.getRoom().game,before.game);assertNoPasswordPersisted(client);
});

test('account UI: a legacy guest can save the exact playing seat without exposing role or retaining passwords',async()=>{
 const store=new MemoryStore(),now=Date.now(),sessions={},members=[],tokens=[];
 for(let i=0;i<2;i++){const token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex'),id='m_legacy_ui_'+i;tokens.push(token);sessions[hash]={id,name:'이전 참가자 '+i,roomCode:'ABC234',lastSeen:now,expiresAt:now+86400000,requests:{}};members.push({id,name:'이전 참가자 '+i,tokenHash:hash,ready:true,gameId:'u'+i});}
 let game=Party.makeGame(members.map(m=>m.name),{seed:17,secret:{suspectId:'s0',placeId:'p0'}});while(game.phase==='reveal')game=Party.act(game,{type:'ROLE_SEEN',actorId:Party.turnOwner(game)});while(game.phase==='secret')game=Party.act(game,{type:'SECRET_ACTION',actorId:Party.turnOwner(game),kind:'pass'});
 await store.create(WORLD_KEY,{version:1,sessions,rooms:{ABC234:{code:'ABC234',capacity:2,hostId:members[0].id,revision:3,status:'playing',members,game,expiresAt:now+86400000}},rates:{}});
 const service=createService({store,rateLimit:10000}),client=makeClient(service,201,{sessions:new Map([['last-witness-online-token',tokens[0]],['last-witness-online-name','이전 참가자 0']])});await settle();await client.api.poll();await settle();const before=client.api.getRoom();assert.ok(before);
 assert.equal(client.api.getAccount(),null);assert.ok(client.html().includes('현재 자리 저장 · 비밀번호 등록'));await act(client,'private-show');await act(client,'logout');assert.ok(client.modal().includes('현재 자리를 다시 찾을 수 없습니다'));await act(client,'upgrade');assert.ok(!client.combined().includes('YOUR SECRET ROLE'));assert.ok(!client.modal().includes('secret-case-grid'));
 client.document.querySelector('#nickname').value='저장한 참가자';client.document.querySelector('#password').value=PASSWORD;client.document.querySelector('#password-confirm').value=PASSWORD;await act(client,'upgrade-submit');const after=client.api.getRoom();
 assert.equal(after.code,before.code);assert.equal(after.meId,before.meId);assert.equal(after.hostId,before.hostId);assert.equal(after.game.self.id,before.game.self.id);assert.equal(after.game.self.role,before.game.self.role);assert.deepEqual(after.game.self.clues,before.game.self.clues);assert.equal(after.game.phase,before.game.phase);assert.equal(after.game.kits,before.game.kits);assert.deepEqual(after.game.caseSecret,before.game.caseSecret);assert.ok(client.api.getAccount());assert.ok(!client.html().includes('account-save-banner'));assertNoPasswordPersisted(client);
 const nextTab=makeClient(service,202,{remembered:client.remembered});await login(nextTab,'저장한 참가자');assert.equal(nextTab.api.getRoom().meId,before.meId);assert.equal(nextTab.api.getRoom().game.self.role,before.game.self.role);
});

test('account UI: invalid registration and login clear password inputs and never create a replacement guest',async()=>{
 const service=createService({store:new MemoryStore(),rateLimit:10000}),client=makeClient(service,301);
 await act(client,'auth-mode',{mode:'register'});assert.equal(client.document.querySelector('#password').getAttribute('maxlength'),'16');assert.equal(client.document.querySelector('#password-confirm').getAttribute('maxlength'),'16');client.document.querySelector('#nickname').value='비밀번호 확인';client.document.querySelector('#password').value=PASSWORD;client.document.querySelector('#password-confirm').value=PASSWORD.slice(0,-1)+'2';await act(client,'register');assert.ok(client.html().includes('비밀번호 확인이 일치하지'));assert.equal(client.requests.length,0,'invalid confirmation never leaves browser');assertNoPasswordPersisted(client);
 await register(client,'내 계정');await act(client,'logout');await act(client,'logout-confirm');client.document.querySelector('#nickname').value='내 계정';client.document.querySelector('#password').value='WrongPassword!2781';await act(client,'login');assert.equal(client.api.getAccount(),null);assert.equal(client.api.getRoom(),null);assert.ok(client.html().includes('일치하지 않습니다'));assertNoPasswordPersisted(client,'WrongPassword!2781');assert.equal(client.requests.filter(r=>r.op==='register').length,1,'bad login does not generate another guest or account');
});

test('account UI: existing long passwords remain login-valid while new registration is limited to sixteen characters',async()=>{
 const legacy='LegacyPassword!123456789',salt=crypto.randomBytes(16),{PARAMETERS}=require('../lib/passwords.cjs');
 const key=await new Promise((resolve,reject)=>crypto.scrypt(legacy,salt,64,PARAMETERS,(error,key)=>error?reject(error):resolve(key)));
 const name='긴 기존 비밀번호',accountKey='a_'+crypto.createHash('sha256').update(name.toLowerCase()).digest('hex'),store=new MemoryStore();
 await store.create(WORLD_KEY,{version:2,accounts:{[accountKey]:{id:'m_legacy_long_ui',name,roomCode:null,createdAt:Date.now(),password:{algorithm:'scrypt',N:PARAMETERS.N,r:PARAMETERS.r,p:PARAMETERS.p,salt:salt.toString('base64url'),hash:key.toString('base64url')}}},sessions:{},rooms:{},rates:{}});
 const service=createService({store,rateLimit:10000}),client=makeClient(service,401);
 assert.equal(client.document.querySelector('#password').getAttribute('maxlength'),'128','login accepts the previous password limit');assert.equal(client.document.querySelector('#password').getAttribute('autocomplete'),'current-password');
 await login(client,name,legacy);assert.equal(client.api.getAccount().id,'m_legacy_long_ui');await act(client,'logout');await act(client,'logout-confirm');
 await act(client,'auth-mode',{mode:'register'});assert.equal(client.document.querySelector('#password').getAttribute('maxlength'),'16');assert.equal(client.document.querySelector('#password').getAttribute('autocomplete'),'new-password');
 client.document.querySelector('#nickname').value='새 긴 비밀번호';client.document.querySelector('#password').value=legacy;client.document.querySelector('#password-confirm').value=legacy;const requests=client.requests.length;await act(client,'register');assert.equal(client.requests.length,requests,'new password over sixteen characters is rejected before a request');assert.ok(client.html().includes('8~16자로'));assertNoPasswordPersisted(client,legacy);
});

test('practice UI: a visitor can enter, chat in, and exit real local practice without login or server requests',async t=>{
 const service=createService({store:new MemoryStore(),rateLimit:10000}),client=makeClient(service,501,{practice:true});t.after(()=>client.practice.stop());
 const tokenBefore=client.sessions.get('last-witness-online-token'),nameBefore=client.sessions.get('last-witness-online-name'),rememberedBefore=[...client.remembered];
 assert.equal(client.api.getAccount(),null);assert.equal(client.api.getRoom(),null);assert.equal(client.requests.length,0);
 await act(client,'practice-setup');assert.equal(client.api.getModalKind(),'practice');assert.ok(client.modal().includes('로그인 없이 실제 규칙으로 연습'));
 await act(client,'practice-count',{count:'3'});await act(client,'practice-role',{role:'detective'});await act(client,'practice-start');
 assert.equal(client.practice.active(),true);const local=client.api.getRoom();assert.equal(local.code,'PRACTICE');assert.equal(local.practice,true);assert.equal(local.members.length,3);assert.equal(local.game.self.role,'detective');assert.ok(!Object.hasOwn(local.game,'caseSecret'),'human detective receives no criminal case');assert.equal(client.api.getAccount(),null);
 assert.ok(client.html().includes('PRACTICE / LOCAL'));assert.ok(client.html().includes('컴퓨터와 연습 중'));assert.ok(client.document.querySelector('.case-chat'),'floating chat exists in local practice');assert.ok(client.document.querySelector('#chat-text'));assert.ok(client.modal().includes('case-locked'),'practice also starts with the personal card sealed');
 client.document.querySelector('#chat-text').value='로그인 없는 연습 대화';await act(client,'send-note');assert.equal(client.api.getRoom().game.notes.at(-1).text,'로그인 없는 연습 대화','the UI routes game actions to the real local adapter');await client.api.poll();await settle();assert.equal(client.requests.length,0,'local actions and polls do not call the room API');
 await act(client,'practice-exit');assert.equal(client.practice.active(),false);assert.equal(client.api.getRoom(),null);assert.equal(client.api.getAccount(),null);assert.ok(client.document.querySelector('#nickname'),'exit returns to the login screen');assert.ok(!client.combined().includes('YOUR SECRET ROLE'));assert.ok(!client.document.querySelector('.case-chat'));assert.equal(client.requests.length,0,'the full visitor practice flow sends zero API requests');
 assert.equal(client.sessions.get('last-witness-online-token'),tokenBefore);assert.equal(client.sessions.get('last-witness-online-name'),nameBefore);assert.deepEqual([...client.remembered],rememberedBefore,'practice does not change remembered account identity');
});

test('practice UI: an authenticated player returns to the exact online seat and account after local practice',async t=>{
 const service=createService({store:new MemoryStore(),gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}},rateLimit:10000});
 const [client,partner]=await playingPair(service,{practice:true});t.after(()=>{client.practice.stop();partner.practice.stop();});
 const before=client.api.getRoom(),accountBefore=client.api.getAccount(),tokenBefore=client.sessions.get('last-witness-online-token'),nameBefore=client.sessions.get('last-witness-online-name'),rememberedBefore=[...client.remembered],requestCount=client.requests.length,partnerBefore=partner.api.getRoom().game;
 await act(client,'private-show');await act(client,'practice-setup');await act(client,'practice-count',{count:'6'});await act(client,'practice-role',{role:'culprit'});await act(client,'practice-start');
 assert.equal(client.api.getRoom().code,'PRACTICE');assert.equal(client.api.getRoom().game.self.role,'culprit');assert.equal(client.api.getRoom().members.length,6);assert.ok(client.document.querySelector('.case-chat'));assert.ok(client.html().includes('PRACTICE / LOCAL'));assert.equal(client.sessions.get('last-witness-online-token'),tokenBefore);assert.deepEqual(client.api.getAccount(),accountBefore,'entering practice retains the suspended online account');
 client.document.querySelector('#chat-text').value='서버에 보내지 않는 컴퓨터 연습 발언';await act(client,'send-note');await client.api.poll();await settle();assert.equal(client.requests.length,requestCount,'entering and using practice has no server request');
 await act(client,'practice-exit');await client.api.poll();await settle();const after=client.api.getRoom();
 assert.equal(client.practice.active(),false);assert.equal(after.code,before.code);assert.equal(after.meId,before.meId);assert.equal(after.hostId,before.hostId);assert.equal(after.revision,before.revision);assert.deepEqual(after.game,before.game,'all online role, private clues, case, resources and pending turn are preserved');assert.deepEqual(client.api.getAccount(),accountBefore);assert.equal(client.sessions.get('last-witness-online-token'),tokenBefore);assert.equal(client.sessions.get('last-witness-online-name'),nameBefore);assert.deepEqual([...client.remembered],rememberedBefore);assert.ok(!client.combined().includes('YOUR SECRET ROLE'),'the restored online role is sealed again');assert.ok(!client.html().includes('컴퓨터와 연습 중'));
 assert.ok(client.requests.slice(requestCount).every(request=>request.op==='poll'),'returning may poll but cannot mutate the server room');await partner.api.poll();assert.deepEqual(partner.api.getRoom().game,partnerBefore,'the partner sees the untouched online game');assertNoPasswordPersisted(client);
});

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
 const listeners={},sessions=options.sessions||new Map(),remembered=options.remembered||new Map(),requests=[],timerTasks=new Map();let timerId=0;
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
 const immediatePresentation={busy:()=>false,showStory:({onDone})=>onDone(),cancel(){},questionText(){return'';},answerText(){return'';},type(element,text,settings={}){element.textContent=text;const result={cancelled:false,text};queueMicrotask(()=>settings.onDone?.(result));return{cancel(){},finish(){},done:true,promise:Promise.resolve(result)};}};
 const window={location,history:{replaceState(){}},crypto:{randomUUID:()=>crypto.randomUUID()},WitnessFX:{init(){},setQuality(){},setPrivate(){},burst(){}},WitnessCasePresentation:options.presentation||immediatePresentation,scrollX:0,scrollY:0,scrollTo(){},addEventListener:(name,callback)=>(listeners['window-'+name]??=[]).push(callback)};
 const context={document,window,URL,AbortController,matchMedia:()=>({matches:false}),sessionStorage:{getItem:key=>sessions.get(key)||null,setItem:(key,value)=>sessions.set(key,value),removeItem:key=>sessions.delete(key)},localStorage:{getItem:key=>remembered.get(key)||null,setItem:(key,value)=>remembered.set(key,value),removeItem:key=>remembered.delete(key)},setTimeout(fn,delay){if(!options.botClock)return 1;const id=++timerId;timerTasks.set(id,{fn,delay});return id;},clearTimeout(id){timerTasks.delete(id);},navigator:{clipboard:{writeText:async()=>{}}},console,
  fetch:async(url,options)=>{
   if(url==='/party-rules.html')return{ok:true,text:async()=>fs.readFileSync(path.join(publicDir,'party-rules.html'),'utf8')};
   const body=JSON.parse(options.body);requests.push(body);
   try{const result=await service.handle(body,{ip:'ui-audit-'+index});return{ok:true,status:200,json:async()=>result};}
   catch(error){if(!(error instanceof GameError))throw error;return{ok:false,status:error.status,json:async()=>({error:error.message,code:error.code})};}
  }
 };
 vm.createContext(context);for(const file of ['catalog.js','detective-options.js','case-interface.js','case-replay.js'])vm.runInContext(fs.readFileSync(path.join(publicDir,file),'utf8'),context);
 if(options.practice){vm.runInContext(fs.readFileSync(path.join(publicDir,'practice-engine.js'),'utf8'),context);window.WitnessPracticeEngine=context.WitnessPracticeEngine;vm.runInContext(fs.readFileSync(path.join(publicDir,'practice.js'),'utf8'),context);assert.ok(window.WitnessPracticeEngine,'real browser practice engine is loaded');assert.ok(window.WitnessPractice,'real browser practice adapter is loaded');}
 let source=fs.readFileSync(path.join(publicDir,'online-app.js'),'utf8');const end=source.lastIndexOf('}());');assert.ok(end>0,'UI IIFE boundary exists');
 source=source.slice(0,end)+'window.audit={act,poll,privacy,acceptRoom,render,setPending:value=>{pending=value;render();},getRoom:()=>room,getPrivate:()=>privateVisible,getAccount:()=>account,getDrafts:()=>drafts,getModalKind:()=>modalKind};'+source.slice(end);vm.runInContext(source,context);
 const html=()=>document.getElementById('app').innerHTML,modal=()=>document.getElementById('modal-host').innerHTML;
 return{document,api:window.audit,practice:window.WitnessPractice,requests,listeners,sessions,remembered,html,modal,combined:()=>html()+modal(),toast:()=>document.getElementById('toast-host').innerHTML,nextBot(){const item=[...timerTasks].find(([,task])=>task.delay>=700&&task.delay<=1400);assert.ok(item,'the real practice adapter scheduled a bot turn');timerTasks.delete(item[0]);item[1].fn();}};
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
   const questionField=owner.document.querySelector('#question-category');
   if(!questionField||questionField.disabled||!questionField.querySelector('option[value]')){assert.ok(!owner.document.querySelector('[data-action="question"]')||owner.document.querySelector('[data-action="question"]').disabled,'no hidden fallback question remains');await act(owner,'skip');await act(owner,'skip-confirm');continue;}
   const chosenCategory=questionField.value;
   owner.document.querySelector('#question-target').value=culprit;owner.document.querySelector('#question-proposed').value='1';
   if(g.round===1){const input=owner.document.querySelector('#question-proposed');input.focus();await owner.api.poll();assert.ok(owner.document.querySelector('#question-proposed')===input,'same revision retains question input');const other=clients.find(c=>c!==owner);other.document.querySelector('#chat-text').value='질문 작성 중인 탐정을 기다립니다.';await act(other,'send-note');await owner.api.poll();assert.equal(owner.api.getModalKind(),'personal','new chat revision preserves the question window');assert.equal(owner.document.querySelector('#question-target').value,culprit);assert.equal(owner.document.querySelector('#question-category').value,chosenCategory);assert.equal(owner.document.querySelector('#question-proposed').value,'1');assert.equal(owner.document.activeElement.id,'question-proposed','question focus survives a new revision');}
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
 await sync(clients);assert.equal(host.api.getRoom().status,'finished');assert.equal(roleActions,count);assert.equal(secretActions,count===2?5:count*5);assert.equal(answers,3,'the detective asks each of the three unknown categories once');assert.equal(discussions,5);assert.equal(audits,1);assert.deepEqual([...chatted].sort(),['answer','discussion','final','investigate','reveal','secret'].sort());
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

// Deliberately unfinished handwriting reproduces a poll arriving while a person
// is still reading. No wall-clock sleeps or network races are involved.
function controlledPresentation(){
 const types=[],scenes=[];
 const api={types,scenes,busy:()=>false,questionText:()=> '탐정의 질문입니다.',answerText:()=> '목격자의 답변입니다.',
  showStory(settings){scenes.push({kind:'story',day:settings.day,stage:settings.stage});settings.onDone?.();return Promise.resolve({cancelled:false});},
  showDay(day,settings){scenes.push({kind:'day',day});settings.onDone?.();return Promise.resolve({cancelled:false});},
  type(element,text,settings={}){let resolve,done=false;const promise=new Promise(r=>{resolve=r;});element.textContent=String(text).slice(0,1);const handle={element,text,promise,get done(){return done;},finish(){if(done)return;done=true;element.textContent=text;const result={cancelled:false,text};resolve(result);queueMicrotask(()=>settings.onDone?.(result));},cancel(){if(done)return;done=true;resolve({cancelled:true});}};types.push(handle);return handle;},
  cancel(){types.forEach(handle=>handle.cancel());}
 };return api;
}
function projectedRoom(role,patch={}){
 const state=JSON.parse(JSON.stringify(Party.makeGame(['가','나','다','라','마','바'],{seed:17,secret:{suspectId:'s0',placeId:'p0'}})));
 const actor=state.players.find(p=>p.role===role);state.phase=patch.phase||'investigate';state.round=patch.round||1;
 if(state.phase==='answer')state.pending={targetId:actor.id,category:'item',proposedValue:0};
 const g=JSON.parse(JSON.stringify(Party.publicView(state)));g.self=JSON.parse(JSON.stringify(actor));
 g.self.clues=role==='detective'?[{category:'coat',value:0},{category:'zone',value:0}]:[];
 Object.assign(g,patch);g.self={...JSON.parse(JSON.stringify(actor)),...g.self};
 if(role==='culprit'){g.caseSecret=state.secretNPC;g.remainingLies=2;g.partnerIds=[];}
 return {code:'ABC234',caseId:'synthetic-case-ui',capacity:6,status:'playing',revision:1,hostId:actor.id,meId:actor.id,members:state.players.map(p=>({id:p.id,gameId:p.id,name:p.name,ready:true,online:true})),game:g};
}
async function loadProjection(client,room){client.api.acceptRoom(room,true);await settle();}
function selectValues(client,id){return(client.document.querySelector('#'+id)?.querySelectorAll('option')||[]).map(option=>option.value).filter(Boolean);}

test('detective UI: final accusation combines official evidence, own memories, and manual exclusions',async()=>{
 const client=makeClient(createService({store:new MemoryStore()}),601),room=projectedRoom('detective',{phase:'final',facts:[{id:'fact-1',category:'hand',value:0,source:'search',round:1}]});
 await loadProjection(client,room);await act(client,'private-show');await act(client,'mark-s',{id:'s0'});await act(client,'mark-p',{id:'p1'});await act(client,'accuse');
 assert.deepEqual(selectValues(client,'accuse-person'),['s1'],'official hand clue + own coat clue + manual s0 exclusion leave s1');
 assert.deepEqual(selectValues(client,'accuse-place'),['p0'],'own zone clue + manual p1 exclusion leave p0');
 assert.equal(client.document.querySelector('#confirm-accuse').disabled,true,'placeholders require an explicit final selection');
 await act(client,'close-modal');await act(client,'mark-s',{id:'s1'});await act(client,'mark-p',{id:'p0'});await act(client,'accuse');
 assert.deepEqual(selectValues(client,'accuse-person'),[]);assert.deepEqual(selectValues(client,'accuse-place'),[]);
 assert.equal(client.document.querySelector('#confirm-accuse').disabled,true,'crossing out every candidate never restores excluded choices');
 assert.ok(client.document.getElementById('modal-host').querySelector('[data-action="clear-marks"]'),'empty manual result offers memo reset inside final accusation');
});

test('detective UI: known, answered, unknown and blocked categories never return as an empty-list fallback',async()=>{
 const client=makeClient(createService({store:new MemoryStore()}),602),room=projectedRoom('detective',{questionHistory:[{round:1,category:'hand',status:'answered'},{round:2,category:'item',status:'blocked'},{round:3,category:'light',status:'unknown'}]});
 client.api.getDrafts().questionCategory='coat';client.api.getDrafts().questionProposed='1';await loadProjection(client,room);await act(client,'private-show');
 const field=client.document.querySelector('#question-category'),question=client.document.querySelector('[data-action="question"]');
 assert.ok(!field||field.disabled||selectValues(client,'question-category').length===0,'all five exhausted categories are removed');
 assert.ok(!question||question.disabled,'there is no enabled question backed by hidden coat/zero defaults');
 assert.ok(!client.document.querySelector('#question-proposed')||client.document.querySelector('#question-proposed').disabled,'assumptions also stop when no category remains');
 assert.ok(client.modal().includes('data-action="skip"'),'a valid pass preserves five-day progress with no new questions');
 await act(client,'tab',{id:'search'});const search=client.document.getElementById('modal-host').querySelectorAll('[data-action="search"]');assert.deepEqual(search.map(button=>button.dataset.category),['hand','item','light'],'the one-use forensic kit can still establish truth for previously unresolved questions');assert.ok(search.every(button=>!['coat','zone'].includes(button.dataset.category)),'field search never spends a kit on an already known truth');
});

test('detective UI: filtering an old category draft also rebuilds its matching assumption choices',async()=>{
 const client=makeClient(createService({store:new MemoryStore()}),612),room=projectedRoom('detective',{questionHistory:[{round:1,category:'hand',status:'answered'},{round:2,category:'light',status:'blocked'}]});
 await loadProjection(client,room);client.api.getDrafts().questionCategory='coat';client.api.getDrafts().questionProposed='1';await act(client,'private-show');
 assert.deepEqual(selectValues(client,'question-category'),['item']);assert.equal(client.document.querySelector('#question-category').value,'item');
 assert.equal(client.document.querySelector('#question-proposed').value,'0','switching away from filtered stale draft resets its assumption');
 assert.deepEqual(client.document.querySelector('#question-proposed').querySelectorAll('option').map(o=>o.textContent),['장갑','손목시계'],'assumption labels belong to the remaining item category');
});

test('detective UI: a blocked review finishes handwriting before confirmation can advance',async()=>{
 const scene=controlledPresentation(),client=makeClient(createService({store:new MemoryStore()}),603,{presentation:scene}),room=projectedRoom('detective',{phase:'discussion',review:{kind:'blocked',round:1,category:'item'}});
 await loadProjection(client,room);assert.equal(client.api.getModalKind(),'review');
 assert.equal(client.document.querySelector('[data-action="review-confirm"]').disabled,true,'next day cannot interrupt the blocked explanation');
 assert.ok(client.document.querySelector('[data-action="letter-finish"]'),'readers can explicitly finish the handwriting');
 await act(client,'letter-finish');assert.equal(scene.types.at(-1).done,true);assert.equal(client.api.getRoom().game.round,1,'fast-forward reveals text without advancing a day');
 assert.equal(client.document.querySelector('[data-action="review-confirm"]').disabled,false,'the later confirmation becomes available after text completion');
});

test('notice UI: a blocked notice survives a newer day, then drains to the latest day without replay',async()=>{
 const scene=controlledPresentation(),client=makeClient(createService({store:new MemoryStore()}),604,{presentation:scene}),base=projectedRoom('witness');
 await loadProjection(client,base);
 const blocked=JSON.parse(JSON.stringify(base));blocked.revision=2;blocked.game.phase='discussion';blocked.game.review={kind:'blocked',round:1,category:'item'};await loadProjection(client,blocked);
 assert.equal(client.api.getModalKind(),'obstruction');const original=client.modal(),typing=scene.types.at(-1),sceneCount=scene.scenes.length;
 assert.equal(client.document.querySelector('[data-action="notice-continue"]').disabled,true);assert.ok(client.document.querySelector('[data-action="notice-finish"]'));
 const next=JSON.parse(JSON.stringify(blocked));next.revision=3;next.game.phase='secret';next.game.round=2;next.game.review=null;next.game.turnOwnerId=next.game.self.id;await loadProjection(client,next);
 assert.equal(client.api.getModalKind(),'obstruction');assert.equal(client.modal(),original,'a poll must not replace the partly written notice');assert.equal(typing.done,false);assert.equal(scene.scenes.length,sceneCount,'DAY-02 story waits behind current notice');
 await act(client,'notice-finish');assert.equal(client.api.getRoom().game.round,2);assert.equal(client.api.getModalKind(),'obstruction','first action only completes the current message');assert.equal(client.document.querySelector('[data-action="notice-continue"]').disabled,false);
 await act(client,'notice-continue');assert.ok(scene.scenes.some(s=>s.kind==='story'&&s.day===2),'continuation displays the newest day story');assert.equal(client.api.getModalKind(),'personal','own current turn menu follows the completed story');
 await loadProjection(client,next);assert.equal(client.api.getModalKind(),'personal','repeated polling cannot replay consumed obstruction');
});

test('notice UI: failed concealment is shown only to the culprit and only once per case and round',async()=>{
 for(const role of ['detective','witness','suspect','accomplice','culprit']){
  const scene=controlledPresentation(),client=makeClient(createService({store:new MemoryStore()}),610,{presentation:scene}),base=projectedRoom(role);await loadProjection(client,base);
  const resolved=JSON.parse(JSON.stringify(base));resolved.revision=2;resolved.game.phase='discussion';resolved.game.review={kind:'search',category:'item',round:1,value:0,verified:true,actualValue:0};resolved.game.self.sealOutcome={round:1,success:false,reason:'miss'};await loadProjection(client,resolved);
  if(role!=='culprit'){assert.notEqual(client.api.getModalKind(),'obstruction',role+' must never render the culprit-only failure');continue;}
  assert.equal(client.api.getModalKind(),'obstruction');assert.ok(client.modal().includes('은폐'),'culprit receives an explicit outcome');assert.equal(client.document.querySelector('[data-action="notice-continue"]').disabled,true);
  await act(client,'notice-finish');await act(client,'notice-continue');await loadProjection(client,resolved);assert.notEqual(client.api.getModalKind(),'obstruction','same private result cannot replay under polling');
 }
});

test('notice UI: changing the case cancels pending handwriting without a stale continuation',async()=>{
 const scene=controlledPresentation(),client=makeClient(createService({store:new MemoryStore()}),611,{presentation:scene}),base=projectedRoom('culprit');await loadProjection(client,base);
 const resolved=JSON.parse(JSON.stringify(base));resolved.revision=2;resolved.game.phase='discussion';resolved.game.self.sealOutcome={round:1,success:false,reason:'miss'};await loadProjection(client,resolved);assert.equal(client.api.getModalKind(),'obstruction');const old=scene.types.at(-1);
 const replacement=projectedRoom('culprit');replacement.caseId='brand-new-case-ui';replacement.revision=3;await loadProjection(client,replacement);old.finish();await settle();
 assert.equal(client.api.getRoom().caseId,'brand-new-case-ui');assert.notEqual(client.api.getModalKind(),'obstruction','cancelled old case cannot open its notice or next-turn continuation');
});

test('detective UI: incoming chat and pending renders retain one review typing session before audit is enabled',async()=>{
 for(const originalValue of [0,1]){
  const scene=controlledPresentation(),client=makeClient(createService({store:new MemoryStore()}),620+originalValue,{presentation:scene}),room=projectedRoom('detective',{phase:'discussion'}),target=room.game.players.find(p=>!p.isDetective).id;
  room.game.statements=[{id:'statement-1',round:1,speakerId:target,category:'item',value:originalValue,audited:false}];
  room.game.review={kind:'answer',round:1,category:'item',targetId:target,statementId:'statement-1',value:originalValue,verified:false,proposedValue:0};
  await loadProjection(client,room);const typing=scene.types.at(-1),typedElement=typing.element,typesStarted=scene.types.length;
  assert.equal(client.document.querySelector('[data-action="review-audit"]').disabled,true);assert.equal(client.document.querySelector('[data-action="review-confirm"]').disabled,true);
  const changed=JSON.parse(JSON.stringify(room));changed.revision=2;changed.game.notes.push({round:1,speakerId:target,text:'답변을 읽는 동안 보낸 자유 발언'});await loadProjection(client,changed);
  client.api.setPending(true);await settle();client.api.setPending(false);await settle();
  assert.equal(scene.types.length,typesStarted,'chat revision and sending-state renders do not restart handwriting');assert.equal(typing.done,false,'a rerender does not cancel current typing');assert.equal(typing.element,typedElement);assert.ok(typedElement.isConnected,'the original paper paragraph remains in the live dialog');
  assert.equal(client.document.querySelector('[data-action="review-audit"]').disabled,true,'audit stays locked while the reply is incomplete');
  await act(client,'letter-finish');assert.equal(client.document.querySelector('[data-action="review-audit"]').disabled,false,'the existing kit can be used after the reply finishes');assert.equal(client.document.querySelector('[data-action="review-confirm"]').disabled,false);
  const verified=JSON.parse(JSON.stringify(changed));verified.revision=3;verified.game.kits=0;verified.game.review.verified=true;verified.game.review.actualValue=0;verified.game.statements[0].audited=true;verified.game.facts.push({id:'fact-1',round:1,category:'item',value:0,source:'audit',statementId:'statement-1'});await loadProjection(client,verified);
  const review=client.document.querySelector('.case-review');assert.equal(review.classList.contains('is-verified-lie'),originalValue===1,'red border class applies precisely to an actual contradiction');assert.equal(client.api.getRoom().game.statements[0].value,originalValue,'verification does not replace the historical answer');assert.equal(client.document.querySelector('[data-action="review-audit"]'),null,'a spent and audited reply cannot offer another verification');assert.equal(client.document.querySelector('[data-action="review-confirm"]').disabled,false,'both truth and lie results can be confirmed after reading');
 }
});

test('notice UI: a culprit private result is concealed on blur and resumes unread without stale typing callbacks',async()=>{
 const scene=controlledPresentation(),client=makeClient(createService({store:new MemoryStore()}),630,{presentation:scene}),base=projectedRoom('culprit');await loadProjection(client,base);
 const resolved=JSON.parse(JSON.stringify(base));resolved.revision=2;resolved.game.phase='discussion';resolved.game.self.sealOutcome={round:1,success:false,reason:'missed'};await loadProjection(client,resolved);
 assert.equal(client.api.getModalKind(),'obstruction');const first=scene.types.at(-1),seenKey=resolved.caseId+':seal:1';
 client.api.privacy();await settle();assert.notEqual(client.api.getModalKind(),'obstruction','private failure must leave the DOM when privacy is requested');assert.ok(!client.modal().includes('PRIVATE RECORD'));assert.ok(!client.sessions.has(seenKey),'concealing an unread notice does not mark it consumed');
 for(const focus of client.listeners['window-focus']||[])focus();await settle();assert.equal(client.api.getModalKind(),'obstruction','returning focus resumes the unread private outcome');const second=scene.types.at(-1);assert.notEqual(second,first);
 for(const blur of client.listeners['window-blur']||[])blur();await settle();assert.notEqual(client.api.getModalKind(),'obstruction','the actual window blur handler also removes private text');assert.ok(!client.sessions.has(seenKey));
 for(const focus of client.listeners['window-focus']||[])focus();await settle();const current=scene.types.at(-1);first.finish();second.finish();await settle();
 assert.equal(current.done,false,'cancelled older writing cannot finish the new privacy cycle');assert.equal(client.document.querySelector('[data-action="notice-continue"]').disabled,true);
 await act(client,'notice-finish');await act(client,'notice-continue');assert.equal(client.sessions.get(seenKey),'1');await loadProjection(client,resolved);assert.notEqual(client.api.getModalKind(),'obstruction','a completed result remains consumed after later polling');
});

test('detective UI: review updates received while handwriting refresh the verdict only after the current text finishes',async()=>{
 const scene=controlledPresentation(),client=makeClient(createService({store:new MemoryStore()}),631,{presentation:scene}),room=projectedRoom('detective',{phase:'discussion'}),target=room.game.players.find(p=>!p.isDetective).id;
 room.game.statements=[{id:'statement-1',round:1,speakerId:target,category:'item',value:1,audited:false}];room.game.review={kind:'answer',round:1,category:'item',targetId:target,statementId:'statement-1',value:1,verified:false,proposedValue:0};
 await loadProjection(client,room);const original=scene.types.at(-1),element=original.element;
 const otherSession=JSON.parse(JSON.stringify(room));otherSession.revision=2;otherSession.game.kits=0;otherSession.game.statements[0].audited=true;otherSession.game.review.verified=true;otherSession.game.review.actualValue=0;otherSession.game.facts.push({id:'fact-1',round:1,category:'item',value:0,source:'audit',statementId:'statement-1'});await loadProjection(client,otherSession);
 assert.equal(original.done,false,'the incoming verdict preserves the current sentence');assert.ok(element.isConnected);assert.equal(client.document.querySelector('.case-review').classList.contains('is-verified-lie'),false,'the old dialog remains intact until its writing finishes');
 await act(client,'letter-finish');assert.equal(client.document.querySelector('.case-review').classList.contains('is-verified-lie'),true,'completion immediately applies the latest authoritative verification');assert.equal(client.document.querySelector('[data-action="review-audit"]'),null,'stale verification controls are removed');assert.equal(client.document.querySelector('[data-action="review-confirm"]').disabled,false);assert.equal(client.api.getRoom().game.kits,0);assert.equal(client.api.getRoom().game.statements[0].value,1);
});

// The finished case is produced by the real rules engine. A current, completed
// record and a legacy record without the new journal exercise the same UI entry.
function replayFinishedRoom(){
 let state=Party.makeGame(['복기 참가자','<img onerror=1>'],{seed:17,secret:{suspectId:'s0',placeId:'p0'}});
 const run=event=>{state=Party.act(state,{actorId:Party.turnOwner(state),...event});};
 while(state.phase==='reveal')run({type:'ROLE_SEEN'});
 const detective=state.players.find(p=>p.role==='detective'),culprit=state.players.find(p=>p.role==='culprit');
 const unknown=Party.CATEGORIES.filter(c=>!detective.clues.some(clue=>clue.category===c.id));
 const valueOf=id=>{const i=Party.CATEGORIES.findIndex(c=>c.id===id);return i<3?Party.SUSPECTS[0].bits[i]:Party.PLACES[0].bits[i-3];};
 for(let day=1;day<=5;day++){
  while(state.phase==='secret')run({type:'SECRET_ACTION',kind:'pass'});
  if(day<=unknown.length){
   const category=unknown[day-1].id;run({type:'INVESTIGATE',kind:'question',category,targetId:culprit.id,proposedValue:1});
   run({type:'ANSWER',value:day===1?1-valueOf(category):valueOf(category)});
   if(day===1)run({type:'REVIEW_RESULT',kind:'audit'});
  }else run({type:'INVESTIGATE',kind:'pass'});
  run({type:'REVIEW_RESULT',kind:'confirm'});
 }
 run({type:'ACCUSE',suspectId:'s0',placeId:'p0'});
 const g=JSON.parse(JSON.stringify(Party.publicView(state)));g.self=JSON.parse(JSON.stringify(detective));
 return{code:'ABC234',caseId:'completed-replay-ui',capacity:2,status:'finished',revision:99,hostId:detective.id,meId:detective.id,members:state.players.map(p=>({id:p.id,gameId:p.id,name:p.name,ready:true,online:true})),game:g};
}
function replayPanel(client){const panel=client.document.querySelector('.case-replay');assert.ok(panel,'the finished replay panel is mounted');return panel;}

test('replay UI: ongoing games cannot open replay, including a forged finished reveal',async()=>{
 const client=makeClient(createService({store:new MemoryStore()}),701),room=projectedRoom('detective');
 await loadProjection(client,room);assert.equal(client.document.querySelector('[data-action="replay-open"]'),null);
 await act(client,'replay-open');assert.notEqual(client.api.getModalKind(),'replay');assert.equal(client.document.querySelector('.case-replay'),null);
 const forged=JSON.parse(JSON.stringify(room));forged.revision++;forged.game.reveal=replayFinishedRoom().game.reveal;
 await loadProjection(client,forged);await act(client,'replay-open');assert.notEqual(client.api.getModalKind(),'replay','a reveal-shaped object cannot bypass the live phase guard');assert.equal(client.document.querySelector('.case-replay'),null);assert.equal(client.requests.length,0,'replay entry is never a server mutation');
});

test('replay UI: a finished timeline supports day filters, bounded steps, polling and a safe reopen without changing the case',async()=>{
 const client=makeClient(createService({store:new MemoryStore()}),702),room=replayFinishedRoom();await loadProjection(client,room);
 assert.ok(client.document.querySelector('[data-action="replay-open"]'),'the finished result offers replay');
 const snapshot=JSON.stringify(client.api.getRoom());await act(client,'replay-open');assert.equal(client.api.getModalKind(),'replay');
 let panel=replayPanel(client);assert.equal(panel.dataset.round,'all');assert.equal(panel.dataset.stepIndex,'0');assert.equal(client.document.querySelector('[data-action="replay-prev"]').disabled,true);
 assert.equal(client.document.querySelector('img[onerror]'),null,'player names are escaped in the replay');
 const firstId=client.document.querySelector('[data-replay-step]').dataset.replayStep;
 await act(client,'replay-next');panel=replayPanel(client);assert.equal(panel.dataset.stepIndex,'1');assert.notEqual(client.document.querySelector('[data-replay-step]').dataset.replayStep,firstId);
 await act(client,'replay-round',{round:'2'});panel=replayPanel(client);assert.equal(panel.dataset.round,'2');assert.equal(panel.dataset.stepIndex,'0','changing day starts at the first step of that day');
 const buttons=client.document.querySelectorAll('[data-action="replay-step"]');assert.ok(buttons.length>1,'the question, answer and day markers create multiple reviewable steps');
 await act(client,'replay-step',{index:String(buttons.length-1)});assert.equal(replayPanel(client).dataset.stepIndex,String(buttons.length-1));assert.equal(client.document.querySelector('[data-action="replay-next"]').disabled,true);
 await act(client,'replay-next');assert.equal(replayPanel(client).dataset.stepIndex,String(buttons.length-1),'a stale next action cannot overrun the final step');
 await act(client,'replay-first');assert.equal(replayPanel(client).dataset.stepIndex,'0');await act(client,'replay-last');assert.equal(replayPanel(client).dataset.stepIndex,String(buttons.length-1));
 const newer=JSON.parse(JSON.stringify(room));newer.revision++;await loadProjection(client,newer);assert.equal(client.api.getModalKind(),'replay','a completed-room poll does not dismiss the replay');assert.equal(replayPanel(client).dataset.round,'2');assert.equal(replayPanel(client).dataset.stepIndex,String(buttons.length-1));
 await act(client,'close-modal');assert.equal(client.api.getModalKind(),null);assert.equal(client.document.querySelector('.case-replay'),null);await act(client,'replay-open');assert.equal(client.api.getModalKind(),'replay');assert.ok(Number(replayPanel(client).dataset.stepIndex)>=0,'reopening retains a valid selection or begins safely at zero');
 assert.equal(JSON.stringify(client.api.getRoom()),JSON.stringify(newer),'navigation never edits official statements, verdict, resources or roles');assert.equal(client.requests.length,0,'opening, reading and closing replay send no game API requests');assert.notEqual(snapshot,JSON.stringify(newer),'the only state change was the explicit simulated server revision');
});

test('replay UI: a host restart or case replacement removes the old timeline and rejects stale navigation',async()=>{
 const client=makeClient(createService({store:new MemoryStore()}),703),finished=replayFinishedRoom();await loadProjection(client,finished);await act(client,'replay-open');assert.equal(client.api.getModalKind(),'replay');
 const lobby={...finished,status:'lobby',revision:100,game:null};delete lobby.caseId;await loadProjection(client,lobby);
 assert.equal(client.api.getModalKind(),null);assert.equal(client.document.querySelector('.case-replay'),null);assert.equal(client.document.querySelector('[data-action="replay-open"]'),null);
 for(const action of ['replay-next','replay-last','replay-open'])await act(client,action);assert.equal(client.document.querySelector('.case-replay'),null,'stale buttons cannot resurrect a previous result');
 const next=projectedRoom('detective');next.caseId='new-case-after-restart';next.revision=101;await loadProjection(client,next);await act(client,'replay-open');assert.equal(client.document.querySelector('.case-replay'),null);assert.ok(!client.modal().includes('completed-replay-ui'));assert.equal(client.requests.length,0);
});

test('replay UI: a legacy finished case remains readable when chronological replay was never recorded',async()=>{
 const client=makeClient(createService({store:new MemoryStore()}),704),legacy=replayFinishedRoom();delete legacy.game.reveal.replay;delete legacy.game.replay;delete legacy.game.timeline;
 await loadProjection(client,legacy);await act(client,'replay-open');assert.equal(client.api.getModalKind(),'replay');assert.ok(replayPanel(client));assert.match(client.modal(),/기록|이전|복기/);assert.ok(!client.modal().includes('undefined'));assert.ok(!client.modal().includes('NaN'));assert.equal(client.requests.length,0);
});

test('replay UI: a login-free computer game reaches its result and opens replay without contacting the room API',async t=>{
 const client=makeClient(createService({store:new MemoryStore()}),705,{practice:true,botClock:true});t.after(()=>client.practice.stop());
 await act(client,'practice-setup');await act(client,'practice-count',{count:'2'});await act(client,'practice-role',{role:'detective'});await act(client,'practice-start');
 for(let guard=0;guard<100&&client.api.getRoom().status!=='finished';guard++){
  const g=client.api.getRoom().game;
  if(g.turnOwnerId!==g.self.id){client.nextBot();await settle();continue;}
  let event;if(g.phase==='reveal')event={type:'ROLE_SEEN'};else if(g.phase==='secret')event={type:'SECRET_ACTION',kind:'pass'};else if(g.phase==='investigate')event={type:'INVESTIGATE',kind:'pass'};else if(g.phase==='discussion')event={type:'REVIEW_RESULT',kind:'confirm'};else if(g.phase==='final')event={type:'ACCUSE',...Party.candidates(g)[0]};else assert.fail('unexpected human practice phase '+g.phase);
  const data=await client.practice.request({op:'action',event});client.api.acceptRoom(data.room,true);await settle();
 }
 assert.equal(client.api.getRoom().status,'finished');assert.equal(client.api.getRoom().game.round,5);assert.equal(client.api.getAccount(),null);assert.ok(client.document.querySelector('[data-action="replay-open"]'));await act(client,'replay-open');assert.equal(client.api.getModalKind(),'replay');assert.ok(replayPanel(client));await act(client,'replay-last');await act(client,'close-modal');await act(client,'practice-exit');assert.equal(client.api.getRoom(),null);assert.equal(client.document.querySelector('.case-replay'),null);assert.equal(client.requests.length,0,'the complete five-day practice and replay flow stays local');
});

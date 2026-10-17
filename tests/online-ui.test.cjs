'use strict';
// Real room service + real UI in a minimal DOM stub. These tests do not measure
// visual rendering, browser layout, or human game balance.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {createService,GameError}=require('../lib/game-service.cjs');
const {MemoryStore}=require('../lib/store.cjs');
const publicDir=path.join(__dirname,'../public');

function makeClient(service,index){
 const nodes=new Map(),listeners={},sessions=new Map(),requests=[];let version=0;
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
  if(!element){element=new Element(id,owner);element.value=a.value||'';element.disabled=/\bdisabled\b/.test(match[2]);
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
  return [];
 }
 const classList={add(){},remove(){},toggle(){}};
 const document={body:{style:{},classList},hidden:false,activeElement:null,querySelector:selector=>resolve(selector),querySelectorAll:selector=>all(selector),getElementById:id=>resolve('#'+id),addEventListener:(name,callback)=>(listeners[name]??=[]).push(callback)};
 const location={href:'http://localhost/',origin:'http://localhost',pathname:'/'};
 const window={location,history:{replaceState(){}},crypto:{randomUUID:()=>crypto.randomUUID()},WitnessFX:{init(){},setQuality(){},setPrivate(){},burst(){}},scrollX:0,scrollY:0,scrollTo(){},addEventListener:(name,callback)=>(listeners['window-'+name]??=[]).push(callback)};
 const context={document,window,URL,AbortController,matchMedia:()=>({matches:false}),sessionStorage:{getItem:key=>sessions.get(key)||null,setItem:(key,value)=>sessions.set(key,value),removeItem:key=>sessions.delete(key)},setTimeout:()=>1,clearTimeout(){},navigator:{clipboard:{writeText:async()=>{}}},console,
  fetch:async(url,options)=>{
   if(url==='/party-rules.html')return{ok:true,text:async()=>fs.readFileSync(path.join(publicDir,'party-rules.html'),'utf8')};
   const body=JSON.parse(options.body);requests.push(body);
   try{const result=await service.handle(body,{ip:'ui-audit-'+index});return{ok:true,status:200,json:async()=>result};}
   catch(error){if(!(error instanceof GameError))throw error;return{ok:false,status:error.status,json:async()=>({error:error.message,code:error.code})};}
  }
 };
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(publicDir,'catalog.js'),'utf8'),context);
 let source=fs.readFileSync(path.join(publicDir,'online-app.js'),'utf8');const end=source.lastIndexOf('}());');assert.ok(end>0,'UI IIFE boundary exists');
 source=source.slice(0,end)+'window.audit={act,poll,privacy,getRoom:()=>room,getPrivate:()=>privateVisible};'+source.slice(end);vm.runInContext(source,context);
 return{document,api:window.audit,requests,listeners,html:()=>nodes.get('app').innerHTML,modal:()=>nodes.get('modal-host').innerHTML,toast:()=>nodes.get('toast-host').innerHTML};
}
async function settle(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}
async function act(client,action,dataset={}){await client.api.act(action,{dataset});await settle();}
async function sync(clients){await Promise.all(clients.map(client=>client.api.poll()));await settle();}

for(const count of [2,3,4,5,6])test('online UI: '+count+' authenticated clients finish five rounds with private DOM and preserved drafts',async()=>{
 const service=createService({store:new MemoryStore(),gameOptions:{seed:17,secret:{suspectId:'s0',placeId:'p0'}},rateLimit:10000});
 const clients=Array.from({length:count},(_,i)=>makeClient(service,i));
 for(const [i,client]of clients.entries()){client.document.querySelector('#nickname').value='테스트 '+(i+1);await act(client,'login');}
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

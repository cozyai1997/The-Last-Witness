'use strict';
const crypto=require('node:crypto');
const Party=require('./party-engine.cjs');
const {createStore}=require('./store.cjs');
const WORLD_KEY='witness:world';
const TTL=24*60*60*1000;
const PRESENCE=30000;
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MUTATIONS=new Set(['create','join','ready','start','action','restart','leave','kick']);
const OPS=new Set(['login','poll',...MUTATIONS]);
const PRIVATE_FALLBACK=crypto.randomBytes(32).toString('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
class GameError extends Error{
 constructor(status,code,message){super(message);this.name='GameError';this.status=status;this.code=code;}
}
function reject(status,code,message){throw new GameError(status,code,message);}
function digest(value){return crypto.createHash('sha256').update(value).digest('hex');}
function validName(name){if(typeof name!=='string'||!name.trim()||name.trim().length>20)reject(400,'INVALID_NAME','닉네임은 1자부터 20자까지 입력하세요.');return name.trim();}
function requestId(body,optional=false){if(optional&&body.requestId===undefined)return null;if(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId)||['__proto__','constructor','prototype'].includes(body.requestId))reject(400,'REQUEST_ID_REQUIRED','요청 식별자가 필요합니다. 화면을 새로고침하고 다시 시도하세요.');return body.requestId;}
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
function initialWorld(){return {version:1,sessions:{},rooms:{},rates:{}};}
function detachMember(world,room,memberId){
 const member=room.members.find(m=>m.id===memberId);if(!member)return;
 const session=world.sessions[member.tokenHash];if(session)session.roomCode=null;
 room.members=room.members.filter(m=>m.id!==memberId);
 if(!room.members.length){delete world.rooms[room.code];return;}
 if(room.hostId===memberId)room.hostId=room.members[0].id;
 room.members.forEach(m=>{m.ready=false;});
 room.revision++;
}
function prune(world,now){
 for(const [code,room] of Object.entries(world.rooms))if(room.expiresAt<=now){delete world.rooms[code];for(const session of Object.values(world.sessions))if(session.roomCode===code)session.roomCode=null;}
 for(const [hash,session] of Object.entries(world.sessions))if(session.expiresAt<=now){const room=world.rooms[session.roomCode];if(room&&room.status==='lobby')detachMember(world,room,session.id);delete world.sessions[hash];}
 for(const [key,rate] of Object.entries(world.rates))if(rate.expiresAt<=now)delete world.rates[key];
}
function safeGame(game,gameId){
 if(!game)return null;
 const view=clone(Party.publicView(game)),self=game.players.find(p=>p.id===gameId);
 if(!self)reject(403,'NOT_A_PLAYER','이 게임의 참가자가 아닙니다.');
 view.self={id:self.id,name:self.name,role:self.role,clues:clone(self.clues),shared:clone(self.shared),sabotageLeft:self.sabotageLeft,guardLeft:self.guardLeft};
 if(['culprit','accomplice'].includes(self.role)){
  view.caseSecret=clone(game.secretNPC);view.remainingLies=2-game.liesUsed;
  view.partnerIds=game.players.filter(p=>p.id!==self.id&&['culprit','accomplice'].includes(p.role)).map(p=>p.id);view.sabotage=clone(game.sabotage);
 }
 return view;
}
function safeRoom(world,session,now){
 const room=world.rooms[session.roomCode];if(!room)return null;
 const member=room.members.find(m=>m.id===session.id);if(!member)return null;
 return {code:room.code,capacity:room.capacity,hostId:room.hostId,revision:room.revision,status:room.status,
  members:room.members.map(m=>{const value={id:m.id,name:m.name,ready:m.ready,online:!!world.sessions[m.tokenHash]&&world.sessions[m.tokenHash].lastSeen>=now-PRESENCE};if(m.gameId)value.gameId=m.gameId;return value;}),
  meId:session.id,game:safeGame(room.game,member.gameId)};
}
function createService(options={}){
 const store=options.store||createStore(),now=options.now||Date.now,randomBytes=options.randomBytes||crypto.randomBytes;
 const secret=options.sessionSecret||process.env.WITNESS_STORE_SECRET||PRIVATE_FALLBACK;
 const rateLimit=options.rateLimit||900;
 function limit(world,ip,op,time){
  const bucket=Math.floor(time/60000),key=digest(secret+'|ip|'+String(ip||'unknown'))+':'+bucket;
  const entry=world.rates[key]||(world.rates[key]={count:0,login:0,expiresAt:(bucket+1)*60000});
  entry.count++;if(op==='login')entry.login++;
  if(entry.count>rateLimit||entry.login>30)reject(429,'RATE_LIMIT','요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
 }
 async function transact(callback){
  for(let attempt=0;attempt<20;attempt++){
   const doc=await store.get(WORLD_KEY),world=doc?clone(doc.value):initialWorld(),time=now();prune(world,time);
   let result,error;try{result=callback(world,time);}catch(caught){if(!(caught instanceof GameError))throw caught;error=caught;}
   const saved=doc?await store.CAS(WORLD_KEY,doc.rev,world):await store.create(WORLD_KEY,world);
   if(!saved)continue;
   if(error)throw error;return result;
  }
  reject(409,'BUSY','다른 요청이 처리 중입니다. 잠시 후 다시 시도하세요.');
 }
 function makeCode(world){for(let attempt=0;attempt<100;attempt++){const bytes=randomBytes(6);let code='';for(const byte of bytes)code+=CODE_ALPHABET[byte&31];if(!world.rooms[code])return code;}reject(503,'ROOM_UNAVAILABLE','새 방을 만들 수 없습니다. 잠시 후 다시 시도하세요.');}
 function authenticated(world,body,time){
  if(typeof body.token!=='string'||body.token.length<40||body.token.length>200)reject(401,'UNAUTHENTICATED','로그인이 만료되었습니다. 닉네임으로 다시 입장하세요.');
  const session=world.sessions[digest(body.token)];if(!session||session.expiresAt<=time)reject(401,'UNAUTHENTICATED','로그인이 만료되었습니다. 닉네임으로 다시 입장하세요.');
  session.lastSeen=time;return session;
 }
 function requireRoom(world,session){const room=world.rooms[session.roomCode];if(!room||!room.members.some(m=>m.id===session.id))reject(409,'NO_ROOM','먼저 방을 만들거나 참가하세요.');return room;}
 function hostOnly(room,session){if(room.hostId!==session.id)reject(403,'HOST_ONLY','방장만 할 수 있는 행동입니다.');}
 function revision(room,body){if(!Number.isSafeInteger(body.revision)||body.revision!==room.revision)reject(409,'REVISION_CONFLICT','방 상태가 바뀌었습니다. 최신 화면에서 다시 시도하세요.');}
 async function handle(body,context={}){
  if(!body||typeof body!=='object'||Array.isArray(body))reject(400,'INVALID_BODY','올바른 요청이 필요합니다.');
  return transact((world,time)=>{
   limit(world,context.ip,body.op,time);
   if(!OPS.has(body.op))reject(400,'INVALID_OPERATION','알 수 없는 요청입니다.');
   if(body.op==='login'){
    const name=validName(body.name);requestId(body,true);
    if(Object.keys(world.sessions).length>=4096)reject(503,'SESSION_LIMIT','접속자가 많습니다. 잠시 후 다시 시도하세요.');
    const token=randomBytes(32).toString('base64url'),hash=digest(token);
    const session=world.sessions[hash]={id:'m_'+randomBytes(12).toString('hex'),name,roomCode:null,lastSeen:time,expiresAt:time+TTL,requests:{}};
    return {token,room:null};
   }
   const session=authenticated(world,body,time);
   if(body.op==='poll')return {room:safeRoom(world,session,time)};
   const id=requestId(body),fingerprint=digest(canonical(Object.fromEntries(Object.entries(body).filter(([key])=>!['token','revision','requestId'].includes(key)))));
   const previous=session.requests[id];
   if(previous){if(previous.fingerprint!==fingerprint)reject(409,'REQUEST_ID_REUSED','같은 요청 식별자로 다른 행동을 보낼 수 없습니다.');return {room:safeRoom(world,session,time)};}
   if(Object.keys(session.requests).length>=2048)reject(429,'SESSION_ACTION_LIMIT','오늘의 요청 한도에 도달했습니다. 새로 로그인하세요.');
   let room;
   if(body.op==='create'){
    if(session.roomCode&&world.rooms[session.roomCode])reject(409,'ALREADY_IN_ROOM','이미 참가 중인 방에서 먼저 나가세요.');
    if(!Number.isInteger(body.capacity)||body.capacity<2||body.capacity>6)reject(400,'INVALID_CAPACITY','방 정원은 2명부터 6명까지 가능합니다.');
    if(Object.keys(world.rooms).length>=256)reject(503,'ROOM_LIMIT','열린 방이 많습니다. 잠시 후 다시 시도하세요.');
    const code=makeCode(world);room=world.rooms[code]={code,capacity:body.capacity,hostId:session.id,revision:0,status:'lobby',members:[{id:session.id,name:session.name,tokenHash:digest(body.token),ready:false}],game:null,expiresAt:time+TTL};session.roomCode=code;
   }else if(body.op==='join'){
    const code=typeof body.code==='string'?body.code.trim().toUpperCase():'';
    if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))reject(400,'INVALID_CODE','여섯 자리 방 코드를 입력하세요.');
    if(session.roomCode&&session.roomCode!==code&&world.rooms[session.roomCode])reject(409,'ALREADY_IN_ROOM','이미 참가 중인 방에서 먼저 나가세요.');
    room=world.rooms[code];if(!room)reject(404,'ROOM_NOT_FOUND','방을 찾을 수 없습니다. 코드를 확인하세요.');
    if(!room.members.some(m=>m.id===session.id)){
     if(room.status!=='lobby')reject(409,'GAME_STARTED','이미 게임이 시작된 방입니다.');
     if(room.members.length>=room.capacity)reject(409,'ROOM_FULL','방 정원이 가득 찼습니다.');
     room.members.push({id:session.id,name:session.name,tokenHash:digest(body.token),ready:false});room.members.forEach(m=>{m.ready=false;});room.revision++;
    }
    session.roomCode=code;
   }else{
    room=requireRoom(world,session);revision(room,body);
    if(body.op==='ready'){
     if(room.status!=='lobby')reject(409,'GAME_STARTED','게임 중에는 준비 상태를 바꿀 수 없습니다.');
     if(typeof body.ready!=='boolean')reject(400,'INVALID_READY','준비 상태를 선택하세요.');
     room.members.find(m=>m.id===session.id).ready=body.ready;room.revision++;
    }else if(body.op==='start'){
     hostOnly(room,session);if(room.status!=='lobby')reject(409,'GAME_STARTED','이미 시작된 게임입니다.');
     if(room.members.length<2||!room.members.every(m=>m.ready))reject(409,'NOT_READY','참가자 두 명 이상이 모두 준비해야 시작할 수 있습니다.');
     const gameOptions=options.gameOptions||{};room.game=Party.makeGame(room.members.map(m=>m.name),gameOptions);room.members.forEach((m,index)=>{m.gameId='u'+index;});room.status='playing';room.revision++;
    }else if(body.op==='action'){
     if(room.status!=='playing')reject(409,'NOT_PLAYING','진행 중인 게임이 아닙니다.');
     const member=room.members.find(m=>m.id===session.id),input=body.event;
     if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.type!=='string')reject(400,'INVALID_ACTION','올바른 게임 행동이 필요합니다.');
     if(input.type!=='ADD_NOTE'&&Party.turnOwner(room.game)!==member.gameId)reject(403,'NOT_YOUR_TURN','현재 차례인 참가자만 행동할 수 있습니다.');
     if(input.type==='ACCUSE'&&room.game.round===5&&room.game.phase==='investigate')reject(409,'FINAL_INVESTIGATION_REQUIRED','마지막 라운드에는 수사 한 번을 마친 뒤 최종 지목하세요.');
     const event={};for(const key of ['type','kind','category','value','targetId','statementId','suspectId','placeId','text'])if(Object.hasOwn(input,key))event[key]=input[key];event.actorId=member.gameId;event.speakerId=member.gameId;
     try{room.game=Party.act(room.game,event);}catch(error){reject(400,'INVALID_ACTION',error.message);}
     if(room.game.phase==='finished')room.status='finished';room.revision++;
    }else if(body.op==='restart'){
     hostOnly(room,session);if(room.status!=='finished')reject(409,'NOT_FINISHED','게임이 끝난 뒤 다시 시작할 수 있습니다.');room.game=null;room.status='lobby';room.members.forEach(m=>{m.ready=false;delete m.gameId;});room.revision++;
    }else if(body.op==='leave'){
     if(room.status==='playing')reject(409,'GAME_STARTED','진행 중인 게임에서는 자리를 양도하거나 나갈 수 없습니다.');detachMember(world,room,session.id);
    }else if(body.op==='kick'){
     hostOnly(room,session);if(room.status!=='lobby')reject(409,'GAME_STARTED','대기실에서만 참가자를 내보낼 수 있습니다.');if(body.targetId===session.id||!room.members.some(m=>m.id===body.targetId))reject(400,'INVALID_TARGET','다른 참가자를 선택하세요.');detachMember(world,room,body.targetId);
    }
   }
   session.requests[id]={fingerprint,at:time};return {room:safeRoom(world,session,time)};
  });
 }
 return {handle,store};
}
module.exports={createService,GameError,safeGame,WORLD_KEY,TTL};

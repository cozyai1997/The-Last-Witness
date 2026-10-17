'use strict';
const {createService,GameError}=require('../lib/game-service.cjs');
const MAX_BODY=16*1024;
function send(res,status,body){if(typeof res.status==='function'&&typeof res.json==='function')return res.status(status).json(body);res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));}
async function readBody(req){
 let body=req.body;
 if(body===undefined){const chunks=[];let size=0;for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>MAX_BODY)throw new GameError(413,'BODY_TOO_LARGE','요청 내용이 너무 큽니다.');chunks.push(Buffer.from(chunk));}body=Buffer.concat(chunks).toString('utf8');}
 let encoded;if(Buffer.isBuffer(body)){encoded=body.toString('utf8');body=encoded;}else encoded=typeof body==='string'?body:JSON.stringify(body);
 if(!encoded||Buffer.byteLength(encoded)>MAX_BODY)throw new GameError(encoded?413:400,'INVALID_BODY','요청 내용의 크기를 확인하세요.');
 if(typeof body==='string'){try{body=JSON.parse(body);}catch(error){throw new GameError(400,'INVALID_JSON','올바른 JSON 요청이 필요합니다.');}}
 return body;
}
function createHandler(service,options={}){
 const production=options.production??(process.env.NODE_ENV==='production'||!!process.env.VERCEL);
 const allowed=options.allowedOrigins||String(process.env.WITNESS_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('Expires','0');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Vary','Origin');
  try{
   if(req.method!=='POST'){res.setHeader('Allow','POST');throw new GameError(405,'METHOD_NOT_ALLOWED','POST 요청만 허용됩니다.');}
   const origin=req.headers.origin,host=req.headers.host;
   if(req.headers['sec-fetch-site']==='cross-site')throw new GameError(403,'ORIGIN_REJECTED','이 사이트에서 보낸 요청만 허용됩니다.');
   if(origin){const same=origin===('https://'+host)||(!production&&origin===('http://'+host));if(!same&&!allowed.includes(origin))throw new GameError(403,'ORIGIN_REJECTED','이 사이트에서 보낸 요청만 허용됩니다.');}
   if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new GameError(415,'CONTENT_TYPE','JSON 요청만 허용됩니다.');
   const body=await readBody(req),ip=process.env.VERCEL?(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'unknown'):(req.socket?.remoteAddress||'unknown');
   return send(res,200,await service.handle(body,{ip}));
  }catch(error){if(error instanceof GameError)return send(res,error.status,{error:error.message,code:error.code});return send(res,503,{error:'서버 연결이 원활하지 않습니다. 잠시 후 다시 시도하세요.',code:'SERVICE_UNAVAILABLE'});}
 };
}
let defaultHandler;
module.exports=async function room(req,res){if(!defaultHandler){try{defaultHandler=createHandler(createService());}catch(error){res.setHeader('Cache-Control','no-store');return send(res,503,{error:'서버 연결을 준비 중입니다. 잠시 후 다시 시도하세요.',code:'SERVICE_UNAVAILABLE'});}}return defaultHandler(req,res);};
module.exports.createHandler=createHandler;

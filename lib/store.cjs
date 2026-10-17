'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
class StoreError extends Error { constructor(){super('저장소에 연결할 수 없습니다. 잠시 후 다시 시도하세요.');this.name='StoreError';} }
class MemoryStore {
 constructor(){this.documents=new Map();}
 async get(key){const doc=this.documents.get(key);return doc?clone(doc):null;}
 async create(key,value){if(this.documents.has(key))return false;this.documents.set(key,{rev:0,value:clone(value)});return true;}
 async CAS(key,expectedRev,value){const doc=this.documents.get(key);if(!doc||doc.rev!==expectedRev)return false;this.documents.set(key,{rev:doc.rev+1,value:clone(value)});return true;}
}
class SupabaseStore {
 constructor({url,anonKey,secret,fetchImpl=globalThis.fetch}){
  if(!url||!anonKey||!secret||typeof fetchImpl!=='function')throw new StoreError();
  this.url=url.replace(/\/$/,'');this.anonKey=anonKey;this.secret=secret;this.fetch=fetchImpl;
 }
 async rpc(op,key,expected,value){
  try{
   const response=await this.fetch(this.url+'/rest/v1/rpc/witness_store',{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_secret:this.secret,p_op:op,p_key:key,p_expected:expected??null,p_value:value??null}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new StoreError();
   const result=await response.json();
   if(op==='get'){if(result!==null&&(!Number.isSafeInteger(result.rev)||!Object.hasOwn(result,'value')))throw new StoreError();}
   else if(typeof result!=='boolean')throw new StoreError();
   return result;
  }catch(error){throw new StoreError();}
 }
 get(key){return this.rpc('get',key,null,null);}
 create(key,value){return this.rpc('create',key,null,value);}
 CAS(key,expectedRev,value){return this.rpc('cas',key,expectedRev,value);}
}
const localMemory=new MemoryStore();
function createStore(env=process.env){
 const values=[env.SUPABASE_URL,env.SUPABASE_ANON_KEY,env.WITNESS_STORE_SECRET];
 if(values.every(Boolean))return new SupabaseStore({url:values[0],anonKey:values[1],secret:values[2]});
 if(values.some(Boolean)||env.NODE_ENV==='production'||env.VERCEL)throw new StoreError();
 return localMemory;
}
module.exports={MemoryStore,SupabaseStore,StoreError,createStore};

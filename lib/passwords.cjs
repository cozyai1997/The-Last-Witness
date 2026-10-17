'use strict';
const crypto=require('node:crypto');
const PARAMETERS=Object.freeze({N:131072,r:8,p:1,maxmem:256*1024*1024});
const MAX_JOBS=2,MAX_QUEUE=12;
let active=0;const queue=[];
class PasswordError extends Error{constructor(code,message){super(message);this.name='PasswordError';this.code=code;}}
function validatePassword(password){
 if(typeof password!=='string'||Array.from(password).length<8||Array.from(password).length>128||Buffer.byteLength(password,'utf8')>512)throw new PasswordError('INVALID_PASSWORD','비밀번호는 공백을 포함해 8자부터 128자까지 입력하세요.');
 return password;
}
function drain(){while(active<MAX_JOBS&&queue.length){const {password,salt,resolve,reject}=queue.shift();active++;crypto.scrypt(password,salt,64,PARAMETERS,(error,key)=>{active--;if(error)reject(new PasswordError('PASSWORD_UNAVAILABLE','비밀번호 확인을 완료할 수 없습니다. 잠시 후 다시 시도하세요.'));else resolve(key);drain();});}}
function derive(password,salt){return new Promise((resolve,reject)=>{if(active>=MAX_JOBS&&queue.length>=MAX_QUEUE)return reject(new PasswordError('AUTH_BUSY','로그인 요청이 많습니다. 잠시 후 다시 시도하세요.'));queue.push({password,salt,resolve,reject});drain();});}
async function hashPassword(password){validatePassword(password);const salt=crypto.randomBytes(16),key=await derive(password,salt);return {algorithm:'scrypt',N:PARAMETERS.N,r:PARAMETERS.r,p:PARAMETERS.p,salt:salt.toString('base64url'),hash:key.toString('base64url')};}
const DUMMY={algorithm:'scrypt',N:PARAMETERS.N,r:PARAMETERS.r,p:PARAMETERS.p,salt:Buffer.alloc(16).toString('base64url'),hash:Buffer.alloc(64).toString('base64url')};
async function verifyPassword(password,record){
 validatePassword(password);
 const valid=record&&record.algorithm==='scrypt'&&record.N===PARAMETERS.N&&record.r===PARAMETERS.r&&record.p===PARAMETERS.p&&typeof record.salt==='string'&&typeof record.hash==='string';
 const candidate=valid?record:DUMMY,salt=Buffer.from(candidate.salt,'base64url'),expected=Buffer.from(candidate.hash,'base64url');
 const key=await derive(password,salt.length===16?salt:Buffer.alloc(16));
 return !!valid&&expected.length===key.length&&crypto.timingSafeEqual(expected,key);
}
module.exports={hashPassword,verifyPassword,validatePassword,PasswordError,PARAMETERS,MAX_JOBS,MAX_QUEUE};

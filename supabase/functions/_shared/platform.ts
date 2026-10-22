import type { RawMaterial } from './contracts.ts';
import { createHash } from 'node:crypto';

export class ApiError extends Error {
  constructor(readonly status:number, readonly code:string, message:string) { super(message); }
}
export const expectedProjectRef = 'jqhivsrfrkycfjefgoam';
export const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
if (projectUrl !== `https://${expectedProjectRef}.supabase.co`) throw new Error('CLOUD_PROJECT_MISMATCH');
function injectedKey(dictionary:string,legacy:string):string {
  const fallback = Deno.env.get(legacy);
  if (fallback) return fallback;
  try {
    const keys = JSON.parse(Deno.env.get(dictionary) ?? '{}') as Record<string,string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch { return ''; }
}
// These values stay inside the Edge runtime. Never return/log them or put them in EXPO_PUBLIC_*.
const serviceKey = injectedKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
const publicKey = injectedKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
if (!serviceKey || !publicKey) throw new Error('CLOUD_PLATFORM_KEYS_MISSING');
const apiHeaders = (key:string) => ({apikey:key,...(key.startsWith('eyJ') ? {Authorization:`Bearer ${key}`} : {})});
const serverHeaders = () => apiHeaders(serviceKey);

export async function sha256(value:string|ArrayBuffer):Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256',typeof value==='string' ? new TextEncoder().encode(value) : value);
  return Array.from(new Uint8Array(hash),(byte)=>byte.toString(16).padStart(2,'0')).join('');
}
export function newToken():string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function safeDatabaseError(body:unknown):ApiError {
  if (body && typeof body==='object' && 'code' in body && body.code==='P0001' && 'message' in body && typeof body.message==='string') {
    try {
      const value = JSON.parse(body.message);
      if (Number.isInteger(value.status) && value.status>=400 && value.status<600 &&
          typeof value.code==='string' && /^[A-Z_]+$/.test(value.code) && typeof value.message==='string') {
        return new ApiError(value.status,value.code,value.message);
      }
    } catch { /* Never expose SQL, schema names, or raw provider errors. */ }
  }
  return new ApiError(503,'DATABASE_UNAVAILABLE','클라우드 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}
async function callRpc<T>(name:string,op:string,ownerId:string|null,args:unknown):Promise<T> {
  let response:Response;
  try {
    response=await fetch(`${projectUrl}/rest/v1/rpc/${name}`,{method:'POST',
      headers:{...serverHeaders(),'Content-Type':'application/json'},body:JSON.stringify({op,owner_id:ownerId,args}),
      signal:AbortSignal.timeout(15000)});
  } catch { throw new ApiError(503,'DATABASE_UNAVAILABLE','클라우드 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  const body=await response.json().catch(()=>null);
  if (!response.ok) throw safeDatabaseError(body);
  return body as T;
}
export const rpc=<T>(op:string,ownerId:string|null=null,args:unknown={}):Promise<T>=>callRpc('ai_study_rpc',op,ownerId,args);
export const accountRpc=<T>(op:string,ownerId:string,args:unknown={}):Promise<T>=>callRpc('ai_study_account_rpc',op,ownerId,args);
// Supabase Auth's separate reauthentication nonce uses SHA-224(email + nonce).
// Keep this server-only compatibility boundary in sync with Supabase Auth.
export const nonceHash=(email:string,nonce:string):string=>createHash('sha224').update(email+nonce).digest('hex');
export async function authRequest(path:string,body:unknown,admin=false):Promise<Record<string,unknown>> {
  let response:Response;
  try {
    response=await fetch(`${projectUrl}/auth/v1/${path}`,{method:'POST',headers:{...apiHeaders(admin?serviceKey:publicKey),
      'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  } catch { throw new ApiError(503,'AUTH_UNAVAILABLE','인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  const data=await response.json().catch(()=>({})) as Record<string,unknown>;
  if (!response.ok) {
    const code=typeof data.code==='string'?data.code:'';
    if (response.status===429 || code==='over_email_send_rate_limit' || code==='over_request_rate_limit')
      throw new ApiError(429,'CODE_COOLDOWN','메일 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
    if (path==='verify') throw new ApiError(422,'INVALID_CODE','인증 코드가 올바르지 않거나 만료되었습니다. 코드를 다시 확인해 주세요.');
    throw new ApiError(503,'EMAIL_DELIVERY_FAILED','인증 코드를 보내지 못했습니다. 잠시 후 다시 요청해 주세요.');
  }
  return data;
}
export async function revokeProviderSession(token:unknown):Promise<void> {
  if (typeof token!=='string') return;
  const response=await fetch(`${projectUrl}/auth/v1/logout?scope=local`,{method:'POST',
    headers:{apikey:publicKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});
  await response.body?.cancel();
}
export async function sendReauthentication(token:string):Promise<void> {
  const response=await fetch(`${projectUrl}/auth/v1/reauthenticate`,{method:'GET',
    headers:{apikey:publicKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(45000)});
  await response.body?.cancel();
  if (response.status===429) throw new ApiError(429,'CODE_COOLDOWN','인증 코드는 잠시 후 다시 요청해 주세요.');
  if (!response.ok) throw new ApiError(503,'EMAIL_DELIVERY_FAILED','삭제 인증 코드를 보내지 못했습니다. 잠시 후 다시 요청해 주세요.');
}
export async function deleteProviderUser(userId:string):Promise<void> {
  const response=await fetch(`${projectUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,{
    method:'DELETE',headers:{...serverHeaders(),'Content-Type':'application/json'},
    body:JSON.stringify({should_soft_delete:false}),signal:AbortSignal.timeout(15000)});
  await response.body?.cancel();
  if (!response.ok) throw new ApiError(503,'ACCOUNT_DELETION_FAILED','계정을 삭제하지 못했습니다. 다시 로그인해 상태를 확인해 주세요.');
}
export const bucket = 'ai-study-materials';
const storagePath=(path:string)=>path.split('/').map(encodeURIComponent).join('/');
export async function uploadImage(path:string,file:File):Promise<void> {
  const response=await fetch(`${projectUrl}/storage/v1/object/${bucket}/${storagePath(path)}`,{
    method:'POST',headers:{...serverHeaders(),'Content-Type':file.type,'x-upsert':'false'},body:file,signal:AbortSignal.timeout(30000)});
  await response.body?.cancel();
  if (!response.ok) throw new ApiError(503,'IMAGE_UPLOAD_FAILED','사진을 업로드하지 못했습니다. 입력을 유지한 채 다시 저장해 주세요.');
}
export async function readImage(path:string,signal:AbortSignal):Promise<ArrayBuffer> {
  const response=await fetch(`${projectUrl}/storage/v1/object/${bucket}/${storagePath(path)}`,{headers:serverHeaders(),signal});
  if (!response.ok) { await response.body?.cancel(); throw new ApiError(503,'IMAGE_READ_FAILED','저장된 사진을 읽지 못했습니다. 다시 시도해 주세요.'); }
  return response.arrayBuffer();
}
export async function presentMaterials(materials:RawMaterial[]):Promise<Record<string,unknown>[]> {
  const paths=materials.flatMap((m)=>m._images.map((image)=>image.path));
  const urls=new Map<string,string>();
  // Sign in batches to keep the Storage response bounded for the largest list page.
  for (let i=0;i<paths.length;i+=100) {
    const response=await fetch(`${projectUrl}/storage/v1/object/sign/${bucket}`,{method:'POST',
      headers:{...serverHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify({paths:paths.slice(i,i+100),expiresIn:3600}),signal:AbortSignal.timeout(10000)});
    const signed=await response.json().catch(()=>null) as {path:string;signedURL?:string;error?:string}[]|null;
    if (!response.ok || !Array.isArray(signed) || signed.some((item)=>!item.signedURL || item.error))
      throw new ApiError(503,'IMAGE_URL_UNAVAILABLE','사진 주소를 불러오지 못했습니다. 자료를 다시 열어 주세요.');
    for (const item of signed) urls.set(item.path,`${projectUrl}/storage/v1${item.signedURL}`);
  }
  return materials.map(({_images,...material})=>({...material,imageIds:_images.map((image)=>image.id),
    imagePaths:_images.map((image)=>{
      const url=urls.get(image.path);
      if (!url) throw new ApiError(503,'IMAGE_URL_UNAVAILABLE','사진 주소를 다시 불러와 주세요.');
      return url;
    })}));
}
export async function cleanupFiles():Promise<void> {
  const paths=await rpc<string[]>('gc_list');
  if (!paths.length) return;
  const response=await fetch(`${projectUrl}/storage/v1/object/${bucket}`,{method:'DELETE',
    headers:{...serverHeaders(),'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths}),signal:AbortSignal.timeout(15000)});
  await response.body?.cancel();
  if (response.ok) await rpc('gc_ack',null,{paths});
}
export function background(task:Promise<unknown>):void {
  EdgeRuntime.waitUntil(task.catch((error:unknown)=>{
    console.error(JSON.stringify({code:error instanceof ApiError?error.code:'BACKGROUND_FAILED'}));
  }));
}
export async function dispatchJob(userId:string,jobId:string):Promise<void> {
  const response=await fetch(`${projectUrl}/functions/v1/ai-study-worker`,{method:'POST',
    headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({userId,jobId}),signal:AbortSignal.timeout(10000)});
  await response.body?.cancel();
  if (!response.ok) throw new ApiError(503,'WORKER_DISPATCH_FAILED','작업 실행을 시작하지 못했습니다. 작업 상태를 다시 확인해 주세요.');
}
export async function isServiceRequest(request:Request):Promise<boolean> {
  const supplied=request.headers.get('apikey')??'';
  // Compare fixed-size digests to avoid exposing a key prefix through string comparisons.
  const [left,right]=await Promise.all([sha256(supplied),sha256(serviceKey)]);
  let difference=0; for (let i=0;i<left.length;i++) difference|=left.charCodeAt(i)^right.charCodeAt(i);
  return supplied.length>0 && difference===0;
}

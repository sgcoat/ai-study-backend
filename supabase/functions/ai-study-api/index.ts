/// <reference path="../_shared/runtime.d.ts" />
import { z, uuid, generationSchema, type Accepted, type Job, type RawMaterial, type User } from '../_shared/contracts.ts';
import { ApiError, background, cleanupFiles, dispatchJob, presentMaterials, rpc, sha256 } from '../_shared/platform.ts';
import { bearerToken, errorResponse, jsonBody, parse, requestKey } from '../_shared/http.ts';
import { deleteAccount, requestDeletion, requestLogin, verifyLogin } from '../_shared/auth.ts';
import { saveMaterial } from '../_shared/materials.ts';
import { submitAttempt } from '../_shared/attempts.ts';

const pagination=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(100).default(20)});
const listSchema=pagination.extend({query:z.string().trim().max(200).optional(),subject:z.string().trim().max(50).optional()}).strict();
const empty=z.object({}).strict();
const webOrigins=(Deno.env.get('WEB_ORIGINS')??'http://localhost:8081').split(',').map((origin)=>origin.trim()).filter(Boolean);
function responseHeaders(request:Request):Headers {
  const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'});
  const origin=request.headers.get('origin');
  if (origin && webOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers','Authorization, Content-Type, Idempotency-Key, apikey');
    headers.set('Access-Control-Max-Age','600');
  }
  return headers;
}
function pathOf(request:Request):string {
  const path=new URL(request.url).pathname;
  return path.replace(/^\/functions\/v1\/ai-study-api(?=\/|$)/,'').replace(/^\/ai-study-api(?=\/|$)/,'');
}
Deno.serve(async (request:Request)=>{
  const headers=responseHeaders(request);
  const respond=(body:unknown,status=200)=>status===204?new Response(null,{status,headers}):Response.json(body,{status,headers});
  try {
    if (request.headers.has('origin') && !webOrigins.includes(request.headers.get('origin')!))
      throw new ApiError(403,'ORIGIN_NOT_ALLOWED','허용되지 않은 웹 주소입니다.');
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
    const path=pathOf(request); const method=request.method;
    if (method==='GET' && (path==='/health' || path==='/api/v1/health')) {
      const database=await rpc<{schemaVersion:number}>('health');
      return respond({status:'ok',apiVersion:'v1',serverMode:'full',platform:'supabase',...database,
        aiProvider:Deno.env.get('AI_PROVIDER')??'mock',emailProvider:'supabase',
        accountDeletionEnabled:Deno.env.get('ACCOUNT_DELETION_ENABLED')==='true'});
    }
    if (!path.startsWith('/api/v1/')) throw new ApiError(404,'NOT_FOUND','요청한 API를 찾을 수 없습니다.');
    const route=path.slice('/api/v1'.length);
    if (method==='POST' && (route==='/auth/login' || route==='/auth/verify')) {
      // Email-scoped checks remain effective even if a client spoofs an IP header.
      const minute=Math.floor(Date.now()/60000);
      const ip=(request.headers.get('x-forwarded-for')??'unknown').slice(0,256);
      await rpc('rate',null,{bucket:`auth:${route}:${await sha256(ip)}:${minute}`,maximum:route==='/auth/login'?5:20,seconds:120});
      await rpc('rate',null,{bucket:`auth-global:${route}:${minute}`,maximum:100,seconds:120});
      return respond(await (route==='/auth/login'?requestLogin(request):verifyLogin(request)));
    }
    const tokenHash=await sha256(bearerToken(request));
    const user=await rpc<User>('session_get',null,{tokenHash});
    await rpc('rate',null,{bucket:`api:${user.id}:${Math.floor(Date.now()/60000)}`,maximum:120,seconds:120});
    if (method==='GET' && route==='/users/me') return respond(user);
    if (method==='POST' && route==='/auth/logout') { await rpc('session_delete',null,{tokenHash}); return respond(null,204); }
    if (method==='POST' && route==='/users/me/deletion-code') return respond(await requestDeletion(user,request));
    if (method==='DELETE' && route==='/users/me') { await deleteAccount(user,request); return respond(null,204); }
    if (route==='/materials' && method==='GET') {
      const query=parse(listSchema,Object.fromEntries(new URL(request.url).searchParams));
      const result=await rpc<{items:RawMaterial[];pageInfo:unknown;subjects:string[]}>('materials_list',user.id,query);
      background(cleanupFiles());
      return respond({...result,items:await presentMaterials(result.items)});
    }
    if (route==='/materials' && method==='POST') {
      await rpc('rate',null,{bucket:`write:${user.id}:${Math.floor(Date.now()/60000)}`,maximum:5,seconds:120});
      return respond(await saveMaterial(user.id,request),201);
    }
    const registration=route.match(/^\/materials\/registrations\/([^/]+)$/);
    if (registration && method==='GET') {
      let key:string; try { key=decodeURIComponent(registration[1]!); } catch { throw new ApiError(422,'INVALID_REQUEST','요청 키를 확인해 주세요.'); }
      if (!/^[A-Za-z0-9._:-]{1,512}$/.test(key)) throw new ApiError(422,'INVALID_REQUEST','요청 키를 확인해 주세요.');
      return respond((await presentMaterials([await rpc<RawMaterial>('material_registration',user.id,{key})]))[0]);
    }
    const material=route.match(/^\/materials\/([^/]+)(?:\/(summaries|questions(?:\/generate)?))?$/);
    if (material) {
      const materialId=parse(uuid,material[1]); const section=material[2];
      if (!section && method==='GET') return respond((await presentMaterials([await rpc<RawMaterial>('material_get',user.id,{materialId})]))[0]);
      if (!section && method==='PATCH') {
        await rpc('rate',null,{bucket:`write:${user.id}:${Math.floor(Date.now()/60000)}`,maximum:5,seconds:120});
        return respond(await saveMaterial(user.id,request,materialId));
      }
      if (!section && method==='DELETE') {
        const body=parse(z.object({expectedRevision:z.number().int().positive().max(999999999)}).strict(),await jsonBody(request));
        await rpc('material_delete',user.id,{materialId,...body}); background(cleanupFiles()); return respond(null,204);
      }
      if (section==='summaries' && method==='GET') {
        const result=await rpc<{items:unknown[];activeJob:Accepted|null}>('summary_snapshot',user.id,{materialId});
        if (result.activeJob?.status==='QUEUED') background(dispatchJob(user.id,result.activeJob.jobId));
        return respond(result);
      }
      if (section==='questions' && method==='GET') {
        const result=await rpc<{items:unknown[];activeJobs:Accepted[]}>('questions_snapshot',user.id,{materialId});
        for (const job of result.activeJobs) if (job.status==='QUEUED') background(dispatchJob(user.id,job.jobId));
        return respond(result);
      }
      if ((section==='summaries' || section==='questions/generate') && method==='POST') {
        const kind=section==='summaries'?'SUMMARY':'QUESTIONS';
        const body=await jsonBody(request);
        const config=kind==='SUMMARY'?parse(empty,body):parse(generationSchema,body);
        if ('types' in config) config.types.sort();
        const fingerprint=await sha256(JSON.stringify(kind==='SUMMARY'?[user.id,materialId,'SUMMARY']:
          [user.id,materialId,config.summaryId,config.types,config.count]));
        const accepted=await rpc<Accepted>('job_start',user.id,{materialId,kind,config,fingerprint,key:requestKey(request)});
        background(dispatchJob(user.id,accepted.jobId)); return respond(accepted,202);
      }
    }
    const job=route.match(/^\/jobs\/([^/]+)$/);
    if (job && method==='GET') {
      const result=await rpc<Job>('job_get',user.id,{jobId:parse(uuid,job[1])});
      if (result.status==='QUEUED') background(dispatchJob(user.id,result.jobId));
      return respond(result);
    }
    const attempt=route.match(/^\/questions\/([^/]+)\/attempts$/);
    if (attempt && method==='POST') {
      await rpc('rate',null,{bucket:`attempt:${user.id}:${Math.floor(Date.now()/60000)}`,maximum:30,seconds:120});
      return respond(await submitAttempt(user.id,parse(uuid,attempt[1]),request));
    }
    if (route==='/study-records' && method==='GET')
      return respond(await rpc('records_list',user.id,parse(pagination.strict(),Object.fromEntries(new URL(request.url).searchParams))));
    throw new ApiError(404,'NOT_FOUND','요청한 API를 찾을 수 없습니다.');
  } catch (error) { return errorResponse(error,headers); }
});

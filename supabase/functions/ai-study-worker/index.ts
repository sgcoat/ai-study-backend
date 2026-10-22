/// <reference path="../_shared/runtime.d.ts" />
import { z, uuid, generationSchema, summarySchema, draftsSchema, type ClaimedJob, type Question,
  type Summary, type QuestionSet } from '../_shared/contracts.ts';
import { ApiError, background, cleanupFiles, isServiceRequest, rpc } from '../_shared/platform.ts';
import { errorResponse, jsonBody, parse } from '../_shared/http.ts';
import { summarize, generateQuestions, modelInfo, validateDrafts } from '../_shared/ai.ts';

async function execute(claim:ClaimedJob):Promise<void> {
  const {job,material}=claim;
  // Free Edge instances have a 150s wall-clock limit. Leave time for durable writes.
  // There are no automatic provider retries, including after an interrupted worker.
  const signal=AbortSignal.timeout(105000);
  try {
    if (job.kind==='SUMMARY') {
      const draft=parse(summarySchema,await summarize(claim,signal));
      const {content,...structuredContent}=draft;
      const result:Summary={id:crypto.randomUUID(),materialId:material.id,content,structuredContent,
        modelInfo:modelInfo(),createdAt:new Date().toISOString()};
      await rpc('job_finish',job.user_id,{jobId:job.id,lease:job.lease,result});
    } else {
      if (!claim.summary) throw new ApiError(422,'SUMMARY_REQUIRED','저장된 요약이 없습니다. 요약을 먼저 생성해 주세요.');
      const config=parse(generationSchema,job.config);
      const drafts=parse(draftsSchema,{questions:await generateQuestions(claim.summary,config,signal)}).questions;
      validateDrafts(drafts,config);
      const questions:Question[]=drafts.map((draft)=>{
        const id=crypto.randomUUID(); const {choices:options,answer,...content}=draft;
        const choices=options.map((option)=>({id:crypto.randomUUID(),questionId:id,content:option}));
        return {id,authorId:job.user_id,materialId:material.id,...content,source:'AI',
          answer:draft.type==='MULTIPLE_CHOICE'?choices[Number(answer)-1]!.id:answer,
          ...(draft.type==='MULTIPLE_CHOICE'?{choices}:{})};
      });
      const result:QuestionSet={id:crypto.randomUUID(),materialId:material.id,config,
        questions:questions.map(({answer:_answer,explanation:_explanation,...prompt})=>prompt),
        createdAt:new Date().toISOString(),modelInfo:modelInfo()};
      await rpc('job_finish',job.user_id,{jobId:job.id,lease:job.lease,result,questions});
    }
  } catch (error) {
    const safe=error instanceof ApiError?error:new ApiError(503,'AI_FAILED','AI 작업을 완료하지 못했습니다. 다시 시도해 주세요.');
    console.error(JSON.stringify({jobId:job.id,code:safe.code}));
    await rpc('job_fail',job.user_id,{jobId:job.id,lease:job.lease,error:{code:safe.code,message:safe.message}}).catch(()=>undefined);
    // If persistence also fails, the lease expiry exposes FAILED on the next poll.
  }
}
Deno.serve(async (request:Request)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  try {
    if (!await isServiceRequest(request)) throw new ApiError(401,'UNAUTHENTICATED','서버 전용 API입니다.');
    if (request.method!=='POST') throw new ApiError(405,'METHOD_NOT_ALLOWED','POST 요청이 필요합니다.');
    const {userId,jobId}=parse(z.object({userId:uuid,jobId:uuid}).strict(),await jsonBody(request));
    const claim=await rpc<ClaimedJob|null>('job_claim',userId,{jobId});
    if (claim) background(execute(claim));
    background(cleanupFiles());
    return Response.json({accepted:true},{status:202,headers});
  } catch (error) { return errorResponse(error,headers); }
});

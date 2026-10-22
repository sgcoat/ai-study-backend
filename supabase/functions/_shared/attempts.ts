import { z, normalizeAnswer, type Question } from './contracts.ts';
import { ApiError, rpc, sha256 } from './platform.ts';
import { jsonBody, parse, requestKey } from './http.ts';
import { grade } from './ai.ts';

interface AttemptClaim { result?:unknown; attemptId:string; lease:string; question:Question; modelInfo:string }
export async function submitAttempt(userId:string,questionId:string,request:Request):Promise<unknown> {
  const {submittedAnswer}=parse(z.object({submittedAnswer:z.string().min(1).max(5000).refine((value)=>Boolean(value.trim()))}).strict(),await jsonBody(request));
  const key=requestKey(request);
  const fingerprint=await sha256(JSON.stringify([questionId,submittedAnswer]));
  const claim=await rpc<AttemptClaim>('attempt_claim',userId,{questionId,submittedAnswer,key,fingerprint});
  if (claim.result) return claim.result;
  try {
    const {question}=claim; const mock=claim.modelInfo.startsWith('mock');
    const normalize=(value:string)=>mock?normalizeAnswer(value).toLowerCase():normalizeAnswer(value);
    let isCorrect=normalize(question.answer)===normalize(submittedAnswer); let explanation=question.explanation;
    if (!isCorrect && !mock && !['MULTIPLE_CHOICE','OX'].includes(question.type)) {
      const result=await grade(question,submittedAnswer); isCorrect=result.isCorrect;
      explanation=`${question.explanation}\n\n채점 이유: ${result.explanation}`;
    }
    return await rpc('attempt_finish',userId,{attemptId:claim.attemptId,lease:claim.lease,submittedAnswer,isCorrect,explanation});
  } catch (error) {
    await rpc('attempt_fail',userId,{attemptId:claim.attemptId,lease:claim.lease}).catch(()=>undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError(503,'AI_GRADING_FAILED','답안을 채점하지 못했습니다. 입력을 유지한 채 다시 제출해 주세요.');
  }
}

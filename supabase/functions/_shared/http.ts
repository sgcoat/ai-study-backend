import { z } from './contracts.ts';
import { ApiError } from './platform.ts';

export function parse<T>(schema:z.ZodType<T>,value:unknown):T {
  const result=schema.safeParse(value);
  if (!result.success) throw new ApiError(422,'INVALID_REQUEST','입력 내용과 요청 형식을 확인해 주세요.');
  return result.data;
}
export function requestKey(request:Request,required=true):string|null {
  const key=request.headers.get('Idempotency-Key');
  if (!key && !required) return null;
  if (!key || !/^[A-Za-z0-9._:-]{1,512}$/.test(key))
    throw new ApiError(422,'IDEMPOTENCY_KEY_REQUIRED','올바른 Idempotency-Key가 필요합니다.');
  return key;
}
export async function boundedBody(request:Request,maximum:number):Promise<Response> {
  const length=Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length>maximum)
    throw new ApiError(413,'UPLOAD_TOO_LARGE','요청 용량이 너무 큽니다. 사진 수나 크기를 줄여 주세요.');
  let bytes=0;
  const body=request.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
    transform(chunk,controller) {
      bytes+=chunk.byteLength;
      if (bytes>maximum) throw new ApiError(413,'UPLOAD_TOO_LARGE','요청 용량이 너무 큽니다. 사진 수나 크기를 줄여 주세요.');
      controller.enqueue(chunk);
    },
  }));
  return new Response(body??null,{headers:{'Content-Type':request.headers.get('content-type')??''}});
}
export async function jsonBody(request:Request):Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new ApiError(415,'INVALID_CONTENT_TYPE','JSON 형식으로 요청해 주세요.');
  try { return await (await boundedBody(request,128000)).json(); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400,'INVALID_JSON','요청 내용을 읽을 수 없습니다.'); }
}
export function bearerToken(request:Request):string {
  const authorization=request.headers.get('authorization');
  if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))
    throw new ApiError(401,'UNAUTHENTICATED','로그인이 필요합니다.');
  return authorization.slice(7);
}
export function errorResponse(error:unknown,headers:HeadersInit={}):Response {
  const safe=error instanceof ApiError?error:new ApiError(500,'SERVER_ERROR','서버에서 요청을 처리하지 못했습니다.');
  if (safe.status>=500) console.error(JSON.stringify({code:safe.code}));
  return Response.json({code:safe.code,message:safe.message},{status:safe.status,headers});
}

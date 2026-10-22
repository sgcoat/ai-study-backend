import { z, uuid, type User } from './contracts.ts';
import { ApiError, accountRpc, authRequest, background, cleanupFiles, deleteProviderUser, newToken, nonceHash,
  revokeProviderSession, rpc, sendReauthentication, sha256 } from './platform.ts';
import { jsonBody, parse } from './http.ts';

const emailSchema=z.object({email:z.email().max(254).transform((email)=>email.toLowerCase())}).strict();
const verifySchema=emailSchema.extend({code:z.string().regex(/^\d{6}$/)});
const timing={expiresInSeconds:300,resendAfterSeconds:60,deliveryMode:'email' as const};
export async function requestLogin(request:Request) {
  const {email}=parse(emailSchema,await jsonBody(request));
  const emailHash=await sha256(email);
  await rpc('login_reserve',null,{emailHash});
  try { await authRequest('otp',{email,create_user:true}); }
  catch (error) { await rpc('login_release',null,{emailHash}).catch(()=>undefined); throw error; }
  return {message:'인증 코드를 보냈습니다.',...timing};
}
export async function verifyLogin(request:Request) {
  const {email,code}=parse(verifySchema,await jsonBody(request));
  const emailHash=await sha256(email);
  const check=await rpc<{allowed:boolean}>('login_check',null,{emailHash});
  if (!check.allowed) throw new ApiError(422,'INVALID_CODE','인증 코드가 올바르지 않거나 만료되었습니다. 새 코드를 요청해 주세요.');
  const verified=await authRequest('verify',{email,token:code,type:'email'});
  const providerUser=parse(z.object({id:uuid,email:z.email()}),verified.user);
  if (providerUser.email.toLowerCase()!==email) throw new ApiError(401,'UNAUTHENTICATED','이메일 인증을 다시 진행해 주세요.');
  try {
    const accessToken=newToken();
    const user=await rpc<User>('session_create',providerUser.id,{tokenHash:await sha256(accessToken),emailHash});
    return {accessToken,user};
  } finally {
    // Supabase's temporary access/refresh tokens are never returned to the app.
    background(revokeProviderSession(verified.access_token));
  }
}
export async function requestDeletion(user:User,request:Request) {
  parse(z.object({}).strict(),await jsonBody(request));
  if (Deno.env.get('ACCOUNT_DELETION_ENABLED')!=='true')
    throw new ApiError(503,'DELETION_EMAIL_NOT_CONFIGURED','계정 삭제 메일 설정이 준비 중입니다. 잠시 후 다시 시도해 주세요.');
  const challengeId=crypto.randomUUID();
  await accountRpc('reserve',user.id,{challengeId,emailHash:await sha256(user.email)});
  let providerToken:unknown;
  try {
    // The app has already authenticated this exact user. Create a temporary
    // provider session to call Supabase's signed-in reauthentication endpoint.
    // generate_link does NOT send an email; recovery cannot create a new user.
    const generated=await authRequest('admin/generate_link',{type:'recovery',email:user.email},true);
    const identity=parse(z.object({id:uuid,email:z.email(),hashed_token:z.string().min(1).max(200)}),generated);
    if (identity.id!==user.id || identity.email.toLowerCase()!==user.email.toLowerCase())
      throw new ApiError(401,'SESSION_EXPIRED','로그인이 만료되었습니다. 다시 로그인해 주세요.');
    const verified=await authRequest('verify',{token_hash:identity.hashed_token,type:'recovery'});
    providerToken=verified.access_token;
    const verifiedUser=parse(z.object({id:uuid}),verified.user);
    if (verifiedUser.id!==user.id || typeof providerToken!=='string')
      throw new ApiError(503,'AUTH_UNAVAILABLE','삭제 인증을 시작하지 못했습니다.');
    await sendReauthentication(providerToken);
    await accountRpc('bind',user.id,{challengeId});
  } catch (error) { await accountRpc('release',user.id,{challengeId}).catch(()=>undefined); throw error; }
  finally { background(revokeProviderSession(providerToken)); }
  return timing;
}
export async function deleteAccount(user:User,request:Request):Promise<void> {
  const {code}=parse(z.object({code:z.string().regex(/^\d{6}$/)}).strict(),await jsonBody(request));
  const invalid=()=>new ApiError(422,'INVALID_DELETION_CODE','계정 삭제 인증 코드가 올바르지 않거나 만료되었습니다.');
  if (Deno.env.get('ACCOUNT_DELETION_ENABLED')!=='true')
    throw new ApiError(503,'DELETION_EMAIL_NOT_CONFIGURED','계정 삭제 메일 설정이 준비 중입니다.');
  const check=await accountRpc<{allowed:boolean}>('consume',user.id,{nonceHash:nonceHash(user.email,code)});
  if (!check.allowed) throw invalid();
  // Auth's FK cascade deletes the profile and all study rows in a transaction.
  // Database triggers enqueue photos, even when the function exits immediately.
  await deleteProviderUser(user.id);
  background(cleanupFiles());
}

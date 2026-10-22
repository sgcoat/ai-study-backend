import { z, uuid, type Image, type RawMaterial } from './contracts.ts';
import { ApiError, background, cleanupFiles, presentMaterials, rpc, sha256, uploadImage } from './platform.ts';
import { boundedBody, parse, requestKey } from './http.ts';

const fieldsSchema=z.object({title:z.string().trim().min(1).max(100),subject:z.string().trim().min(1).max(50),
  content:z.string().max(30000).default(''),isPublic:z.enum(['true','false']).default('false')}).strict();
const updateSchema=fieldsSchema.extend({expectedRevision:z.string().regex(/^[1-9]\d{0,8}$/),
  retainedImageIds:z.string(),resetStudyData:z.enum(['true','false'])}).strict();
const extensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
function validImage(bytes:Uint8Array,mime:string):boolean {
  if (mime==='image/jpeg') return bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  if (mime==='image/png') return [137,80,78,71,13,10,26,10].every((value,i)=>bytes[i]===value);
  if (mime==='image/webp') return bytes.length>=12 && String.fromCharCode(...bytes.slice(0,4))==='RIFF'
    && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  return false;
}
async function form(request:Request,update:boolean) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;'))
    throw new ApiError(415,'MULTIPART_REQUIRED','자료와 사진은 multipart/form-data로 전송해 주세요.');
  let data:FormData;
  try { data=await (await boundedBody(request,53_000_000)).formData(); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400,'INVALID_MULTIPART','자료와 사진을 읽지 못했습니다. 다시 저장해 주세요.'); }
  const fields:Record<string,string>={}; const files:File[]=[];
  for (const [name,value] of data.entries()) {
    if (value instanceof File) {
      if (name!=='images') throw new ApiError(422,'INVALID_IMAGE_FIELD','사진 입력 형식을 확인해 주세요.');
      files.push(value);
    } else {
      if (Object.hasOwn(fields,name) || value.length>120000) throw new ApiError(422,'INVALID_REQUEST','자료 입력 형식을 확인해 주세요.');
      fields[name]=value;
    }
  }
  if (files.length>10) throw new ApiError(413,'TOO_MANY_IMAGES','사진은 최대 10장까지 등록할 수 있습니다.');
  const editing=update?parse(updateSchema,fields):null;
  const base=editing??parse(fieldsSchema,fields);
  let retainedImageIds:string[]=[];
  if (editing) {
    try { retainedImageIds=parse(z.array(uuid).max(10).refine((ids)=>new Set(ids).size===ids.length),JSON.parse(editing.retainedImageIds)); }
    catch { throw new ApiError(422,'INVALID_IMAGE_REFERENCE','유지할 사진 목록을 확인해 주세요.'); }
  }
  if (retainedImageIds.length+files.length>10) throw new ApiError(413,'TOO_MANY_IMAGES','사진은 최대 10장까지 등록할 수 있습니다.');
  if (!base.content.trim() && !files.length && !retainedImageIds.length)
    throw new ApiError(422,'MATERIAL_CONTENT_REQUIRED','필기 내용 또는 사진을 하나 이상 등록해 주세요.');
  const hashes:string[]=[];
  for (const file of files) {
    if (!extensions[file.type] || file.size<1 || file.size>5*1024*1024)
      throw new ApiError(413,'INVALID_IMAGE','JPG·PNG·WebP 사진을 장당 5MB 이하로 등록해 주세요.');
    const bytes=await file.arrayBuffer();
    if (!validImage(new Uint8Array(bytes,0,Math.min(bytes.byteLength,12)),file.type))
      throw new ApiError(422,'INVALID_IMAGE','사진 파일 형식이 올바르지 않습니다.');
    hashes.push(await sha256(bytes));
  }
  return {base,editing,retainedImageIds,files,hashes};
}
export async function saveMaterial(userId:string,request:Request,materialId?:string):Promise<Record<string,unknown>> {
  const update=Boolean(materialId);
  const {base,editing,retainedImageIds,files,hashes}=await form(request,update);
  const key=requestKey(request,false);
  const fingerprint=await sha256(JSON.stringify([base.title,base.subject,base.content,base.isPublic,
    files.map((file,i)=>[file.type,hashes[i]])]));
  if (!update && key) {
    const previous=await rpc<RawMaterial|null>('material_replay',userId,{key,fingerprint});
    if (previous) return (await presentMaterials([previous]))[0]!;
  }
  const batch=crypto.randomUUID();
  const images:Image[]=files.map((file)=>{
    const id=crypto.randomUUID();
    return {id,path:`${userId}/${batch}/${id}.${extensions[file.type]}`,mime:file.type,bytes:file.size};
  });
  if (images.length) await rpc('upload_reserve',userId,{images});
  try {
    for (let i=0;i<files.length;i++) await uploadImage(images[i]!.path,files[i]!);
    const raw=await rpc<RawMaterial>(update?'material_update':'material_create',userId,{
      id:crypto.randomUUID(),materialId,key,fingerprint,title:base.title,subject:base.subject,
      content:base.content,isPublic:base.isPublic==='true',images,
      ...(editing ? {expectedRevision:Number(editing.expectedRevision),retainedImageIds,
        resetStudyData:editing.resetStudyData==='true'}:{}),
    });
    // A concurrent create may have replayed a completed registration. Abandon ONLY
    // the still-unattached reservations, never files already attached by this call.
    if (images.length) await rpc('upload_abandon',userId,{ids:images.map((image)=>image.id)});
    background(cleanupFiles());
    return (await presentMaterials([raw]))[0]!;
  } catch (error) {
    if (images.length) await rpc('upload_abandon',userId,{ids:images.map((image)=>image.id)}).catch(()=>undefined);
    background(cleanupFiles());
    throw error;
  }
}

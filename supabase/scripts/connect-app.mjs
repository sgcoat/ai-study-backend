import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function connectCloudApp() {
  const projects=JSON.parse(await readFile(new URL('../projects.json',import.meta.url),'utf8'));
  const ref=projects.supabase.projectRef;
  if (ref!=='jqhivsrfrkycfjefgoam' || projects.supabase.plan!=='free') throw new Error('Approved free project does not match.');
  const url=`https://${ref}.supabase.co/functions/v1/ai-study-api/api/v1`;
  const response=await fetch(`${url}/health`,{signal:AbortSignal.timeout(30000)});
  const health=await response.json().catch(()=>null);
  if (!response.ok || health?.status!=='ok' || health?.platform!=='supabase' || health?.schemaVersion!==2)
    throw new Error('Cloud API is not ready. Existing app settings were kept.');
  if (!health.accountDeletionEnabled)
    throw new Error('Configure the cloud account deletion email first. Existing app settings were kept.');
  const file=new URL('../../.env',import.meta.url);
  let previous='';
  try { previous=await readFile(file,'utf8'); } catch (error) { if (error.code!=='ENOENT') throw error; }
  const values={EXPO_PUBLIC_API_MODE:'http',EXPO_PUBLIC_API_BASE_URL:url};
  let next=previous;
  for (const [key,value] of Object.entries(values)) {
    const expression=new RegExp(`^${key}=.*$`,'gm');
    const line=`${key}=${value}`;
    next=expression.test(next)?next.replace(expression,line):`${next}${next && !next.endsWith('\n')?'\n':''}${line}\n`;
  }
  if (next!==previous) {
    const directory=new URL('../../work/cloud-env-backups/',import.meta.url);
    await mkdir(directory,{recursive:true,mode:0o700});
    if (previous) await copyFile(file,new URL(`env-${Date.now()}.txt`,directory));
    await writeFile(file,next,{mode:0o600});
  }
  console.log('App connected to the Supabase cloud API.');
  console.log(`AI mode: ${health.aiProvider}. Restart Expo to apply the connection.`);
  return values;
}
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  try { await connectCloudApp(); } catch (error) { console.error(error.message); process.exitCode=1; }
}

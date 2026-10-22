import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
// Reuse the existing, locked server build dependency. No new global install.
const require=createRequire(new URL('../../server/package.json',import.meta.url));
const fromTsx=createRequire(require.resolve('tsx'));
const {build}=fromTsx('esbuild');
const output=new URL('../../outputs/supabase-deploy/',import.meta.url);
await mkdir(output,{recursive:true});
for (const name of ['ai-study-api','ai-study-worker']) {
  const result=await build({absWorkingDir:root,entryPoints:[`supabase/functions/${name}/index.ts`],
    bundle:true,write:false,platform:'neutral',format:'esm',target:'es2022',external:['npm:*','node:*'],
    legalComments:'none',banner:{js:'// Generated from supabase/functions/. Edit source files and bundle again.'}});
  await writeFile(new URL(`${name}.ts`,output),result.outputFiles[0].text);
  console.log(`Prepared outputs/supabase-deploy/${name}.ts`);
}

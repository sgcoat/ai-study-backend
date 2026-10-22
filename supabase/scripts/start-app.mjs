import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connectCloudApp } from './connect-app.mjs';

try {
  const values=await connectCloudApp();
  const child=spawn('pnpm',['exec','expo','start','--clear',...process.argv.slice(2)],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)),stdio:'inherit',env:{...process.env,...values},
  });
  child.on('error',(error)=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',(code)=>{process.exitCode=code??1;});
} catch (error) { console.error(error.message); process.exitCode=1; }

import { mkdir, readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) {
  console.error('Usage: node server/scripts/export-backend.mjs [--output work/backend-publish]');
  process.exit(1);
}
const output = resolve(root, args[1] ?? 'work/backend-publish');
// Keep upload staging outside the app/server source trees and preserve earlier exports.
const work = resolve(root, 'work');
if (relative(work, output).startsWith('..') || output === work) {
  console.error('Choose a new subdirectory inside work/.');
  process.exit(1);
}

const files = [
  '.github/workflows/publish-backend.yml',
  'docs/DOCKER_DEPLOYMENT.md',
  'docs/DOCKER_RELEASE_1.0.0.md',
  'docs/DOCKER_RELEASE_1.0.1.md',
  'docs/BACKEND_README.md', 'docs/SERVER_HANDOFF.md',
  'supabase/README.md', 'supabase/SMTP_SETUP_RESULT.md', 'supabase/projects.json',
  'supabase/email-templates/otp.html', 'supabase/scripts/request-login-code.mjs',
  'supabase/email-templates/delete-account.html', 'supabase/config.toml', 'supabase/tsconfig.json',
  'supabase/functions/.env.example', 'supabase/migrations/202610220001_cloud_api.sql',
  'supabase/migrations/202610220002_account_reauthentication.sql',
  'supabase/migrations/202610220003_account_delete_lock_order.sql',
  'supabase/DEPLOYMENT.md', 'supabase/DEPLOYMENT_STATUS.md',
  'supabase/scripts/bundle-functions.mjs', 'supabase/scripts/connect-app.mjs', 'supabase/scripts/start-app.mjs',
  'server/Dockerfile', 'server/.dockerignore', 'server/package.json',
  'server/pnpm-lock.yaml', 'server/pnpm-workspace.yaml', 'server/tsconfig.json',
  'server/.env.example', 'server/scripts/setup.mjs',
  'server/scripts/publish-image.mjs', 'server/scripts/export-backend.mjs',
  'server/deploy/docker/.env.example', 'server/deploy/docker/server.env.example',
  'server/deploy/docker/compose.yaml', 'server/deploy/docker/compose.https.yaml',
  'server/deploy/docker/Caddyfile', 'server/deploy/docker/prepare.sh',
];

async function collect(directory) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const name = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${name}`);
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(name);
    else throw new Error(`Unexpected backend source entry: ${name}`);
  }
}

try {
  await collect('server/src');
  await collect('supabase/functions/_shared');
  await collect('supabase/functions/ai-study-api');
  await collect('supabase/functions/ai-study-worker');
  // Read only approved regular files before creating the export.
  const contents = [];
  for (const name of files.sort()) {
    const source = resolve(root, name);
    if (!(await lstat(source)).isFile()) throw new Error(`Expected regular file: ${name}`);
    contents.push([name, await readFile(source)]);
  }
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Existing exports are never overwritten.
  for (const [name, content] of contents) {
    const target = resolve(output, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
  }
  await writeFile(resolve(output, '.gitignore'), `node_modules/\ndist/\nwork/\noutputs/\n.env\n.env.*\n!.env.example\nserver/data/\nserver/deploy/docker/server.env\nserver/deploy/docker/backups/\nsupabase/.temp/\nsupabase/.branches/\n*.log\n.DS_Store\n`, { flag: 'wx' });
  await writeFile(resolve(output, 'README.md'), await readFile(resolve(root, 'docs/BACKEND_README.md')), { flag: 'wx' });
  console.log(`Prepared ${files.length + 2} backend files in ${relative(root, output)}/`);
  console.log('No runtime env, database, photos, frontend or build output was copied.');
} catch (error) {
  console.error(error?.code === 'EEXIST' ? 'Output exists. Choose a new --output directory.' : error.message);
  process.exitCode = 1;
}

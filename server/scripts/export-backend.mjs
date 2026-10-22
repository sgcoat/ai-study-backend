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
  await writeFile(resolve(output, '.gitignore'), `node_modules/\ndist/\nwork/\n.env\n.env.*\n!.env.example\nserver/data/\nserver/deploy/docker/server.env\nserver/deploy/docker/backups/\n*.log\n.DS_Store\n`, { flag: 'wx' });
  await writeFile(resolve(output, 'README.md'), `# AI Study Backend\n\nFastify + TypeScript + SQLite. Node.js 24 이상을 사용합니다.\n\n- 비공개 Docker Hub 이미지: \`devcksgur/ai-study-backend\`\n- GitHub Actions에서 수동으로 AMD64·ARM64 이미지를 빌드하고 업로드합니다.\n- GitHub Actions secret \`DOCKERHUB_TOKEN\`을 먼저 설정하세요.\n- [빌드·배포 안내](docs/DOCKER_DEPLOYMENT.md)\n- [Dockerfile](server/Dockerfile), [Docker Compose](server/deploy/docker/compose.yaml)\n\nAPI 키와 SMTP 설정은 배포 서버의 \`server.env\`에 직접 입력합니다. 소스·이미지에는 포함하지 않습니다.\n이 저장소는 앱 프로젝트에서 내보낸 백엔드 전용 소스입니다. 로컬 앱 개발 명령과 앱 파일은 포함하지 않습니다.\n`, { flag: 'wx' });
  console.log(`Prepared ${files.length + 2} backend files in ${relative(root, output)}/`);
  console.log('No runtime env, database, photos, frontend or build output was copied.');
} catch (error) {
  console.error(error?.code === 'EEXIST' ? 'Output exists. Choose a new --output directory.' : error.message);
  process.exitCode = 1;
}

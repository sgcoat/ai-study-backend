import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
const usage = `Usage:
  pnpm server:docker:publish --image devcksgur/ai-study-backend --tag 1.0.0
  pnpm server:docker:publish --image devcksgur/ai-study-backend --tag 1.0.0 --dry-run

Options:
  --platforms linux/amd64,linux/arm64  Default: both architectures
  --builder ai-study-backend         Default: dedicated docker-container builder
  --revision <git-commit>            Optional OCI revision label
  --dry-run                         Print commands without running Docker

Create the Docker Hub repository as PRIVATE and run docker login before publishing.
This command does not create repositories or change their visibility.
No API key, SMTP credential or server data is passed to the image builder.`;

function options(args) {
  const result = { platforms: 'linux/amd64,linux/arm64', builder: 'ai-study-backend', revision: 'unknown', dryRun: false };
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--') continue;
    if (name === '--help' || name === '-h') return { help: true };
    if (name === '--dry-run') { result.dryRun = true; continue; }
    const key = { '--image': 'image', '--tag': 'tag', '--platforms': 'platforms', '--builder': 'builder', '--revision': 'revision' }[name];
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${name}`);
    result[key] = args[++index];
  }
  if (!/^(?:docker\.io\/)?[a-z0-9][a-z0-9_-]*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(result.image ?? '')) {
    throw new Error('--image must be a lowercase Docker Hub namespace/repository without a tag.');
  }
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(result.tag ?? '')) throw new Error('--tag requires an explicit release version.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(result.builder)) throw new Error('Invalid builder name.');
  if (result.revision !== 'unknown' && !/^[a-f0-9]{7,64}$/.test(result.revision)) throw new Error('--revision must be a lowercase commit hash.');
  const platforms = [...new Set(result.platforms.split(','))];
  if (!platforms.length || platforms.some((platform) => !['linux/amd64', 'linux/arm64'].includes(platform))) throw new Error('Only linux/amd64 and linux/arm64 are supported.');
  result.platforms = platforms.join(',');
  return result;
}

function display(args) { return ['docker', ...args].map((arg) => /^[a-zA-Z0-9_./:,@=-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`).join(' '); }
function run(args, { probe = false } = {}) {
  const result = spawnSync('docker', args, { cwd: serverDirectory, stdio: probe ? 'ignore' : 'inherit', env: process.env });
  if (result.error?.code === 'ENOENT') throw new Error('Docker was not found. Install and start Docker Desktop, then reopen your terminal.');
  if (result.error) throw new Error('Could not run Docker. Check Docker Desktop and try again.');
  if (!probe && result.status !== 0) throw new Error(`Docker command failed (${result.status ?? result.signal}): ${display(args)}`);
  return result.status === 0;
}

try {
  const selected = options(process.argv.slice(2));
  if (selected.help) console.log(usage);
  else {
    const ref = `${selected.image}:${selected.tag}`;
    const build = ['buildx', 'build', '--builder', selected.builder, '--platform', selected.platforms,
      '--file', 'Dockerfile', '--tag', ref, '--build-arg', `VERSION=${selected.tag}`,
      '--build-arg', `VCS_REF=${selected.revision}`, '--provenance=mode=min', '--push', '.'];
    if (selected.dryRun) {
      console.log('Run from the server/ directory. Create the PRIVATE repository and log in first.');
      console.log(display(['buildx', 'create', '--name', selected.builder, '--driver', 'docker-container']));
      console.log('(Create the builder only if it does not already exist.)');
      console.log(display(['buildx', 'inspect', selected.builder, '--bootstrap']));
      console.log(display(build));
      console.log(display(['buildx', 'imagetools', 'inspect', ref]));
    } else {
      run(['version']);
      run(['buildx', 'version']);
      if (!run(['buildx', 'inspect', selected.builder], { probe: true })) {
        run(['buildx', 'create', '--name', selected.builder, '--driver', 'docker-container']);
      }
      run(['buildx', 'inspect', selected.builder, '--bootstrap']);
      run(build);
      run(['buildx', 'imagetools', 'inspect', ref]);
      console.log(`Published ${ref}. Record its registry digest for reproducible deployment.`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Image publishing failed.');
  process.exitCode = 1;
}

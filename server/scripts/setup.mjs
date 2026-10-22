import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(file)) {
  console.log('server/.env가 이미 있습니다. 기존 설정을 사용합니다.');
} else {
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  writeFileSync(file, example.replace(/^AUTH_SECRET=$/m, `AUTH_SECRET=${randomBytes(32).toString('hex')}`), { mode: 0o600, flag: 'wx' });
  console.log('server/.env를 생성했습니다. AI·메일 설정은 이 파일에서 변경하세요.');
}

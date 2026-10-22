import { loadConfig } from '../config.js';
import { createEmailSender } from '../features/auth/email.js';

let sender: ReturnType<typeof createEmailSender> | undefined;
let phase: 'configuration' | 'connection' = 'configuration';
try {
  // SMTP diagnostics neither instantiate AI nor open the live database.
  const config = loadConfig({ ...process.env, SERVER_MODE: 'auth' });
  if (config.EMAIL_PROVIDER !== 'smtp') throw new Error('server/.env의 EMAIL_PROVIDER를 smtp로 설정하세요.');
  phase = 'connection';
  sender = createEmailSender(config);
  await sender.verifyConnection();
  console.log('SMTP 연결과 인증이 성공했습니다. 실제 수신과 도메인 인증은 이메일 발송 후 별도로 확인하세요.');
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    EAUTH: 'SMTP 인증 실패: SMTP_USER와 SMTP_PASS를 확인하세요. Gmail은 2단계 인증 후 발급한 앱 비밀번호를 사용합니다.',
    ECONNECTION: 'SMTP 연결 실패: 서버 주소, 포트, 발신 방화벽을 확인하세요.',
    ETIMEDOUT: 'SMTP 연결 시간 초과: 발신 네트워크와 포트를 확인하세요.',
    ESOCKET: 'SMTP TLS/소켓 연결 실패: 호스트와 TLS 설정을 확인하세요.',
    EDNS: 'SMTP 호스트를 찾을 수 없습니다. SMTP_HOST를 확인하세요.',
  };
  // Provider messages can contain credentials or recipient data.
  console.error(phase === 'configuration' && error instanceof Error
    ? error.message
    : messages[code] ?? 'SMTP 확인 실패: AUTH_SECRET, EMAIL_PROVIDER=smtp, SMTP 설정을 확인하세요.');
  process.exitCode = 1;
} finally { sender?.close(); }

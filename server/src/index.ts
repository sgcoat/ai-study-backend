import { createApp } from './app.js';
import { loadConfig } from './config.js';

process.umask(0o077);
try {
  const config = loadConfig();
  const app = await createApp(config);
  const close = async () => { await app.close(); process.exitCode = 0; };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  try { await app.listen({ host: config.HOST, port: config.PORT }); }
  catch (error) { await app.close(); throw error; }
  console.log(`AI Study API: http://localhost:${config.PORT}/api/v1 (모드: ${config.SERVER_MODE}, AI: ${config.SERVER_MODE === 'full' ? config.AI_PROVIDER : '사용 안 함'}, 이메일: ${config.EMAIL_PROVIDER})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : '서버를 시작하지 못했습니다.');
  process.exitCode = 1;
}

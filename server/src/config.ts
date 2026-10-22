import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { z } from 'zod';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SERVER_MODE: z.enum(['full', 'auth']).default('full'),
  HOST: z.string().default('0.0.0.0'), PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  AUTH_SECRET: z.string().min(32, 'pnpm server:setup으로 server/.env를 생성하세요.'),
  DATA_DIR: z.string().default('./data'), ACCESS_TOKEN_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  IMAGE_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
  TRUSTED_PROXY_IPS: z.string().default(''),
  AI_FEATURES_ENABLED: z.enum(['true', 'false']).default('true'),
  AI_PROVIDER: z.enum(['mock', 'openai', 'gemini']).default('mock'), OPENAI_API_KEY: z.string().trim().default(''),
  GEMINI_API_KEY: z.string().trim().default(''),
  GEMINI_MODEL: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/).default(DEFAULT_GEMINI_MODEL),
  OPENAI_MODEL: z.string().trim().min(1).max(200).default(DEFAULT_OPENAI_MODEL), AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(240000).default(120000),
  MOCK_AI_DELAY_MS: z.coerce.number().int().min(0).max(30000).default(1500),
  DAILY_GENERATION_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'), SMTP_HOST: z.string().trim().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'), SMTP_USER: z.string().trim().default(''),
  SMTP_PASS: z.string().default(''), EMAIL_FROM: z.string().trim().default(''),
  EMAIL_DAILY_LIMIT_PER_ADDRESS: z.coerce.number().int().min(1).max(100).default(10),
  EMAIL_HOURLY_LIMIT: z.coerce.number().int().min(1).max(100000).default(100),
  EMAIL_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000000).default(500),
});

export type Config = ReturnType<typeof loadConfig>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error(`서버 환경 설정을 확인하세요: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  const value = result.data;
  const aiEnabled = value.AI_FEATURES_ENABLED === 'true';
  if (aiEnabled && value.SERVER_MODE === 'full' && value.AI_PROVIDER === 'openai' && !value.OPENAI_API_KEY) throw new Error('server/.env의 OPENAI_API_KEY가 필요합니다.');
  if (aiEnabled && value.SERVER_MODE === 'full' && value.AI_PROVIDER === 'gemini' && !value.GEMINI_API_KEY) throw new Error('server/.env의 GEMINI_API_KEY가 필요합니다. docs/GEMINI_CONNECTION.md를 확인하세요.');
  if (value.EMAIL_PROVIDER === 'smtp' && (!value.SMTP_HOST || !value.EMAIL_FROM)) throw new Error('SMTP_HOST와 EMAIL_FROM이 필요합니다.');
  if (value.EMAIL_PROVIDER === 'smtp' && value.SMTP_HOST.toLowerCase() === 'smtp.gmail.com' && (!value.SMTP_USER || !value.SMTP_PASS)) {
    throw new Error('Gmail SMTP에는 SMTP_USER와 앱 비밀번호 SMTP_PASS가 필요합니다.');
  }
  if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASS)) throw new Error('SMTP_USER와 SMTP_PASS는 함께 설정하세요.');
  if (value.EMAIL_PROVIDER === 'smtp' && value.SMTP_PORT === 465 && value.SMTP_SECURE !== 'true') throw new Error('SMTP 포트 465에는 SMTP_SECURE=true가 필요합니다.');
  if (value.NODE_ENV === 'production' && value.EMAIL_PROVIDER !== 'smtp') throw new Error('production에서는 SMTP 이메일 설정이 필요합니다.');
  if (aiEnabled && value.NODE_ENV === 'production' && value.SERVER_MODE === 'full' && value.AI_PROVIDER === 'mock') {
    throw new Error('전체 API의 production 모드에서는 실제 AI 설정이 필요합니다.');
  }
  const trustedProxyIps = value.TRUSTED_PROXY_IPS.split(',').map((address) => address.trim()).filter(Boolean);
  if (trustedProxyIps.some((address) => isIP(address) === 0)) throw new Error('TRUSTED_PROXY_IPS에는 신뢰할 프록시의 IP 주소만 입력하세요.');
  return { ...value, DATA_DIR: resolve(value.DATA_DIR), trustedProxyIps,
    corsOrigins: value.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean) };
}

import { z } from 'zod';
import { DEFAULT_GEMINI_MODEL } from '../config.js';
import { checkGeminiConnection } from '../ai/geminiProvider.js';
import { describeAIError } from '../ai/errors.js';

const settings = z.object({
  GEMINI_API_KEY: z.string().trim().min(1),
  GEMINI_MODEL: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/).default(DEFAULT_GEMINI_MODEL),
}).safeParse(process.env);

if (!settings.success) {
  console.error('server/.env의 GEMINI_API_KEY와 GEMINI_MODEL을 확인하세요. API 키는 앱 .env나 채팅에 입력하지 마세요.');
  process.exitCode = 1;
} else {
  try {
    await checkGeminiConnection({ ...settings.data, DATA_DIR: '', AI_TIMEOUT_MS: 10000 });
    console.log(`Gemini 인증·모델 조회 성공: ${settings.data.GEMINI_MODEL}`);
    console.log('학습 자료 전송·생성 요청은 보내지 않았습니다. 무료 등급·잔여 한도는 Google AI Studio에서 확인하세요.');
  } catch (error) {
    const failure = describeAIError(error, 'connection');
    console.error(`[${failure.code}] ${failure.message}`);
    process.exitCode = 1;
  }
}

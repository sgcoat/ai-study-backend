import OpenAI from 'openai';
import { z } from 'zod';
import { DEFAULT_OPENAI_MODEL } from '../config.js';
import { describeAIError } from '../ai/errors.js';

const settings = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  OPENAI_MODEL: z.string().trim().min(1).max(200).default(DEFAULT_OPENAI_MODEL),
}).safeParse(process.env);

if (!settings.success) {
  console.error('server/.env의 OPENAI_API_KEY와 OPENAI_MODEL을 확인하세요. API 키는 앱 .env나 채팅에 입력하지 마세요.');
  process.exitCode = 1;
} else {
  try {
    // Metadata only: do not open the database, send email, upload notes, or generate content.
    const client = new OpenAI({ apiKey: settings.data.OPENAI_API_KEY, timeout: 10000, maxRetries: 0 });
    await client.models.retrieve(settings.data.OPENAI_MODEL);
    console.log(`OpenAI 인증·모델 조회 성공: ${settings.data.OPENAI_MODEL}`);
    console.log('생성 요청은 보내지 않았습니다. Responses 생성 권한·결제 한도·이미지/JSON 지원은 실제 생성 시 확인됩니다.');
  } catch (error) {
    const failure = describeAIError(error, 'connection');
    console.error(`[${failure.code}] ${failure.message}`);
    process.exitCode = 1;
  }
}

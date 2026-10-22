import OpenAI from 'openai';

export interface AIFailure { code: string; message: string }

export class AIServiceError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

// Return only controlled messages. Provider errors can contain request data and credentials.
export function describeAIError(error: unknown, operation: 'generation' | 'grading' | 'connection'): AIFailure {
  if (error instanceof AIServiceError) return { code: error.code, message: error.message };
  const metadata = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown; name?: unknown } : {};
  if (error instanceof OpenAI.APIConnectionTimeoutError || metadata.name === 'TimeoutError') {
    return { code: 'AI_TIMEOUT', message: 'AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return { code: 'AI_CONNECTION_ERROR', message: 'AI 서비스에 연결할 수 없습니다. 서버의 인터넷 연결을 확인해 주세요.' };
  }
  if (metadata.status === 401) {
    return { code: 'AI_AUTH_FAILED', message: 'AI 서비스 인증에 실패했습니다. 서버의 OpenAI API 키를 확인해 주세요.' };
  }
  if (metadata.status === 403 || metadata.status === 404) {
    return { code: 'AI_MODEL_UNAVAILABLE', message: '설정한 AI 모델을 사용할 수 없습니다. 서버의 모델 이름과 프로젝트 권한을 확인해 주세요.' };
  }
  if (metadata.status === 429) {
    return metadata.code === 'insufficient_quota' || metadata.code === 'billing_hard_limit_reached'
      ? { code: 'AI_QUOTA_EXCEEDED', message: 'AI 사용 가능 한도에 도달했습니다. OpenAI 프로젝트의 결제·크레딧·사용 한도를 확인해 주세요.' }
      : { code: 'AI_RATE_LIMIT', message: 'AI 서비스의 요청 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (metadata.status === 400 || metadata.status === 422) {
    return { code: 'AI_REQUEST_INVALID', message: 'AI 요청을 처리할 수 없습니다. 자료 형식과 모델의 이미지·구조화 출력 지원 여부를 확인해 주세요.' };
  }
  if (typeof metadata.status === 'number' && metadata.status >= 500) {
    return { code: 'AI_UNAVAILABLE', message: 'AI 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (error instanceof SyntaxError || metadata.name === 'ZodError' ||
      (error instanceof Error && ['AI_QUESTION_FORMAT', 'AI_SUMMARY_EMPTY'].includes(error.message))) {
    return { code: 'AI_INVALID_RESPONSE', message: 'AI 결과가 필요한 형식과 맞지 않습니다. 다시 시도해 주세요.' };
  }
  if (operation === 'grading') return { code: 'GRADING_FAILED', message: '채점을 완료하지 못했습니다. 같은 답안으로 제출을 다시 확인해 주세요.' };
  if (operation === 'connection') return { code: 'AI_CONNECTION_FAILED', message: 'OpenAI 접속을 확인하지 못했습니다. API 키, 모델 이름, 서버의 인터넷 연결을 확인하세요.' };
  return { code: 'AI_GENERATION_FAILED', message: 'AI 결과를 생성하거나 검증하지 못했습니다. 다시 시도해 주세요.' };
}

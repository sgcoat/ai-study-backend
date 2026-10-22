import { z } from 'zod';

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(422, 'INVALID_INPUT', '입력한 값과 형식을 확인해 주세요.');
  return result.data;
}
export function required<T>(value: T | null | undefined, message = '요청한 정보를 찾을 수 없습니다.'): T {
  if (value === undefined || value === null) throw new HttpError(404, 'NOT_FOUND', message);
  return value;
}

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function sign(secret: string, value: string): string { return createHmac('sha256', secret).update(value).digest('hex'); }
export function matches(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function requestKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,512}$/.test(value)) throw new HttpError(422, 'IDEMPOTENCY_KEY_REQUIRED', '올바른 Idempotency-Key가 필요합니다.');
  return value;
}

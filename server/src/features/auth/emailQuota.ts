import type { Config } from '../../config.js';
import type { Store } from '../../db/database.js';
import { sign } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';

/** Call inside the same transaction that creates the challenge. Failed sends also consume a slot. */
export function reserveEmail(store: Store, config: Config, email: string): void {
  const now = Date.now();
  const day = Math.floor(now / 86400000);
  const hour = Math.floor(now / 3600000);
  store.run('DELETE FROM email_counters WHERE expires_at<=?', now);
  const limits = [
    { bucket: `day:${day}`, identity: sign(config.AUTH_SECRET, `email-quota:${email}`), max: config.EMAIL_DAILY_LIMIT_PER_ADDRESS, expires: (day + 1) * 86400000 },
    { bucket: `day:${day}`, identity: 'global', max: config.EMAIL_DAILY_LIMIT, expires: (day + 1) * 86400000 },
    { bucket: `hour:${hour}`, identity: 'global', max: config.EMAIL_HOURLY_LIMIT, expires: (hour + 1) * 3600000 },
  ];
  for (const limit of limits) {
    const count = store.one<{ total: number }>('SELECT total FROM email_counters WHERE bucket=? AND identity=?', limit.bucket, limit.identity)?.total ?? 0;
    if (count >= limit.max) throw new HttpError(429, 'EMAIL_SEND_LIMIT', '인증 이메일 발송 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
  }
  for (const limit of limits) store.run(`INSERT INTO email_counters VALUES (?,?,1,?)
    ON CONFLICT(bucket,identity) DO UPDATE SET total=total+1`, limit.bucket, limit.identity, limit.expires);
}

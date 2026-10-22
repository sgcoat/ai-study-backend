import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../../config.js';
import type { Store } from '../../db/database.js';
import { hash, matches, sign } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import type { User } from '../../types.js';
import type { EmailSender } from './email.js';
import { reserveEmail } from './emailQuota.js';

interface CodeRow { code_hash: string; expires_at: number; attempts: number; resend_at: number }
interface UserRow { id: string; email: string; created_at: string }
const asUser = (row: UserRow): User => ({ id: row.id, email: row.email, createdAt: row.created_at });
const remainingSeconds = (expiresAt: number, resendAt: number) => ({
  expiresInSeconds: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  resendAfterSeconds: Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)),
});

export class AuthService {
  constructor(private store: Store, private config: Config, private email: EmailSender) {}
  async requestCode(address: string) {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = sign(this.config.AUTH_SECRET, `code:${address}:${code}`);
    const expiresAt = Date.now() + 300000;
    const resendAt = Date.now() + 60000;
    this.store.transaction(() => {
      const previous = this.store.one<CodeRow>('SELECT * FROM login_codes WHERE email=?', address);
      if (previous && previous.resend_at > Date.now()) throw new HttpError(429, 'CODE_COOLDOWN', '인증 코드는 60초 후 다시 요청할 수 있습니다.');
      reserveEmail(this.store, this.config, address);
      this.store.run(`INSERT INTO login_codes (email, code_hash, expires_at, attempts, resend_at) VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, resend_at=excluded.resend_at`,
        address, codeHash, expiresAt, resendAt);
    });
    try { await this.email.sendCode(address, code); }
    catch { this.store.run('DELETE FROM login_codes WHERE email=? AND code_hash=?', address, codeHash);
      throw new HttpError(503, 'EMAIL_DELIVERY_FAILED', '인증 코드를 보내지 못했습니다. 잠시 후 다시 요청해 주세요.'); }
    return { message: this.config.EMAIL_PROVIDER === 'console' ? '개발 서버 터미널에서 인증 코드를 확인하세요.' : '인증 코드를 보냈습니다.',
      ...remainingSeconds(expiresAt, resendAt), deliveryMode: this.config.EMAIL_PROVIDER === 'console' ? 'console' : 'email' };
  }
  async requestDeletionCode(user: User) {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = sign(this.config.AUTH_SECRET, `delete-account:${user.id}:${code}`);
    const expiresAt = Date.now() + 300000;
    const resendAt = Date.now() + 60000;
    this.store.transaction(() => {
      const previous = this.store.one<CodeRow>('SELECT * FROM deletion_codes WHERE user_id=?', user.id);
      if (previous && previous.resend_at > Date.now()) throw new HttpError(429, 'CODE_COOLDOWN', '인증 코드는 60초 후 다시 요청할 수 있습니다.');
      reserveEmail(this.store, this.config, user.email);
      this.store.run(`INSERT INTO deletion_codes VALUES (?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET
        code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, resend_at=excluded.resend_at`,
        user.id, codeHash, expiresAt, resendAt);
    });
    try { await this.email.sendCode(user.email, code, 'delete_account'); }
    catch {
      this.store.run('DELETE FROM deletion_codes WHERE user_id=? AND code_hash=?', user.id, codeHash);
      throw new HttpError(503, 'EMAIL_DELIVERY_FAILED', '인증 코드를 보내지 못했습니다. 잠시 후 다시 요청해 주세요.');
    }
    return { ...remainingSeconds(expiresAt, resendAt),
      deliveryMode: this.config.EMAIL_PROVIDER === 'console' ? 'console' as const : 'email' as const };
  }
  /** The caller's transaction commits incorrect attempt counts and performs deletion atomically. */
  consumeDeletionCode(userId: string, code: string): boolean {
    const challenge = this.store.one<CodeRow>('SELECT * FROM deletion_codes WHERE user_id=?', userId);
    if (!challenge || challenge.expires_at <= Date.now() || challenge.attempts >= 5) return false;
    if (!matches(challenge.code_hash, sign(this.config.AUTH_SECRET, `delete-account:${userId}:${code}`))) {
      this.store.run('UPDATE deletion_codes SET attempts=attempts+1 WHERE user_id=?', userId); return false;
    }
    this.store.run('DELETE FROM deletion_codes WHERE user_id=?', userId);
    return true;
  }
  verify(address: string, code: string) {
    // Invalid attempt counts must commit, even when verification fails.
    const result = this.store.transaction(() => {
      const challenge = this.store.one<CodeRow>('SELECT * FROM login_codes WHERE email=?', address);
      if (!challenge || challenge.expires_at <= Date.now() || challenge.attempts >= 5) return null;
      if (!matches(challenge.code_hash, sign(this.config.AUTH_SECRET, `code:${address}:${code}`))) {
        this.store.run('UPDATE login_codes SET attempts=attempts+1 WHERE email=?', address); return null;
      }
      this.store.run('DELETE FROM login_codes WHERE email=?', address);
      let user = this.store.one<UserRow>('SELECT * FROM users WHERE email=?', address);
      if (!user) {
        user = { id: randomUUID(), email: address, created_at: new Date().toISOString() };
        this.store.run('INSERT INTO users VALUES (?,?,?)', user.id, user.email, user.created_at);
      }
      const token = randomBytes(32).toString('base64url');
      this.store.run('INSERT INTO sessions VALUES (?,?,?)', hash(token), user.id, Date.now() + this.config.ACCESS_TOKEN_DAYS * 86400000);
      return { accessToken: token, user: asUser(user) };
    });
    if (!result) throw new HttpError(422, 'INVALID_CODE', '인증 코드가 올바르지 않거나 만료되었습니다. 코드를 다시 확인해 주세요.');
    return result;
  }
  currentUser(request: FastifyRequest): User {
    const token = this.bearerToken(request);
    const user = this.store.one<UserRow>(`SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id
      WHERE sessions.token_hash=? AND sessions.expires_at>?`, hash(token), Date.now());
    if (!user) throw new HttpError(401, 'SESSION_EXPIRED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    return asUser(user);
  }
  logout(request: FastifyRequest): void { this.store.run('DELETE FROM sessions WHERE token_hash=?', hash(this.bearerToken(request))); }
  private bearerToken(request: FastifyRequest): string {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || !/^[A-Za-z0-9_-]{43}$/.test(authorization.slice(7))) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
    return authorization.slice(7);
  }
}

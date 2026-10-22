import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Store } from '../../db/database.js';
import { HttpError } from '../../lib/errors.js';
import type { User } from '../../types.js';
import type { AuthService } from './authService.js';

export class AccountService {
  private timer?: NodeJS.Timeout;
  private cleaning: Promise<void> | null = null;
  constructor(private store: Store, private auth: AuthService, private log: FastifyBaseLogger,
    private cancelGeneration: (owner: string) => void) {}

  start() {
    this.timer = setInterval(() => { void this.cleanup(); }, 60000);
    this.timer.unref();
    void this.cleanup();
  }

  cleanupFiles(): void { void this.cleanup(); }

  deleteAccount(user: User, code: string): void {
    const deleted = this.store.transaction(() => {
      if (!this.auth.consumeDeletionCode(user.id, code)) return false;
      const images = this.store.all<{ filename: string }>('SELECT filename FROM images WHERE owner_id=?', user.id);
      for (const image of images) this.store.run('INSERT OR IGNORE INTO file_deletions VALUES (?,?)', image.filename, Date.now());
      // Delete dependents first; foreign-key validation remains enabled throughout.
      this.store.run('DELETE FROM attempts WHERE user_id=?', user.id);
      this.store.run('DELETE FROM idempotency WHERE user_id=?', user.id);
      this.store.run('DELETE FROM jobs WHERE user_id=?', user.id);
      this.store.run('DELETE FROM questions WHERE owner_id=?', user.id);
      this.store.run('DELETE FROM question_sets WHERE owner_id=?', user.id);
      this.store.run('DELETE FROM summaries WHERE owner_id=?', user.id);
      this.store.run('DELETE FROM images WHERE owner_id=?', user.id);
      this.store.run('DELETE FROM materials WHERE owner_id=?', user.id);
      this.store.run('DELETE FROM sessions WHERE user_id=?', user.id);
      this.store.run('DELETE FROM login_codes WHERE email=?', user.email);
      this.store.run('DELETE FROM users WHERE id=?', user.id);
      return true;
    });
    if (!deleted) throw new HttpError(422, 'INVALID_DELETION_CODE', '삭제 인증 코드가 올바르지 않거나 만료되었습니다. 다시 확인해 주세요.');
    this.cancelGeneration(user.id);
    // File cleanup is durably queued. A restart or disk error does not resurrect an account.
    void this.cleanup();
  }

  private cleanup(): Promise<void> {
    if (this.cleaning) return this.cleaning;
    this.cleaning = this.drainFiles().catch(() => { this.log.error({ code: 'ACCOUNT_CLEANUP_FAILED' }, '계정 삭제 파일 정리를 다시 시도합니다.'); })
      .finally(() => { this.cleaning = null; });
    return this.cleaning;
  }

  private async drainFiles(): Promise<void> {
    const now = Date.now();
    this.store.run('DELETE FROM email_counters WHERE expires_at<=?', now);
    this.store.run('DELETE FROM deletion_codes WHERE expires_at<=?', now);
    this.store.run('DELETE FROM login_codes WHERE expires_at<=?', now);
    this.store.run('DELETE FROM sessions WHERE expires_at<=?', now);
    const files = this.store.all<{ filename: string }>('SELECT filename FROM file_deletions ORDER BY created_at LIMIT 1000');
    let failures = 0;
    for (const { filename } of files) {
      // Queued entries may never escape the private uploads directory.
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp)$/.test(filename)) { failures++; continue; }
      try { await unlink(join(this.store.directory, 'uploads', filename)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { failures++; continue; }
      }
      this.store.run('DELETE FROM file_deletions WHERE filename=?', filename);
    }
    if (failures) this.log.warn({ code: 'ACCOUNT_FILES_PENDING', count: failures }, '삭제 파일이 남아 있어 다음 정리 주기에 재시도합니다.');
  }

  async close() { if (this.timer) clearInterval(this.timer); await this.cleaning; }
}

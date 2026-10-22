import { mkdirSync, chmodSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { schema } from './schema.js';

interface LockOwner { pid: number; linuxIdentity?: string; nonce?: string }

function linuxProcessIdentity(pid: number): string | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const startedAt = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
    if (!startedAt) throw new Error('프로세스 시작 정보를 확인하지 못했습니다.');
    return `${bootId}:${startedAt}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function lockOwner(raw: string): LockOwner {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('데이터 폴더의 server.lock을 확인하세요.'); }
  // Older local servers stored just the PID.
  const owner = typeof value === 'number' ? { pid: value } : value as LockOwner | null;
  if (!owner || typeof owner !== 'object' || !Number.isInteger(owner.pid) || owner.pid < 1 ||
      (owner.linuxIdentity !== undefined && typeof owner.linuxIdentity !== 'string')) {
    throw new Error('데이터 폴더의 server.lock을 확인하세요.');
  }
  return owner;
}

function processLock(directory: string): () => void {
  const file = join(directory, 'server.lock');
  const record = JSON.stringify({ pid: process.pid, linuxIdentity: linuxProcessIdentity(process.pid), nonce: randomUUID() });
  for (let attempt = 0; attempt < 3; attempt++) {
    try { writeFileSync(file, record, { flag: 'wx', mode: 0o600 }); return () => {
      try { if (readFileSync(file, 'utf8') === record) unlinkSync(file); } catch { /* Already removed. */ }
    }; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = readFileSync(file, 'utf8');
      const owner = lockOwner(previous);
      // Container restarts can reuse a PID; kernel boot/start identity distinguishes it.
      if (process.platform === 'linux' && owner.linuxIdentity && linuxProcessIdentity(owner.pid) !== owner.linuxIdentity) {
        if (readFileSync(file, 'utf8') === previous) unlinkSync(file);
        continue;
      }
      try { process.kill(owner.pid, 0); } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === 'ESRCH') {
          if (readFileSync(file, 'utf8') === previous) unlinkSync(file);
          continue;
        }
        throw failure;
      }
      throw new Error('같은 데이터 폴더를 사용하는 서버가 이미 실행 중입니다.');
    }
  }
  throw new Error('서버 데이터 폴더를 잠그지 못했습니다.');
}

export class Store {
  private database: DatabaseSync;
  private releaseLock: () => void;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    mkdirSync(join(directory, 'uploads'), { recursive: true, mode: 0o700 });
    this.releaseLock = processLock(directory);
    try {
      const file = join(directory, 'study.sqlite');
      this.database = new DatabaseSync(file, { timeout: 5000 });
      chmodSync(file, 0o600);
      this.database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      this.database.exec(schema);
      // Keep existing data while adding optimistic edit protection.
      if (!this.all<{ name: string }>('PRAGMA table_info(materials)').some((column) => column.name === 'revision')) {
        this.database.exec('ALTER TABLE materials ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
      }
      this.database.exec('PRAGMA user_version=3');
      // Never replay an AI call whose response was uncertain at process shutdown.
      this.run("UPDATE jobs SET status='FAILED', error_json=?, updated_at=? WHERE status='PROCESSING'",
        JSON.stringify({ code: 'WORKER_INTERRUPTED', message: '서버 재시작으로 작업이 중단되었습니다. 결과를 확인한 뒤 다시 생성해 주세요.' }), new Date().toISOString());
      this.run("UPDATE attempts SET status='FAILED' WHERE status='PROCESSING'");
      this.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
      this.run('DELETE FROM login_codes WHERE expires_at < ?', Date.now());
    } catch (error) { this.releaseLock(); throw error; }
  }
  one<T>(sql: string, ...values: SQLInputValue[]): T | undefined { return this.database.prepare(sql).get(...values) as T | undefined; }
  all<T>(sql: string, ...values: SQLInputValue[]): T[] { return this.database.prepare(sql).all(...values) as T[]; }
  run(sql: string, ...values: SQLInputValue[]) { return this.database.prepare(sql).run(...values); }
  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  close() { try { this.database.close(); } finally { this.releaseLock(); } }
}

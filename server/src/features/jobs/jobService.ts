import { randomUUID } from 'node:crypto';
import type { Config } from '../../config.js';
import type { Store } from '../../db/database.js';
import { hash } from '../../lib/crypto.js';
import { HttpError, required } from '../../lib/errors.js';
import type { GenerationConfig, JobRow, QuestionSet, Summary } from '../../types.js';
import type { MaterialService } from '../materials/materialService.js';

export function configFingerprint(owner: string, material: string, config: GenerationConfig): string {
  return hash(JSON.stringify([owner, material, config.summaryId, [...config.types].sort(), config.count]));
}
export function accepted(job: JobRow) {
  return { jobId: job.id, status: job.status === 'PROCESSING' ? 'PROCESSING' as const : 'QUEUED' as const, pollAfterMs: 2000 };
}
export class JobService {
  constructor(private store: Store, private materials: MaterialService, private config: Config) {}
  savedSummary(owner: string, material: string): Summary | null {
    this.materials.getRow(owner, material);
    const saved = this.store.one<{ payload: string }>('SELECT payload FROM summaries WHERE material_id=? AND owner_id=?', material, owner);
    return saved ? JSON.parse(saved.payload) as Summary : null;
  }
  summarySnapshot(owner: string, material: string) {
    const summary = this.savedSummary(owner, material);
    const active = this.store.one<JobRow>("SELECT * FROM jobs WHERE user_id=? AND material_id=? AND kind='SUMMARY' AND status IN ('QUEUED','PROCESSING')", owner, material);
    return { items: summary ? [summary] : [], activeJob: active ? accepted(active) : null };
  }
  questionSnapshot(owner: string, material: string) {
    this.materials.getRow(owner, material);
    return { items: this.store.all<{ payload: string }>('SELECT payload FROM question_sets WHERE owner_id=? AND material_id=? ORDER BY rowid DESC', owner, material)
      .map((row) => JSON.parse(row.payload) as QuestionSet),
    activeJobs: this.store.all<JobRow>("SELECT * FROM jobs WHERE user_id=? AND material_id=? AND kind='QUESTIONS' AND status IN ('QUEUED','PROCESSING') ORDER BY created_at", owner, material)
      .map((job) => ({ ...accepted(job), config: JSON.parse(job.config_json) as GenerationConfig })) };
  }
  start(owner: string, material: string, kind: JobRow['kind'], key: string, input?: GenerationConfig) {
    this.materials.getRow(owner, material);
    const config = input ? { ...input, types: [...input.types].sort() } : undefined;
    if (kind === 'QUESTIONS' && (!config || this.savedSummary(owner, material)?.id !== config.summaryId)) {
      throw new HttpError(422, 'SUMMARY_REQUIRED', '저장된 요약을 먼저 확인해 주세요.');
    }
    const fingerprint = config ? configFingerprint(owner, material, config) : hash(JSON.stringify([owner, material, 'SUMMARY']));
    return this.store.transaction(() => {
      const replay = this.store.one<{ fingerprint: string; resource_id: string }>('SELECT * FROM idempotency WHERE user_id=? AND operation=? AND request_key=?', owner, kind, key);
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '같은 요청 키에 다른 생성 조건을 사용할 수 없습니다.');
        return accepted(required(this.store.one<JobRow>('SELECT * FROM jobs WHERE id=? AND user_id=?', replay.resource_id, owner)));
      }
      let job = this.store.one<JobRow>("SELECT * FROM jobs WHERE fingerprint=? AND status IN ('QUEUED','PROCESSING','COMPLETED') ORDER BY created_at DESC LIMIT 1", fingerprint);
      if (!job) {
        const total = this.store.one<{ count: number }>('SELECT count(*) as count FROM jobs WHERE user_id=? AND created_at>=?', owner,
          new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')!.count;
        if (total >= this.config.DAILY_GENERATION_LIMIT) throw new HttpError(429, 'DAILY_GENERATION_LIMIT', '오늘의 문제·요약 생성 한도에 도달했습니다. 저장된 결과를 이용해 주세요.');
        const active = this.store.one<{ count: number }>("SELECT count(*) as count FROM jobs WHERE user_id=? AND status IN ('QUEUED','PROCESSING')", owner)!.count;
        if (active >= 3) throw new HttpError(429, 'TOO_MANY_JOBS', '진행 중인 생성 작업이 완료된 뒤 다시 요청해 주세요.');
        const now = new Date().toISOString();
        job = { id: randomUUID(), user_id: owner, material_id: material, kind, fingerprint, config_json: JSON.stringify(config ?? {}),
          status: 'QUEUED', result_json: null, error_json: null, created_at: now, updated_at: now };
        this.store.run('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)', job.id, owner, material, kind, fingerprint, job.config_json, job.status, null, null, now, now);
      }
      this.store.run('INSERT INTO idempotency VALUES (?,?,?,?,?)', owner, kind, key, fingerprint, job.id);
      return accepted(job);
    });
  }
  get(owner: string, id: string) {
    const job = required(this.store.one<JobRow>('SELECT * FROM jobs WHERE id=? AND user_id=?', id, owner), '생성 작업을 찾을 수 없습니다.');
    return { jobId: job.id, status: job.status, pollAfterMs: 2000, createdAt: job.created_at, updatedAt: job.updated_at,
      ...(job.result_json ? { result: JSON.parse(job.result_json) as Summary | QuestionSet } : {}),
      ...(job.error_json ? { error: JSON.parse(job.error_json) as { code: string; message: string } } : {}) };
  }
}

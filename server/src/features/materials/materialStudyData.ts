import type { Store } from '../../db/database.js';
import { HttpError } from '../../lib/errors.js';

// Call inside the same transaction as the material change.
export function assertMaterialIdle(store: Store, owner: string, materialId: string): void {
  if (store.one("SELECT id FROM jobs WHERE user_id=? AND material_id=? AND status IN ('QUEUED','PROCESSING') LIMIT 1", owner, materialId) ||
      store.one("SELECT a.id FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.user_id=? AND q.material_id=? AND a.status='PROCESSING' LIMIT 1", owner, materialId)) {
    throw new HttpError(409, 'MATERIAL_BUSY', '이 자료의 생성 또는 채점이 진행 중입니다. 완료된 뒤 다시 시도해 주세요.');
  }
}

export function clearMaterialStudyData(store: Store, owner: string, materialId: string): void {
  store.run('DELETE FROM attempts WHERE user_id=? AND question_id IN (SELECT id FROM questions WHERE owner_id=? AND material_id=?)', owner, owner, materialId);
  store.run("DELETE FROM idempotency WHERE user_id=? AND operation IN ('SUMMARY','QUESTIONS') AND resource_id IN (SELECT id FROM jobs WHERE user_id=? AND material_id=?)", owner, owner, materialId);
  store.run('DELETE FROM jobs WHERE user_id=? AND material_id=?', owner, materialId);
  store.run('DELETE FROM questions WHERE owner_id=? AND material_id=?', owner, materialId);
  store.run('DELETE FROM question_sets WHERE owner_id=? AND material_id=?', owner, materialId);
  store.run('DELETE FROM summaries WHERE owner_id=? AND material_id=?', owner, materialId);
}

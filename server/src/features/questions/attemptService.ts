import { randomUUID } from 'node:crypto';
import { normalizeAnswer, type AIProvider } from '../../ai/provider.js';
import { describeAIError } from '../../ai/errors.js';
import type { Store } from '../../db/database.js';
import { hash } from '../../lib/crypto.js';
import { HttpError, required } from '../../lib/errors.js';
import type { AttemptResult, Question, QuestionSet } from '../../types.js';

interface AttemptRow { id: string; fingerprint: string; status: 'PROCESSING' | 'COMPLETED' | 'FAILED'; result_json: string | null }
interface QuestionRow { payload: string; set_id: string | null }

export class AttemptService {
  private requests = new Map<string, { fingerprint: string; promise: Promise<AttemptResult> }>();
  constructor(private store: Store, private ai: AIProvider) {}
  submit(owner: string, questionId: string, submittedAnswer: string, key: string): Promise<AttemptResult> {
    const fingerprint = hash(JSON.stringify([questionId, submittedAnswer]));
    const identity = JSON.stringify([owner, key]);
    const existing = this.requests.get(identity);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.reject(new HttpError(409, 'IDEMPOTENCY_CONFLICT', '같은 요청 키의 답안은 변경할 수 없습니다.'));
      return existing.promise;
    }
    const promise = this.run(owner, questionId, submittedAnswer, key, fingerprint).finally(() => {
      if (this.requests.get(identity)?.promise === promise) this.requests.delete(identity);
    });
    this.requests.set(identity, { fingerprint, promise });
    return promise;
  }
  private async run(owner: string, questionId: string, submittedAnswer: string, key: string, fingerprint: string): Promise<AttemptResult> {
    const row = required(this.store.one<QuestionRow>('SELECT payload,set_id FROM questions WHERE id=? AND owner_id=?', questionId, owner), '문제를 찾을 수 없습니다.');
    const question = JSON.parse(row.payload) as Question;
    if (!submittedAnswer.trim() || (question.type === 'MULTIPLE_CHOICE' && !question.choices?.some((choice) => choice.id === submittedAnswer)) ||
      (question.type === 'OX' && !['O', 'X'].includes(submittedAnswer))) throw new HttpError(422, 'INVALID_ANSWER', '답안을 확인해 주세요.');
    const attempt = this.store.transaction(() => {
      const previous = this.store.one<AttemptRow>('SELECT * FROM attempts WHERE user_id=? AND request_key=?', owner, key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '같은 요청 키의 답안은 변경할 수 없습니다.');
        if (previous.status === 'COMPLETED') return previous;
        if (previous.status === 'PROCESSING') throw new HttpError(409, 'ATTEMPT_PROCESSING', '채점이 진행 중입니다. 잠시 후 같은 답안을 다시 확인해 주세요.');
        this.store.run("UPDATE attempts SET status='PROCESSING' WHERE id=?", previous.id);
        return { ...previous, status: 'PROCESSING' as const };
      }
      const today = this.store.one<{ count: number }>('SELECT count(*) as count FROM attempts WHERE user_id=? AND solved_time>=?', owner,
        new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')!.count;
      if (today >= 500) throw new HttpError(429, 'DAILY_ATTEMPT_LIMIT', '오늘의 답안 제출 한도에 도달했습니다. 이전 결과를 복습해 주세요.');
      const id = randomUUID();
      this.store.run('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?)', id, owner, questionId, key, fingerprint, 'PROCESSING', null, new Date().toISOString());
      return { id, fingerprint, status: 'PROCESSING' as const, result_json: null };
    });
    if (attempt.status === 'COMPLETED' && attempt.result_json) return JSON.parse(attempt.result_json) as AttemptResult;
    try {
      const setRow = row.set_id ? this.store.one<{ payload: string }>('SELECT payload FROM question_sets WHERE id=? AND owner_id=?', row.set_id, owner) : undefined;
      const mockQuestion = setRow && (JSON.parse(setRow.payload) as QuestionSet).modelInfo.startsWith('mock');
      const normalize = (value: string) => mockQuestion ? normalizeAnswer(value).toLowerCase() : normalizeAnswer(value);
      let isCorrect = normalize(submittedAnswer) === normalize(question.answer);
      let explanation = question.explanation;
      if (!isCorrect && !mockQuestion && !['MULTIPLE_CHOICE', 'OX'].includes(question.type)) {
        if (this.ai.modelInfo.startsWith('mock')) throw new HttpError(503, 'AI_GRADING_REQUIRED', '이 문제의 주관식 채점에는 서버의 실제 AI 설정이 필요합니다.');
        const grade = await this.ai.grade(question, submittedAnswer);
        isCorrect = grade.isCorrect;
        explanation = `${question.explanation}\n\n채점 안내: ${grade.explanation}`;
      }
      const result: AttemptResult = { record: { id: attempt.id, userId: owner, questionId, submittedAnswer, isCorrect, solvedTime: new Date().toISOString() },
        correctAnswer: question.answer, explanation };
      if (!this.store.one('SELECT id FROM users WHERE id=?', owner)) throw new HttpError(401, 'ACCOUNT_DELETED', '삭제된 계정입니다. 다시 로그인해 주세요.');
      this.store.run("UPDATE attempts SET status='COMPLETED',result_json=?,solved_time=? WHERE id=?", JSON.stringify(result), result.record.solvedTime, attempt.id);
      return result;
    } catch (error) {
      this.store.run("UPDATE attempts SET status='FAILED' WHERE id=?", attempt.id);
      if (error instanceof HttpError) throw error;
      const failure = describeAIError(error, 'grading');
      // An upstream AI 401 is a server configuration issue, not an expired app session.
      throw new HttpError(503, failure.code, failure.message);
    }
  }
  records(owner: string, page: number, pageSize: number) {
    const totalItems = this.store.one<{ count: number }>("SELECT count(*) as count FROM attempts WHERE user_id=? AND status='COMPLETED'", owner)!.count;
    return { items: this.store.all<{ result_json: string }>("SELECT result_json FROM attempts WHERE user_id=? AND status='COMPLETED' ORDER BY solved_time DESC,id DESC LIMIT ? OFFSET ?",
      owner, pageSize, (page - 1) * pageSize).map((row) => (JSON.parse(row.result_json) as AttemptResult).record),
    pageInfo: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } };
  }
  async close() { await Promise.allSettled([...this.requests.values()].map((request) => request.promise)); }
}

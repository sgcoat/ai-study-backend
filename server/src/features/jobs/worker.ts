import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { AIProvider } from '../../ai/provider.js';
import { describeAIError } from '../../ai/errors.js';
import type { Store } from '../../db/database.js';
import { publicQuestion, type GenerationConfig, type JobRow, type Question, type QuestionDraft, type QuestionSet, type Summary } from '../../types.js';
import type { MaterialService } from '../materials/materialService.js';
import type { JobService } from './jobService.js';

function validateDrafts(drafts: QuestionDraft[], config: GenerationConfig): void {
  if (drafts.length !== config.count || drafts.some((question) => !config.types.includes(question.type) || !question.content.trim() ||
    question.content.length > 10000 || !question.answer.trim() || question.answer.length > 5000 || !question.explanation.trim() ||
    question.explanation.length > 20000 || (question.type === 'MULTIPLE_CHOICE' && (question.choices.length < 2 || question.choices.length > 10 ||
      new Set(question.choices).size !== question.choices.length || question.choices.some((choice) => !choice.trim() || choice.length > 5000) ||
      !/^[1-9]\d*$/.test(question.answer) || Number(question.answer) > question.choices.length)) ||
    (question.type === 'OX' && !['O', 'X'].includes(question.answer))) ||
    (config.count >= config.types.length && config.types.some((type) => !drafts.some((question) => question.type === type)))) throw new Error('AI_QUESTION_FORMAT');
}

export class JobWorker {
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | null = null;
  private abort = new AbortController();
  private active: { owner: string; abort: AbortController } | null = null;
  private stopped = false;
  constructor(private store: Store, private materials: MaterialService, private jobs: JobService, private ai: AIProvider, private log: FastifyBaseLogger) {}
  start() { this.timer = setInterval(() => this.tick(), 500); this.timer.unref(); this.tick(); }
  private tick() {
    if (this.stopped || this.running) return;
    this.running = this.processNext().catch(() => this.log.error('작업 처리 중 저장소 오류가 발생했습니다.')).finally(() => { this.running = null; });
  }
  private async processNext(): Promise<void> {
    const job = this.store.transaction(() => {
      const next = this.store.one<JobRow>("SELECT * FROM jobs WHERE status='QUEUED' ORDER BY created_at, rowid LIMIT 1");
      if (next) this.store.run("UPDATE jobs SET status='PROCESSING',updated_at=? WHERE id=? AND status='QUEUED'", new Date().toISOString(), next.id);
      return next;
    });
    if (!job) return;
    this.active = { owner: job.user_id, abort: new AbortController() };
    const signal = AbortSignal.any([this.abort.signal, this.active.abort.signal]);
    try {
      const now = () => new Date().toISOString();
      if (job.kind === 'SUMMARY') {
        const material = this.materials.get(job.user_id, job.material_id);
        const draft = await this.ai.summarize(material, this.materials.images(job.user_id, job.material_id), signal);
        if (!this.store.one('SELECT id FROM jobs WHERE id=?', job.id)) return;
        const { content, ...structuredContent } = draft;
        if (!content.trim()) throw new Error('AI_SUMMARY_EMPTY');
        const summary: Summary = { id: randomUUID(), materialId: job.material_id, content, structuredContent,
          modelInfo: this.ai.modelInfo, createdAt: now() };
        this.store.transaction(() => {
          this.store.run('INSERT INTO summaries VALUES (?,?,?,?)', summary.id, summary.materialId, job.user_id, JSON.stringify(summary));
          this.complete(job.id, summary);
        });
      } else {
        const config = JSON.parse(job.config_json) as GenerationConfig;
        const summary = this.jobs.savedSummary(job.user_id, job.material_id);
        if (summary?.id !== config.summaryId) throw new Error('SUMMARY_MISSING');
        const drafts = await this.ai.questions(summary, config, signal);
        if (!this.store.one('SELECT id FROM jobs WHERE id=?', job.id)) return;
        validateDrafts(drafts, config);
        const questions: Question[] = drafts.map((draft) => {
          const id = randomUUID();
          const choices = draft.type === 'MULTIPLE_CHOICE' ? draft.choices.map((content) => ({ id: randomUUID(), questionId: id, content })) : undefined;
          return { id, authorId: job.user_id, materialId: job.material_id, type: draft.type, content: draft.content, source: 'AI',
            choices, answer: choices ? choices[Number(draft.answer) - 1]!.id : draft.answer, explanation: draft.explanation };
        });
        const set: QuestionSet = { id: randomUUID(), materialId: job.material_id, config, questions: questions.map(publicQuestion),
          modelInfo: this.ai.modelInfo, createdAt: now() };
        this.store.transaction(() => {
          this.store.run('INSERT INTO question_sets VALUES (?,?,?,?,?)', set.id, set.materialId, job.user_id, job.fingerprint, JSON.stringify(set));
          for (const question of questions) this.store.run('INSERT INTO questions VALUES (?,?,?,?,?)', question.id, set.id, job.user_id, set.materialId, JSON.stringify(question));
          this.complete(job.id, set);
        });
      }
    } catch (error) {
      if (!this.store.one('SELECT id FROM jobs WHERE id=?', job.id)) return;
      const { code, message } = this.stopped
        ? { code: 'WORKER_INTERRUPTED', message: '서버 종료로 작업이 중단되었습니다. 다시 확인해 주세요.' }
        : describeAIError(error, 'generation');
      this.store.run("UPDATE jobs SET status='FAILED',error_json=?,updated_at=? WHERE id=?", JSON.stringify({ code, message }), new Date().toISOString(), job.id);
      this.log.warn({ jobId: job.id, code }, 'AI 작업 실패');
    } finally { this.active = null; }
  }
  private complete(id: string, result: Summary | QuestionSet) {
    this.store.run("UPDATE jobs SET status='COMPLETED',result_json=?,updated_at=? WHERE id=?", JSON.stringify(result), new Date().toISOString(), id);
  }
  async stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.abort.abort(); await this.running; }
  cancelUser(owner: string) { if (this.active?.owner === owner) this.active.abort.abort(); }
}

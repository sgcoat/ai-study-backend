import { z } from 'zod';

export const questionTypes = ['MULTIPLE_CHOICE', 'SHORT_ANSWER', 'OX', 'CONCEPT_CHECK', 'CONCEPT_COMPARISON'] as const;
export type QuestionType = typeof questionTypes[number];
export const generationSchema = z.object({ summaryId: z.string().min(1).max(100),
  types: z.array(z.enum(questionTypes)).min(1).max(5).refine((values) => new Set(values).size === values.length),
  count: z.number().int().min(1).max(20) }).strict();
export type GenerationConfig = z.infer<typeof generationSchema>;
export interface User { id: string; email: string; createdAt: string }
export interface Material { id: string; authorId: string; subject: string; title: string; content: string;
  imagePaths: string[]; imageIds?: string[]; isPublic: boolean; revision?: number }
export const summaryDraftSchema = z.object({ content: z.string(), coreConcepts: z.array(z.string()),
  keyTerms: z.array(z.object({ term: z.string(), definition: z.string() })),
  sections: z.array(z.object({ title: z.string(), content: z.string(), bulletPoints: z.array(z.string()) })) });
export type SummaryDraft = z.infer<typeof summaryDraftSchema>;
export interface Summary { id: string; materialId: string; content: string; modelInfo: string; createdAt: string;
  structuredContent: Pick<SummaryDraft, 'coreConcepts' | 'keyTerms' | 'sections'> }
export const questionDraftSchema = z.object({ type: z.enum(questionTypes), content: z.string(), choices: z.array(z.string()), answer: z.string(), explanation: z.string() });
export const questionDraftsSchema = z.object({ questions: z.array(questionDraftSchema) });
export type QuestionDraft = z.infer<typeof questionDraftSchema>;
export interface Choice { id: string; questionId: string; content: string }
export interface Question { id: string; authorId: string; materialId: string; type: QuestionType; content: string;
  answer: string; explanation: string; source: 'AI' | 'USER'; choices?: Choice[] }
export type QuestionPrompt = Omit<Question, 'answer' | 'explanation'>;
export interface QuestionSet { id: string; materialId: string; config: GenerationConfig; questions: QuestionPrompt[]; createdAt: string; modelInfo: string }
export interface StudyRecord { id: string; userId: string; questionId: string; submittedAnswer: string; isCorrect: boolean; solvedTime: string }
export interface AttemptResult { record: StudyRecord; correctAnswer: string; explanation: string }
export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export interface JobRow { id: string; user_id: string; material_id: string; kind: 'SUMMARY' | 'QUESTIONS';
  fingerprint: string; config_json: string; status: JobStatus; result_json: string | null; error_json: string | null;
  created_at: string; updated_at: string }
export interface ImageRow { id: string; material_id: string; owner_id: string; filename: string; mime: string; bytes: number }
export function publicQuestion(question: Question): QuestionPrompt {
  return { id: question.id, authorId: question.authorId, materialId: question.materialId, type: question.type,
    content: question.content, source: question.source, ...(question.choices ? { choices: question.choices } : {}) };
}

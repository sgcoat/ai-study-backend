import { z } from 'npm:zod@4.6.5';

export { z };
export const uuid = z.uuid();
export const questionTypes = ['MULTIPLE_CHOICE','SHORT_ANSWER','OX','CONCEPT_CHECK','CONCEPT_COMPARISON'] as const;
export const generationSchema = z.object({
  summaryId: uuid, types: z.array(z.enum(questionTypes)).min(1).max(5)
    .refine((values) => new Set(values).size === values.length),
  count: z.number().int().min(1).max(20),
}).strict();
export const summarySchema = z.object({
  content: z.string().trim().min(1).max(50000),
  coreConcepts: z.array(z.string().trim().min(1).max(3000)).max(40),
  keyTerms: z.array(z.object({term:z.string().trim().min(1).max(200),definition:z.string().trim().min(1).max(3000)})).max(80),
  sections: z.array(z.object({title:z.string().trim().min(1).max(300),content:z.string().max(12000),
    bulletPoints:z.array(z.string().max(3000)).max(40)})).max(40),
});
export const draftSchema = z.object({type:z.enum(questionTypes),content:z.string().trim().min(1).max(10000),
  choices:z.array(z.string().trim().min(1).max(2000)).max(4),answer:z.string().trim().min(1).max(5000),
  explanation:z.string().trim().min(1).max(10000)});
export const draftsSchema = z.object({questions:z.array(draftSchema).min(1).max(20)});
export type GenerationConfig = z.infer<typeof generationSchema>;
export type SummaryDraft = z.infer<typeof summarySchema>;
export type QuestionDraft = z.infer<typeof draftSchema>;
export interface User { id:string; email:string; createdAt:string }
export interface Image { id:string; path:string; mime:string; bytes:number }
export interface RawMaterial { id:string; authorId:string; subject:string; title:string; content:string;
  isPublic:boolean; revision:number; _images:Image[] }
export interface Summary { id:string; materialId:string; content:string; modelInfo:string; createdAt:string;
  structuredContent:Pick<SummaryDraft,'coreConcepts'|'keyTerms'|'sections'> }
export interface Question { id:string; authorId:string; materialId:string; type:typeof questionTypes[number];
  content:string; answer:string; explanation:string; source:'AI'; choices?:{id:string;questionId:string;content:string}[] }
export interface QuestionSet { id:string; materialId:string; config:GenerationConfig;
  questions:Omit<Question,'answer'|'explanation'>[]; createdAt:string; modelInfo:string }
export interface Accepted { jobId:string; status:'QUEUED'|'PROCESSING'; pollAfterMs:number }
export interface Job { jobId:string; status:'QUEUED'|'PROCESSING'|'COMPLETED'|'FAILED'; result?:Summary|QuestionSet;
  error?:{code:string;message:string}; createdAt:string; updatedAt:string }
export interface ClaimedJob { job:{id:string;user_id:string;material_id:string;kind:'SUMMARY'|'QUESTIONS';
  config:GenerationConfig;lease:string}; material:RawMaterial; summary:Summary|null }

export const normalizeAnswer = (value:string) => value.normalize('NFKC').trim().replace(/\s+/g,' ');

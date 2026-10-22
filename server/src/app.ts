import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createAIProvider, type AIProvider } from './ai/provider.js';
import type { Config } from './config.js';
import { Store } from './db/database.js';
import { AuthService } from './features/auth/authService.js';
import { AccountService } from './features/auth/accountService.js';
import { createEmailSender, type EmailSender } from './features/auth/email.js';
import { JobService } from './features/jobs/jobService.js';
import { JobWorker } from './features/jobs/worker.js';
import { deleteMaterialSchema, listSchema, MaterialService } from './features/materials/materialService.js';
import { AttemptService } from './features/questions/attemptService.js';
import { requestKey } from './lib/crypto.js';
import { HttpError, parse } from './lib/errors.js';
import { generationSchema, type User } from './types.js';

declare module 'fastify' { interface FastifyRequest { user?: User } }
const emailSchema = z.object({ email: z.email().max(254).transform((value) => value.toLowerCase()) }).strict();
const verifySchema = emailSchema.extend({ code: z.string().regex(/^\d{6}$/) });
const idSchema = z.object({ id: z.uuid() });
const userId = (request: FastifyRequest) => {
  if (!request.user) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  return request.user.id;
};

export interface AppDependencies {
  email?: EmailSender;
  ai?: AIProvider;
  logging?: boolean;
}

// Tests can substitute adapters in process. HTTP requests and environment flags cannot override authentication.
export async function createApp(config: Config, dependencies: AppDependencies = {}) {
  const app = Fastify({ logger: dependencies.logging === false ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: config.trustedProxyIps.length ? config.trustedProxyIps : false,
    logController: new LogController({ disableRequestLogging: true }), bodyLimit: 128000, requestTimeout: 60000, connectionTimeout: 65000 });
  const store = new Store(config.DATA_DIR);
  const email = dependencies.email ?? createEmailSender(config);
  const auth = new AuthService(store, config, email);
  const learning = config.SERVER_MODE === 'full' ? (() => {
    const materials = new MaterialService(store, config);
    const jobs = new JobService(store, materials, config);
    const ai = dependencies.ai ?? createAIProvider(config);
    const attempts = new AttemptService(store, ai);
    const worker = new JobWorker(store, materials, jobs, ai, app.log);
    return { materials, jobs, attempts, worker };
  })() : undefined;
  const accounts = new AccountService(store, auth, app.log, (owner) => learning?.worker.cancelUser(owner));
  let uploadsInProgress = 0;
  app.addHook('onClose', async () => { await learning?.worker.stop(); await learning?.attempts.close(); await accounts.close(); email.close(); store.close(); });

  try {
    await app.register(cors, { origin: config.corsOrigins, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'] });
    await app.register(multipart, { limits: { files: 10, fileSize: 5 * 1024 * 1024, fields: 7, fieldSize: 120000, parts: 17 } });
    await app.register(rateLimit, { max: 120, timeWindow: 60000 });
    app.setErrorHandler((error, request, reply) => {
      const status = error instanceof HttpError ? error.statusCode :
        typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
      const code = error instanceof HttpError ? error.code : status === 413 ? 'UPLOAD_TOO_LARGE' : status === 429 ? 'RATE_LIMIT' :
        status === 400 ? 'INVALID_REQUEST' : 'SERVER_ERROR';
      const message = error instanceof HttpError ? error.message : status === 413 ? '이미지는 장당 5MB, 최대 10장까지 등록할 수 있습니다.' :
        status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : status < 500 ? '요청 형식을 확인해 주세요.' : '서버에서 요청을 처리하지 못했습니다.';
      if (status >= 500) app.log.error({ requestId: request.id, code }, '서버 요청 실패');
      void reply.code(status).send({ code, message });
    });
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: 'NOT_FOUND', message: '요청한 API를 찾을 수 없습니다.' }));
    app.addHook('onSend', async (_request, reply, payload) => {
      reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff'); return payload;
    });
    app.get('/health', () => ({ status: 'ok', apiVersion: 'v1', serverMode: config.SERVER_MODE,
      aiProvider: learning ? (config.AI_FEATURES_ENABLED === 'false' ? 'disabled' : config.AI_PROVIDER) : null,
      emailProvider: config.EMAIL_PROVIDER }));
    if (learning) app.get('/uploads/:id', async (request, reply) => {
      const { id } = parse(idSchema, request.params);
      const image = learning.materials.readSignedImage(id, request.query);
      return reply.type(image.mime).send(image.stream);
    });
    await app.register(async (api) => {
      api.post('/auth/login', { config: { rateLimit: { max: 5, timeWindow: 60000 } } }, async (request) => {
        const { email } = parse(emailSchema, request.body); return auth.requestCode(email);
      });
      api.post('/auth/verify', { config: { rateLimit: { max: 20, timeWindow: 60000 } } }, async (request) => {
        const { email, code } = parse(verifySchema, request.body); return auth.verify(email, code);
      });
      await api.register(async (secured) => {
        secured.addHook('onRequest', async (request) => { request.user = auth.currentUser(request); });
        secured.get('/users/me', (request) => request.user);
        secured.post('/auth/logout', (request, reply) => { auth.logout(request); return reply.code(204).send(); });
        secured.post('/users/me/deletion-code', { config: { rateLimit: { max: 5, timeWindow: 60000 } } }, async (request) => {
          parse(z.object({}).strict(), request.body);
          return auth.requestDeletionCode(request.user!);
        });
        secured.delete('/users/me', { config: { rateLimit: { max: 20, timeWindow: 60000 } } }, (request, reply) => {
          const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }).strict(), request.body);
          accounts.deleteAccount(request.user!, code);
          return reply.code(204).send();
        });
        if (!learning) return;
        const { materials, jobs, attempts } = learning;
        secured.get('/materials', (request) => materials.list(userId(request), parse(listSchema, request.query)));
        secured.get('/materials/registrations/:key', (request) => {
          const key = requestKey((request.params as { key: string }).key);
          const material = materials.registration(userId(request), key);
          if (!material) throw new HttpError(404, 'MATERIAL_REGISTRATION_NOT_FOUND', '아직 등록된 자료를 확인하지 못했습니다.');
          return material;
        });
        secured.post('/materials', { config: { rateLimit: { max: 5, timeWindow: 60000 } } }, async (request, reply) => {
          if (uploadsInProgress >= 2) throw new HttpError(429, 'UPLOAD_BUSY', '다른 자료가 업로드 중입니다. 잠시 후 다시 시도해 주세요.');
          uploadsInProgress++;
          try { return reply.code(201).send(await materials.create(userId(request), request)); }
          finally { uploadsInProgress--; }
        });
        secured.get('/materials/:id', (request) => materials.get(userId(request), parse(idSchema, request.params).id));
        secured.patch('/materials/:id', { config: { rateLimit: { max: 5, timeWindow: 60000 } } }, async (request) => {
          if (uploadsInProgress >= 2) throw new HttpError(429, 'UPLOAD_BUSY', '다른 자료가 업로드 중입니다. 잠시 후 다시 시도해 주세요.');
          uploadsInProgress++;
          try {
            const material = await materials.update(userId(request), parse(idSchema, request.params).id, request);
            accounts.cleanupFiles();
            return material;
          } finally { uploadsInProgress--; }
        });
        secured.delete('/materials/:id', (request, reply) => {
          const { expectedRevision } = parse(deleteMaterialSchema, request.body);
          materials.delete(userId(request), parse(idSchema, request.params).id, expectedRevision);
          accounts.cleanupFiles();
          return reply.code(204).send();
        });
        secured.get('/materials/:id/summaries', (request) => jobs.summarySnapshot(userId(request), parse(idSchema, request.params).id));
        secured.post('/materials/:id/summaries', (request, reply) => {
          if (config.AI_FEATURES_ENABLED === 'false') throw new HttpError(503, 'AI_DISABLED', 'AI 기능은 현재 준비 중입니다. 자료 등록과 조회를 이용해 주세요.');
          parse(z.object({}).strict(), request.body);
          return reply.code(202).send(jobs.start(userId(request), parse(idSchema, request.params).id, 'SUMMARY', requestKey(request.headers['idempotency-key'])));
        });
        secured.get('/materials/:id/questions', (request) => jobs.questionSnapshot(userId(request), parse(idSchema, request.params).id));
        secured.post('/materials/:id/questions/generate', (request, reply) => {
          if (config.AI_FEATURES_ENABLED === 'false') throw new HttpError(503, 'AI_DISABLED', 'AI 기능은 현재 준비 중입니다. 자료 등록과 조회를 이용해 주세요.');
          const generation = parse(generationSchema, request.body);
          return reply.code(202).send(jobs.start(userId(request), parse(idSchema, request.params).id, 'QUESTIONS', requestKey(request.headers['idempotency-key']), generation));
        });
        secured.get('/jobs/:id', (request) => jobs.get(userId(request), parse(idSchema, request.params).id));
        secured.post('/questions/:id/attempts', { config: { rateLimit: { max: 30, timeWindow: 60000 } } }, async (request) => {
          const { submittedAnswer } = parse(z.object({ submittedAnswer: z.string().min(1).max(5000) }).strict(), request.body);
          return attempts.submit(userId(request), parse(idSchema, request.params).id, submittedAnswer, requestKey(request.headers['idempotency-key']));
        });
        secured.get('/study-records', (request) => {
          const { page, pageSize } = parse(listSchema.pick({ page: true, pageSize: true }), request.query);
          return attempts.records(userId(request), page, pageSize);
        });
      });
    }, { prefix: '/api/v1' });
    await app.ready();
    learning?.worker.start();
    accounts.start();
    return app;
  } catch (error) { await app.close(); throw error; }
}

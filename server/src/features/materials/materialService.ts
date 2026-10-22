import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import type { Store } from '../../db/database.js';
import { hash, matches, requestKey, sign } from '../../lib/crypto.js';
import { HttpError, parse, required } from '../../lib/errors.js';
import type { ImageRow, Material } from '../../types.js';
import { assertMaterialIdle, clearMaterialStudyData } from './materialStudyData.js';

interface MaterialRow { id: string; owner_id: string; subject: string; title: string; content: string; is_public: number; created_at: string; revision: number }
interface Upload { id: string; buffer: Buffer; mime: string; filename: string }
const materialSchema = z.object({ title: z.string().trim().min(1).max(100), subject: z.string().trim().min(1).max(50),
  content: z.string().max(30000).default(''), isPublic: z.enum(['true', 'false']).default('false') }).strict();
const updateSchema = materialSchema.extend({ expectedRevision: z.coerce.number().int().positive(),
  retainedImageIds: z.string().max(1000), resetStudyData: z.enum(['true', 'false']) });
export const deleteMaterialSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const listSchema = z.object({ query: z.string().trim().max(200).default(''), subject: z.string().max(50).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12) });

function imageType(buffer: Buffer): { mime: string; extension: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', extension: 'png' };
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

async function readUpload(request: FastifyRequest): Promise<{ fields: Record<string, string>; uploads: Upload[] }> {
  if (!request.isMultipart()) throw new HttpError(415, 'MULTIPART_REQUIRED', '자료는 multipart/form-data로 전송해 주세요.');
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  const uploads: Upload[] = [];
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      const type = imageType(buffer);
      if (part.fieldname !== 'images' || !type || type.mime !== part.mimetype) throw new HttpError(422, 'INVALID_IMAGE', 'JPEG, PNG, WebP 이미지만 등록할 수 있습니다.');
      const id = randomUUID();
      uploads.push({ id, buffer, mime: type.mime, filename: `${id}.${type.extension}` });
    } else {
      if (part.valueTruncated || typeof part.value !== 'string' || fields[part.fieldname] !== undefined) throw new HttpError(422, 'INVALID_MATERIAL_FIELDS', '자료 입력 값을 확인해 주세요.');
      fields[part.fieldname] = part.value;
    }
  }
  return { fields, uploads };
}

function checkRevision(row: MaterialRow, expected: number): void {
  if (row.revision !== expected) throw new HttpError(409, 'MATERIAL_CONFLICT', '다른 화면에서 자료가 변경되었습니다. 최신 자료를 불러온 뒤 다시 수정해 주세요.');
}

export class MaterialService {
  constructor(private store: Store, private config: Config) {}
  getRow(owner: string, id: string): MaterialRow {
    return required(this.store.one<MaterialRow>('SELECT * FROM materials WHERE id=? AND owner_id=?', id, owner), '자료를 찾을 수 없습니다.');
  }
  images(owner: string, materialId: string): ImageRow[] {
    return this.store.all<ImageRow>('SELECT * FROM images WHERE material_id=? AND owner_id=? ORDER BY rowid', materialId, owner);
  }
  private present(row: MaterialRow): Material {
    const expires = Math.floor(Date.now() / 1000) + this.config.IMAGE_URL_TTL_SECONDS;
    const images = this.images(row.owner_id, row.id);
    return { id: row.id, authorId: row.owner_id, subject: row.subject, title: row.title, content: row.content,
      revision: row.revision, imageIds: images.map((image) => image.id),
      isPublic: row.is_public === 1, imagePaths: images.map((image) => {
        const signature = sign(this.config.AUTH_SECRET, `image:${image.id}:${expires}`);
        return `/uploads/${image.id}?expires=${expires}&signature=${signature}`;
      }) };
  }
  get(owner: string, id: string): Material { return this.present(this.getRow(owner, id)); }
  registration(owner: string, key: string): Material | null {
    const entry = this.store.one<{ resource_id: string }>("SELECT resource_id FROM idempotency WHERE user_id=? AND operation='MATERIAL_CREATE' AND request_key=?", owner, key);
    if (!entry) return null;
    if (!this.store.one('SELECT id FROM materials WHERE id=? AND owner_id=?', entry.resource_id, owner)) {
      throw new HttpError(410, 'MATERIAL_ALREADY_DELETED', '이 요청으로 등록한 자료는 이미 삭제되었습니다. 새 자료로 등록해 주세요.');
    }
    return this.get(owner, entry.resource_id);
  }
  list(owner: string, params: z.infer<typeof listSchema>) {
    const terms = [owner, params.subject, params.subject, params.query, params.query, params.query, params.query];
    const filter = `owner_id=? AND (?='' OR subject=?) AND (?='' OR instr(lower(title),lower(?))>0
      OR instr(lower(content),lower(?))>0 OR instr(lower(subject),lower(?))>0)`;
    const totalItems = this.store.one<{ count: number }>(`SELECT count(*) as count FROM materials WHERE ${filter}`, ...terms)!.count;
    return { items: this.store.all<MaterialRow>(`SELECT * FROM materials WHERE ${filter} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ...terms, params.pageSize, (params.page - 1) * params.pageSize).map((row) => this.present(row)),
    pageInfo: { page: params.page, pageSize: params.pageSize, totalItems, totalPages: Math.ceil(totalItems / params.pageSize) },
    subjects: this.store.all<{ subject: string }>('SELECT DISTINCT subject FROM materials WHERE owner_id=? ORDER BY subject', owner).map((row) => row.subject) };
  }
  async create(owner: string, request: FastifyRequest): Promise<Material> {
    const { fields, uploads } = await readUpload(request);
    const input = parse(materialSchema, fields);
    if (!input.content.trim() && !uploads.length) throw new HttpError(422, 'EMPTY_MATERIAL', '텍스트 또는 이미지를 등록해 주세요.');
    const key = request.headers['idempotency-key'] === undefined ? undefined : requestKey(request.headers['idempotency-key']);
    const fingerprint = hash(JSON.stringify([input.title, input.subject, input.content, input.isPublic,
      uploads.map((upload) => [upload.mime, createHash('sha256').update(upload.buffer).digest('hex')])]));
    const replay = (): Material | null => {
      if (!key) return null;
      const previous = this.store.one<{ fingerprint: string }>("SELECT fingerprint FROM idempotency WHERE user_id=? AND operation='MATERIAL_CREATE' AND request_key=?", owner, key);
      if (previous && previous.fingerprint !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '같은 등록 요청의 내용은 바꿀 수 없습니다. 등록 결과를 먼저 확인해 주세요.');
      return previous ? this.registration(owner, key) : null;
    };
    const previous = replay();
    if (previous) return previous;
    const written: string[] = [];
    const id = randomUUID();
    let replayed: Material | null = null;
    try {
      for (const upload of uploads) {
        const filename = join(this.config.DATA_DIR, 'uploads', upload.filename);
        await writeFile(filename, upload.buffer, { mode: 0o600, flag: 'wx' }); written.push(filename);
      }
      this.store.transaction(() => {
        if (!this.store.one('SELECT id FROM users WHERE id=?', owner)) throw new HttpError(401, 'ACCOUNT_DELETED', '삭제된 계정입니다. 다시 로그인해 주세요.');
        replayed = replay();
        if (replayed) return;
        this.store.run('INSERT INTO materials (id,owner_id,subject,title,content,is_public,created_at) VALUES (?,?,?,?,?,?,?)', id, owner, input.subject, input.title, input.content,
          input.isPublic === 'true' ? 1 : 0, new Date().toISOString());
        for (const upload of uploads) this.store.run('INSERT INTO images VALUES (?,?,?,?,?,?)', upload.id, id, owner, upload.filename, upload.mime, upload.buffer.length);
        if (key) this.store.run('INSERT INTO idempotency VALUES (?,?,?,?,?)', owner, 'MATERIAL_CREATE', key, fingerprint, id);
      });
    } catch (error) { await Promise.allSettled(written.map((filename) => unlink(filename))); throw error; }
    if (replayed) {
      await Promise.allSettled(written.map((filename) => unlink(filename)));
      return replayed;
    }
    return this.get(owner, id);
  }
  async update(owner: string, id: string, request: FastifyRequest): Promise<Material> {
    this.getRow(owner, id);
    const { fields, uploads } = await readUpload(request);
    const input = parse(updateSchema, fields);
    let retainedInput: unknown;
    try { retainedInput = JSON.parse(input.retainedImageIds); }
    catch { throw new HttpError(422, 'INVALID_RETAINED_IMAGES', '유지할 이미지 목록을 확인해 주세요.'); }
    const retained = parse(z.array(z.uuid()).max(10).refine((ids) => new Set(ids).size === ids.length), retainedInput);
    if (retained.length + uploads.length > 10) throw new HttpError(422, 'TOO_MANY_IMAGES', '이미지는 최대 10장까지 첨부할 수 있습니다.');
    if (!input.content.trim() && !retained.length && !uploads.length) throw new HttpError(422, 'EMPTY_MATERIAL', '텍스트 또는 이미지를 등록해 주세요.');
    const written: string[] = [];
    try {
      for (const upload of uploads) {
        const path = join(this.config.DATA_DIR, 'uploads', upload.filename);
        await writeFile(path, upload.buffer, { mode: 0o600, flag: 'wx' }); written.push(path);
      }
      this.store.transaction(() => {
        const current = this.getRow(owner, id);
        checkRevision(current, input.expectedRevision);
        const images = this.images(owner, id);
        if (retained.some((imageId) => !images.some((image) => image.id === imageId))) throw new HttpError(422, 'INVALID_RETAINED_IMAGES', '이 자료에 속한 이미지만 유지할 수 있습니다.');
        const removed = images.filter((image) => !retained.includes(image.id));
        const learningChanged = current.title !== input.title || current.subject !== input.subject || current.content !== input.content || removed.length > 0 || uploads.length > 0;
        if (learningChanged) {
          assertMaterialIdle(this.store, owner, id);
          if (input.resetStudyData !== 'true') throw new HttpError(409, 'MATERIAL_RESET_REQUIRED', '학습 내용을 수정하면 기존 요약·문제·풀이 기록이 초기화됩니다. 확인 후 다시 저장해 주세요.');
          clearMaterialStudyData(this.store, owner, id);
        }
        if (!learningChanged && current.is_public === (input.isPublic === 'true' ? 1 : 0)) return;
        for (const image of removed) {
          this.store.run('INSERT OR IGNORE INTO file_deletions VALUES (?,?)', image.filename, Date.now());
          this.store.run('DELETE FROM images WHERE id=? AND owner_id=?', image.id, owner);
        }
        for (const upload of uploads) this.store.run('INSERT INTO images VALUES (?,?,?,?,?,?)', upload.id, id, owner, upload.filename, upload.mime, upload.buffer.length);
        this.store.run('UPDATE materials SET subject=?,title=?,content=?,is_public=?,revision=revision+1 WHERE id=? AND owner_id=?',
          input.subject, input.title, input.content, input.isPublic === 'true' ? 1 : 0, id, owner);
      });
    } catch (error) { await Promise.allSettled(written.map((path) => unlink(path))); throw error; }
    return this.get(owner, id);
  }
  delete(owner: string, id: string, expectedRevision: number): void {
    this.store.transaction(() => {
      checkRevision(this.getRow(owner, id), expectedRevision);
      assertMaterialIdle(this.store, owner, id);
      for (const image of this.images(owner, id)) this.store.run('INSERT OR IGNORE INTO file_deletions VALUES (?,?)', image.filename, Date.now());
      clearMaterialStudyData(this.store, owner, id);
      this.store.run('DELETE FROM images WHERE material_id=? AND owner_id=?', id, owner);
      this.store.run('DELETE FROM materials WHERE id=? AND owner_id=?', id, owner);
    });
  }
  readSignedImage(id: string, query: unknown) {
    const input = parse(z.object({ expires: z.coerce.number().int().positive(), signature: z.string().regex(/^[a-f0-9]{64}$/) }), query);
    if (input.expires <= Math.floor(Date.now() / 1000) || !matches(input.signature, sign(this.config.AUTH_SECRET, `image:${id}:${input.expires}`))) {
      throw new HttpError(403, 'IMAGE_URL_EXPIRED', '이미지 주소가 만료되었습니다. 자료를 다시 불러와 주세요.');
    }
    const image = required(this.store.one<ImageRow>('SELECT * FROM images WHERE id=?', id));
    return { stream: createReadStream(join(this.config.DATA_DIR, 'uploads', image.filename)), mime: image.mime };
  }
}

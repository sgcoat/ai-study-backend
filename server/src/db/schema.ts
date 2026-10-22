export const schema = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, resend_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS materials_owner ON materials(owner_id, created_at DESC);
CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
  owner_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS summaries (id TEXT PRIMARY KEY, material_id TEXT NOT NULL UNIQUE REFERENCES materials(id),
  owner_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS question_sets (id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
  owner_id TEXT NOT NULL REFERENCES users(id), fingerprint TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, set_id TEXT REFERENCES question_sets(id),
  owner_id TEXT NOT NULL REFERENCES users(id), material_id TEXT NOT NULL REFERENCES materials(id), payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  material_id TEXT NOT NULL REFERENCES materials(id), kind TEXT NOT NULL CHECK(kind IN ('SUMMARY', 'QUESTIONS')),
  fingerprint TEXT NOT NULL, config_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('QUEUED','PROCESSING','COMPLETED','FAILED')),
  result_json TEXT, error_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active ON jobs(fingerprint) WHERE status IN ('QUEUED','PROCESSING');
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_complete ON jobs(fingerprint) WHERE status='COMPLETED';
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, created_at);
CREATE TABLE IF NOT EXISTS idempotency (user_id TEXT NOT NULL REFERENCES users(id), operation TEXT NOT NULL,
  request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, resource_id TEXT NOT NULL,
  PRIMARY KEY(user_id, operation, request_key));
CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL REFERENCES questions(id), request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PROCESSING','COMPLETED','FAILED')), result_json TEXT, solved_time TEXT,
  UNIQUE(user_id, request_key));
CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id, solved_time DESC);
CREATE TABLE IF NOT EXISTS deletion_codes (user_id TEXT PRIMARY KEY REFERENCES users(id), code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, resend_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS email_counters (bucket TEXT NOT NULL, identity TEXT NOT NULL, total INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, PRIMARY KEY(bucket, identity));
CREATE INDEX IF NOT EXISTS email_counters_expiry ON email_counters(expires_at);
CREATE TABLE IF NOT EXISTS file_deletions (filename TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
`;

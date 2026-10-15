import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Versioned migrations. NEVER edit a released migration; append a new one.
 * Privacy: no column holds prompt/output/task text or absolute paths. Source
 * files are stored relative to the (internal) source root.
 */
export type Migration = string | ((db: DatabaseSync) => void);

/**
 * Storage notes (privacy minimization):
 * - `source_files.rel_path` is the path relative to the source root. Claude Code encodes the project cwd into the
 *   first folder name, so rel_path can still reveal the encoded cwd. It is required to re-stat known files (watcher)
 *   and is never returned by any API, export, log or diagnostic.
 * - `source_files.project_dir` holds sha256(encoded project folder name) since migration 3, not the folder name.
 */
export const MIGRATIONS: readonly Migration[] = [
  `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE source_files (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('main','agent')),
  rel_path TEXT NOT NULL,
  project_dir TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  dev INTEGER,
  ino INTEGER,
  size INTEGER NOT NULL DEFAULT 0,
  mtime_ms REAL NOT NULL DEFAULT 0,
  cursor_offset INTEGER NOT NULL DEFAULT 0,
  present INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER,
  cwd_hash TEXT,
  cwd_label TEXT,
  first_ms INTEGER,
  last_ms INTEGER
);
CREATE INDEX idx_source_files_session ON source_files(session_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  short_code TEXT NOT NULL,
  alias TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  first_ms INTEGER,
  last_ms INTEGER,
  present INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_sessions_project ON sessions(project_id);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  source_file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  project_id TEXT,
  parent_agent_id TEXT,
  role TEXT,
  depth INTEGER,
  confidence TEXT NOT NULL DEFAULT 'unknown',
  reason TEXT NOT NULL DEFAULT 'not_linked_yet',
  first_ms INTEGER,
  last_ms INTEGER,
  meta_tool_use_id TEXT,
  meta_role TEXT,
  meta_depth INTEGER,
  present INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_agents_session ON agents(session_id);
CREATE INDEX idx_agents_parent ON agents(parent_agent_id);

CREATE TABLE task_refs (
  tool_use_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  parent_agent_id TEXT,
  tool_name TEXT NOT NULL,
  role TEXT,
  PRIMARY KEY (session_id, tool_use_id)
);

CREATE TABLE requests (
  dedupe_key TEXT PRIMARY KEY,
  dedupe_quality TEXT NOT NULL,
  source_file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  project_id TEXT,
  model TEXT,
  ts_ms INTEGER,
  ts_derived INTEGER NOT NULL DEFAULT 0,
  first_seen_ms INTEGER,
  uncached_input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write_5m INTEGER NOT NULL,
  cache_write_1h INTEGER NOT NULL,
  unsplit_cache_write INTEGER NOT NULL,
  snapshot_count INTEGER NOT NULL DEFAULT 1,
  stop_reason TEXT,
  micro_usd INTEGER,
  price_quality TEXT NOT NULL DEFAULT 'unpriced',
  rate_model_id TEXT,
  rate_version TEXT,
  source_present INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_requests_ts ON requests(ts_ms);
CREATE INDEX idx_requests_project_ts ON requests(project_id, ts_ms);
CREATE INDEX idx_requests_session ON requests(session_id);
CREATE INDEX idx_requests_agent ON requests(agent_id);
CREATE INDEX idx_requests_model ON requests(model);
CREATE INDEX idx_requests_file ON requests(source_file_id);

CREATE TABLE parse_warnings (
  source_file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (source_file_id, code)
);
`,
  // v2: maintained 15-minute rollup of requests (+ dirty-bucket tracking by triggers) and a source head fingerprint
  // (used to confirm a rename/move by inode before remapping a vanished file to its new path).
  `
CREATE TABLE request_buckets (
  bucket INTEGER NOT NULL,
  project_id TEXT,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  model TEXT,
  n INTEGER NOT NULL,
  ui INTEGER NOT NULL, o INTEGER NOT NULL, cr INTEGER NOT NULL, c5 INTEGER NOT NULL, c1 INTEGER NOT NULL, us INTEGER NOT NULL,
  usd INTEGER NOT NULL,
  unpriced INTEGER NOT NULL,
  fb INTEGER NOT NULL,
  unpriced_tok INTEGER NOT NULL,
  pui INTEGER NOT NULL, po INTEGER NOT NULL, pcr INTEGER NOT NULL, pc5 INTEGER NOT NULL, pc1 INTEGER NOT NULL, pus INTEGER NOT NULL,
  arch INTEGER NOT NULL,
  tmin INTEGER NOT NULL,
  tmax INTEGER NOT NULL
);
CREATE INDEX idx_rb_bucket ON request_buckets(bucket);
CREATE INDEX idx_rb_project ON request_buckets(project_id, bucket);

-- Buckets whose request rows changed since the last rollup refresh. Readers use the rollup only when this is empty.
CREATE TABLE dirty_buckets (bucket INTEGER PRIMARY KEY);

ALTER TABLE source_files ADD COLUMN head_len INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_files ADD COLUMN head_hash TEXT;

INSERT INTO request_buckets
SELECT ts_ms / 900000, project_id, session_id, agent_id, model, COUNT(*),
  SUM(uncached_input), SUM(output), SUM(cache_read), SUM(cache_write_5m), SUM(cache_write_1h), SUM(unsplit_cache_write),
  SUM(COALESCE(micro_usd, 0)),
  SUM(micro_usd IS NULL),
  SUM(price_quality = 'estimated_fallback'),
  SUM(CASE WHEN micro_usd IS NULL THEN uncached_input + output + cache_read + cache_write_5m + cache_write_1h + unsplit_cache_write ELSE 0 END),
  SUM(CASE WHEN micro_usd IS NULL THEN 0 ELSE uncached_input END),
  SUM(CASE WHEN micro_usd IS NULL THEN 0 ELSE output END),
  SUM(CASE WHEN micro_usd IS NULL THEN 0 ELSE cache_read END),
  SUM(CASE WHEN micro_usd IS NULL THEN 0 ELSE cache_write_5m END),
  SUM(CASE WHEN micro_usd IS NULL THEN 0 ELSE cache_write_1h END),
  SUM(CASE WHEN micro_usd IS NULL THEN 0 ELSE unsplit_cache_write END),
  SUM(source_present = 0),
  MIN(ts_ms), MAX(ts_ms)
FROM requests WHERE ts_ms IS NOT NULL
GROUP BY ts_ms / 900000, project_id, session_id, agent_id, model;

-- (ON CONFLICT DO NOTHING, not OR IGNORE: an outer upsert's conflict policy would override OR IGNORE.)
-- Every row mutation (including FK cascades, derived-project updates and re-pricing) marks its old and new bucket.
CREATE TRIGGER trg_requests_ai AFTER INSERT ON requests BEGIN
  INSERT INTO dirty_buckets SELECT NEW.ts_ms / 900000 WHERE NEW.ts_ms IS NOT NULL ON CONFLICT(bucket) DO NOTHING;
END;
CREATE TRIGGER trg_requests_ad AFTER DELETE ON requests BEGIN
  INSERT INTO dirty_buckets SELECT OLD.ts_ms / 900000 WHERE OLD.ts_ms IS NOT NULL ON CONFLICT(bucket) DO NOTHING;
END;
CREATE TRIGGER trg_requests_au AFTER UPDATE OF ts_ms, project_id, session_id, agent_id, model, uncached_input, output,
  cache_read, cache_write_5m, cache_write_1h, unsplit_cache_write, micro_usd, price_quality, source_present ON requests BEGIN
  INSERT INTO dirty_buckets SELECT OLD.ts_ms / 900000 WHERE OLD.ts_ms IS NOT NULL ON CONFLICT(bucket) DO NOTHING;
  INSERT INTO dirty_buckets SELECT NEW.ts_ms / 900000 WHERE NEW.ts_ms IS NOT NULL ON CONFLICT(bucket) DO NOTHING;
END;
`,
  // v3 (security F-07): replace the encoded project folder name (an encoded absolute cwd) with its sha256.
  (db) => {
    const rows = db.prepare('SELECT DISTINCT project_dir AS d FROM source_files').all() as { d: string }[];
    const upd = db.prepare('UPDATE source_files SET project_dir = ? WHERE project_dir = ?');
    for (const { d } of rows) {
      if (/^[0-9a-f]{64}$/.test(d)) continue;
      upd.run(createHash('sha256').update(d).digest('hex'), d);
    }
  },
];

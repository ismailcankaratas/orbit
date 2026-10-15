import { chmodSync, existsSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { suppressSqliteExperimentalWarning } from '../config/warnings.js';
import { MIGRATIONS } from './migrations.js';
import { refreshRollup } from './rollup.js';

type SqlValue = string | number | bigint | null | Uint8Array;

let DatabaseSyncCtor: typeof DatabaseSync | null = null;
function ctor(): typeof DatabaseSync {
  if (!DatabaseSyncCtor) {
    suppressSqliteExperimentalWarning();
    const require = createRequire(import.meta.url);
    DatabaseSyncCtor = (require('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;
  }
  return DatabaseSyncCtor;
}

export type StoreKind = 'real' | 'demo';

/** A single Orbit SQLite database (real or demo). Synchronous API; one connection. */
export class Store {
  readonly db: DatabaseSync;
  readonly file: string;
  private readonly cache = new Map<string, StatementSync>();
  private inTx = false;

  constructor(
    readonly kind: StoreKind,
    dataDir: string,
  ) {
    this.file = join(dataDir, kind === 'real' ? 'orbit.sqlite' : 'demo.sqlite');
    const Ctor = ctor();
    this.db = new Ctor(this.file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;');
    this.migrate();
    refreshRollup(this); // heals a rollup left dirty by a crash
    this.chmodFiles();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null } | undefined;
    let current = row?.v ?? 0;
    while (current < MIGRATIONS.length) {
      const step = MIGRATIONS[current] as string | ((db: DatabaseSync) => void);
      this.db.exec('BEGIN');
      try {
        if (typeof step === 'string') this.db.exec(step);
        else step(this.db);
        this.db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(current + 1);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
      current += 1;
    }
  }

  get schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
    return row.v ?? 0;
  }

  chmodFiles(): void {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = this.file + suffix;
      try {
        if (existsSync(f)) chmodSync(f, 0o600);
      } catch {
        /* best effort */
      }
    }
  }

  sizeBytes(): number {
    let n = 0;
    for (const suffix of ['', '-wal']) {
      try {
        n += statSync(this.file + suffix).size;
      } catch {
        /* missing */
      }
    }
    return n;
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SqlValue[]): number {
    return Number(this.stmt(sql).run(...params).changes);
  }

  iterate<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): IterableIterator<T> {
    return this.stmt(sql).iterate(...params) as IterableIterator<T>;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.db.exec('BEGIN');
    this.inTx = true;
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.inTx = false;
    }
  }

  getMeta(key: string): string | null {
    return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  /** Remove all ingested data (keeps schema + schema_version). */
  clearData(): void {
    this.tx(() => {
      for (const t of ['requests', 'request_buckets', 'dirty_buckets', 'parse_warnings', 'task_refs', 'agents', 'source_files', 'sessions', 'projects', 'meta']) {
        this.exec(`DELETE FROM ${t}`);
      }
    });
  }

  close(): void {
    this.cache.clear();
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }

  /** Close and delete the database files. */
  destroy(): void {
    this.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(this.file + suffix, { force: true });
  }
}

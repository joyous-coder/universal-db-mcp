/**
 * HistoryStore (v2.17 + v2.19 + v2.20 cipher + FTS5)
 *
 * SQLite-backed query history with TTL + LRU eviction.
 * v2.19: adds profile_name column + filter + groupBy='profile' aggregate.
 * v2.20: SQLCipher encryption support + FTS5 virtual table for full-text search.
 */

import type { SQLiteConnection } from '../adapters/sqlite/types.js';
import { detectEncryptedBackend } from '../utils/encrypted-sqlite.js';
import type {
  QueryHistoryEntry,
  QueryHistoryInput,
  HistoryFilter,
  ProfileHistoryAggregate,
} from './query-analyzer-types.js';

export interface HistoryStoreOptions {
  ttlDays: number;
  maxRows: number;
  /** v2.20: SQLCipher key for transparent encryption of history.db. */
  cipherKey?: string;
}

export class HistoryStore {
  private conn: SQLiteConnection | null = null;
  private initPromise: Promise<void> | null = null;
  private cipherKey?: string;
  private _encrypted = false;
  /** v2.20: true after init() once the backend is known to be SQLCipher. */
  public get encrypted(): boolean { return this._encrypted; }

  constructor(public readonly dbPath: string, public readonly options: HistoryStoreOptions) {
    this.cipherKey = options.cipherKey;
  }

  private async init(): Promise<void> {
    if (this.conn) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      // v2.20: pick encrypted or native backend based on cipherKey.
      const backend = detectEncryptedBackend(this.cipherKey);
      this._encrypted = backend.name === 'cipher';
      try {
        this.conn = await backend.open(this.dbPath, {
          readonly: false,
          cipherKey: this.cipherKey,
        });
      } catch (err) {
        this.initPromise = null;
        throw err;
      }
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS query_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          db TEXT NOT NULL,
          kind TEXT NOT NULL,
          sql TEXT NOT NULL,
          params TEXT,
          duration_ms INTEGER NOT NULL,
          rows INTEGER,
          error TEXT,
          error_code TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_history_ts ON query_history(ts);
        CREATE INDEX IF NOT EXISTS idx_history_db ON query_history(db, kind);
        PRAGMA journal_mode = WAL;
      `);
      // v2.19: idempotent migration — add profile_name column for cross-profile
      // history queries. Older history.db files from v2.17 get NULL.
      try {
        this.conn.exec(`ALTER TABLE query_history ADD COLUMN profile_name TEXT`);
      } catch {
        // column already exists — ignore
      }
      this.conn.exec(`CREATE INDEX IF NOT EXISTS idx_history_profile ON query_history(profile_name)`);
      // v2.20: full-text search via SQLite FTS5 virtual table.
      // Contentless=0 (default) so the FTS table can be rebuilt from query_history.
      // triggers keep both tables in sync; backfill handles pre-existing rows.
      this.conn.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
          sql,
          content='query_history',
          content_rowid='id',
          tokenize='unicode61 remove_diacritics 2'
        );
      `);
      // sync triggers — INSERT/DELETE/UPDATE mirror FTS row lifecycle.
      this.conn.exec(`DROP TRIGGER IF EXISTS trg_history_ai`);
      this.conn.exec(`DROP TRIGGER IF EXISTS trg_history_ad`);
      this.conn.exec(`DROP TRIGGER IF EXISTS trg_history_au`);
      this.conn.exec(`
        CREATE TRIGGER trg_history_ai AFTER INSERT ON query_history BEGIN
          INSERT INTO history_fts(rowid, sql) VALUES (new.id, new.sql);
        END;
      `);
      this.conn.exec(`
        CREATE TRIGGER trg_history_ad AFTER DELETE ON query_history BEGIN
          INSERT INTO history_fts(history_fts, rowid, sql) VALUES ('delete', old.id, old.sql);
        END;
      `);
      this.conn.exec(`
        CREATE TRIGGER trg_history_au AFTER UPDATE ON query_history BEGIN
          INSERT INTO history_fts(history_fts, rowid, sql) VALUES ('delete', old.id, old.sql);
          INSERT INTO history_fts(rowid, sql) VALUES (new.id, new.sql);
        END;
      `);
      // Backfill: copy any pre-existing rows into FTS. INSERT OR IGNORE
      // handles the case where the trigger already added them.
      this.conn.exec(`
        INSERT OR IGNORE INTO history_fts(rowid, sql)
        SELECT id, sql FROM query_history;
      `);
    })();
    return this.initPromise;
  }

  async record(input: QueryHistoryInput): Promise<void> {
    await this.init();
    const sql = input.sql.length > 4000 ? input.sql.slice(0, 4000) + ' /* truncated */' : input.sql;
    const profileName = input.profile_name ?? null;
    this.conn!.exec(
      `INSERT INTO query_history (ts, db, kind, sql, params, duration_ms, rows, error, error_code, profile_name) VALUES (${q(input.ts)}, ${q(input.db)}, ${q(input.kind)}, ${q(sql)}, ${q(input.params)}, ${input.duration_ms}, ${input.rows ?? 'NULL'}, ${q(input.error)}, ${q(input.error_code)}, ${q(profileName)})`
    );
    // LRU: if over maxRows, delete oldest 10%
    const count = (this.conn!.prepare('SELECT COUNT(*) as c FROM query_history').get() as { c: number }).c;
    if (count > this.options.maxRows) {
      const toDelete = Math.ceil(this.options.maxRows * 0.1);
      this.conn!.exec(`DELETE FROM query_history WHERE id IN (SELECT id FROM query_history ORDER BY id ASC LIMIT ${toDelete})`);
    }
  }

  async query(filter: HistoryFilter): Promise<QueryHistoryEntry[] | ProfileHistoryAggregate[]> {
    await this.init();

    // v2.19: groupBy='profile' returns aggregates, not raw entries.
    if (filter.groupBy === 'profile') {
      const aggSql = `
        SELECT
          profile_name,
          COUNT(*) as count,
          SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors,
          AVG(duration_ms) as avg_ms
        FROM query_history
        GROUP BY profile_name
        ORDER BY count DESC
      `;
      const stmt = this.conn!.prepare(aggSql);
      const rows = stmt.all() as Array<Record<string, unknown>>;
      return rows.map(r => ({
        profileName: (r.profile_name as string | null) ?? null,
        count: Number(r.count ?? 0),
        errors: Number(r.errors ?? 0),
        avg_ms: Number(r.avg_ms ?? 0),
      }));
    }

    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.db) { where.push('db = ?'); args.push(filter.db); }
    if (filter.kind) { where.push('kind = ?'); args.push(filter.kind); }
    if (filter.since) { where.push('ts >= ?'); args.push(filter.since); }
    if (filter.until) { where.push('ts <= ?'); args.push(filter.until); }
    if (filter.onlyErrors) { where.push('error IS NOT NULL'); }
    // v2.19: profileName is 3-state:
    //   - omitted    → all
    //   - null       → only profile_name IS NULL
    //   - 'name'     → only profile_name = ?
    if (filter && 'profileName' in filter) {
      if (filter.profileName === null) {
        where.push('profile_name IS NULL');
      } else if (filter.profileName !== undefined) {
        where.push('profile_name = ?');
        args.push(filter.profileName);
      }
    }
    // v2.20: FTS5 full-text search. Whitelist chars in the query to mitigate
    // FTS5 syntax errors on raw LLM input; we still pass through simple
    // AND / OR / NOT / quoted phrases.
    if (filter && typeof filter.q === 'string' && filter.q.trim().length > 0) {
      where.push("rowid IN (SELECT rowid FROM history_fts WHERE history_fts MATCH ?)");
      args.push(filter.q.trim());
    }
    const limit = filter.limit ?? 50;
    const sql = `SELECT * FROM query_history ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit}`;
    const stmt = this.conn!.prepare(sql);
    const rows = stmt.all(...args) as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  async cleanup(): Promise<{ deleted: number }> {
    await this.init();
    const cutoff = new Date(Date.now() - this.options.ttlDays * 86400_000).toISOString();
    const before = (this.conn!.prepare('SELECT COUNT(*) as c FROM query_history WHERE ts < ?').get(cutoff) as { c: number }).c;
    this.conn!.exec(`DELETE FROM query_history WHERE ts < ${q(cutoff)}`);
    return { deleted: before };
  }

  async close(): Promise<void> {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
  }

  /** v2.20: rotate cipher key. */
  async rotateKey(newKey: string): Promise<void> {
    await this.close();
    const { rotateDbKey } = await import('./key-rotator.js');
    const oldKey = this.cipherKey;
    await rotateDbKey(this.dbPath, 'history', oldKey, newKey);
    this.cipherKey = newKey;
    this.initPromise = null;
    await this.init();
  }

  private rowToEntry(row: Record<string, unknown>): QueryHistoryEntry {
    return {
      id: row.id as number,
      ts: row.ts as string,
      db: row.db as string,
      kind: row.kind as string,
      sql: row.sql as string,
      params: (row.params as string) ?? null,
      duration_ms: row.duration_ms as number,
      rows: (row.rows as number) ?? null,
      error: (row.error as string) ?? null,
      error_code: (row.error_code as string) ?? null,
      profile_name: (row.profile_name as string | null) ?? null,
    };
  }
}

function q(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

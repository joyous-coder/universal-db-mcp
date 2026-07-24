/**
 * HistoryStore (v2.17)
 *
 * SQLite-backed query history with TTL + LRU eviction.
 * Uses v2.16 multi-backend SQLite.
 */

import { detectSqliteBackend } from '../adapters/sqlite/types.js';
import type { SQLiteConnection } from '../adapters/sqlite/types.js';
import type { QueryHistoryEntry, QueryHistoryInput, HistoryFilter } from './query-analyzer-types.js';

export interface HistoryStoreOptions {
  ttlDays: number;
  maxRows: number;
}

export class HistoryStore {
  private conn: SQLiteConnection | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(public readonly dbPath: string, public readonly options: HistoryStoreOptions) {}

  private async init(): Promise<void> {
    if (this.conn) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const backend = await detectSqliteBackend();
      this.conn = await backend.open(this.dbPath, { readonly: false });
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
    })();
    return this.initPromise;
  }

  async record(input: QueryHistoryInput): Promise<void> {
    await this.init();
    const sql = input.sql.length > 4000 ? input.sql.slice(0, 4000) + ' /* truncated */' : input.sql;
    this.conn!.exec(
      `INSERT INTO query_history (ts, db, kind, sql, params, duration_ms, rows, error, error_code) VALUES (${q(input.ts)}, ${q(input.db)}, ${q(input.kind)}, ${q(sql)}, ${q(input.params)}, ${input.duration_ms}, ${input.rows ?? 'NULL'}, ${q(input.error)}, ${q(input.error_code)})`
    );
    // LRU: if over maxRows, delete oldest 10%
    const count = (this.conn!.prepare('SELECT COUNT(*) as c FROM query_history').get() as { c: number }).c;
    if (count > this.options.maxRows) {
      const toDelete = Math.ceil(this.options.maxRows * 0.1);
      this.conn!.exec(`DELETE FROM query_history WHERE id IN (SELECT id FROM query_history ORDER BY id ASC LIMIT ${toDelete})`);
    }
  }

  async query(filter: HistoryFilter): Promise<QueryHistoryEntry[]> {
    await this.init();
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.db) { where.push('db = ?'); args.push(filter.db); }
    if (filter.kind) { where.push('kind = ?'); args.push(filter.kind); }
    if (filter.since) { where.push('ts >= ?'); args.push(filter.since); }
    if (filter.until) { where.push('ts <= ?'); args.push(filter.until); }
    if (filter.onlyErrors) { where.push('error IS NOT NULL'); }
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
    };
  }
}

function q(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

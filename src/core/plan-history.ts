/**
 * PlanHistory (v3.1)
 *
 * SQLite-backed store for EXPLAIN plan snapshots. Independent file
 * (plan_history.db) so it doesn't bloat v2.17 query_history.
 */

import { detectSqliteBackend } from '../adapters/sqlite/types.js';
import type { SQLiteConnection } from '../adapters/sqlite/types.js';

export interface PlanHistoryEntry {
  id?: number;
  queryHash: string;
  sqlTemplate: string;
  sqlOriginal: string;
  planJson: string;
  dbType: string;
  profileName: string | null;
  capturedAt: string;
  durationMs: number;
}

export interface PlanHistoryOptions {
  dbPath: string;
}

export class PlanHistory {
  private conn: SQLiteConnection | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(public readonly options: PlanHistoryOptions) {}

  private async init(): Promise<void> {
    if (this.conn) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const backend = await detectSqliteBackend();
      this.conn = await backend.open(this.options.dbPath, { readonly: false });
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS plan_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query_hash TEXT NOT NULL,
          sql_template TEXT NOT NULL,
          sql_original TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          db_type TEXT NOT NULL,
          profile_name TEXT,
          captured_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_plan_query_hash ON plan_history(query_hash);
        CREATE INDEX IF NOT EXISTS idx_plan_captured_at ON plan_history(captured_at);
      `);
    })();
    return this.initPromise;
  }

  /** Persist one EXPLAIN snapshot. */
  async capture(entry: PlanHistoryEntry): Promise<void> {
    await this.init();
    this.conn!.exec(
      `INSERT INTO plan_history (query_hash, sql_template, sql_original, plan_json, db_type, profile_name, captured_at, duration_ms)
       VALUES (${q(entry.queryHash)}, ${q(entry.sqlTemplate)}, ${q(entry.sqlOriginal)}, ${q(entry.planJson)}, ${q(entry.dbType)}, ${q(entry.profileName)}, ${q(entry.capturedAt)}, ${entry.durationMs})`
    );
  }

  /** All snapshots for one normalized query hash (oldest → newest). */
  async getByHash(queryHash: string): Promise<PlanHistoryEntry[]> {
    await this.init();
    const stmt = this.conn!.prepare(
      `SELECT * FROM plan_history WHERE query_hash = ${q(queryHash)} ORDER BY captured_at ASC`
    );
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  /** Last N entries (by capture time). */
  async list(limit: number = 50): Promise<PlanHistoryEntry[]> {
    await this.init();
    const stmt = this.conn!.prepare(
      `SELECT * FROM plan_history ORDER BY captured_at DESC LIMIT ${limit}`
    );
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  /** Close file handle (call before process exit). */
  async close(): Promise<void> {
    if (this.conn) { this.conn.close(); this.conn = null; }
  }

  private rowToEntry(row: Record<string, unknown>): PlanHistoryEntry {
    return {
      id: row.id as number,
      queryHash: row.query_hash as string,
      sqlTemplate: row.sql_template as string,
      sqlOriginal: row.sql_original as string,
      planJson: row.plan_json as string,
      dbType: row.db_type as string,
      profileName: (row.profile_name as string | null) ?? null,
      capturedAt: row.captured_at as string,
      durationMs: row.duration_ms as number,
    };
  }
}

function q(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * TemplateStore (v2.17)
 *
 * SQLite-backed CRUD for parameterized SQL templates.
 * Uses v2.16 multi-backend SQLite (node:sqlite or better-sqlite3).
 */

import { nanoid } from 'nanoid';
import { detectSqliteBackend } from '../adapters/sqlite/types.js';
import type { SQLiteConnection } from '../adapters/sqlite/types.js';
import type { Template, TemplateInput, TemplateParam } from './query-analyzer-types.js';

export class TemplateStore {
  private conn: SQLiteConnection | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(public readonly dbPath: string) {}

  private async init(): Promise<void> {
    if (this.conn) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const backend = await detectSqliteBackend();
      this.conn = await backend.open(this.dbPath, { readonly: false });
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          sql TEXT NOT NULL,
          parameters_json TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          use_count INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name);
      `);
    })();
    return this.initPromise;
  }

  async save(input: TemplateInput, createdBy = 'cli'): Promise<Template> {
    await this.init();
    const now = new Date().toISOString();
    const id = nanoid(8);
    this.conn!.exec(
      `INSERT INTO templates (id, name, description, sql, parameters_json, tags_json, created_at, updated_at, created_by, use_count) VALUES (${q(id)}, ${q(input.name)}, ${q(input.description)}, ${q(input.sql)}, ${q(JSON.stringify(input.parameters))}, ${q(JSON.stringify(input.tags ?? []))}, ${q(now)}, ${q(now)}, ${q(createdBy)}, 0)`
    );
    return {
      id,
      name: input.name,
      description: input.description,
      sql: input.sql,
      parameters: input.parameters as TemplateParam[],
      tags: input.tags ?? [],
      created_at: now,
      updated_at: now,
      created_by: createdBy,
      use_count: 0,
    };
  }

  async list(filter?: { tag?: string }): Promise<Template[]> {
    await this.init();
    const rows = filter?.tag
      ? this.queryAll(`SELECT * FROM templates WHERE tags_json LIKE ${q('%' + filter.tag + '%')}`)
      : this.queryAll(`SELECT * FROM templates ORDER BY updated_at DESC`);
    return rows.map(this.rowToTemplate);
  }

  async get(id: string): Promise<Template | null> {
    await this.init();
    const rows = this.queryAll(`SELECT * FROM templates WHERE id = ${q(id)}`);
    return rows.length ? this.rowToTemplate(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    await this.init();
    const before = this.queryAll(`SELECT id FROM templates WHERE id = ${q(id)}`);
    this.conn!.exec(`DELETE FROM templates WHERE id = ${q(id)}`);
    return before.length > 0;
  }

  async incrementUseCount(id: string): Promise<void> {
    await this.init();
    this.conn!.exec(`UPDATE templates SET use_count = use_count + 1 WHERE id = ${q(id)}`);
  }

  async close(): Promise<void> {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
  }

  private queryAll(sql: string): Array<Record<string, unknown>> {
    const stmt = this.conn!.prepare(sql);
    return stmt.all() as Array<Record<string, unknown>>;
  }

  private rowToTemplate(row: Record<string, unknown>): Template {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? '',
      sql: row.sql as string,
      parameters: JSON.parse(row.parameters_json as string),
      tags: JSON.parse(row.tags_json as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      created_by: row.created_by as string,
      use_count: row.use_count as number,
    };
  }
}

function q(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

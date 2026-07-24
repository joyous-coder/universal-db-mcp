/**
 * TemplateStore (v2.17 + v2.19 + v2.20 cipher)
 *
 * SQLite-backed CRUD for parameterized SQL templates.
 * Uses v2.16 multi-backend SQLite, transparently switching to SQLCipher
 * when a non-empty cipherKey is provided (v2.20).
 */

import { nanoid } from 'nanoid';
import type { SQLiteConnection } from '../adapters/sqlite/types.js';
import { detectEncryptedBackend } from '../utils/encrypted-sqlite.js';
import type { Template, TemplateInput, TemplateParam } from './query-analyzer-types.js';

export interface TemplateStoreOptions {
  /**
   * v2.20: SQLCipher key for transparent encryption of templates.db.
   * Undefined/empty → plaintext (v2.17-v2.19 behavior).
   */
  cipherKey?: string;
}

export class TemplateStore {
  private conn: SQLiteConnection | null = null;
  private initPromise: Promise<void> | null = null;
  private cipherKey?: string;
  private _encrypted = false;
  /** v2.20: true after init() once the backend is known to be SQLCipher. */
  public get encrypted(): boolean { return this._encrypted; }

  constructor(public readonly dbPath: string, options?: TemplateStoreOptions) {
    this.cipherKey = options?.cipherKey;
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
      // v2.19: idempotent migration — add profile_name column for cross-profile
      // template filtering. Older templates.db files from v2.17 auto-get NULL.
      try {
        this.conn.exec(`ALTER TABLE templates ADD COLUMN profile_name TEXT`);
      } catch {
        // column already exists — ignore
      }
      this.conn.exec(`CREATE INDEX IF NOT EXISTS idx_templates_profile ON templates(profile_name)`);
    })();
    return this.initPromise;
  }

  async save(input: TemplateInput, createdBy = 'cli'): Promise<Template> {
    await this.init();
    const now = new Date().toISOString();
    const id = nanoid(8);
    const profileName = input.profile_name ?? null;
    this.conn!.exec(
      `INSERT INTO templates (id, name, description, sql, parameters_json, tags_json, created_at, updated_at, created_by, use_count, profile_name) VALUES (${q(id)}, ${q(input.name)}, ${q(input.description)}, ${q(input.sql)}, ${q(JSON.stringify(input.parameters))}, ${q(JSON.stringify(input.tags ?? []))}, ${q(now)}, ${q(now)}, ${q(createdBy)}, 0, ${q(profileName)})`
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
      profile_name: profileName,
    };
  }

  async list(filter?: { tag?: string; profileName?: string | null }): Promise<Template[]> {
    await this.init();
    const where: string[] = [];
    if (filter?.tag) { where.push(`tags_json LIKE ${q('%' + filter.tag + '%')}`); }
    // v2.19: profileName has three states:
    //   - omitted    → all templates (backward compat)
    //   - null       → only global templates (profile_name IS NULL)
    //   - 'name'     → only that profile's templates
    if (filter && 'profileName' in filter) {
      if (filter.profileName === null) {
        where.push('profile_name IS NULL');
      } else if (filter.profileName !== undefined) {
        where.push(`profile_name = ${q(filter.profileName)}`);
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.queryAll(`SELECT * FROM templates ${whereSql} ORDER BY updated_at DESC`);
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

  /** v2.20: rotate cipher key. */
  async rotateKey(newKey: string): Promise<void> {
    await this.close();
    const { rotateDbKey } = await import('./key-rotator.js');
    const oldKey = this.cipherKey;
    await rotateDbKey(this.dbPath, 'templates', oldKey, newKey);
    this.cipherKey = newKey;
    this.initPromise = null;
    await this.init();
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
      profile_name: (row.profile_name as string | null) ?? null,
    };
  }
}

function q(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

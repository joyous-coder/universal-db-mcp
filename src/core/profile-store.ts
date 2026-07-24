/**
 * ProfileStore (v2.18)
 *
 * SQLite-backed CRUD for profile definitions. Uses v2.16 multi-backend SQLite.
 */

import { nanoid } from 'nanoid';
import { detectSqliteBackend } from '../adapters/sqlite/types.js';
import type { SQLiteConnection } from '../adapters/sqlite/types.js';
import type { Profile, ProfileInput, ProfileRole } from './profile-manager.js';

export class ProfileStore {
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
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          type TEXT NOT NULL,
          config_json TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'primary',
          tags_json TEXT NOT NULL DEFAULT '[]',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          use_count INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);
        CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
        CREATE INDEX IF NOT EXISTS idx_profiles_tags ON profiles(tags_json);
      `);
    })();
    return this.initPromise;
  }

  async save(input: ProfileInput, createdBy = 'cli'): Promise<Profile> {
    await this.init();
    const now = new Date().toISOString();
    const id = nanoid(8);
    const role: ProfileRole = input.role ?? 'primary';
    const enabled = input.enabled ?? true;
    this.conn!.exec(
      `INSERT INTO profiles (id, name, description, type, config_json, role, tags_json, enabled, created_at, updated_at, created_by, use_count) VALUES (${q(id)}, ${q(input.name)}, ${q(input.description)}, ${q(input.type)}, ${q(JSON.stringify(input.config))}, ${q(role)}, ${q(JSON.stringify(input.tags ?? []))}, ${enabled ? 1 : 0}, ${q(now)}, ${q(now)}, ${q(createdBy)}, 0)`
    );
    return {
      id, name: input.name, description: input.description, type: input.type,
      config: input.config, role, tags: input.tags ?? [], enabled,
      created_at: now, updated_at: now, created_by: createdBy, use_count: 0,
    };
  }

  async list(filter?: { role?: string; tag?: string; enabled?: boolean }): Promise<Profile[]> {
    await this.init();
    const where: string[] = [];
    if (filter?.role) { where.push(`role = ${q(filter.role)}`); }
    if (filter?.tag) { where.push(`tags_json LIKE ${q('%' + filter.tag + '%')}`); }
    if (filter?.enabled !== undefined) { where.push(`enabled = ${filter.enabled ? 1 : 0}`); }
    const sql = `SELECT * FROM profiles ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name ASC`;
    const stmt = this.conn!.prepare(sql);
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map(this.rowToProfile);
  }

  async get(name: string): Promise<Profile | null> {
    await this.init();
    const rows = this.queryAll(`SELECT * FROM profiles WHERE name = ${q(name)}`);
    return rows.length ? this.rowToProfile(rows[0]) : null;
  }

  async delete(name: string): Promise<boolean> {
    await this.init();
    const before = this.queryAll(`SELECT name FROM profiles WHERE name = ${q(name)}`);
    this.conn!.exec(`DELETE FROM profiles WHERE name = ${q(name)}`);
    return before.length > 0;
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    await this.init();
    this.conn!.exec(`UPDATE profiles SET enabled = ${enabled ? 1 : 0}, updated_at = ${q(new Date().toISOString())} WHERE name = ${q(name)}`);
  }

  async incrementUseCount(name: string): Promise<void> {
    await this.init();
    this.conn!.exec(`UPDATE profiles SET use_count = use_count + 1 WHERE name = ${q(name)}`);
  }

  async close(): Promise<void> {
    if (this.conn) { this.conn.close(); this.conn = null; }
  }

  private queryAll(sql: string): Array<Record<string, unknown>> {
    return this.conn!.prepare(sql).all() as Array<Record<string, unknown>>;
  }

  private rowToProfile(row: Record<string, unknown>): Profile {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? '',
      type: row.type as string,
      config: JSON.parse(row.config_json as string),
      role: row.role as ProfileRole,
      tags: JSON.parse(row.tags_json as string),
      enabled: (row.enabled as number) === 1,
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
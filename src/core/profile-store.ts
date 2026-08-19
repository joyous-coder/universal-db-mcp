/**
 * ProfileStore (v2.18 + v2.19 cipher support)
 *
 * SQLite-backed CRUD for profile definitions. Uses v2.16 multi-backend SQLite,
 * and transparently switches to SQLCipher when a non-empty `cipherKey` is
 * passed to the constructor (v2.19).
 */

import { nanoid } from 'nanoid';
import type { SQLiteConnection } from '../adapters/sqlite/types.js';
import { detectEncryptedBackend } from '../utils/encrypted-sqlite.js';
import type { Profile, ProfileInput, ProfileRole } from './profile-manager.js';

export interface ProfileStoreOptions {
  /**
   * v2.19: SQLCipher key for transparent encryption of the entire
   * profiles.db. Undefined/empty → plaintext (v2.18 behavior).
   * Caller is responsible for sourcing this from a safe location
   * (env var, OS keyring, etc.).
   */
  cipherKey?: string;
}

export class ProfileStore {
  private conn: SQLiteConnection | null = null;
  private initPromise: Promise<void> | null = null;
  private cipherKey?: string;
  private _encrypted = false;
  /** v2.19: true after init() once the backend is known to be SQLCipher. */
  public get encrypted(): boolean { return this._encrypted; }

  constructor(public readonly dbPath: string, options?: ProfileStoreOptions) {
    this.cipherKey = options?.cipherKey;
    if (this.cipherKey && this.cipherKey.length < 8) {
      console.warn(
        `[profile] WARNING: DB_PROFILE_ENCRYPTION_KEY is short (<8 chars). Use a stronger key.`,
      );
    }
  }

  private async init(): Promise<void> {
    if (this.conn) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      // v2.19: pick encrypted or native backend based on cipherKey.
      const backend = detectEncryptedBackend(this.cipherKey);
      this._encrypted = backend.name === 'cipher';
      try {
        this.conn = await backend.open(this.dbPath, {
          readonly: false,
          cipherKey: this.cipherKey,
        });
      } catch (err) {
        // Reset so a subsequent call can retry; surface the error.
        this.initPromise = null;
        throw err;
      }
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
          use_count INTEGER DEFAULT 0,
          -- v4.2.0 新增 (权限绑 profile + 探测元数据)
          permission_mode TEXT NOT NULL DEFAULT 'readwrite',
          category TEXT NOT NULL DEFAULT 'unknown',
          product_name TEXT,
          version TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);
        CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
        CREATE INDEX IF NOT EXISTS idx_profiles_tags ON profiles(tags_json);
      `);
      // v4.2.0 老库迁移: 添加缺失列(SQLite 不支持 IF NOT EXISTS for ADD COLUMN,靠 try/catch 吞 'duplicate column' 错误)
      const alterStmts = [
        `ALTER TABLE profiles ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'readwrite'`,
        `ALTER TABLE profiles ADD COLUMN category TEXT NOT NULL DEFAULT 'unknown'`,
        `ALTER TABLE profiles ADD COLUMN product_name TEXT`,
        `ALTER TABLE profiles ADD COLUMN version TEXT`,
      ];
      for (const stmt of alterStmts) {
        try { this.conn.exec(stmt); } catch { /* 列已存在,忽略 */ }
      }
    })();
    return this.initPromise;
  }

  async create(input: ProfileInput, createdBy = 'cli'): Promise<Profile> {
    await this.init();
    // v5.0.0: 重命名自 save()。create() 仅 INSERT,已存在同名 profile 抛 UNIQUE 约束错误。
    // 想修改现有 profile 用 update(input) — 语义清晰,不会误覆盖。
    const now = new Date().toISOString();
    const id = nanoid(8);
    const role: ProfileRole = input.role ?? 'primary';
    const enabled = input.enabled ?? true;
    this.conn!.exec(
      `INSERT INTO profiles (id, name, description, type, config_json, role, tags_json, enabled, created_at, updated_at, created_by, use_count, permission_mode, category, product_name, version)
       VALUES (${q(id)}, ${q(input.name)}, ${q(input.description)}, ${q(input.type)}, ${q(JSON.stringify(input.config))}, ${q(role)}, ${q(JSON.stringify(input.tags ?? []))}, ${enabled ? 1 : 0}, ${q(now)}, ${q(now)}, ${q(createdBy)}, 0, ${q(input.permissionMode ?? 'readwrite')}, ${q(input.category ?? 'unknown')}, ${q(input.productName ?? null)}, ${q(input.version ?? null)})`
    );
    return {
      id, name: input.name, description: input.description, type: input.type,
      config: input.config, role, tags: input.tags ?? [], enabled,
      created_at: now, updated_at: now, created_by: createdBy, use_count: 0,
      permissionMode: input.permissionMode ?? 'readwrite',
      category: input.category ?? 'unknown',
      productName: input.productName ?? null,
      version: input.version ?? null,
    };
  }

  /**
   * v5.0.0: save() is a deprecated alias for create(). Existing callers (unit tests,
   * external consumers) keep working without changes. New code should use create()
   * to make the INSERT-only semantic visible at the call site.
   */
  async save(input: ProfileInput, createdBy = 'cli'): Promise<Profile> {
    return this.create(input, createdBy);
  }

  /**
   * v5.0.0: 修改已存在的 profile(只 UPDATE,profile 名不存在则抛错)。
   * 注意:profile 名是 primary key,但通常不会改 name(改了所有引用都失效)。
   * use_count / created_at / created_by / id 不变。
   */
  async update(input: ProfileInput): Promise<Profile> {
    await this.init();
    const existing = await this.get(input.name);
    if (!existing) {
      throw new Error(`update_profile: profile '${input.name}' does not exist. Use create_profile to insert new.`);
    }
    const now = new Date().toISOString();
    const role: ProfileRole = input.role ?? existing.role;
    const enabled = input.enabled ?? existing.enabled;
    // v5.0.0 Bug N1: PATCH 语义 — 省略的 tags 保留原值,显式 tags:[] 才清空
    const tags: string[] = input.tags !== undefined ? input.tags : existing.tags;
    this.conn!.exec(
      `UPDATE profiles SET
         description = ${q(input.description)},
         type = ${q(input.type)},
         config_json = ${q(JSON.stringify(input.config))},
         role = ${q(role)},
         tags_json = ${q(JSON.stringify(tags))},
         enabled = ${enabled ? 1 : 0},
         updated_at = ${q(now)},
         permission_mode = ${q(input.permissionMode ?? existing.permissionMode)},
         category = ${q(input.category ?? existing.category)},
         product_name = ${q(input.productName ?? existing.productName)},
         version = ${q(input.version ?? existing.version)}
       WHERE name = ${q(input.name)}`
    );
    return {
      ...existing,
      description: input.description,
      type: input.type,
      config: input.config,
      role,
      tags,
      enabled,
      updated_at: now,
      permissionMode: input.permissionMode ?? existing.permissionMode,
      category: input.category ?? existing.category,
      productName: input.productName ?? existing.productName,
      version: input.version ?? existing.version,
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

  /**
   * v2.20: rotate the cipher key of profiles.db.
   * Atomically re-encrypts all rows under the new key.
   * The store's existing connection is closed before rotation and reopened
   * with `newKey` after success.
   */
  async rotateKey(newKey: string): Promise<void> {
    await this.close();
    const { rotateDbKey } = await import('./key-rotator.js');
    const oldKey = this.cipherKey;
    await rotateDbKey(this.dbPath, 'profile', oldKey, newKey);
    this.cipherKey = newKey;
    // Reset init so next call picks up new key.
    this.initPromise = null;
    await this.init();
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
      // v4.2.0 新增字段 — 老库无这些列时,rowToProfile 读出 undefined,这里给默认值
      permissionMode: (row.permission_mode as Profile['permissionMode']) ?? 'readwrite',
      category: (row.category as Profile['category']) ?? 'unknown',
      productName: (row.product_name as string | null) ?? null,
      version: (row.version as string | null) ?? null,
    };
  }
}

function q(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
/**
 * Profile types + ProfileManager (v2.18)
 *
 * Multi-DB profile management: save/list/delete profiles, runtime live connections,
 * read/write routing, global schema view.
 *
 * Implementation broken into multiple tasks:
 * - Task 2: Profile types + ProfileStore (SQLite CRUD)
 * - Task 3: QueryRouter
 * - Task 4: ProfileManager facade + LiveProfile
 * - Task 5: GlobalSchemaView
 */

import type { DbConfig } from '../types/adapter.js';
import { getProfileDbPath } from '../utils/global-paths.js';

export type ProfileRole = 'primary' | 'replica' | 'analytics';
export type ReadRouting = 'round-robin' | 'random' | 'least-loaded';
export type PermissionMode = 'safe' | 'readwrite' | 'full';
export type ProfileCategory = 'rdbms' | 'kv' | 'document' | 'columnar' | 'search' | 'unknown';

export interface Profile {
  id: string;
  name: string;
  description: string;
  type: string;
  config: DbConfig;
  role: ProfileRole;
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  use_count: number;
  // v4.2.0 新增:权限绑 profile,运行时不可覆盖
  permissionMode: PermissionMode;
  // v4.2.0 新增:adapter 分类(辅助元)
  category: ProfileCategory;
  // v4.2.0 新增:首次连接探测的产品名+版本(辅助元)
  productName: string | null;
  version: string | null;
}
export interface ProfileInput {
  name: string;
  description: string;
  type: string;
  config: DbConfig;
  role?: ProfileRole;
  tags?: string[];
  enabled?: boolean;
  // v4.2.0 新增:permissionMode 默认 'readwrite',save_profile 必填(后续 PR1 Task 1.3 在 handler 层校验)
  permissionMode?: PermissionMode;
  // v4.2.0 新增:可选分类(默认按 type 派生)
  category?: ProfileCategory;
  // v4.2.0 新增:产品名/版本(通常由 adapter 探测后回填)
  productName?: string | null;
  version?: string | null;
}

/**
 * v4.2.0:profile 命名严格约束 — 必须 /^[a-zA-Z0-9_-]+$/
 * 因为 profile 名作为子目录名(/~/.universal-db-mcp/<name>/history.db 等),
 * 不能含 `.`、空格、中文、路径分隔符等。
 */
export function isValidProfileName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

import { ProfileStore } from './profile-store.js';
import { QueryRouter } from './query-router.js';
import { createAdapter } from '../utils/adapter-factory.js';
import { DatabaseService, SchemaCacheConfig } from './database-service.js';
import type { DbAdapter, QueryResult } from '../types/adapter.js';
import type { QueryAnalyzer } from './query-analyzer.js';
import {
  ProfileSerializer,
  type ImportMode,
  type ImportResult,
} from './profile-serializer.js';

export interface ProfileManagerOptions {
  enabled: boolean;
  profilesDbPath: string;
  maxProfiles: number;
  defaultRole: ProfileRole;
  readRouting: ReadRouting;
  /** v2.19: SQLCipher key for profiles.db encryption (optional, falls back to plaintext) */
  cipherKey?: string;
  /** v2.20: rotation old key (used by KeyRotator on startup). */
  cipherKeyOld?: string;
  cacheConfig?: Partial<SchemaCacheConfig>;
}

export interface LiveProfile {
  profile: Profile;
  adapter: DbAdapter;
  service: DatabaseService;
  connectedAt: Date;
}

export class ProfileManager {
  private store: ProfileStore;
  private router: QueryRouter;
  private liveProfiles: Map<string, LiveProfile> = new Map();
  private enabled: boolean;
  private maxProfiles: number;

  /**
   * v3.2: expose the underlying ProfileStore so MCP/HTTP handlers can call
   * setEnabled() for enable_profile/disable_profile tools.
   */
  getProfileStore(): ProfileStore {
    return this.store;
  }
  private defaultRole: ProfileRole;
  private readRouting: ReadRouting;
  /** v2.19: cipher key for ProfileStore (Task 3 wires it through). */
  public readonly cipherKey?: string;
  private lruOrder: string[] = [];
  private cacheConfig?: Partial<SchemaCacheConfig>;
  /** v2.19: optional QueryAnalyzer for routeQuery history recording. */
  private queryAnalyzer: QueryAnalyzer | null = null;

  constructor(opts: ProfileManagerOptions) {
    this.enabled = opts.enabled;
    this.maxProfiles = opts.maxProfiles;
    this.defaultRole = opts.defaultRole;
    this.readRouting = opts.readRouting;
    this.cipherKey = opts.cipherKey;
    this.cacheConfig = opts.cacheConfig;
    this.store = new ProfileStore(opts.profilesDbPath, { cipherKey: opts.cipherKey });
    this.router = new QueryRouter(opts.readRouting);
    // Log a startup hint when SQLCipher is configured (verbose only at debug).
    if (process.env.DEBUG_PROFILE_CIPHER === '1' && this.cipherKey) {
      console.error(`[profile] SQLCipher enabled with key length ${this.cipherKey.length}`);
    }
  }

  /**
   * v2.19: wire a QueryAnalyzer so {@link routeQuery} records history rows
   * tagged with `profile_name`. Pass `null` to detach.
   */
  setQueryAnalyzer(qa: QueryAnalyzer | null): void {
    this.queryAnalyzer = qa;
  }

  /** v2.19: diagnostic accessor. */
  getQueryAnalyzer(): QueryAnalyzer | null {
    return this.queryAnalyzer;
  }

  /**
   * v2.20: export profiles to a YAML or JSON string.
   * Passwords are REDACTED by default; pass `{ includeSecrets: true }` to keep them.
   */
  async exportProfiles(format: 'yaml' | 'json' = 'yaml', opts?: { includeSecrets?: boolean }): Promise<string> {
    const all = await this.listProfiles();
    return format === 'json'
      ? ProfileSerializer.toJSON(all, opts)
      : ProfileSerializer.toYAML(all, opts);
  }

  /**
   * v2.20: import profiles from a YAML or JSON string.
   * `mode`:
   *   - 'merge' (default): insert new profiles, update existing ones
   *   - 'replace': delete all current profiles and replace with input
   * `dryRun`: when true, do not actually save; returns a what-if preview.
   *
   * Profiles whose config contains REDACTED placeholders for sensitive fields
   * MUST be re-supplied by the caller via `passwords: { [name]: { password: 'x' } }`.
   * Without those, importing leaves the redaction in place.
   */
  async importProfiles(
    input: string,
    opts?: { mode?: ImportMode; format?: 'yaml' | 'json'; dryRun?: boolean; passwords?: Record<string, Record<string, string>> },
  ): Promise<ImportResult> {
    const format = opts?.format ?? 'yaml';
    const doc = ProfileSerializer.parse(input, format);
    const mode = opts?.mode ?? 'merge';
    const dryRun = opts?.dryRun ?? false;

    const result: ImportResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    if (!dryRun && mode === 'replace' && this.enabled) {
      const current = await this.listProfiles();
      for (const p of current) {
        // v5.0.0: pass confirm: true because this is an internal call (user already
        // explicitly requested replace mode via importProfiles).
        await this.deleteProfile(p.name, { confirm: true });
      }
    }

    for (const p of doc.profiles) {
      const errs = ProfileSerializer.validate(p);
      if (errs.length > 0) {
        result.skipped++;
        result.errors.push(`profile ${p.name || '?'}: ${errs.join('; ')}`);
        continue;
      }
      // Restore redacted secrets from opts.passwords if provided.
      const cfg: Record<string, unknown> = { ...p.config };
      const overrides = opts?.passwords?.[p.name];
      if (overrides) {
        for (const [k, v] of Object.entries(overrides)) {
          cfg[k] = v;
        }
      }
      const existing = await this.getProfile(p.name);
      if (!dryRun) {
        await this.createProfile({
          name: p.name,
          description: p.description,
          type: p.type,
          config: cfg as any,
          role: p.role,
          tags: p.tags,
          enabled: p.enabled,
        }, p.created_by || 'yaml-import');
        if (existing) result.updated++;
        else result.inserted++;
      } else {
        if (existing) result.updated++;
        else result.inserted++;
      }
    }
    return result;
  }

  isEnabled(): boolean { return this.enabled; }

  async createProfile(input: ProfileInput, createdBy = 'mcp'): Promise<Profile> {
    if (!this.enabled) throw new Error('multi-db disabled');
    const existing = await this.listProfiles();
    if (existing.length >= this.maxProfiles && !existing.find(p => p.name === input.name)) {
      throw new Error(`max profiles (${this.maxProfiles}) reached`);
    }
    // v5.0.0: 重命名自 saveProfile,语义化为 create (INSERT-only)。ProfileStore.create 抛 UNIQUE 约束错误
    // 表示同名 profile 已存在 — 用户应改用 updateProfile()。
    return this.store.create({ ...input, role: input.role ?? this.defaultRole }, createdBy);
  }

  /**
   * v5.0.0: saveProfile() is a deprecated alias for createProfile(). New code should
   * use createProfile() to make the INSERT-only semantic explicit.
   */
  async saveProfile(input: ProfileInput, createdBy = 'mcp'): Promise<Profile> {
    return this.createProfile(input, createdBy);
  }

  /**
   * v5.0.0: 修改已存在的 profile(UPDATE-only)。profile 不存在抛 'profile ... does not exist'。
   * 不会动 use_count / created_at / created_by / id。
   */
  async updateProfile(input: ProfileInput): Promise<Profile> {
    if (!this.enabled) throw new Error('multi-db disabled');
    return this.store.update({ ...input, role: input.role ?? this.defaultRole });
  }

  async listProfiles(filter?: { role?: string; tag?: string; enabled?: boolean }): Promise<Profile[]> {
    if (!this.enabled) return [];
    return this.store.list(filter);
  }

  async getProfile(name: string): Promise<Profile | null> {
    if (!this.enabled) return null;
    return this.store.get(name);
  }

  async deleteProfile(name: string, opts?: { confirm?: boolean }): Promise<boolean> {
    if (!this.enabled) return false;
    // v5.0.0: if profile doesn't exist, return false (no-op) — don't trigger the
    // confirm-required error path. Unknown name is not a destructive operation.
    const existing = await this.store.get(name);
    if (!existing) return false;
    // v5.0.0: 二次确认。默认返回 false + 列出 ~/.universal-db-mcp/<name>/ 子目录内容,
    // 用户传 confirm: true 才会真正删除。防止误删 templates / history / plans 数据。
    if (!opts?.confirm) {
      const preview = await this.previewProfileDelete(name);
      if (preview) {
        throw new Error(
          `delete_profile('${name}') 是破坏性操作,会同时删除:\n` +
          `  - ~/.universal-db-mcp/profiles.db 中的 profile 行\n` +
          `  - ${preview.subdir} 子目录(包含 templates/history/plans)\n` +
          (preview.contents?.length
            ? `    内容:\n${preview.contents.map((c) => `      - ${c}`).join('\n')}\n`
            : `    (子目录不存在或为空)\n`) +
          `重新调用并传 confirm: true 以确认删除。`,
        );
      }
      // 子目录不存在也没内容 — 但还是要求 confirm,避免误删 profiles.db 行
      throw new Error(
        `delete_profile('${name}') 是破坏性操作。` +
        `重新调用并传 confirm: true 以确认删除。`,
      );
    }
    await this.unloadProfile(name);
    // v5.0.0: 删 profile 同时清理 ~/.universal-db-mcp/<name>/ 子目录
    // (templates.db / history.db / plans.db),避免成为孤儿。
    try {
      const { removeProfileDir } = await import('../utils/global-paths.js');
      removeProfileDir(name);
    } catch (err) {
      // 清理失败不阻塞删除 — 至少 profiles.db 行已被移除。
      console.error(
        `[profile] failed to remove profile dir for '${name}': ${err instanceof Error ? err.message : err}`,
      );
    }
    return this.store.delete(name);
  }

  /**
   * v5.0.0: 预览 delete_profile 会清理哪些文件。返回 null 表示 profile 不存在。
    * 不传 confirm 时被 deleteProfile 调用,作为错误消息的一部分告知用户。
    */
  private async previewProfileDelete(name: string): Promise<{
    subdir: string;
    contents: string[];
  } | null> {
    const profile = await this.store.get(name);
    if (!profile) return null;
    const { getGlobalDir } = await import('../utils/global-paths.js');
    const path = (await import('node:path')).default.join(getGlobalDir(), name);
    const contents: string[] = [];
    try {
      const fs = await import('node:fs');
      const entries = fs.readdirSync(path, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile()) {
          const stat = fs.statSync((await import('node:path')).default.join(path, e.name));
          contents.push(`${e.name} (${stat.size}B)`);
        } else {
          contents.push(`${e.name}/`);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[profile] preview delete: readdir failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return {
      subdir: path,
      contents: contents.sort(),
    };
  }

  async loadProfile(name: string): Promise<LiveProfile> {
    if (!this.enabled) throw new Error('multi-db disabled');
    // v5.0.0 Bug N2: 缓存命中时,如果 store 里的 updated_at 比 cache 里的新,
    // 说明 profile 被 update 过,先 unload 再重建以避免返回 stale LiveProfile
    const existing = this.liveProfiles.get(name);
    if (existing) {
      const stored = await this.store.get(name);
      if (stored) {
        const storedTs = Date.parse(stored.updated_at ?? '');
        const cachedTs = Date.parse(existing.profile.updated_at ?? '');
        if (!Number.isNaN(storedTs) && !Number.isNaN(cachedTs) && storedTs > cachedTs) {
          await this.unloadProfile(name);
        } else {
          this.touchLRU(name);
          return existing;
        }
      } else {
        this.touchLRU(name);
        return existing;
      }
    }
    const profile = await this.store.get(name);
    if (!profile) throw new Error(`profile not found: ${name}`);
    if (!profile.enabled) throw new Error(`profile disabled: ${name}`);
    const adapter = createAdapter({ ...profile.config, type: profile.type } as any);
    await adapter.connect();
    // v5.0.0 修复:DatabaseService 内部依赖 this.config.type 做方言分支(appendLimit /
    // quoteSimpleIdentifier 等)。profile.config 里没有 type(type 在 profile.type 上),
    // 不传过去会让 DatabaseService 的 config.type === undefined → 默认 fallback
    // 到 PostgreSQL/SQLite 方言(LIMIT + lowercase 双引号),Oracle/DM/SQL Server 全部报错。
    //
    // v5.0.0: 同时传递 permissionMode。profile.config 里可能没有 config.permissions
    // (auto-expand 在并行调用时偶发不跑 / 早期 profile 是手动创建的没展开过),
    // 但 profile.permissionMode 始终在 SQLite 里。resolvePermissions 优先看
    // permissionMode,所以传过去能保证 DatabaseService 拿到正确的权限集合。
    const service = new DatabaseService(
      adapter,
      { ...profile.config, type: profile.type, permissionMode: profile.permissionMode } as any,
      this.cacheConfig,
    );
    // v2.19: forward QA + active-profile provider to the per-profile
    // DatabaseService so history rows executed via this profile get the
    // right profile_name.
    if (this.queryAnalyzer) {
      service.setQueryAnalyzer(this.queryAnalyzer);
      service.setActiveProfileProvider(() => name);
    }
    // v5.0.0: forward active-profile to QueryAnalyzer so templates/history
    // paths follow the active profile (per-profile subdir isolation).
    if (this.queryAnalyzer) {
      this.queryAnalyzer.setProfileProvider(() => name);
      this.queryAnalyzer.setProfilePathResolver(() => {
        if (!name) return null;
        return {
          templates: getProfileDbPath(name, 'templates'),
          history: getProfileDbPath(name, 'history'),
        };
      });
    }
    const live: LiveProfile = { profile, adapter, service, connectedAt: new Date() };
    this.liveProfiles.set(name, live);
    this.touchLRU(name);
    await this.evictIfOverLimit();
    return live;
  }

  async unloadProfile(name: string): Promise<void> {
    const live = this.liveProfiles.get(name);
    if (!live) return;
    try { await live.adapter.disconnect(); } catch { /* ignore */ }
    this.liveProfiles.delete(name);
    this.lruOrder = this.lruOrder.filter(n => n !== name);
  }

  async getLive(name: string): Promise<LiveProfile | null> {
    return this.liveProfiles.get(name) ?? null;
  }

  async listLive(): Promise<LiveProfile[]> {
    return Array.from(this.liveProfiles.values());
  }

  async routeQuery(profileName: string, sql: string, kind: 'read' | 'write', params?: unknown[]): Promise<QueryResult> {
    if (!this.enabled) throw new Error('multi-db disabled');
    const sourceLive = await this.loadProfile(profileName);
    let result: QueryResult;
    if (kind === 'write' || sourceLive.profile.role === 'primary') {
      result = await sourceLive.adapter.executeQuery(sql, params);
    } else {
      const peers = Array.from(this.liveProfiles.values())
        .filter(lp => lp.profile.role === sourceLive.profile.role);
      const pick = this.router.pickReadReplica(peers) ?? sourceLive;
      result = await pick.adapter.executeQuery(sql, params);
    }
    // v2.19: tag history with profile_name when a QueryAnalyzer is wired.
    // Execute the record async (fire-and-forget) — callers don't block on history.
    if (this.queryAnalyzer) {
      this.queryAnalyzer.recordQuery({
        ts: new Date().toISOString(),
        db: sourceLive.profile.type,
        kind: kind === 'read' ? 'select' : (kind === 'write' ? 'write' : kind),
        sql,
        params: params ? JSON.stringify(params) : null,
        duration_ms: 0,
        rows: Array.isArray((result as any).rows) ? (result as any).rows.length : null,
        error: null,
        error_code: null,
        profile_name: profileName,
      }).catch(err => {
        console.error('[profileManager] routeQuery recordQuery failed:', err);
      });
    }
    return result;
  }

  async closeAll(): Promise<void> {
    for (const name of Array.from(this.liveProfiles.keys())) {
      await this.unloadProfile(name);
    }
    await this.store.close();
  }

  getMetricsSnapshot(): {
    enabled: boolean;
    total_profiles: number;
    live_profiles: string[];
    read_routing: ReadRouting;
  } {
    return {
      enabled: this.enabled,
      total_profiles: this.lruOrder.length,
      live_profiles: Array.from(this.liveProfiles.keys()),
      read_routing: this.readRouting,
    };
  }

  private touchLRU(name: string): void {
    this.lruOrder = this.lruOrder.filter(n => n !== name);
    this.lruOrder.push(name);
  }

  private async evictIfOverLimit(): Promise<void> {
    while (this.liveProfiles.size > this.maxProfiles) {
      const oldest = this.lruOrder.shift();
      if (!oldest) break;
      await this.unloadProfile(oldest);
    }
  }
}
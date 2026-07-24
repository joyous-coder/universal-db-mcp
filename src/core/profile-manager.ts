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

export type ProfileRole = 'primary' | 'replica' | 'analytics';
export type ReadRouting = 'round-robin' | 'random' | 'least-loaded';

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
}
export interface ProfileInput {
  name: string;
  description: string;
  type: string;
  config: DbConfig;
  role?: ProfileRole;
  tags?: string[];
  enabled?: boolean;
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
        await this.deleteProfile(p.name);
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
        await this.saveProfile({
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

  async saveProfile(input: ProfileInput, createdBy = 'mcp'): Promise<Profile> {
    if (!this.enabled) throw new Error('multi-db disabled');
    const existing = await this.listProfiles();
    if (existing.length >= this.maxProfiles && !existing.find(p => p.name === input.name)) {
      throw new Error(`max profiles (${this.maxProfiles}) reached`);
    }
    return this.store.save({ ...input, role: input.role ?? this.defaultRole }, createdBy);
  }

  async listProfiles(filter?: { role?: string; tag?: string; enabled?: boolean }): Promise<Profile[]> {
    if (!this.enabled) return [];
    return this.store.list(filter);
  }

  async getProfile(name: string): Promise<Profile | null> {
    if (!this.enabled) return null;
    return this.store.get(name);
  }

  async deleteProfile(name: string): Promise<boolean> {
    if (!this.enabled) return false;
    await this.unloadProfile(name);
    return this.store.delete(name);
  }

  async loadProfile(name: string): Promise<LiveProfile> {
    if (!this.enabled) throw new Error('multi-db disabled');
    const existing = this.liveProfiles.get(name);
    if (existing) { this.touchLRU(name); return existing; }
    const profile = await this.store.get(name);
    if (!profile) throw new Error(`profile not found: ${name}`);
    if (!profile.enabled) throw new Error(`profile disabled: ${name}`);
    const adapter = createAdapter(profile.config as any);
    await adapter.connect();
    const service = new DatabaseService(adapter, profile.config as any, this.cacheConfig);
    // v2.19: forward QA + active-profile provider to the per-profile
    // DatabaseService so history rows executed via this profile get the
    // right profile_name.
    if (this.queryAnalyzer) {
      service.setQueryAnalyzer(this.queryAnalyzer);
      service.setActiveProfileProvider(() => name);
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
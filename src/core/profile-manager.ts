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

export interface ProfileManagerOptions {
  enabled: boolean;
  profilesDbPath: string;
  maxProfiles: number;
  defaultRole: ProfileRole;
  readRouting: ReadRouting;
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
  private lruOrder: string[] = [];
  private cacheConfig?: Partial<SchemaCacheConfig>;

  constructor(opts: ProfileManagerOptions) {
    this.enabled = opts.enabled;
    this.maxProfiles = opts.maxProfiles;
    this.defaultRole = opts.defaultRole;
    this.readRouting = opts.readRouting;
    this.cacheConfig = opts.cacheConfig;
    this.store = new ProfileStore(opts.profilesDbPath);
    this.router = new QueryRouter(opts.readRouting);
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
    if (kind === 'write' || sourceLive.profile.role === 'primary') {
      return sourceLive.adapter.executeQuery(sql, params);
    }
    const peers = Array.from(this.liveProfiles.values())
      .filter(lp => lp.profile.role === sourceLive.profile.role);
    const pick = this.router.pickReadReplica(peers) ?? sourceLive;
    return pick.adapter.executeQuery(sql, params);
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
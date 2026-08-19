/**
 * GlobalSchemaView (v2.18)
 *
 * Parallel-fetch schema for all enabled profiles, merged by profile name.
 */

import type { ProfileManager } from './profile-manager.js';
import type { ProfileRole } from './profile-manager.js';

export interface ProfileSchema {
  name: string;
  type: string;
  role: ProfileRole;
  tables: Array<{
    schema: string;
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean; comment?: string }>;
    primaryKey: string[];
    foreignKeys: unknown[];
    indexes: unknown[];
    comment?: string;
  }>;
  /**
   * v5.0.1 Bug N3: 当 loadProfile 或 getSchema 失败时,把错误消息推到 warnings。
   * 之前 catch 块静默吞掉所有错误返回 tables:[]。现在 LLM 能在 warnings 看到根因。
   */
  warnings?: string[];
}

export interface GlobalSchemaView {
  generatedAt: string;
  profiles: ProfileSchema[];
}

export async function buildGlobalSchemaView(pm: ProfileManager): Promise<GlobalSchemaView> {
  const profiles = await pm.listProfiles({ enabled: true });
  const liveEntries = await Promise.all(
    profiles.map(async (p) => {
      try {
        const live = await pm.loadProfile(p.name);
        return { profile: p, live, loadError: null as string | null };
      } catch (err) {
        return { profile: p, live: null, loadError: err instanceof Error ? err.message : String(err) };
      }
    })
  );
  const profileSchemas: ProfileSchema[] = [];
  for (const { profile, live, loadError } of liveEntries) {
    if (!live) {
      profileSchemas.push({
        name: profile.name, type: profile.type, role: profile.role, tables: [],
        warnings: loadError ? [loadError] : ['profile not loaded'],
      });
      continue;
    }
    try {
      const schemaInfo = await live.service.getSchema(false);
      profileSchemas.push({
        name: profile.name,
        type: profile.type,
        role: profile.role,
        tables: (schemaInfo.tables ?? []).map((t: any) => ({
          schema: t.schema ?? '',
          name: t.name,
          columns: (t.columns ?? []).map((c: any) => ({
            name: c.name, type: c.dataType ?? c.type ?? 'unknown',
            nullable: c.nullable ?? true, comment: c.comment,
          })),
          primaryKey: t.primaryKey ?? [],
          foreignKeys: t.foreignKeys ?? [],
          indexes: t.indexes ?? [],
          comment: t.comment,
        })),
      });
    } catch (err) {
      // v5.0.1 Bug N3: 之前这里静默吞错返回 tables:[]。现在把错误消息推到 warnings
      profileSchemas.push({
        name: profile.name,
        type: profile.type,
        role: profile.role,
        tables: [],
        warnings: [err instanceof Error ? err.message : String(err)],
      });
    }
  }
  return { generatedAt: new Date().toISOString(), profiles: profileSchemas };
}
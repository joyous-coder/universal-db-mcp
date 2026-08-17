/**
 * MCP profile tools (v2.18 + v3.2 lifecycle + v2.20 import/export)
 *
 * v2.18 (4 tools): save_profile / list_profiles / use_profile / get_global_schema
 * v2.20 (2 tools): export_profiles / import_profiles
 * v3.2 lifecycle (5 tools): get_profile / delete_profile / enable_profile /
 *                          disable_profile / disconnect_profile
 *
 * v3.2: all 11 wired into ToolRegistry under 'profiles' lazy group.
 */

import type { ProfileManager } from '../../core/profile-manager.js';
import type { ProfileInput } from '../../core/profile-manager.js';
import type { ProfileStore } from '../../core/profile-store.js';

export function buildSaveProfileHandler(pm: ProfileManager) {
  return async (args: ProfileInput) => {
    // v3.2.7 Bug #27 fix: mongodb requires authSource for SCRAM authentication.
    // Default to 'admin' if missing (the convention used by MONGO_INITDB_ROOT_USERNAME env).
    if (args.type === 'mongodb' && args.config && !(args.config as any).authSource) {
      args = {
        ...args,
        config: { ...args.config, authSource: 'admin' } as any,
      };
    }
    return pm.saveProfile(args, 'mcp');
  };
}

export function buildListProfilesHandler(pm: ProfileManager) {
  return async (args: { role?: string; tag?: string; enabled?: boolean }) => ({
    profiles: await pm.listProfiles(args),
  });
}

export function buildUseProfileHandler(pm: ProfileManager) {
  return async (args: { name: string }) => {
    const live = await pm.loadProfile(args.name);
    // v4.0.2 Bug #7 fix: return the entire LiveProfile (adapter + service already
    // connected by loadProfile). Caller must use these directly — do NOT call
    // createAdapter+connect again, because dmdb.createPool uses an internal alias
    // derived from host+port+user; a second createPool with same alias fails with
    // "[20006] 连接池别名已存在".
    return {
      name: live.profile.name,
      type: live.profile.type,
      role: live.profile.role,
      profileConfig: live.profile.config,
      adapter: live.adapter,
      service: live.service,
    };
  };
}

export function buildGetGlobalSchemaHandler(pm: ProfileManager) {
  return async () => {
    const { buildGlobalSchemaView } = await import('../../core/global-schema-view.js');
    return buildGlobalSchemaView(pm);
  };
}

// v2.20 import/export (registered in v3.2)

export function buildExportProfilesHandler(pm: ProfileManager) {
  return async (args: { format?: 'yaml' | 'json'; includeSecrets?: boolean }) => {
    return {
      content: await pm.exportProfiles(args.format ?? 'yaml', { includeSecrets: args.includeSecrets }),
    };
  };
}

export function buildImportProfilesHandler(pm: ProfileManager) {
  return async (args: {
    input: string;
    format?: 'yaml' | 'json';
    mode?: 'merge' | 'replace';
    dryRun?: boolean;
  }) => {
    return await pm.importProfiles(args.input, {
      format: args.format ?? 'yaml',
      mode: args.mode ?? 'merge',
      dryRun: args.dryRun,
    });
  };
}

// v3.2 lifecycle (HTTP-only → MCP)

export function buildGetProfileHandler(pm: ProfileManager) {
  return async (args: { name: string }) => {
    const profile = await pm.getProfile(args.name);
    if (!profile) throw new Error(`profile ${args.name} not found`);
    return { profile };
  };
}

export function buildDeleteProfileHandler(pm: ProfileManager) {
  return async (args: { name: string }) => ({ deleted: await pm.deleteProfile(args.name) });
}

export function buildEnableProfileHandler(pm: ProfileManager, store: ProfileStore) {
  return async (args: { name: string }) => {
    const p = await pm.getProfile(args.name);
    if (!p) throw new Error(`profile ${args.name} not found`);
    await store.setEnabled(args.name, true);
    return { enabled: true };
  };
}

export function buildDisableProfileHandler(pm: ProfileManager, store: ProfileStore) {
  return async (args: { name: string }) => {
    const p = await pm.getProfile(args.name);
    if (!p) throw new Error(`profile ${args.name} not found`);
    await pm.unloadProfile(args.name);
    await store.setEnabled(args.name, false);
    return { enabled: false };
  };
}

export function buildDisconnectProfileHandler(pm: ProfileManager) {
  return async (args: { name: string }) => {
    await pm.unloadProfile(args.name);
    return { disconnected: true };
  };
}

export const PROFILE_TOOL_DESCRIPTIONS = {
  save_profile: '保存命名 profile (host/port/user 等) 到 profiles.db。[group: profiles]',
  list_profiles: '列出 profile。支持 role/tag/enabled 过滤。[group: profiles]',
  use_profile: '切换活跃连接到已存 profile。必要时加载。[group: profiles]',
  get_global_schema: '合并所有启用 profile 的 schema (并行)。[group: profiles]',
  export_profiles: '导出 profile 为 YAML/JSON (可 redact 密码)。[group: profiles]',
  import_profiles: '导入 profile YAML/JSON (merge/replace + dryRun)。[group: profiles]',
  get_profile: '读单个 profile 配置。[group: profiles]',
  delete_profile: '删除一个 profile。[group: profiles]',
  enable_profile: '启用 profile（写入 enabled 标志）。[group: profiles]',
  disable_profile: '禁用 profile（自动 unload）。[group: profiles]',
  disconnect_profile: '断开指定 profile（不删配置）。[group: profiles]',
};
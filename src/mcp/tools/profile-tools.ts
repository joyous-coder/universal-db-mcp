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
import { isValidProfileName } from '../../core/profile-manager.js';

/**
 * v5.0.0: 重命名自 buildSaveProfileHandler。create_profile 只 INSERT,
 * 已存在同名 profile 抛 UNIQUE 约束错误。要修改现有 profile 用 update_profile。
 */
export function buildCreateProfileHandler(pm: ProfileManager) {
  return async (args: ProfileInput) => {
    // v4.2.0: profile name 严格正则 — 名字作为 ~/.universal-db-mcp/<name>/ 子目录,
    // 不能含点/空格/中文/路径分隔符
    if (!isValidProfileName(args.name)) {
      throw new Error(
        `invalid profile name: "${args.name}" (must match /^[a-zA-Z0-9_-]+$/)`,
      );
    }
    // v5.0.1: SQLite profile 不接受 user 自定路径。
    // SQLite 数据文件统一在 ~/.universal-db-mcp/<name>/data.db(profile-manager 自动生成)。
    // 例外: `:memory:` 是 SQLite 内存数据库特殊标识(不是路径),允许传。
    if (args.type === 'sqlite' && args.config && (args.config as any).filePath) {
      const fp = (args.config as any).filePath;
      if (fp !== ':memory:') {
        throw new Error(
          `SQLite profile 不接受 config.filePath="${fp}"。` +
          `SQLite 数据文件自动放在 ~/.universal-db-mcp/${args.name}/data.db,无需手动指定。` +
          `(仅 ":memory:" 字面量可用,表示内存数据库)`,
        );
      }
    }
    // v3.2.7 Bug #27 fix: mongodb requires authSource for SCRAM authentication.
    // Default to 'admin' if missing (the convention used by MONGO_INITDB_ROOT_USERNAME env).
    if (args.type === 'mongodb' && args.config && !(args.config as any).authSource) {
      args = {
        ...args,
        config: { ...args.config, authSource: 'admin' } as any,
      };
    }
    // v4.2.0: 透传 permissionMode (默认 'readwrite' 由 ProfileStore 处理)
    // v5.0.0 修复:permissionMode 与 config.permissions 联动 — 用户只设一个就够。
    if (args.permissionMode && (!args.config.permissions || args.config.permissions.length === 0)) {
      const { resolvePermissions } = await import('../../utils/safety.js');
      const preset = resolvePermissions({ permissionMode: args.permissionMode } as any);
      args = { ...args, config: { ...args.config, permissions: preset } as any };
    }
    return pm.createProfile(args, 'mcp');
  };
}

/**
 * v5.0.0: Deprecated alias for buildCreateProfileHandler(). New code should use
 * buildCreateProfileHandler() to match the renamed tool name `create_profile`.
 */
export function buildSaveProfileHandler(pm: ProfileManager) {
  return buildCreateProfileHandler(pm);
}

/**
 * v5.0.0: 新增工具。update_profile 只 UPDATE 已存在的 profile,
 * profile 不存在抛 'profile ... does not exist'。
 *
 * 不允许改名(name 是更新键,不是设置项)。
 */
export function buildUpdateProfileHandler(pm: ProfileManager) {
  return async (args: ProfileInput) => {
    if (!isValidProfileName(args.name)) {
      throw new Error(
        `invalid profile name: "${args.name}" (must match /^[a-zA-Z0-9_-]+$/)`,
      );
    }
    // v5.0.1: 同 createProfile — SQLite profile 只接受 ":memory:" 字面量
    if (args.type === 'sqlite' && args.config && (args.config as any).filePath) {
      const fp = (args.config as any).filePath;
      if (fp !== ':memory:') {
        throw new Error(
          `SQLite profile 不接受 config.filePath="${fp}"。文件固定在 ~/.universal-db-mcp/${args.name}/data.db。`,
        );
      }
    }
    if (args.type === 'mongodb' && args.config && !(args.config as any).authSource) {
      args = {
        ...args,
        config: { ...args.config, authSource: 'admin' } as any,
      };
    }
    // permissionMode 联动同样在 update 上需要,否则用户更新 permissionMode 后
    // config.permissions 还是旧的,resolvePermissions 优先用 config.permissions。
    if (args.permissionMode && (!args.config.permissions || args.config.permissions.length === 0)) {
      const { resolvePermissions } = await import('../../utils/safety.js');
      const preset = resolvePermissions({ permissionMode: args.permissionMode } as any);
      args = { ...args, config: { ...args.config, permissions: preset } as any };
    }
    return pm.updateProfile(args);
  };
}

export function buildListProfilesHandler(pm: ProfileManager) {
  return async (args: { role?: string; tag?: string; enabled?: boolean }) => ({
    profiles: await pm.listProfiles(args),
  });
}

export function buildUseProfileHandler(pm: ProfileManager) {
  return async (args: { name: string; recordToProject?: boolean }) => {
    const live = await pm.loadProfile(args.name);
    // v5.0.0: <cwd>/.db-profile 项目级激活文件(从 v4.2.0 的 .profile 改名)。
    //   - 不存在:返回 hint 提示用户可以 recordToProject:true 创建
    //   - 已存在:无论是否传 recordToProject,**同步更新**到当前 profile 名
    //     (保证 .db-profile 始终反映最近一次 use_profile 调用)
    //   - 想"临时激活但不同步":用 recordToProject: false 显式跳过 sync
    let profileRecordHint: string | undefined;
    const syncProjectProfile = async (action: 'created' | 'updated' | 'unchanged') => {
      try {
        const { writeProjectProfile } = await import('../../utils/path-resolver.js');
        writeProjectProfile(process.cwd(), args.name);
        const file = `${process.cwd()}/.db-profile`;
        if (action === 'created') {
          profileRecordHint = `已在 ${file} 记录 profile=${args.name},下次 MCP 启动自动激活。`;
        } else if (action === 'updated') {
          profileRecordHint = `已更新 ${file} → profile=${args.name},下次 MCP 启动自动激活。`;
        } else {
          profileRecordHint = `${file} 已绑定 profile=${args.name} (无需更新)。`;
        }
      } catch (err) {
        console.error(
          `[mcp] failed to write .db-profile: ${err instanceof Error ? err.message : err}`,
        );
        profileRecordHint = `写 ${process.cwd()}/.db-profile 失败: ${err instanceof Error ? err.message : err}`;
      }
    };
    if (args.recordToProject === false) {
      // 显式跳过 sync,只激活不绑定
      console.error(`[mcp] profile '${args.name}' activated (recordToProject=false, .db-profile not touched).`);
    } else {
      // 默认 (recordToProject=true 或 undefined): 检查并同步 .db-profile
      try {
        const { readProjectProfile } = await import('../../utils/path-resolver.js');
        const existing = readProjectProfile(process.cwd());
        if (!existing) {
          // 不存在 → 提示 + 自动创建
          profileRecordHint =
            `当前目录 ${process.cwd()} 还没有 .db-profile 文件。\n` +
            `💡 已自动创建 .db-profile (profile=${args.name}),下次启动 MCP 时自动激活。\n` +
            `   想临时激活但不绑定?用 use_profile({name, recordToProject: false})`;
          console.error(`[mcp] profile '${args.name}' activated. No .db-profile — auto-creating.`);
          await syncProjectProfile('created');
        } else if (existing.profile === args.name) {
          // 已绑定到同一 profile → 无需更新
          profileRecordHint = `${process.cwd()}/.db-profile 已绑定 profile=${args.name} (无需更新)。`;
          console.error(`[mcp] profile '${args.name}' activated. .db-profile already binds to same profile.`);
        } else {
          // 绑定了不同的 profile → 同步更新到当前 profile
          profileRecordHint =
            `${process.cwd()}/.db-profile 当前绑到 '${existing.profile}',已同步更新到 '${args.name}'。\n` +
            `💡 想激活但不修改 .db-profile?用 use_profile({name, recordToProject: false})`;
          console.error(`[mcp] profile '${args.name}' activated. .db-profile was '${existing.profile}', syncing.`);
          await syncProjectProfile('updated');
        }
      } catch (err) {
        console.error(
          `[mcp] profile '${args.name}' activated. Failed to sync .db-profile: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
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
      // v5.0.0: 当 .profile 缺失/不匹配时返回 hint 给 mcp-server 拼到响应里
      profileRecordHint,
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
  // v5.0.0: confirm 二次确认。默认走 preview 路径,返回错误+子目录内容摘要;
  // confirm=true 才真正删除(profiles.db 行 + ~/.universal-db-mcp/<name>/ 子目录)。
  return async (args: { name: string; confirm?: boolean }) => ({
    deleted: await pm.deleteProfile(args.name, { confirm: args.confirm }),
  });
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
  // v5.0.0 BREAKING: rename save_profile → create_profile (INSERT-only)
  // v5.0.1: SQLite profile 的 filePath 由工具自动管理(放 ~/.universal-db-mcp/<name>/data.db),
  // 不要在 config 里传 filePath(传了会报错)。其他 DB 类型正常传 host/port/database 等。
  create_profile: '新建 profile 到 profiles.db(INSERT-only)。已存在同名 profile 抛 UNIQUE 约束错误,改用 update_profile。SQLite 类型不要传 config.filePath。[group: profiles]',
  update_profile: '修改已存在的 profile(UPDATE-only)。profile 不存在抛错。use_count/created_at/created_by/id 不变。SQLite 类型不要传 config.filePath。[group: profiles]',
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
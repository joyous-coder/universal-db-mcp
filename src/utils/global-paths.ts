/**
 * v5.0.0: 全局持久化路径解析
 *
 * 所有 profile / history / templates / plans 数据集中放在 `~/.universal-db-mcp/`,
 * 跨项目共享。`DB_GLOBAL_DIR` env 可覆盖根目录(高级用户 / 测试用)。
 *
 * 目录布局:
 *   ~/.universal-db-mcp/
 *   ├── profiles.db                    # 全局 profile 注册表
 *   └── <profile-name>/                # 每个 profile 一份隔离的 history/templates/plans
 *       ├── history.db
 *       ├── templates.db
 *       └── plans.db
 *
 * v5.0.0 修复:ensureGlobalDir() 自动 mkdir -p 父目录,避免 better-sqlite3 报
 * "unable to open database file"。
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * 返回全局根目录。env `DB_GLOBAL_DIR` 覆盖默认值。
 * Windows: %USERPROFILE%\.universal-db-mcp
 * macOS/Linux: ~/.universal-db-mcp
 */
export function getGlobalDir(): string {
  return process.env.DB_GLOBAL_DIR ?? path.join(os.homedir(), '.universal-db-mcp');
}

/**
 * v5.0.0: 确保全局根目录存在。ProfileStore.init 之前调用。
 */
export function ensureGlobalDir(): void {
  fs.mkdirSync(getGlobalDir(), { recursive: true });
}

/** profiles.db — 全局 profile 注册表 */
export function getProfilesDbPath(): string {
  return path.join(getGlobalDir(), 'profiles.db');
}

/**
 * v5.0.0: 确保某个 profile 的子目录存在 ~/.universal-db-mcp/<name>/。
 * save_template / recordQuery / persistPlan 都需要在打开 SQLite 前调用,
 * 否则 better-sqlite3 会报 "unable to open database file"。
 */
export function ensureProfileDir(profileName: string): void {
  fs.mkdirSync(path.join(getGlobalDir(), profileName), { recursive: true });
}

/**
 * v5.0.0: 删除某个 profile 的子目录 ~/.universal-db-mcp/<name>/。
 * 由 ProfileManager.deleteProfile / importProfiles(mode='replace') 调用,
 * 清理 templates.db / history.db / plans.db 等 profile-scoped 数据。
 * 目录不存在时静默忽略(已经清过了)。
 */
export function removeProfileDir(profileName: string): void {
  fs.rmSync(path.join(getGlobalDir(), profileName), { recursive: true, force: true });
}

/**
 * profile-scoped DB 路径(history/templates/plans)。调用前会自动确保子目录存在。
 * @param profileName profile 名(必须满足 /^[a-zA-Z0-9_-]+$/,save_profile 已校验)
 * @param kind 'history' | 'templates' | 'plans'
 */
export function getProfileDbPath(
  profileName: string,
  kind: 'history' | 'templates' | 'plans',
): string {
  // v5.0.0: 自动 mkdir -p,避免 better-sqlite3 在子目录缺失时报错。
  // 失败时调用方拿到原始错误(由 mkdir 抛 ENOENT / EACCES)。
  try {
    ensureProfileDir(profileName);
  } catch {
    /* 调用方拿到的是 better-sqlite3 错误,不影响路径返回值 */
  }
  return path.join(getGlobalDir(), profileName, `${kind}.db`);
}
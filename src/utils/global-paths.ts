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
 * profile-scoped DB 路径(history/templates/plans)
 * @param profileName profile 名(必须满足 /^[a-zA-Z0-9_-]+$/,save_profile 已校验)
 * @param kind 'history' | 'templates' | 'plans'
 */
export function getProfileDbPath(
  profileName: string,
  kind: 'history' | 'templates' | 'plans',
): string {
  return path.join(getGlobalDir(), profileName, `${kind}.db`);
}
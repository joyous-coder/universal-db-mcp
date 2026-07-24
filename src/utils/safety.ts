/**
 * 安全检查工具
 * 用于防止误操作删库等危险行为
 */

import type { DbConfig, PermissionType } from '../types/adapter.js';

/**
 * 操作类型到 SQL 关键字的映射
 */
type SqlOperationPermission = Exclude<PermissionType, 'read' | 'script' | 'batch'>;

const OPERATION_KEYWORDS: Record<SqlOperationPermission, readonly string[]> = {
  insert: ['INSERT', 'REPLACE'],
  update: ['UPDATE'],
  delete: ['DELETE', 'TRUNCATE'],
  ddl: ['CREATE', 'ALTER', 'DROP', 'RENAME'],
} as const;

/**
 * Dangerous keywords that are NOT in OPERATION_KEYWORDS but should be
 * explicitly blocked unless `ddl` permission is granted. These are
 * administrative operations that could compromise security.
 *
 * Defense-in-depth list — `detectOperationType` does NOT match these, so
 * callers must explicitly check `hasAnyDangerousKeyword` before execution.
 */
export const DANGEROUS_ADMIN_KEYWORDS: readonly string[] = [
  'GRANT', 'REVOKE',     // privilege management
  'EXEC', 'EXECUTE',     // dynamic SQL execution
  'SET',                  // session/role config
  'LOCK', 'UNLOCK',       // explicit locking
  'KILL',                 // terminate other connections
  'SHUTDOWN',             // server shutdown (also in BaseAdapter blacklist)
  'REINDEX', 'VACUUM',    // maintenance ops
];

/**
 * 预设权限模式
 */
const PERMISSION_PRESETS: Record<string, readonly PermissionType[]> = {
  safe: ['read'],
  readwrite: ['read', 'insert', 'update'],
  full: ['read', 'insert', 'update', 'delete', 'ddl'],
  // 'script' and 'batch' are NOT in any preset; users opt-in via custom permissions
} as const;

/**
 * 解析配置得到最终权限列表
 */
export function resolvePermissions(config: DbConfig): PermissionType[] {
  // 向后兼容：allowWrite=true 且未设置新参数时，等价于 full
  if (config.allowWrite === true && !config.permissionMode && !config.permissions) {
    return [...PERMISSION_PRESETS.full];
  }

  // 直接指定 permissions 数组（优先级最高）
  if (config.permissions?.length) {
    const perms = new Set<PermissionType>(['read', ...config.permissions]);
    return Array.from(perms);
  }

  // 使用预设模式
  if (config.permissionMode && config.permissionMode !== 'custom') {
    return [...PERMISSION_PRESETS[config.permissionMode]];
  }

  // 默认安全模式
  return [...PERMISSION_PRESETS.safe];
}

/**
 * Pre-compiled regex cache for keyword detection (P1-2)
 */
const KEYWORD_REGEX_CACHE = new Map<string, RegExp>();

function getKeywordRegex(keyword: string): RegExp {
  let regex = KEYWORD_REGEX_CACHE.get(keyword);
  if (!regex) {
    regex = new RegExp(`^(\\s|--[\\s\\S]*?|\\/\\*[\\s\\S]*?\\*\\/)*${keyword}\\b`, 'i');
    KEYWORD_REGEX_CACHE.set(keyword, regex);
  }
  return regex;
}

function startsWithKeyword(query: string, keyword: string): boolean {
  return getKeywordRegex(keyword).test(query);
}

/**
 * 检查 SQL 语句是否包含写操作
 * @param query - 待检查的 SQL 语句
 * @returns 如果包含写操作返回 true
 */
export function isWriteOperation(query: string): boolean {
  const upperQuery = query.trim().toUpperCase();
  for (const keywords of Object.values(OPERATION_KEYWORDS)) {
    for (const keyword of keywords) {
      if (startsWithKeyword(upperQuery, keyword)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 检测查询的操作类型
 * 检测每条语句的第一个关键字以确定其类型。
 * 多语句脚本中,所有语句都会被检测。
 */
export function detectOperationType(query: string): { type: SqlOperationPermission; keyword: string } | null {
  const upperQuery = query.trim().toUpperCase();
  for (const [opType, keywords] of Object.entries(OPERATION_KEYWORDS)) {
    for (const keyword of keywords) {
      if (startsWithKeyword(upperQuery, keyword)) {
        return { type: opType as SqlOperationPermission, keyword };
      }
    }
  }
  return null;
}

/**
 * 验证查询是否允许执行
 * @param query - 待执行的查询
 * @param configOrAllowWrite - DbConfig 对象或 allowWrite 布尔值（向后兼容）
 * @throws 如果查询被拒绝，抛出带有中文提示的错误
 */
export function validateQuery(query: string, configOrAllowWrite: DbConfig | boolean): void {
  // 向后兼容：支持旧的 boolean 参数
  let permissions: PermissionType[];
  if (typeof configOrAllowWrite === 'boolean') {
    permissions = configOrAllowWrite ? [...PERMISSION_PRESETS.full] : [...PERMISSION_PRESETS.safe];
  } else {
    permissions = resolvePermissions(configOrAllowWrite);
  }

  const detected = detectOperationType(query);
  if (detected && !permissions.includes(detected.type)) {
    const permissionLabels: Record<string, string> = {
      insert: '插入(insert)',
      update: '更新(update)',
      delete: '删除(delete)',
      ddl: 'DDL(ddl)',
    };
    throw new Error(
      `❌ 操作被拒绝：当前权限不允许 ${detected.keyword} 操作。\n` +
      `需要的权限：${permissionLabels[detected.type]}\n` +
      `当前权限：${permissions.join(', ')}\n` +
      `如需更多权限，请使用 --permission-mode 或 --permissions 参数。`
    );
  }
}

/**
 * 获取查询中的危险关键字（用于日志记录）
 * @param query - SQL 查询语句
 * @returns 找到的危险关键字数组
 */
export function getDangerousKeywords(query: string): string[] {
  const upperQuery = query.trim().toUpperCase();
  const allKeywords = Object.values(OPERATION_KEYWORDS).flat();
  return allKeywords.filter(keyword => upperQuery.includes(keyword));
}

/**
 * 格式化权限列表用于显示
 */
export function formatPermissions(permissions: PermissionType[]): string {
  const labels: Partial<Record<PermissionType, string>> = {
    read: '读取',
    insert: '插入',
    update: '更新',
    delete: '删除',
    ddl: 'DDL',
  };
  return permissions.map(p => `${labels[p]}(${p})`).join(', ');
}

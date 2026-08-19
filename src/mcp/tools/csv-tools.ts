/**
 * MCP CSV tools (v3.3 + v4.0.8 optional profileName + v4.0.9 default output path)
 *
 * 2 个 tools:
 *  - export_table_csv: 流式导出单表或自定义 SQL 到 CSV 文件
 *  - import_csv: 从 CSV 文件导入数据到已存在的表
 *
 * 路径白名单复用 DB_ALLOWED_FILE_PATHS (与 execute_sql_file 一致)。
 *
 * v4.0.8: profileName 改为可选 — 省略时回退到当前活跃连接。
 * v4.0.9: outputPath 改为可选 — 默认 <cwd>/sql/<table 或 query-时间戳>.csv。
 *         支持 sql 参数 (二选一替代 table) — 用于 Oracle/DM 等方言或带分页的查询。
 */
import path from 'node:path';
import fs from 'node:fs';
import { exportTableCsv } from '../../core/csv-writer.js';
import { importCsv } from '../../core/csv-reader.js';

/**
 * 解析 adapter 来源:
 *   - args.profileName 给定 → pm.loadProfile(profileName).adapter
 *   - 否则用 getActiveAdapter() 返回的 adapter
 *   - 两者皆无 → 抛错
 */
async function resolveAdapter(
  pm: any,
  getActiveAdapter: () => any,
  profileName: string | undefined,
): Promise<any> {
  if (profileName) {
    const live = await pm.loadProfile(profileName);
    return live.adapter;
  }
  const active = getActiveAdapter();
  if (!active) {
    throw new Error(
      'export_table_csv / import_csv 需要 profileName 或 active 连接(connect_database / use_profile)',
    );
  }
  return active;
}

/**
 * v4.0.9: 默认输出路径
 *   - <cwd>/sql/<table-sanitized>.csv  (table 模式)
 *   - <cwd>/sql/query-<YYYYMMDDHHMMSS>.csv  (sql 模式)
 * 自动 mkdir -p,不依赖 path-guard 解析已存在的目录。
 */
function defaultOutputPath(args: { table?: string; sql?: string }, cwd: string): string {
  const sqlDir = path.join(cwd, 'sql');
  fs.mkdirSync(sqlDir, { recursive: true });
  if (args.table) {
    const safe = args.table.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(sqlDir, safe + '.csv');
  }
  // sql 模式:用时间戳命名
  const d = new Date();
  const stamp =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0');
  return path.join(sqlDir, `query-${stamp}.csv`);
}

/**
 * v5.0.1 Bug N9/N11: 在 resolveAdapter 后,先判断是否 NoSQL。
 * NoSQL adapter(redis / mongodb)没有表/列概念,export_table_csv 会拼 SELECT 语句
 * 发给 Redis 触发 `SELECT` 命令错误,import_csv 会调 getTableInfo 返回 null 后
 * null.map() NPE。提前抛清晰错误更友好。
 */
function rejectNoSql(adapter: any, op: string): void {
  const dbType = (adapter as any)?.config?.type;
  if (dbType === 'redis' || dbType === 'mongodb' || dbType === 'mongo') {
    throw new Error(
      `${op} 不支持 ${dbType}:NoSQL adapter 没有表/列结构。` +
      `Redis 用 SCAN + GET,MongoDB 用 find() cursor,请直接用 execute_query。`,
    );
  }
}

export function buildExportTableCsvHandler(pm: any, getActiveAdapter: () => any) {
  return async (args: {
    profileName?: string;
    table?: string;
    columns?: string[];
    where?: string;
    orderBy?: string;
    sql?: string;
    outputPath?: string;
  }) => {
    const cwd = process.cwd();
    const finalOutputPath = args.outputPath ?? defaultOutputPath(args, cwd);

    // 路径白名单检查先于 adapter 解析
    // v4.0.9: env 为空时,自动信任 cwd (允许默认 <cwd>/sql/ 直接工作,无需额外配置)
    const rawAllowed = (process.env.DB_ALLOWED_FILE_PATHS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const allowedDirs = rawAllowed.length > 0 ? rawAllowed : [cwd];
    const { resolveAndValidatePath } = await import('../../utils/path-guard.js');
    let safePath: string;
    try {
      safePath = resolveAndValidatePath(finalOutputPath, allowedDirs, cwd);
    } catch (err) {
      const isDefault = !args.outputPath;
      if (isDefault && err instanceof Error) {
        throw new Error(
          `${err.message}\n` +
            `提示:显式 outputPath 不在白名单(${allowedDirs.join(', ')})。\n` +
            `把目标目录加到 DB_ALLOWED_FILE_PATHS,或显式指定 outputPath 到允许目录内。`,
        );
      }
      throw err;
    }

    const adapter = await resolveAdapter(pm, getActiveAdapter, args.profileName);
    rejectNoSql(adapter, 'export_table_csv'); // v5.0.1 Bug N9

    return exportTableCsv({
      adapter,
      table: args.table,
      columns: args.columns,
      where: args.where,
      orderBy: args.orderBy,
      sql: args.sql,
      outputPath: safePath,
    });
  };
}

export function buildImportCsvHandler(pm: any, getActiveAdapter: () => any) {
  return async (args: {
    profileName?: string;
    table: string;
    filePath: string;
    columns?: string[];
    dryRun?: boolean;
    batchSize?: number;
    hasHeader?: boolean;
    nullStrings?: string[];
  }) => {
    // 路径白名单检查先于 adapter 解析
    // v4.0.9: env 为空时,自动信任 cwd (允许默认 <cwd>/sql/ 直接工作,无需额外配置)
    const rawAllowed = (process.env.DB_ALLOWED_FILE_PATHS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const allowedDirs = rawAllowed.length > 0 ? rawAllowed : [process.cwd()];
    const { resolveAndValidatePath } = await import('../../utils/path-guard.js');
    const safePath = resolveAndValidatePath(args.filePath, allowedDirs, process.cwd());

    const adapter = await resolveAdapter(pm, getActiveAdapter, args.profileName);
    rejectNoSql(adapter, 'import_csv'); // v5.0.1 Bug N11
    const nullStrings = args.nullStrings ? new Set(args.nullStrings) : undefined;
    return importCsv({
      adapter,
      table: args.table,
      filePath: safePath,
      columns: args.columns,
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      hasHeader: args.hasHeader,
      nullStrings,
    });
  };
}

export const CSV_TOOL_DESCRIPTIONS = {
  export_table_csv:
    '导出单表 (或自定义 SQL) 到 CSV 文件。table 与 sql 二选一;省略 outputPath 时默认写到 <cwd>/sql/<表名>.csv。profileName 可选 — 省略时使用当前活跃连接。[group: data-governance]',
  import_csv:
    '从 CSV 文件导入数据到已存在的表 (APPEND 模式)。需 write 权限。profileName 可选 — 省略时使用当前活跃连接。[group: data-governance]',
};
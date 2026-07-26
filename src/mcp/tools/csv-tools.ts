/**
 * MCP CSV tools (v3.3)
 *
 * 2 个 tools:
 *  - export_table_csv: 流式导出单表到 CSV 文件
 *  - import_csv: 从 CSV 文件导入数据到已存在的表
 *
 * 路径白名单复用 DB_ALLOWED_FILE_PATHS (与 execute_sql_file 一致)。
 */
import { exportTableCsv } from '../../core/csv-writer.js';
import { importCsv } from '../../core/csv-reader.js';

export function buildExportTableCsvHandler(pm: any) {
  return async (args: {
    profileName: string;
    table: string;
    columns?: string[];
    where?: string;
    orderBy?: string;
    limit?: number;
    offset?: number;
    outputPath: string;
    batchSize?: number;
  }) => {
    const live = await pm.loadProfile(args.profileName);
    // v3.3: 路径白名单复用 DB_ALLOWED_FILE_PATHS
    const allowedDirs = (process.env.DB_ALLOWED_FILE_PATHS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowedDirs.length === 0) {
      throw new Error('DB_ALLOWED_FILE_PATHS 未配置,无法使用 export_table_csv');
    }
    const { resolveAndValidatePath } = await import('../../utils/path-guard.js');
    const safePath = resolveAndValidatePath(args.outputPath, allowedDirs, process.cwd());

    return exportTableCsv({
      adapter: live.adapter,
      table: args.table,
      columns: args.columns,
      where: args.where,
      orderBy: args.orderBy,
      limit: args.limit,
      offset: args.offset,
      outputPath: safePath,
      batchSize: args.batchSize,
    });
  };
}

export function buildImportCsvHandler(pm: any) {
  return async (args: {
    profileName: string;
    table: string;
    filePath: string;
    columns?: string[];
    dryRun?: boolean;
    batchSize?: number;
    hasHeader?: boolean;
    nullStrings?: string[];
  }) => {
    // v3.3: 复用 DB_ALLOWED_FILE_PATHS 路径白名单
    const allowedDirs = (process.env.DB_ALLOWED_FILE_PATHS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowedDirs.length === 0) {
      throw new Error('DB_ALLOWED_FILE_PATHS 未配置,无法使用 import_csv');
    }
    const { resolveAndValidatePath } = await import('../../utils/path-guard.js');
    const safePath = resolveAndValidatePath(args.filePath, allowedDirs, process.cwd());

    const live = await pm.loadProfile(args.profileName);
    const nullStrings = args.nullStrings ? new Set(args.nullStrings) : undefined;
    return importCsv({
      adapter: live.adapter,
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
  export_table_csv: '导出单表到 CSV 文件。支持 WHERE / ORDER BY / LIMIT / OFFSET。[group: data-governance]',
  import_csv: '从 CSV 文件导入数据到已存在的表 (APPEND 模式)。需 write 权限。[group: data-governance]',
};
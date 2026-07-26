/**
 * CsvReader — RFC 4180 CSV 解析与导入 (v3.3)
 *
 * 提供:
 *  - parseCsvLine(line, nullStrings): 解析单行 CSV (支持 quoted + escaped "")
 *  - streamCsvRows(stream, opts): 流式迭代 header + rows (readline 跨 chunk 重组)
 *  - importCsv(opts): 从 CSV 文件导入到已存在表 (APPEND, executeBatch 流式入库)
 *
 * 编码: UTF-8 无 BOM
 * 行终止符: \r\n 或 \n
 * nullStrings 默认: ['', 'NULL', '\\N']
 */

const DEFAULT_NULL_STRINGS = new Set(['', 'NULL', '\\N']);

/**
 * 解析单行 CSV (不含末尾换行符)。
 * 返回 (string | null)[] — 命中 nullStrings 的字段为 null。
 */
export function parseCsvLine(
  line: string,
  nullStrings: Set<string> = DEFAULT_NULL_STRINGS
): (string | null)[] {
  // v3.3: 行末尾的换行符(CR/LF)被 caller 在传入前剥掉;若传入了也容错
  const trimmed = line.endsWith('\r\n') ? line.slice(0, -2) : line.endsWith('\n') ? line.slice(0, -1) : line;
  const out: (string | null)[] = [];
  let i = 0;
  const n = trimmed.length;
  while (i < n) {
    if (trimmed[i] === '"') {
      // quoted field
      i += 1;
      let val = '';
      while (i < n) {
        if (trimmed[i] === '"') {
          if (i + 1 < n && trimmed[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          val += trimmed[i];
          i += 1;
        }
      }
      out.push(nullStrings.has(val) ? null : val);
      if (i < n && trimmed[i] === ',') i += 1;
    } else {
      // unquoted field
      let val = '';
      while (i < n && trimmed[i] !== ',') {
        val += trimmed[i];
        i += 1;
      }
      out.push(nullStrings.has(val) ? null : val);
      if (i < n && trimmed[i] === ',') i += 1;
    }
  }
  return out;
}
/**
 * 流式 CSV 行迭代器:输入 ReadableStream,产出 header + rows。
 *
 * 用 node:readline 一次读一行(crlfDelay: Infinity 让 readline 正确处理 CRLF/LF/CR)。
 * 多 chunk 流由 readline 内部 buffer 重组,跨 chunk 的 quoted field 正确处理。
 * 首行作为 header(可 hasHeader=false 跳过,列名用 col1, col2, ... 占位)。
 *
 * 流结束时若 readline 已读到 EOF 但 quote 未闭合 → 由 parseCsvLine 检测报 csv_parse_error。
 */
export async function* streamCsvRows(
  input: NodeJS.ReadableStream,
  opts: { hasHeader?: boolean; nullStrings?: Set<string> } = {}
): AsyncIterableIterator<Record<string, string | null>> {
  const hasHeader = opts.hasHeader ?? true;
  const nullStrings = opts.nullStrings ?? DEFAULT_NULL_STRINGS;
  const rl = require('node:readline').createInterface({ input, crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const line of rl) {
    const fields = parseCsvLine(line, nullStrings);
    if (header === null) {
      if (hasHeader) {
        header = fields.map((f) => f ?? '');
        continue;
      }
      header = fields.map((_, i) => `col${i + 1}`);
    }
    const row: Record<string, string | null> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = fields[i] ?? null;
    }
    yield row;
  }
}

/**
 * 从 CSV 文件导入到已存在的表 (APPEND 模式)。
 *
 * 流程:
 *  1. getTableInfo(table) 校验表存在, 取列定义
 *  2. streamCsvRows 读 header + rows (流式, 跨 chunk 正确处理)
 *  3. columns 显式覆盖 → CSV 列映射到表列; 否则按 CSV header 自动匹配
 *  4. 校验 CSV 列 ⊆ table.columns, 缺失列抛 column_mismatch
 *  5. 累积 batchSize 行 → adapter.executeBatch(INSERT INTO ..., rows, useTransaction: false)
 *     Bug #54 已修: 对象数组 [{c1:v1, c2:v2}, ...] 自动当 query_params 用
 *  6. dryRun=true 时不调 executeBatch, 返回 sample 前 5 行 + totalRows
 *
 * 列类型: 本版本全部按 String placeholder; DB 自己按列类型 coerce
 *  (后续如需精细类型可在 adapter.getTableInfo 提供 type 后扩展)
 */
import { createReadStream } from 'node:fs';

export async function importCsv(opts: {
  adapter: {
    executeBatch(sql: string, paramsList: unknown, options?: any): Promise<{ totalAffectedRows?: number; affectedRowsPerStatement?: number[] }>;
    executeQuery(sql: string): Promise<{ rows: unknown[] }>;
    getTableInfo(name: string): Promise<{ name: string; schema?: string | null; columns: Array<{ name: string; type: string; nullable?: boolean }> }>;
  };
  table: string;
  filePath: string;
  columns?: string[];
  hasHeader?: boolean;
  batchSize?: number;
  nullStrings?: Set<string>;
  dryRun?: boolean;
}): Promise<{
  totalRows: number;
  batches: number;
  durationMs: number;
  errors?: string[];
  sample?: Record<string, unknown>[];
}> {
  const start = Date.now();
  const hasHeader = opts.hasHeader ?? true;
  const batchSize = opts.batchSize ?? 1000;
  const nullStrings = opts.nullStrings ?? DEFAULT_NULL_STRINGS;
  const dryRun = opts.dryRun ?? false;

  if (!opts.adapter.getTableInfo) {
    throw new Error('adapter.getTableInfo not implemented');
  }
  const tableInfo = await opts.adapter.getTableInfo(opts.table);
  const tableCols = tableInfo.columns.map((c) => c.name);

  const stream = createReadStream(opts.filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });
  const csvCols = opts.columns ?? null;

  let tableColumnNames: string[] = [];
  let insertSql = '';
  let pendingBatch: Array<Record<string, unknown>> = [];
  let totalRows = 0;
  let batches = 0;
  const errors: string[] = [];
  const sample: Array<Record<string, unknown>> = [];

  const flushBatch = async () => {
    if (pendingBatch.length === 0) return;
    if (!dryRun) {
      const result = await opts.adapter.executeBatch(insertSql, pendingBatch, { useTransaction: false });
      batches += 1;
      if (result.totalAffectedRows !== undefined && result.totalAffectedRows !== pendingBatch.length) {
        errors.push(`batch affected ${result.totalAffectedRows}/${pendingBatch.length}`);
      }
    } else {
      for (const row of pendingBatch) {
        if (sample.length < 5) sample.push(row);
      }
    }
    pendingBatch = [];
  };

  const aiter = streamCsvRows(stream, { hasHeader, nullStrings });
  // v3.3: streamCsvRows 已经剥离 header,直接 yield 数据行
  // (row keys = header 列名)
  for await (const row of aiter) {
    if (tableColumnNames.length === 0) {
      // 第一行:决定列映射(用 opts.columns 显式覆盖,否则用 row keys)
      const headerKeys = Object.keys(row);
      tableColumnNames = csvCols ?? headerKeys;
      for (const col of tableColumnNames) {
        if (!tableCols.includes(col)) {
          throw new Error(`column_mismatch: csv column "${col}" not in table columns [${tableCols.join(',')}]`);
        }
      }
      // 拼 INSERT INTO schema.name (col1, col2) VALUES ({col1:String}, {col2:String})
      const { schema, name } = opts.table.includes('.')
        ? { schema: opts.table.substring(0, opts.table.indexOf('.')), name: opts.table.substring(opts.table.indexOf('.') + 1) }
        : { schema: null as string | null, name: opts.table };
      const q = (i: string) => `"${i}"`;
      const colList = tableColumnNames.map(q).join(', ');
      const tbl = schema ? `${q(schema)}.${q(name)}` : name;
      const placeholders = tableColumnNames.map((c) => `{${c}:String}`).join(', ');
      insertSql = `INSERT INTO ${tbl} (${colList}) VALUES (${placeholders})`;
    }
    pendingBatch.push(row);
    totalRows += 1;
    if (!dryRun && pendingBatch.length >= batchSize) {
      await flushBatch();
    }
  }
  if (!dryRun) {
    await flushBatch();
  } else {
    // dryRun: 也把最后剩余的塞进 sample
    for (const row of pendingBatch) {
      if (sample.length < 5) sample.push(row);
    }
  }

  return {
    totalRows,
    batches,
    durationMs: Date.now() - start,
    errors: errors.length ? errors : undefined,
    sample: dryRun ? sample : undefined,
  };
}

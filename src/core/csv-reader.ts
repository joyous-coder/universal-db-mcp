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
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

const DEFAULT_NULL_STRINGS = new Set(['', 'NULL', '\\N']);

/**
 * 解析单行 CSV (不含末尾换行符)。
 * 返回 (string | null)[] — 命中 nullStrings 的字段为 null。
 */
export function parseCsvLine(
  line: string,
  nullStrings: Set<string> = DEFAULT_NULL_STRINGS
): (string | null)[] {
  const trimmed = line.endsWith('\r\n') ? line.slice(0, -2) : line.endsWith('\n') ? line.slice(0, -1) : line;
  const out: (string | null)[] = [];
  let i = 0;
  const n = trimmed.length;
  while (i < n) {
    if (trimmed[i] === '"') {
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
 * streamCsvRows 已经剥离 header,直接 yield 数据行(每行 keys = header 列名)
 */
export async function* streamCsvRows(
  input: NodeJS.ReadableStream,
  opts: { hasHeader?: boolean; nullStrings?: Set<string> } = {}
): AsyncIterableIterator<Record<string, string | null>> {
  const hasHeader = opts.hasHeader ?? true;
  const nullStrings = opts.nullStrings ?? DEFAULT_NULL_STRINGS;
  const rl = createInterface({ input, crlfDelay: Infinity });
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
 * v3.3: 把对象数组 batch 转成 adapter 期望的形状。
 * - SQLite (`config.type === 'sqlite'`): 用 `?` 顺序 placeholder,需 raw value 数组。
 * - 其他 (CH/DM/MySQL/PG/...): 用 `{col:Type}` named placeholder,需对象数组
 *   (Bug #54 已修 — 对象数组会被自动当 query_params 用)
 */
export function _toAdapterBatch(
  pendingBatch: Array<Record<string, unknown>>,
  adapter: { config?: { type?: string } },
  tableColumnNames: string[]
): unknown {
  const dbType = adapter.config?.type;
  const isSqlite = dbType === 'sqlite';
  const isClickHouse = dbType === 'clickhouse';
  if (pendingBatch.length === 0) return pendingBatch;
  // v5.0.0: CSV row keys 可能跟 tableColumnNames 大小写不一致(CSV header 是用户写的,
  // tableColumnNames 是 getTableInfo 返回的 DB 实际 case)。先建 lowercase lookup map。
  const getValue = (row: Record<string, unknown>, key: string): unknown => {
    if (key in row) return row[key];
    const lowerKey = key.toLowerCase();
    for (const [rk, rv] of Object.entries(row)) {
      if (rk.toLowerCase() === lowerKey) return rv;
    }
    return undefined;
  };
  if (isSqlite) {
    // SQLite: positional ? placeholders, params 是按列顺序的值数组
    return pendingBatch.map((row) => tableColumnNames.map((k) => getValue(row, k)));
  }
  if (isClickHouse) {
    // ClickHouse: {col:String} named params,params 是 {col: value} 对象
    return pendingBatch;
  }
  // v4.0.9: 其他 DB (MySQL/PG/Oracle/DM/Kingbase/...) — 用 ? 占位符 (位置绑定),
  // params 是按列顺序的值数组
  return pendingBatch.map((row) => tableColumnNames.map((k) => getValue(row, k)));
}

/**
 * 从 CSV 文件导入到已存在的表 (APPEND 模式)。
 *
 * 流程:
 *  1. getTableInfo(table) 校验表存在, 取列定义 (兼容 SQLite {tableInfo} 与 CH 直接返回)
 *  2. streamCsvRows 读 header + rows (流式, 跨 chunk 正确处理)
 *  3. columns 显式覆盖 → CSV 列映射到表列; 否则按 CSV header 自动匹配
 *  4. 校验 CSV 列 ⊆ table.columns, 缺失列抛 column_mismatch
 *  5. 累积 batchSize 行 → adapter.executeBatch(INSERT INTO ..., rows, useTransaction: false)
 *     SQLite 用 raw 数组 + ? placeholder, 其他用对象数组 + named placeholder
 *  6. dryRun=true 时不调 executeBatch, 返回 sample 前 5 行 + totalRows
 */
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
  const rawInfo = await opts.adapter.getTableInfo(opts.table);
  // v5.0.1 Bug N11: Redis/MongoDB 等 NoSQL adapter 的 getTableInfo 默认返回 null,
  // 之前直接 `null.map()` 抛 NPE。改成显式报错(让上层 handler 也能 catch)。
  if (!rawInfo) {
    throw new Error(
      `getTableInfo returned null for table "${opts.table}" ` +
      `(NoSQL adapter 或未识别的表?)`,
    );
  }
  // v3.3: SQLite 包 {tableInfo, tableForeignKeys}, CH/DM/MySQL 等直接返回 {name, columns}
  const tableInfo = (rawInfo as any).tableInfo ?? rawInfo;
  const tableCols = tableInfo.columns.map((c: any) => c.name);

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
      // v3.3: SQLite 用 ? raw 数组, 其他用对象数组
      const batch = _toAdapterBatch(pendingBatch, opts.adapter as any, tableColumnNames);
      const result = await opts.adapter.executeBatch(insertSql, batch as any, { useTransaction: false });
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

  // v4.0.9: Oracle 默认存列名为大写,但 getTableInfo 可能返回小写 — 做大小写无关匹配,
  // 并用 tableInfo 的实际列名生成 INSERT,避免 bind 占位符大小写不一致。
  const tableColsLowerMap: Map<string, string> = new Map(
    tableCols.map((c: string) => [c.toLowerCase(), c]),
  );

  const aiter = streamCsvRows(stream, { hasHeader, nullStrings });
  for await (const row of aiter) {
    if (tableColumnNames.length === 0) {
      // 第一行: 决定列映射(用 opts.columns 显式覆盖, 否则用 row keys)
      const headerKeys = Object.keys(row);
      const csvColNames = csvCols ?? headerKeys;
      // 大小写无关匹配 → 映射到 tableInfo 实际列名(保持 DB 实际大小写)
      tableColumnNames = [];
      for (const csvCol of csvColNames) {
        const actual = tableColsLowerMap.get(csvCol.toLowerCase());
        if (actual === undefined) {
          throw new Error(
            `column_mismatch: csv column "${csvCol}" not in table columns [${tableCols.join(',')}]`,
          );
        }
        tableColumnNames.push(actual);
      }
      // 拼 INSERT INTO schema.name (col1, col2) VALUES (?, ?, ?)
// SQLite/MySQL/PG/Oracle/DM/Kingbase/... → ? (positional)
// ClickHouse → {col:String} (named with type)
// v4.0.9: 标识符**不加引号**(除非含特殊字符) — 让 Oracle 自动大写 / MySQL/PG/SQLite 大小写无关
const dbType = (opts.adapter as any).config?.type;
      const isClickHouse = dbType === 'clickhouse';
      const { schema, name } = opts.table.includes('.')
        ? { schema: opts.table.substring(0, opts.table.indexOf('.')), name: opts.table.substring(opts.table.indexOf('.') + 1) }
        : { schema: null as string | null, name: opts.table };
      // v4.0.9: 只对含特殊字符的标识符加引号 — 否则让 DB 自己 case fold
      const safeIdent = (i: string) =>
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(i) ? i : `"${i.replace(/"/g, '""')}"`;
      const colList = tableColumnNames.map(safeIdent).join(', ');
      const tbl = schema ? `${safeIdent(schema)}.${safeIdent(name)}` : safeIdent(name);
      const placeholders = isClickHouse
        ? tableColumnNames.map((c: string) => `{${c}:String}`).join(', ')
        : tableColumnNames.map(() => '?').join(', ');
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
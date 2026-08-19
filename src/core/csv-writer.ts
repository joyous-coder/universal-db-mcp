/**
 * CsvWriter — RFC 4180 CSV 序列化 (v3.3)
 *
 * 提供:
 *  - quoteField(value): 序列化单个值为 CSV 字段(自动 quote 含 , " \r \n 的字段)
 *  - rowToCsv(row, columns): 把一行记录拼成 CSV 行(不含换行符)
 *  - buildSelectSql(opts): 拼 SELECT SQL 模板(LIMIT/OFFSET 分页,WHERE/ORDER BY 注入防护)
 *  - exportTableCsv(opts): 流式 export 单表到 CSV 文件(自动分页 + writeStream)
 *
 * 编码: UTF-8 无 BOM (v3.3 用户确认)
 * 行终止符: \r\n
 * NULL: 空字符串
 */
import { createWriteStream } from 'node:fs';

/**
 * 把单个值序列化为 CSV 字段字符串。
 * 返回的字符串可直接拼接(已含 quote)。
 */
export function quoteField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '0x' + value.toString('hex');
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * v5.0.0: case-insensitive lookup。Adapter 之间对 row keys 大小写处理不一致
 * (Oracle 之前主动 lowercase,MySQL/Postgres/SQLite 保留原 case)。CSV writer
 * 用小写 lookup 表兜底,确保用户传 uppercase 列名也能命中 DB 返回的 lowercase keys
 * (或反过来)。
 */
function buildRowLookup(row: Record<string, unknown>): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    m.set(k.toLowerCase(), v);
  }
  return m;
}

/**
 * 把一行记录转成 CSV 行(不含末尾换行符)。
 * columns 决定列序;row 中缺失列输出空字符串。v5.0.0 起大小写不敏感。
 */
export function rowToCsv(row: Record<string, unknown>, columns: string[]): string {
  const lookup = buildRowLookup(row);
  return columns.map((col) => quoteField(lookup.get(col.toLowerCase()))).join(',');
}

/**
 * 解析 schema.table 格式。
 * 返回 {schema: string|null, name: string}。
 */
function parseTableName(table: string): { schema: string | null; name: string } {
  if (table.includes('.')) {
    const dotIdx = table.indexOf('.');
    return { schema: table.substring(0, dotIdx), name: table.substring(dotIdx + 1) };
  }
  return { schema: null, name: table };
}

/**
 * 拼接标识符为双引号包裹。
 * 只允许 [a-zA-Z_][a-zA-Z0-9_]* — 不允许多语句 / 注入。
 */
function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`invalid_identifier: ${ident}`);
  }
  return `"${ident}"`;
}

/**
 * 拼 SELECT SQL (v4.0.9: 移除 LIMIT/OFFSET — 兼容 Oracle/DM 等不支持的标准 SQL 方言)
 *
 * - columns=['*'] 直接用 *,否则逐个 quoteIdent 拼出 "col1","col2",...
 * - table 接受 "schema.table" 或 "table",前者 schema 与 name 都 quote
 * - where / orderBy 是字符串 SQL 片段(trusted path,只在白名单内用)
 *   含 ';' 视为注入,拒绝
 * - 不再 emit LIMIT/OFFSET — 需要分页请用 exportTableCsv 的 sql 参数自带
 */
export function buildSelectSql(opts: {
  table: string;
  columns: string[];
  where?: string;
  orderBy?: string;
}): string {
  const { schema, name } = parseTableName(opts.table);
  const cols =
    opts.columns.length === 1 && opts.columns[0] === '*'
      ? '*'
      : opts.columns.map(quoteIdent).join(', ');
  const tbl = schema ? `${quoteIdent(schema)}.${quoteIdent(name)}` : name;

  if (opts.where && /;/.test(opts.where)) {
    throw new Error('injection_blocked: where contains ";"');
  }
  if (opts.orderBy && /;/.test(opts.orderBy)) {
    throw new Error('injection_blocked: orderBy contains ";"');
  }

  const parts: string[] = [`SELECT ${cols} FROM ${tbl}`];
  if (opts.where) parts.push(`WHERE ${opts.where}`);
  if (opts.orderBy) parts.push(`ORDER BY ${opts.orderBy}`);
  return parts.join(' ');
}

/**
 * 流式导出单表 (或自定义 SQL) 到 CSV 文件 (v4.0.9 重构)
 *
 * 两种模式 (二选一,不能同时给):
 *   1. table 模式: 给 table [+ columns + where + orderBy] → 全表导出
 *      - 拼 SELECT cols FROM "schema"."table" [WHERE ...] [ORDER BY ...]
 *      - **不** 加 LIMIT/OFFSET (跨 DB 方言兼容)
 *   2. sql 模式: 给 sql → 原样执行 (用于 Oracle/DM 等特殊语法或带分页的查询)
 *      - 去掉末尾分号,其他保持不变
 *
 * 单次查询,无内部分页循环 — 大表请用 sql 模式自带 WHERE ROWNUM <= N 等方言分页。
 */
export async function exportTableCsv(opts: {
  adapter: {
    executeQuery(
      sql: string,
      params?: unknown[]
    ): Promise<{ rows: unknown[]; executionTime?: number }>;
  };
  table?: string;
  columns?: string[];
  where?: string;
  orderBy?: string;
  sql?: string;
  outputPath: string;
}): Promise<{
  totalRows: number;
  bytesWritten: number;
  durationMs: number;
  batches: number;
}> {
  const start = Date.now();

  if (!opts.table && !opts.sql) {
    throw new Error('exportTableCsv: 需要 table 或 sql 二选一');
  }
  if (opts.table && opts.sql) {
    throw new Error('exportTableCsv: table 与 sql 不能同时给');
  }

  const columns = opts.columns ?? ['*'];
  let sql: string;
  if (opts.sql) {
    sql = opts.sql.trim().replace(/;\s*$/, '');
  } else {
    sql = buildSelectSql({
      table: opts.table!,
      columns,
      where: opts.where,
      orderBy: opts.orderBy,
    });
  }

  const result = await opts.adapter.executeQuery(sql);
  const rows = result.rows as Array<Record<string, unknown>>;

  const stream = createWriteStream(opts.outputPath, { encoding: 'utf8' });
  // v4.0.9: 必须监听 'error' — 否则底层 file open 失败 (EISDIR/EPERM/...) 会让进程崩溃
  let streamError: Error | null = null;
  stream.on('error', (err) => {
    streamError = err;
  });
  let bytesWritten = 0;
  const writeChunk = (s: string) =>
    new Promise<void>((res, rej) => {
      if (streamError) return rej(streamError);
      stream.write(s, 'utf8', (err) => (err ? rej(err) : res()));
      bytesWritten += Buffer.byteLength(s, 'utf8');
    });

  // CSV header — columns=['*'] 时从首行推断列名
  const headerCols =
    columns.length === 1 && columns[0] === '*' && rows.length > 0
      ? Object.keys(rows[0])
      : columns;
  await writeChunk(headerCols.join(',') + '\r\n');

  let totalRows = 0;
  for (const row of rows) {
    await writeChunk(rowToCsv(row, headerCols) + '\r\n');
    totalRows += 1;
  }

  await new Promise<void>((res) => stream.end(res));
  return {
    totalRows,
    bytesWritten,
    durationMs: Date.now() - start,
    batches: 1,
  };
}

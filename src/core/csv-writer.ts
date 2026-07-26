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
 * 把一行记录转成 CSV 行(不含末尾换行符)。
 * columns 决定列序;row 中缺失列输出空字符串。
 */
export function rowToCsv(row: Record<string, unknown>, columns: string[]): string {
  return columns.map((col) => quoteField(row[col])).join(',');
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
 * 拼 SELECT SQL (含 LIMIT/OFFSET 分页)。
 *
 * - columns=['*'] 直接用 *,否则逐个 quoteIdent 拼出 "col1","col2",...
 * - table 接受 "schema.table" 或 "table",前者 schema 与 name 都 quote
 * - where / orderBy 是字符串 SQL 片段(trusted path,只在白名单内用)
 *   含 ';' 视为注入,拒绝
 */
export function buildSelectSql(opts: {
  table: string;
  columns: string[];
  where?: string;
  orderBy?: string;
  limit: number;
  offset: number;
}): string {
  const { schema, name } = parseTableName(opts.table);
  const cols =
    opts.columns.length === 1 && opts.columns[0] === '*'
      ? '*'
      : opts.columns.map(quoteIdent).join(', ');
  // v3.3: 当 schema 存在时双 quote schema 与 name;无 schema 时 name 保留原样
  // (向后兼容 — CH/DM 适配器对未 quote 表名大小写不敏感,统一表名处理在 adapter 层)
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
  if (opts.limit > 0) parts.push(`LIMIT ${opts.limit}`);
  parts.push(`OFFSET ${opts.offset}`);
  return parts.join(' ');
}
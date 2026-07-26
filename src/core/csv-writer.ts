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
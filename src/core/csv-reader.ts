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
/**
 * CSV Writer 单元测试 (v3.3)
 *
 * 覆盖 quoteField / rowToCsv:
 *  - RFC 4180 转义 (逗号 / 双引号 / 换行符)
 *  - NULL 序列化 (空字符串)
 *  - 类型转换 (Date → ISO, Buffer → hex)
 *  - rowToCsv 列序与缺失列
 */
import { describe, expect, it } from 'vitest';
import { quoteField, rowToCsv } from '../../src/core/csv-writer.js';

describe('CsvWriter', () => {
  it('quotes field containing comma', () => {
    expect(quoteField('a,b')).toBe('"a,b"');
  });
  it('quotes field containing double quote and escapes it', () => {
    expect(quoteField('a"b')).toBe('"a""b"');
  });
  it('quotes field containing newline', () => {
    expect(quoteField('a\nb')).toBe('"a\nb"');
  });
  it('leaves plain field unquoted', () => {
    expect(quoteField('hello')).toBe('hello');
  });
  it('emits empty string for null', () => {
    expect(quoteField(null)).toBe('');
    expect(quoteField(undefined)).toBe('');
  });
  it('serializes Date to ISO 8601', () => {
    const d = new Date('2025-07-26T08:43:00Z');
    expect(quoteField(d)).toBe('2025-07-26T08:43:00.000Z');
  });
  it('serializes Buffer to hex with 0x prefix', () => {
    expect(quoteField(Buffer.from([1, 2, 3]))).toBe('0x010203');
  });
  it('rowToCsv joins columns with comma', () => {
    const row = { id: 1, name: 'a,b', ts: new Date('2025-07-26T08:43:00Z') };
    expect(rowToCsv(row, ['id', 'name', 'ts'])).toBe(
      '1,"a,b",2025-07-26T08:43:00.000Z'
    );
  });
  it('rowToCsv handles missing column as empty string', () => {
    const row = { id: 1 };
    expect(rowToCsv(row, ['id', 'name'])).toBe('1,');
  });
});